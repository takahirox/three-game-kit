# M5 cross-runtime narrative

This document follows the implemented path from input to authoritative multiplayer presentation and
cleanup. It brings together the public Client Runtime, Shared movement, Protocol v1, the headless
Server, the optional external Interaction Feature, and their verification evidence. The detailed
contracts remain normative in the [MVP protocol](../protocol/mvp.md),
[runtime scheduling](./runtime-scheduling.md), [Interaction contract](../features/interaction.md),
and [two-client acceptance contract](../testing/two-client-acceptance.md).

Movement is the base cross-runtime path. Interaction is the one optional, consumer-owned Feature:
it uses the Protocol v1 `interact` action and interactable snapshot variant only when its server and
client adapters are installed. Interaction does not predict movement, run collision, or change an
avatar position. Removing it leaves movement runnable, and Core contains no Interaction-specific
branch.

## Ordered multiplayer stages

### 1. Physical or programmatic input becomes semantic intent

The Client input surface maps browser keyboard events, or direct calls to the programmable input
API, to a bounded semantic movement vector. Device events remain in the Client; Shared and the
Server receive only the authority-neutral `{ kind: "move", x, z }` action. The local browser example
shows the public input, Client Runtime, collision, camera, asset, and rendering composition in
[`examples/local-browser/main.ts`](../../examples/local-browser/main.ts).

Interaction begins separately as `{ kind: "interact", targetEntityId }`. `queueInteract` rejects an
invalid target synchronously and otherwise queues semantic intent. It never performs movement
prediction or local Interaction state mutation.

### 2. The Client assigns an exact tick and predicts only its owner

On each exact Client simulation tick, the replication engine runs these phases in order:
`snapshot-ingest`, `reconcile`, `action-sample`, `command-send`, `shared-predict`,
`predictive-collision`, `presentation-publish`, and `telemetry`. A sampled action receives the next
sequence and the current Client tick as `intendedTick`; the bounded pending history retains the
attempt until acknowledgement or rejection.

For movement only, Shared converts semantic axes, configured speed, and fixed `dt` into desired
translation. The Client applies that translation through its own private static-world collision
adapter and immediately publishes the predicted owner position. This lowers perceived input latency
but makes no authority claim: the Client sends neither position nor collision results, and it never
predicts peers. Interaction skips `shared-predict` and `predictive-collision`.

### 3. Protocol v1 carries the outbound command

The Protocol codec serializes one strict JSON object in one UTF-8 WebSocket text message:

```text
{ protocolVersion: 1, kind: "command", sequence, intendedTick, action }
```

The strict action is either movement `{ kind: "move", x, z }` or optional Interaction
`{ kind: "interact", targetEntityId }`. Unknown fields, coercion, arrays, scalars, `null`, binary
frames, malformed JSON, wrong-direction messages, and values outside the Protocol bounds are not
accepted. Protocol codecs own JSON parsing and serialization. See
[`@three-game-kit/protocol`](../../packages/protocol/README.md) and the
[versioned wire contract](../protocol/mvp.md#fixed-version-1-boundary).

### 4. WebSocket ingress resolves server-owned identity

The real WebSocket adapter accepts text frames, enforces transport bounds, decodes with the Client-to-
Server codec, and copies valid messages into bounded ingress. Transport callbacks do not mutate the
World, run gameplay or collision, reconcile, or build snapshots.

Join establishes the server-owned live binding:

```text
socket/generation -> ordinal -> connectionId -> playerId -> ownedEntityId -> runtime-local EntityId
```

The Server allocates the connection, player, and wire entity IDs and creates the authoritative avatar
and private collision capsule as one transaction. No Client-to-Server message contains an owner,
player, connection, or session claim. Command authority is always recovered from the emitting socket,
its current generation, and this live binding. A reconnect or resumable session is not part of this
connection lifecycle.

### 5. Validation admits or rejects without partial gameplay mutation

Ingress and `validate-bind` apply the implemented gates in deterministic order:

1. live adapter, connection, generation, and phase fences;
2. complete text-frame size, UTF-8, JSON, Protocol version, direction, kind, and strict schema;
3. the per-connection pending-command capacity;
4. the next exact sequence;
5. the intended-tick window from six ticks in the past through two ticks in the future;
6. the connection-derived player/entity/capsule ownership chain;
7. action availability and action-specific validation; and
8. atomic sequence admission, movement-slot reservation where applicable, and scheduling.

Protocol schemas require finite, bounded positions and finite movement axes in `[-1, 1]` whose
length is at most one. Authoritative movement additionally requires a positive finite configured
speed no greater than 10 m/s, a bounded one-tick translation, and no second movement command for the
same connection and intended tick. These failures are `schema-invalid` or `movement-limit` at their
documented boundary.

Interaction is consulted only after the common connection, sequence, tick, and ownership gates. If
its external adapter is absent, an otherwise valid `interact` is `phase-invalid`. When installed, the
Server validates the configured finite target and range against the authoritative actor position;
failures are `unknown-target` or `interaction-out-of-range`. The target ID is untrusted selection
data, not proof of identity or ownership.

Other command reasons are `unsupported-version`, `unknown-kind`, `wrong-direction`,
`sequence-invalid`, `tick-out-of-window`, `queue-full`, `ownership-violation`, and
`stale-connection`. Each expected command rejection increments exactly one matching bounded counter
and records one immutable expected runtime-error record before an optional `rejected` response.
Precise decode and frame diagnostics are retained; failures that cannot establish a command attempt
do not invent a command sequence. A rejection does not advance accepted sequence, call Shared or
collision, mutate authority, or leave scheduled work behind.

### 6. The authoritative Server advances fixed gameplay ticks

The Server owns a 60 Hz logical clock with `dt = 1/60` and executes:

```text
ingress -> validate-bind -> command-apply -> shared-movement
        -> authoritative-collision -> gameplay -> snapshot-build -> telemetry
```

Due commands are ordered by intended tick, server connection ordinal, and sequence. Shared computes
movement translation; the Server then moves its own capsule through its own private static Rapier
scene and copies only a finite effective result into authoritative state. Client collision cannot
overwrite this state. There is no rewind or late resimulation.

An admitted Interaction command does no work in the movement or collision phases. Its external
server adapter applies the validated toggle exactly once in `gameplay`.

### 7. Snapshots replicate post-gameplay authority

At ticks divisible by three, `snapshot-build` emits a recipient-specific strict snapshot. This is
20 snapshot opportunities per 60 authoritative ticks. Each snapshot contains the authoritative
`serverTick`, that recipient's contiguous completed `acknowledgedSequence`, and detached avatar
entities. With Interaction installed, its validated detached interactable entity is included beside
the avatars. Snapshot state is built after collision and gameplay, so it reflects the completed
authoritative tick.

### 8. The owner reconciles prediction

The Client buffers bounded, monotonically newer snapshots. During `reconcile`, it retires acknowledged
history, installs the owner's authoritative position, and replays remaining movement attempts through
Shared movement and the Client's private collision adapter. A matching rejection retires that command
and later dependent history before the simulation is rebuilt from the newest authority. Simulation
snaps to authority; the presentation correction offset decays over the bounded correction interval.

Interaction acknowledgements and rejections retire command history through the same sequence
mechanism, but there is no Interaction prediction to replay.

### 9. Peers interpolate snapshots; Interaction presents latest state

On an explicit presentation frame, the Client runs `remote-interpolation`, `camera-view`, `render`,
and `frame-telemetry`. Peer avatars are derived only from authoritative snapshot samples and are
interpolated at the presentation target tick without consuming another client's commands or
extrapolating authority.

Interactables take a different path: the Client presents the newest authoritative snapshot values
exactly, detached and sorted by entity ID. Their position and `active` state are not interpolated;
absence from the newest snapshot removes them from presentation.

### 10. Disconnect fencing prevents stale authority

A close, error, protocol-fatal frame, or explicit disconnect enters `disconnecting` once. Generation
and live-record fences stop callbacks and queued work from regaining authority. Pending commands are
purged with bounded `stale-connection` observability; the Server removes the binding, avatar, capsule,
movement reservations, and connection resources while other joined clients remain independent.
Client replication clears pending actions, history, snapshot buffers, peer/interactable presentation,
and correction state.

### 11. Shutdown, rollback, and cleanup converge

Join/setup failure rolls back partial IDs, mappings, entities, capsules, listeners, and Feature-owned
resources in reverse acquisition order. Runtime and networking shutdown fence new work before closing
connections and owned transports, dispose installed Features and owned resources, and converge on
terminal state. Repeated shutdown returns the completed result without a second mutation. Borrowed
host adapters remain caller-owned; the external Interaction Feature releases only what it acquired.
The acceptance and packed-consumer checks assert zero remaining live-resource gauges.

## Non-networked single-player option

A consumer can build a local-only game from the public Client Runtime plus Shared movement and local
collision/rendering, as demonstrated by [`examples/local-browser`](../../examples/local-browser).
Physical or programmatic input becomes semantic movement, Shared computes the desired translation,
the Client's local collision adapter resolves it against its static scene, and the Client camera and
renderer present the result.

This composition has no Server, Protocol transport, replication, network identity, reconnect
behavior, or multiplayer authority claim. Its local state is the whole game state for that process.
It is a documented non-networked single-player option, not a substitute for server validation,
ownership checks, rejection behavior, reconciliation, disconnect fencing, or any other multiplayer
evidence.

## Evidence and verification

The implementation is covered at complementary boundaries:

- Unit tests cover Core scheduling/lifecycle/telemetry, Protocol codecs, Shared movement, Client
  input/replication/Interaction, and Server authority/collision/validation.
- Node and real-WebSocket integration tests cover networking phases, ingress edges, rejection
  counters, disconnect fences, and cleanup.
- Exact-step headless tests cover deterministic Client and Server phase ordering, movement,
  authority, snapshots, rollback, and double shutdown.
- The canonical Playwright test starts one Server and two isolated browser contexts, proves owner
  prediction, static collision, 20 Hz replication, reconciliation, peer interpolation, rejection
  isolation, disconnect cleanup, and zero-resource repeated shutdown. See
  [M3 verification](../m3-verification.md) and the
  [two-client test](../../tests/acceptance/two-client.spec.ts).
- The external consumer builds against public imports and tests optional Interaction composition.
  The packed-consumer verifier packs all five kit packages, installs their tarballs outside the
  workspace graph, checks resolved exports, builds the fixture, and runs its tests. See
  [M4 verification](../m4-verification.md),
  [cross-runtime Interaction authoring](../authoring/cross-runtime-interaction.md), and
  [`examples/external-interaction-consumer`](../../examples/external-interaction-consumer/README.md).

From the repository root, the complete aggregate is:

```sh
pnpm verify:m5
```

It runs the workspace build, strict type checks, unit/headless/WebSocket suites, browser examples and
canonical two-context acceptance, catalog checks, packed external-consumer proof, and release archive
inspection through the scripts declared in [`package.json`](../../package.json).
