# MVP protocol and authority contract

- **Status:** Accepted
- **Milestone:** M0
- **Protocol version:** 1
- **Applies to:** `@three-game-kit/protocol`, Client networking and prediction, Server networking and authority, Shared movement, runtime scheduling, lifecycle, collision, and telemetry

## Purpose and precedence

This is the single operational contract for the bounded Milestone 3 multiplayer slice. It composes,
without replacing, ADR 0005, ADR 0006, the runtime scheduling contract, ADR 0004, the Feature
lifecycle contract, and the structured errors and telemetry contract. Those accepted documents
remain normative. If this document is ambiguous, their exact constants, schemas, phase names,
ordering rules, lifecycle states, cleanup orders, and vocabularies control; this document must not
be read as relaxing or renaming them.

The slice is one authoritative headless Server and browser Clients connected by the selected
WebSocket text transport. Shared supplies authority-neutral movement rules. Each Client predicts
only its owned avatar in its own private Rapier World. Only the Server's World, live bindings, and
private Rapier collision produce authoritative state and snapshots.

## Fixed version 1 boundary

Every application message is exactly one strict, runtime-validated JSON object in one UTF-8
WebSocket text message. Binary delivery is rejected and is never converted to text. Unknown fields
at any depth, unknown kinds, missing fields, coercible values, wrong primitive types, arrays,
scalars, `null`, and more than one JSON value are invalid. Protocol codecs, rather than Client or
Server runtime code, perform every protocol `JSON.parse` and `JSON.stringify`.

ADR 0005 owns these exact version 1 constants:

| Constant | Value |
| --- | ---: |
| `PROTOCOL_VERSION` | `1` |
| `MAX_MESSAGE_BYTES` | `16_384` |
| `MAX_ID_LENGTH` | `64` |
| `MAX_SEQUENCE` | `4_294_967_295` |
| `MAX_TICK` | `9_007_199_254_740_991` |
| `MAX_PAST_TICKS` | `6` |
| `MAX_FUTURE_TICKS` | `2` |
| `MAX_PENDING_COMMANDS` | `128` |
| `MAX_BUFFERED_SNAPSHOTS` | `32` |
| `MAX_SNAPSHOT_ENTITIES` | `256` |
| `MAX_POSITION_ABS` | `1_000_000` |
| `MAX_MOVEMENT_SPEED` | `10` |

Opaque wire IDs match `^[A-Za-z0-9_-]{1,64}$`, are case-sensitive, and have no
client-interpreted structure. Sequences and ticks are non-negative safe integers within the bounds
above. A `Position` is the strict object `{ x, y, z }`; each coordinate is finite and in
`[-1_000_000, 1_000_000]`. Movement axes are finite values in `[-1, 1]`, and
`x * x + z * z <= 1`.

The complete Client-to-Server schema is:

| `kind` | Exact fields |
| --- | --- |
| `join` | `{ protocolVersion: 1, kind: "join" }` |
| `command` | `{ protocolVersion: 1, kind: "command", sequence, intendedTick, action }` |

The strict `action` union is:

| `action.kind` | Exact fields |
| --- | --- |
| `move` | `{ kind: "move", x, z }` |
| `interact` | `{ kind: "interact", targetEntityId }` |

The complete Server-to-Client schema is:

| `kind` | Exact fields |
| --- | --- |
| `joined` | `{ protocolVersion: 1, kind: "joined", connectionId, playerId, ownedEntityId, serverTick }` |
| `snapshot` | `{ protocolVersion: 1, kind: "snapshot", serverTick, acknowledgedSequence, entities }` |
| `rejected` | `{ protocolVersion: 1, kind: "rejected", sequence, reason }` |

`acknowledgedSequence` and `rejected.sequence` are `null` or an integer from `1` through
`MAX_SEQUENCE`. Snapshot `entities` contains at most 256 records and no duplicate `entityId`.
Its strict entity union is:

| `entityKind` | Exact fields |
| --- | --- |
| `avatar` | `{ entityKind: "avatar", entityId, playerId, position }` |
| `interactable` | `{ entityKind: "interactable", entityId, position, active }` |

The rejection vocabulary is exactly:

- `schema-invalid`
- `unsupported-version`
- `unknown-kind`
- `wrong-direction`
- `phase-invalid`
- `sequence-invalid`
- `tick-out-of-window`
- `queue-full`
- `ownership-violation`
- `movement-limit`
- `unknown-target`
- `interaction-out-of-range`
- `stale-connection`

No alias or additional wire rejection reason is permitted. Decode failures retain ADR 0005's exact
stages and reasons, and encode failures retain its exact result union and reasons. A malformed
message need not receive a wire rejection when a safe sequence is unavailable or the transport is
closing, but it is still observed locally under the telemetry rules.

The Interaction action and interactable snapshot variant are reserved in version 1 for Milestone 4.
Without the external Interaction Feature installed, an otherwise valid `interact` command is
unsupported and is rejected `phase-invalid` without sequence admission or authoritative mutation.
Installing that external Feature activates target existence, connection-derived avatar authority,
finite configured range, `unknown-target`, and `interaction-out-of-range` checks; a target ID is
only untrusted data and never an ownership credential. The base movement slice does not contain an
Interaction-specific branch in Core.

## Server-issued identity and binding

An accepted socket receives a private, monotonically increasing server connection ordinal. The
ordinal is not sent on the wire and is used only for deterministic server ordering and cleanup.
During a valid join, the Server allocates a connection ID, player ID, and wire entity ID, creates the
authoritative avatar and its private Server collision capsule, and atomically installs this live
binding:

`socket/generation -> ordinal -> connectionId -> playerId -> ownedEntityId -> runtime-local EntityId`

Every server-issued connection, player, or entity ID, including interactable entity IDs, is exactly
128 random bits encoded as 22 ASCII characters of unpadded base64url. Production allocation uses a
cryptographically secure random-byte source, retries a collision, and never derives one ID from
another or embeds the ordinal, time, address, or gameplay data. This exact 22-character server
output is a stricter allocation rule within ADR 0005's 64-character schema bound.

The allocator accepts an injected deterministic 16-byte generator for tests. Test composition must
select it explicitly, must prove stable and collision-testable allocation, and must make it
impossible to select through production configuration. Deterministic IDs, and all MVP IDs generally,
are correlation labels only: the generator is never used as production authentication, and
possession or prediction of any ID grants no authority.

No Client-to-Server schema contains a connection, player, owned-entity, session, or ownership claim.
A Client cannot select identity during join, command routing, or reconnect. Extra identity fields
fail strict decoding. `targetEntityId` in an Interaction is only a requested target. Runtime-local
Core `EntityId` values and private Rapier handles never cross the wire.

The emitting socket and its current generation select the private connection record. Every command
resolves authority from that record and its live binding. A missing entity, mismatched player/entity
mapping, or avatar not owned by that binding is `ownership-violation`; a dead generation or
invalidated record is `stale-connection`. No lookup by a client-provided wire ID may select the
command's owner.

## Transport readiness and join phases

There is no `ready` protocol message. Transport readiness and gameplay join are distinct.

The exact successful Client path is
`idle -> connecting -> ready -> joining -> joined`. Native WebSocket `open` establishes
`ready`; the Client then sends the strict `join` exactly once and enters `joining`. Only a
valid `joined` response installs the returned binding and permits commands. A command before
`joined`, a second join, or an application send while disconnecting or closed is
`phase-invalid` or the corresponding structured transport-state failure and never waits for a
later phase.

The exact successful Server connection path is
`connected -> ready -> joining -> joined`. `connected` installs listeners and a generation
fence. `ready` accepts exactly one strict `join`. The Server enters `joining`, allocates all
three IDs, creates the avatar and collision capsule, and commits the binding as one transaction.
Only then does it enter `joined` and send `joined` with the current logical `serverTick`.
Allocation or setup failure rolls back every partial ID mapping, entity, capsule, and binding before
the connection closes. A second join is `phase-invalid`.

A local close, peer close, transport error, protocol-fatal frame, or shutdown enters
`disconnecting` once and converges on terminal `closed`. Connection instances do not reconnect
or resume.

## Ingress, validation, and admission

Transport callbacks may validate and copy only. They never mutate a World, apply gameplay, run
collision, reconcile, or build a snapshot. A command occupies one of its connection's 128 pending
slots from decoded enqueue until rejection, application, or purge; decoded ingress and accepted
scheduled work share this single bound and there is no fallback queue.

Inbound processing has this exact precedence:

1. Re-check adapter, connection, generation, and live fences. Work already stale may emit one
   bounded `stale-connection` diagnostic but performs no decode or enqueue.
2. Enforce a complete non-binary UTF-8 text message of at most 16,384 bytes before JSON parsing.
3. Run the strict Client-to-Server direction codec. Its precise frame/JSON/schema/direction failure
   is retained; command-rejection counting follows the telemetry mapping below.
4. For a decoded message, enforce the connection phase. `join` is legal only in Server `ready`;
   `command` is legal only in `joined`.
5. For a decoded command, check the shared 128-slot pending capacity. If full, reject
   `queue-full`; otherwise copy and enqueue it for the next Server `ingress` phase.

During a tick, `ingress` drains copied commands without applying them. `validate-bind` visits
connections by ascending server connection ordinal and each connection's messages by WebSocket
arrival order. It applies this exact validation order to each queued command:

1. Re-resolve the same live connection generation and joined binding; reject
   `stale-connection` if it is no longer live and `phase-invalid` if its live phase is wrong.
2. Require sequence `1` when no command has been accepted, otherwise exactly the previous accepted
   sequence plus one; reject reuse, regression, a gap, or exhaustion as `sequence-invalid`.
3. At validation tick `T`, require
   `max(0, T - 6) <= intendedTick <= min(MAX_TICK, T + 2)`; otherwise reject
   `tick-out-of-window`.
4. Resolve the connection-owned player, wire entity, runtime-local entity, authoritative movement
   state, and private Server capsule. Reject a mismatched or missing ownership mapping as
   `ownership-violation`.
5. Validate action availability and action-specific authoritative preconditions. Without the
   external Feature, `interact` is `phase-invalid`; with it, target and range failures use only
   `unknown-target` and `interaction-out-of-range`.
6. For `move`, require no earlier accepted movement command for this connection and
   `intendedTick`, and require configured speed to be positive, finite, no greater than 10 m/s,
   with the resulting one-tick desired translation within that ceiling. A duplicate movement slot
   or speed failure is `movement-limit`. Axis representation and unit-disc failures have already
   failed the strict schema as `schema-invalid`.
7. Atomically accept: advance accepted-sequence state, reserve the movement slot when applicable,
   and place the command in the bounded scheduled set. A rejection performs none of these actions
   and frees its pending slot.

The movement-slot reservation remains until its intended tick can no longer re-enter the six-tick
past window; disconnect and shutdown clear it. Consequently, at most one movement action is ever
accepted for one connection and one intended tick, including when a second attempt arrives after
the first was applied.

Each rejected attempt chooses the first applicable reason in this order. It does not advance
accepted sequence, remain queued, call Shared, call Rapier, mutate a binding, entity, component, or
authoritative position, or build a snapshot from changed gameplay state.

## Tick scheduling and authoritative application

The Server advances at exactly 60 logical ticks per simulated second with `dt = 1/60`. Its exact
phases are:

1. `ingress`
2. `validate-bind`
3. `command-apply`
4. `shared-movement`
5. `authoritative-collision`
6. `gameplay`
7. `snapshot-build`
8. `telemetry`

Async data arriving after its owning phase begins waits for that phase on the next tick. At
validation tick `T`, an accepted command with `intendedTick <= T` is due at the next
`command-apply` phase, which is the phase later in tick `T`. An accepted command with
`intendedTick > T` is due at `command-apply` on exactly `intendedTick`. There is no rewind,
late simulation, or rollback.

At each `command-apply`, all due accepted commands are sorted by original `intendedTick`, then
ascending server connection ordinal, then ascending sequence. That order is independent of callback
timing, map iteration, opaque ID spelling, or Feature setup completion. A future sequence can
therefore remain unapplied while a later sequence with an earlier intended tick becomes due; the
acknowledgement frontier below never skips that gap.

A movement command supplies semantic axes for one authoritative tick. Shared computes one desired
translation from those axes, configured speed, and `dt`. The Server synchronizes the owned
capsule from current authoritative kit-owned position, runs its own private zero-gravity Rapier
kinematic character controller against its trusted static scene, and copies only the effective
translation and finite result back to authoritative state. The controller offset is 0.01 m,
sliding is enabled, and autostep and snap-to-ground are disabled. The Client sends no position,
velocity, collision result, grounded flag, collider identity, scene configuration, or Rapier value.

Snapshots are built only after `shared-movement`, `authoritative-collision`, and `gameplay`.
Thus every avatar position in a snapshot is the post-collision Server position. Client prediction
or collision can never overwrite it.

## Snapshot cadence and acknowledgements

The Server builds periodic snapshot state exactly when `serverTick % 3 === 0`: ticks 3, 6, 9, and
so on. At 60 Server ticks per simulated second this is exactly 20 Hz. It builds no periodic
snapshot on either intervening tick and does not synthesize extra snapshots after a wall-clock
stall. Each joined recipient receives its own schema-valid snapshot, subject to transport state;
`serverTick` is the tick whose post-collision state it contains.

For one recipient, `acknowledgedSequence` is `null` until at least sequence 1 has completed its
authoritative application. Thereafter it is the greatest sequence N such that every accepted
sequence from 1 through N has completed all authoritative phases that can affect its result before
this snapshot. Receipt, decode, queueing, validation, or future scheduling alone is never
acknowledgement. Rejected commands are never acknowledged.

Application may occur out of sequence because intended tick dominates sequence. The Server tracks
completed accepted sequences and advances the acknowledgement only across a contiguous prefix. For
example, if sequence 2 applies while accepted sequence 1 is still scheduled for a future tick, the
snapshot remains `null`; after sequence 1 completes, the next snapshot may acknowledge 2.
Acknowledgement is recipient-specific and never acknowledges another connection's commands.

The Client retains at most 32 decoded snapshots in strictly increasing `serverTick` order.
Duplicate or older snapshots are discarded. Inserting a newer snapshot at capacity discards
exactly the oldest. Control and rejection messages are handled immediately and are not snapshot
buffer entries.

## Client prediction, reconciliation, and presentation

The Client simulation phases are exactly:

1. `snapshot-ingest`
2. `reconcile`
3. `action-sample`
4. `command-send`
5. `shared-predict`
6. `predictive-collision`
7. `presentation-publish`
8. `telemetry`

A sampled local move creates the next candidate sequence and intended tick, sends semantic intent,
and is applied to the owned predicted state in the same Client tick. `presentation-publish`
exposes that finite predicted transform. The next independently delivered presentation frame can
therefore show local motion before a delayed Server response.

In `snapshot-ingest`, the Client admits only a newer valid snapshot. In the immediately following
`reconcile` phase, it uses the newest authoritative owned-avatar position, discards prediction
history through `acknowledgedSequence`, replaces simulation position with that authoritative
position, and replays the still-unacknowledged local movement history through Shared and the
Client's private Rapier adapter. A `rejected` response removes the rejected attempt from prediction
history; because rejection does not advance Server sequence state, later candidate sequencing must
again begin at the Server's next required sequence. Reconciliation changes simulation state in that
single phase; simulation is never eased, blended, or rewound across later ticks.

Presentation may hide the visual discontinuity without becoming authoritative. It preserves the
pre-reconciliation displayed position as a finite presentation-only correction offset and decreases
that offset monotonically to zero over no more than 500 ms. The owning avatar must be within 0.05
world units of the latest authoritative position by 500 ms after a forced displacement. The offset
never feeds simulation, collision, commands, or reconciliation, and presentation always converges
to the immediately reconciled simulation state.

Client presentation frames have exactly
`remote-interpolation -> camera-view -> render -> frame-telemetry`. For remote avatars, the
presentation target is the Client's monotonic estimate of Server tick minus exactly six ticks,
which is 100 ms at 60 Hz. That clock estimate may advance from received `serverTick` values; it
does not predict entity state. When snapshots bracket the target, presentation linearly
interpolates finite positions. Before the target reaches the oldest sample it holds the oldest; if
no newer bracketing authoritative sample exists it holds the newest available sample. It never
derives velocity or position beyond the newest authoritative snapshot. There is no authoritative
extrapolation, and remote interpolation never mutates either Client simulation World.

## Disconnect and shutdown

When disconnect begins, the Server immediately flips the connection live fence and invalidates the
socket/session/player/entity binding and accepted-sequence state. It cancels timers, detaches
admission listeners, purges decoded and scheduled commands plus movement-slot state, and prevents
every delayed callback from decoding, enqueueing, sending, or mutating authority. A purged command
with an already safely decoded sequence may be observed once as `stale-connection`; no response is
required after close begins.

Normal disconnect removes the owned authoritative entity and its private Server capsule immediately
when safe, and no later than the end of the second Server tick after disconnect begins. Other
connections, bindings, queues, sequence state, avatars, and collision objects remain live and
unchanged. A stale command cannot recreate a binding, avatar, or capsule.

Runtime shutdown is terminal and idempotent. It first flips the runtime and scheduler live fences,
stops pumps and frame requests, and prevents new ticks, frames, mailbox admission, and setup
publication. Client networking invalidates its binding and sequence state, cancels timers, removes
listeners, clears snapshot and delayed-delivery queues, closes the native socket, clears its
reference, and reaches `shutdown`. Server networking stops upgrades, then visits connection
records in ascending ordinal; each binding is invalidated and each queue purged before its socket is
terminated. It then closes the WebSocket and HTTP servers and clears all maps, listeners, timers,
and references.

Shutdown does not wait for another tick. Any remaining authoritative avatar and private capsule are
removed during teardown. Successfully set-up Features are fenced, unpublished, disposed, and
ledger-released in exact reverse setup/acquisition order; collision systems and private Rapier
objects are removed before the runtime-owned ECS World, which is disposed last. Cleanup continues
after bounded failures. The final telemetry snapshot must show zero live owned resources, bindings,
avatars, queues, callbacks, Worlds, and retained references. Repeated stop, dispose, or shutdown
returns the same promise/result and performs no additional transition, cleanup, counter, observer,
or telemetry mutation.

## Telemetry and errors

Each Client and the Server owns a separate bounded telemetry store. Every legal transport and
connection state edge emits exactly one transition record. Every expected command rejection emits
exactly one immutable expected `RuntimeErrorRecord` and increments exactly one matching entry in
the Server's complete 13-reason `rejectedCommandCounts` map before an optional `rejected`
response. A propagated result is not recorded again.

Server ingress maps `unsupported-version`, `unknown-kind`, `wrong-direction`, and
`schema-invalid` directly. `invalid-json` and `not-json-object` count as
`schema-invalid` while their error record retains the precise decode classification.
`binary-frame`, `message-too-large`, and `invalid-utf8` cannot establish a command attempt;
they emit an expected transport record without a command reason or rejection-counter increment.
Client snapshot decode and encode failures likewise do not increment Server command counters.

Telemetry reports the accepted schema-version 1 snapshots: logical tick, finite Client frame or
Server tick duration, Server backlog and discarded wall time, entity count, resolved installed
Feature IDs, frozen schedule report, connection state/history, complete rejection counts,
structured errors, and live-resource gauges. Timing and telemetry never affect authority or
scheduling. Records contain only bounded sanitized kit-owned data and trusted correlation IDs; they
never contain raw payloads, credentials, addresses, URLs, socket or HTTP objects, Zod issues,
Rapier handles, DOM/Three.js objects, stacks, or arbitrary thrown values. Unexpected async or
invariant failures are captured once and cannot escape as uncaught errors.

## Protocol evolution

Version 1 has no negotiation, downgrade, fallback, reconnect migration, or silent compatibility
mode. Any field addition, removal, rename, semantic reinterpretation, discriminator change, or
bound relaxation that changes an accepted wire value requires a new protocol-version literal and
parallel strict direction schemas during an explicit migration. A receiver never silently accepts
both shapes as version 1. Unknown versions are `unsupported-version`.

Same-build Clients and Server use one selected version. A later migration must document which
versions a build sends and receives, how lifecycle chooses one before join, how telemetry
distinguishes them, and when the old parallel schemas can be removed. Opaque IDs and
`acknowledgedSequence` do not provide resume or cross-version authority.

## Message flow

```text
Client simulation                         WebSocket                         Server tick
action-sample -> command-send  -- command(seq, intendedTick, move) -->  ingress
shared-predict -> predictive-collision                                 validate-bind
presentation-publish                                               -> command-apply
next frame renders predicted owner                                  -> shared-movement
                                                                     authoritative-collision
                                                                     gameplay
snapshot-ingest <- snapshot(tick, ack, post-collision entities) --  snapshot-build (tick % 3 == 0)
reconcile immediately; replay unacked                               telemetry
remote-interpolation (owner excluded, six ticks delayed) -> camera-view -> render
```

## Objective Milestone 3 verification

Automated M3 evidence must establish all of the following:

1. Round-trip every version 1 variant through the direction codecs and table-test strict unknown
   fields, wrong direction, unknown kind/version, binary, invalid UTF-8/JSON/root, the 16,384-byte
   boundary, every numeric edge, duplicate entity IDs, and the 32-snapshot and 128-command bounds.
   Each failure has its exact reason and no queue or World mutation.
2. With an injected deterministic ID generator, prove each join produces three distinct
   22-character unpadded-base64url IDs from 16 bytes and the exact Client and Server state paths.
   Forged join/command identity fields fail schema; target IDs and cross-client labels never select
   ownership. A production-construction test proves the deterministic generator cannot be selected
   and no ID is treated as authentication.
3. Multi-invalid command cases prove the documented validation precedence. Sequences accept exactly
   1 then 2 with no gap or wrap; at tick 100, ticks 94 through 102 are accepted and 93/103 rejected;
   the 129th pending command is `queue-full`; and a second move for one
   connection/intended-tick is `movement-limit`. Every rejection preserves accepted state and
   increments exactly one reason.
4. Schedule past, present, and future commands from multiple connections in scrambled callback
   order. Prove past/present commands apply at the next `command-apply`, future commands at their
   intended tick, and observed order is exactly intended tick, connection ordinal, then sequence.
   No Shared or Rapier call occurs before admission.
5. Advance exactly 60 Server ticks. Prove snapshots are generated only at ticks 3, 6, ..., 60,
   exactly 20 opportunities, and contain post-collision authoritative positions. Delay sequence 1
   past applied sequence 2 and prove acknowledgement remains null until the contiguous completion
   frontier reaches 2; rejected and merely queued commands are never acknowledged.
6. Use separate Client and Server Rapier Worlds with the same copied static scene. Prove a Client
   forged or perturbed collision result cannot cross the strict schema or affect Server collision;
   the authoritative capsule respects the ADR 0004 obstacle tolerances and every snapshot equals
   the Server's copied post-collision position.
7. In one Client tick, prove local semantic movement reaches finite predicted presentation by the
   next explicit frame before a delayed response. Force authoritative displacement and prove
   simulation reconciliation completes in one `reconcile` phase, unacknowledged input is replayed,
   and presentation converges within 0.05 world units in 500 ms.
8. For a remote avatar, prove the presentation target is six Server ticks/100 ms behind, bracketing
   snapshots interpolate, missing future data holds an authoritative sample, no extrapolated
   transform is produced, and presentation frames perform no World mutation or collision.
9. Use one real loopback `ws` 8.x Server and two storage-isolated bundled-Chromium contexts with
   the canonical deterministic 100 ms RTT, 0-20 ms jitter, zero-loss profile. Prove exactly 60
   Server ticks per simulated second, owner prediction, peer replication without peer-command
   consumption, forced correction, finite transforms, exact rejection telemetry, and no uncaught
   Client or Server errors.
10. Disconnect one Client with queued and delayed work. Immediately prove its binding is invalid and
    queues are purged; after at most two exact Server ticks prove its entity and capsule are gone,
    its stale work cannot mutate state, and the other Client remains joined. Shut down every runtime
    twice and prove the exact close/disposal order, one cached result, and zero live-resource gauges.
11. Without the external Interaction Feature, prove a valid `interact` is `phase-invalid` and
    causes no sequence admission or mutation. Boundary and version tests prove the Interaction
    schema remains present, version 1 rejects additive fields, and changed wire acceptance requires
    a distinct parallel version schema.

## Deliberate exclusions

The MVP has no reconnect or resume, client-selected identity or ownership, alternate transport,
binary encoding, persistence, production authentication, cryptographic anti-replay, matchmaking,
lag compensation, rollback netcode, deterministic lockstep, nonzero-loss guarantee, graceful
application-message delivery guarantee, dynamic or rigid-body replication, or production
operations/security claim. None may be inferred from opaque IDs, WebSocket ordering, prediction,
telemetry, the test generator, or the zero-loss acceptance profile.
