# ADR 0005: Zod JSON protocol boundary

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

Milestone 0 must freeze one runtime-validation and encoding contract before Client and Server
networking are implemented. TypeScript declarations disappear at runtime, `JSON.parse` produces an
untrusted value, and a syntactically valid object can still contain unknown fields, non-finite
numbers, forged identity, or data for the wrong protocol direction. The Protocol package therefore
needs one closed wire vocabulary and measurable bounds for the authoritative multiplayer slice.

The boundary must serve browser Client and headless Server without importing either runtime. It must
support joining, semantic movement, authoritative snapshots and rejection reporting for Milestone 3,
and the one Interaction proof in Milestone 4. It must not turn schema success into session authority
or gameplay approval.

## Decision

### Validator, unknown-field policy, and wire encoding

The MVP selects the `zod` package on major line 4. Every wire object, including nested positions,
actions, and snapshot entities, is a Zod 4 strict object. The top-level direction schemas are closed
`z.discriminatedUnion("kind", ...)` unions. Unknown properties at any depth, unknown message kinds,
missing fields, coercible values, and values of the wrong primitive type are rejected; no wire
schema uses coercion, `.passthrough()`, or `.strip()`.

Every network message is exactly one JSON object carried in a WebSocket text message encoded as
UTF-8. Binary messages are rejected and are never converted to text. A complete reassembled message
is bounded before `JSON.parse`; valid JSON containing more than one value, a top-level array, scalar,
or `null` is invalid. The encoder validates with the same strict schema before `JSON.stringify` and
checks the resulting UTF-8 byte length before handing text to the transport. Client and Server may
not call `JSON.parse` or `JSON.stringify` directly for protocol messages.

The protocol version is the JSON number literal `1`, under the field `protocolVersion`, and every
message has a string-literal `kind`. Version 1 has no negotiation or compatibility fallback. Any
field addition, removal, rename, semantic reinterpretation, or bound relaxation that changes an
accepted wire value requires a new protocol-version literal and parallel schemas during an explicit
migration; silently accepting both shapes as version 1 is forbidden.

### Exact shared bounds

The Protocol package owns and exports these constants as part of the version 1 contract:

| Constant | Version 1 value | Rule |
| --- | ---: | --- |
| `PROTOCOL_VERSION` | `1` | Only accepted protocol version |
| `MAX_MESSAGE_BYTES` | `16_384` | UTF-8 bytes in one complete text message |
| `MAX_ID_LENGTH` | `64` | ASCII characters in any opaque wire ID |
| `MAX_SEQUENCE` | `4_294_967_295` | Largest client command sequence |
| `MAX_TICK` | `9_007_199_254_740_991` | Largest server or intended tick; `Number.MAX_SAFE_INTEGER` |
| `MAX_PAST_TICKS` | `6` | Oldest accepted command is current server tick minus 6 |
| `MAX_FUTURE_TICKS` | `2` | Newest accepted command is current server tick plus 2 |
| `MAX_PENDING_COMMANDS` | `128` | Decoded commands queued per live connection |
| `MAX_BUFFERED_SNAPSHOTS` | `32` | Snapshots retained per Client for interpolation |
| `MAX_SNAPSHOT_ENTITIES` | `256` | Entity records in one snapshot |
| `MAX_POSITION_ABS` | `1_000_000` | Absolute value of any position coordinate, in meters |
| `MAX_MOVEMENT_SPEED` | `10` | Server-side movement speed ceiling, in meters per second |

Opaque IDs match `^[A-Za-z0-9_-]{1,64}$`; they are case-sensitive and have no client-interpreted
structure. Sequences and ticks are non-negative safe integers within their table bounds. Position
coordinates are finite and in the closed interval `[-1_000_000, 1_000_000]`. Movement axes are
finite numbers in `[-1, 1]` whose squared two-axis magnitude is at most `1`.

A connection's first command sequence is exactly `1`; each later accepted sequence is exactly the
previous accepted sequence plus one. There is no wrap. Reuse, regression, or a gap is rejected. At
sequence exhaustion the connection cannot submit another command; reconnect/resume is outside the
MVP. At scheduling time, `intendedTick` must be in the inclusive interval
`[max(0, currentTick - 6), min(MAX_TICK, currentTick + 2)]`.

The Server enqueues at most 128 decoded commands per live connection. A command arriving when that
queue already has 128 entries is rejected with `queue-full` and is not scheduled. Disconnect and
shutdown clear the queue. The Client retains at most 32 decoded snapshots, ordered by `serverTick`;
when a newer valid snapshot would exceed the bound it discards the oldest. A duplicate or older
snapshot is discarded rather than inserted. Control and rejection messages are handled immediately
and are not put in either queue.

### Version 1 message schemas

All fields listed below are required and are the complete field set. `Position` is the strict object
`{ x, y, z }` using the finite bounded position coordinates above.

Client-to-Server messages are:

| `kind` | Exact fields |
| --- | --- |
| `join` | `{ protocolVersion: 1, kind: "join" }` |
| `command` | `{ protocolVersion: 1, kind: "command", sequence, intendedTick, action }` |

`action` is a strict discriminated union with these exact variants:

| `action.kind` | Exact fields |
| --- | --- |
| `move` | `{ kind: "move", x, z }`, with the bounded unit-disc axes above |
| `interact` | `{ kind: "interact", targetEntityId }`, with a bounded opaque ID |

Server-to-Client messages are:

| `kind` | Exact fields |
| --- | --- |
| `joined` | `{ protocolVersion: 1, kind: "joined", connectionId, playerId, ownedEntityId, serverTick }` |
| `snapshot` | `{ protocolVersion: 1, kind: "snapshot", serverTick, acknowledgedSequence, entities }` |
| `rejected` | `{ protocolVersion: 1, kind: "rejected", sequence, reason }` |

`acknowledgedSequence` and the `rejected.sequence` are either `null` or an integer from `1` through
`MAX_SEQUENCE`. `entities` contains at most `MAX_SNAPSHOT_ENTITIES` records, has no duplicate
`entityId`, and is a discriminated union with these strict variants:

| `entityKind` | Exact fields |
| --- | --- |
| `avatar` | `{ entityKind: "avatar", entityId, playerId, position }` |
| `interactable` | `{ entityKind: "interactable", entityId, position, active }`, where `active` is boolean |

The `rejected.reason` vocabulary is exactly `schema-invalid`, `unsupported-version`, `unknown-kind`,
`wrong-direction`, `phase-invalid`, `sequence-invalid`, `tick-out-of-window`, `queue-full`,
`ownership-violation`, `movement-limit`, `unknown-target`, `interaction-out-of-range`, or
`stale-connection`. A rejection never claims that the rejected command mutated authoritative state.
A malformed message need not receive a wire rejection when no safe sequence can be recovered or the
transport is closing; telemetry still records the local decode failure reason.

The `joined` identity fields are server-issued labels for correlation and presentation. No
Client-to-Server schema contains a connection, player, or owned-entity identity. A Client echoing an
identity in an unknown property fails strict decoding, and an ID appearing in an Interaction target
remains only data to validate, never proof of ownership.

### Decode and encode API

The Protocol root exports the schemas, constants, direction-specific `decodeClientMessage` and
`decodeServerMessage` functions, matching encode functions, and named public data types inferred
directly with `z.infer` from the schemas. There is no separately handwritten duplicate interface,
no exported `ws` type, and no cast that asserts parsed data is a message. Public result and message
types are kit-owned aliases; Zod owns their runtime derivation.

Every decode returns a result union. Success is `{ ok: true, value }`. Failure is
`{ ok: false, failure }`, where `failure` has exact fields `stage`, `reason`, and `issues`. `stage` is
one of `frame`, `json`, `schema`, or `direction`. Decode `reason` is one of `binary-frame`,
`message-too-large`, `invalid-utf8`, `invalid-json`, `not-json-object`, `unsupported-version`,
`unknown-kind`, `wrong-direction`, or `schema-invalid`. `issues` is a bounded read-only list of at
most 16 kit-owned `{ path, code }` records; it never includes raw payload bytes, field values, Zod
objects, or stack traces.

Failure classification may inspect discriminator candidates only to choose a reason after parsing;
that inspection grants no trusted type. A value is released to runtime code only after the complete
direction-specific strict schema succeeds. Thus neither a TypeScript declaration, a cast, successful
`JSON.parse`, an apparent object shape, nor client-supplied identity establishes trust.

Every encode likewise returns a result union and validates the complete message before serialization.
Its failure reason is `schema-invalid`, `json-encode-failed`, or `message-too-large`; it does not emit
partial text. Encode success contains only the validated UTF-8 JSON text and its byte length.

### Ownership and lifecycle

`@three-game-kit/protocol` owns the Zod schemas, inferred wire types, codecs, protocol constants,
bounds, and reason-code vocabulary. It is environment-neutral and owns no socket, World, session,
queue instance, clock, or gameplay state. Client and Server networking adapters own their transports
and invoke the appropriate codec at every receive and send boundary. They must not expose a
decoded value if the codec fails.

The Server owns connection phase, the current tick, accepted-sequence state, queues, opaque identity
allocation, connection/player/entity bindings, and cleanup. It alone decides whether a schema-valid
message is legal in the current phase and whether its connection-derived authority, tick, sequence,
queue capacity, and movement ceiling permit scheduling. Disconnect invalidates the binding and
sequence state before clearing pending commands; no wire identity restores them.

Shared/gameplay systems own semantic validation and state transitions, including configured movement
speed at or below the protocol ceiling, target existence, ownership rules, and Interaction range.
Schemas validate representation and universal wire bounds only. Schema success is therefore
necessary but never sufficient for session authority, command scheduling, or gameplay validity.

Decoder and encoder instances hold no authority and no long-lived payload state. Transport shutdown
removes listeners and queued runtime data; it does not mutate or unregister the immutable Protocol
schemas. Schema construction failure is a programmer/invariant failure during module initialization,
while network decode failures are expected structured data failures.

## Consequences

- Client and Server accept one canonical, reject-unknown JSON vocabulary and share the same inferred
  field types without trusting compile-time declarations at runtime.
- Strict nested schemas make additive version 1 fields incompatible by design; protocol evolution
  requires an explicit version rather than silent receiver differences.
- UTF-8 JSON is inspectable and browser-native, but larger and slower than a binary codec and subject
  to the fixed 16 KiB envelope.
- Zod becomes a runtime dependency of Protocol and schema validation adds work at every network
  boundary. The bounded messages, entities, and issue lists cap that work for the MVP.
- Server-owned authority remains separate from representational validity, so schema reuse cannot
  accidentally authorize a session or bypass movement and Interaction rules.
- The fixed queue and tick windows make overload and stale input behavior testable, but may reject
  commands during stalls; reconnect, resumable sequences, and adaptive windows require later work.

## Rejected alternatives

- **TypeScript types, type assertions, or parsed-object checks alone:** none validate untrusted
  runtime data, reject unknown nested fields consistently, or guarantee finite numbers.
- **Zod stripping or passthrough objects:** either silently changes a sender's message or accepts
  ambiguous extra intent; strict rejection gives one auditable policy.
- **Handwritten validators plus handwritten interfaces:** duplicate the wire contract and can drift.
- **JSON Schema/Ajv, Valibot, or TypeBox:** each can validate the slice, but selecting a second
  vocabulary adds no MVP value once Zod 4 supplies strict schemas and inferred types.
- **MessagePack, CBOR, Protocol Buffers, or a custom binary format:** add tooling and browser/debug
  complexity before JSON size or throughput is shown to be a constraint.
- **Binary WebSocket frames containing JSON:** create two accepted encodings and weaken the text-only
  boundary without an acceptance need.
- **Trusting `connectionId`, `playerId`, or entity identity fields:** possession or echo of an opaque
  label is not authority; the Server's live connection binding is authoritative.
- **Putting phase, ownership, or gameplay checks inside Zod refinements:** couples stateless wire
  schemas to mutable runtime state and makes schema success incorrectly imply authorization.

## Objective Milestone 3 verification

Milestone 3 must add automated evidence for all of the following:

1. For every message variant, an encode/decode round trip preserves the inferred value. The encoded
   value is one UTF-8 WebSocket text message no larger than 16,384 bytes; binary delivery, invalid
   UTF-8, invalid JSON, a non-object root, and an oversized message produce their exact reason codes
   without a value or uncaught error.
2. Table-driven mutations add an unknown property at the top level and at every nested object,
   remove each required field, substitute every discriminator, use the opposite direction decoder,
   and supply wrong primitive types. Every case fails with `unsupported-version`, `unknown-kind`,
   `wrong-direction`, or `schema-invalid` as specified, and no runtime queue or World is mutated.
3. Numeric tests cover `NaN`, positive and negative infinity supplied before encoding, JSON exponent
   overflow on decode, unsafe/fractional/negative ticks and sequences, position coordinates just
   inside and outside the bound, movement axes at each edge, and a vector just over unit magnitude.
   Only finite values inside the closed bounds succeed.
4. A live connection accepts sequences 1 then 2 and rejects duplicate, regressed, skipped, and
   exhausted sequences. At server tick 100 it accepts intended ticks 94 through 102 inclusive and
   rejects 93 and 103. Each rejected command leaves authoritative state unchanged and increments
   exactly one matching reason counter.
5. With a stalled Server command consumer, exactly 128 decoded commands can remain pending for one
   connection; the next is rejected `queue-full`. Disconnect clears all 128 and a delayed command is
   rejected `stale-connection`. Other connections' queues and sequence state are unchanged.
6. The Client retains exactly the newest 32 increasing snapshots, discards an older or duplicate
   tick and the oldest on overflow, rejects 257 entities, duplicate entity IDs, out-of-range
   positions, and an oversized snapshot, and never presents a non-finite transform.
7. Forged identity fields added to `join` or `command` fail strict decoding. Valid-looking server
   IDs and target IDs do not grant authority: wrong-owner movement and Interaction attempts are
   rejected without authoritative mutation, while the binding derived from the live connection is
   the only ownership input.
8. Source, dependency, export, and emitted-declaration checks prove Zod is confined to Protocol's
   schema boundary, Client and Server use the direction codecs at every network ingress and egress,
   no `ws`, Zod issue, internal schema helper, or handwritten duplicate wire interface leaks through
   the kit-owned public data types, and Core and Shared remain free of protocol validation logic.

These tests prove the version 1 representation and decode boundary. They do not establish production
authentication, cryptographic anti-replay, reconnect/resume, nonzero-loss tolerance, gameplay
correctness from schema success, or trust in client identity fields.
