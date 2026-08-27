# ADR 0006: WebSocket transport and connection lifecycle

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

Milestone 0 must select the single transport used by the Milestone 3 authoritative multiplayer
slice. ADR 0005 already selects strict Zod 4 validation and one UTF-8 JSON object per WebSocket text
message. This decision must connect that protocol boundary to a browser Client and headless Node
Server without making a socket library part of the Protocol, Core, or Shared contracts.

The transport crosses an untrusted boundary. It must bound a complete inbound message before JSON
decode, distinguish transport readiness from protocol join, bind authority to a live server-owned
connection, and ensure that close or shutdown cannot leave queued work, listeners, timers, or
session authority behind. The loopback acceptance server also needs deterministic startup and
teardown without defining a production deployment architecture.

## Decision

### Selected client, server, and wire boundary

The browser Client uses the browser-native `WebSocket` implementation. The Node Server uses the
`ws` package on major line 8 as a server only. Exact patch resolution belongs in the future lockfile;
the browser does not bundle or import `ws`.

Every application message is one UTF-8 JSON text message encoded and validated by the
direction-specific ADR 0005 Protocol codec. The transport neither parses JSON nor constructs wire
objects itself. Binary messages are rejected and never converted to text. The Server creates `ws`
receivers with `perMessageDeflate: false`, the ADR 0005 message-byte limit as `maxPayload`, and UTF-8
validation enabled. It does not negotiate `permessage-deflate` even when a browser offers it. The
Client treats any negotiated WebSocket extension as a structured transport failure and closes,
although the selected Server will negotiate none.

Message fragmentation is only a WebSocket implementation detail: a fragmented message is admitted
once, after complete reassembly, against the same Protocol byte bound. Fragment boundaries are not
visible to the codec or application. Exact message size, decoded-command and snapshot queue bounds,
tick window, and sequence rules are owned by the versioned M0 Protocol contract in ADR 0005. This
ADR references those exported constants and does not introduce parallel values.

### One standalone server transport

The MVP implements one standalone, loopback-capable Server transport in
`@three-game-kit/server`. It owns one Node HTTP listener, one `ws.WebSocketServer`, the HTTP upgrade
handler, and every accepted server socket. Configuration is kit-owned data containing a host string,
a valid TCP port including `0` for an operating-system-assigned test port, and a WebSocket path.
Binding `127.0.0.1` with port `0` is the normative test configuration. A successful start reports the
resolved URL only after the listener is accepting upgrades.

The transport accepts only an HTTP Upgrade for the configured path. Other requests and paths do not
create a connection. Origin policy, TLS termination, reverse-proxy headers, forwarded addresses,
shared HTTP servers, and deployment adapters are not part of this decision.

The `WebSocketServer` runs in explicit upgrade mode so the transport can detach its single upgrade
handler before closing sockets. There is no second in-memory, polling, HTTP-streaming, or custom
transport implementation. Tests use the real listener and real browser WebSocket stack; a test
delay/jitter injector may delay complete application messages but is not an alternate transport.

### Lifecycle state machines

Client networking has these observable kit-owned states:

| State | Meaning and permitted transition |
| --- | --- |
| `idle` | Constructed and not connected; `connect` may move to `connecting`. |
| `connecting` | A native WebSocket exists but is not open; `open` moves to `ready`, failure moves to `disconnecting`. |
| `ready` | The WebSocket is open and the Protocol `join` message may be sent exactly once. |
| `joining` | A valid `join` has been sent; only transport events and a valid `joined` response are handled. |
| `joined` | The server-issued binding from `joined` is current; valid commands and server messages may flow. |
| `disconnecting` | Close has begun; no new decode, enqueue, command, or send is permitted. |
| `closed` | That connection is terminal. Reconnect on the same instance is forbidden. |
| `shutting-down` | Adapter-wide teardown is running; this supersedes any nonterminal connection state. |
| `shutdown` | Teardown is complete; every operation except repeated `shutdown` fails as disposed. |

A Server transport moves `idle -> listening -> shutting-down -> shutdown`. Each accepted socket gets
a monotonically allocated internal connection ordinal and moves
`connected -> ready -> joining -> joined -> disconnecting -> closed`. `connected` covers the brief
period in which listeners and the close fence are installed; `ready` means the transport can accept
exactly one `join`, not that gameplay authority exists. A strict-decoded `join` moves through
`joining`; only successful server allocation of player ID, owned entity, and session binding moves
it to `joined` and permits the `joined` response. A second join is `phase-invalid`.

`disconnect` is an operation, not a resumable protocol message. A local request, peer close,
transport error, protocol-fatal frame, or Server shutdown enters `disconnecting` once and converges
on `closed`. `shutdown` is adapter-wide and terminal. Calls that contradict the current state return
a structured state failure; they do not silently queue work for a later state.

### Server-owned connection and session authority

On upgrade acceptance, the Server creates a private connection record keyed by socket identity and
its internal ordinal. The record contains the live-state fence, connection phase, server-issued
connection ID when allocated, accepted-sequence state, decoded command queue, listener registrations,
and owned timers. On a valid join, the Server creates and stores the connection/player/entity
binding and the authoritative entity. The socket and binding are never supplied by the Client and
are never recovered from a wire ID.

Every inbound command is associated with the connection record selected by the emitting socket.
Phase, sequence, tick-window, queue-capacity, ownership, and movement checks use that record and the
Server Runtime's state. Client-supplied fields cannot select another record or entity. A connection
record is not an ECS entity ID and a WebSocket object is not a session token.

When close begins, the Server first flips the record's live fence and invalidates its
socket/session/player/entity binding and accepted-sequence state. It then clears pending commands
and invokes authoritative disconnect cleanup. A delayed callback retains only the connection
ordinal and generation; it must re-resolve a still-live record before doing anything. A stale or
closed record can therefore produce telemetry or `stale-connection` where applicable, but cannot
schedule a command or mutate authoritative state.

### Bounded ingress and close fence

The Server applies the ADR 0005 byte bound in `ws` during frame reassembly, before a `message` event
and before Protocol decode. Oversized messages are closed/rejected without calling JSON or schema
decode. The message handler accepts only a non-binary, valid UTF-8, complete text message and calls
the Client-to-Server Protocol decoder synchronously. It retains no raw-message application queue:
decode failure is reported immediately, control messages are handled immediately, and only a valid
command may enter the bounded decoded-command queue from ADR 0005.

The browser API exposes a complete `MessageEvent` rather than a receiver `maxPayload` option. Client
networking therefore requires `event.data` to be a string and passes it directly to the
Server-to-Client Protocol decoder, whose frame stage measures UTF-8 bytes before `JSON.parse`. It
does not retain raw events or convert `Blob` or `ArrayBuffer` data. Only decoded snapshots enter the
ADR 0005 bounded snapshot buffer.

Every socket callback captures a connection generation and begins by checking the adapter state,
connection state, and live fence. It checks the fence again immediately before enqueue, send, or
runtime callback. Once close handling starts, subsequent `open`, `message`, delayed-delivery,
send-completion, or error callbacks may only finish cleanup or emit one bounded diagnostic; they
must not decode, validate gameplay, enqueue, schedule, send an application message, invoke a
gameplay callback, or mutate a World. Listener removal and timer cancellation are required, but the
fence is the correctness boundary for already-dispatched callbacks.

There is no unbounded application outbound queue. A send is accepted only in its permitted state
and only after Protocol encode succeeds; otherwise it returns a structured failure. Socket
`bufferedAmount` may be observed as telemetry but does not authorize retaining additional
application messages.

### Ownership and deterministic shutdown

Client networking owns its native WebSocket, its socket listeners, its decoded snapshot buffer, and
every connect, close, or test-delay timer it creates. Server networking owns the HTTP listener,
upgrade listener, `WebSocketServer`, accepted sockets, socket listeners, private connection records,
decoded per-connection command queues, and every transport or test-delay timer it creates. Protocol
owns schemas and constants, not instances. Core and Shared own none of these resources. Runtime
shutdown calls networking teardown before disposing the World that networking callbacks could
otherwise reach.

Client shutdown performs this exact order:

1. return the existing shutdown promise if shutdown already started;
2. enter `shutting-down`, flip the live fence, and reject new operations;
3. invalidate the joined binding and sequence state;
4. cancel all owned timers and detach `open` and `message` listeners;
5. clear decoded inbound and test-delay queues;
6. request native WebSocket close when its state permits it;
7. after the terminal close event, detach remaining `close` and `error` listeners and clear the
   socket reference; and
8. enter `shutdown` and resolve the stored shutdown promise.

Server shutdown performs this exact order:

1. return the existing shutdown promise if shutdown already started;
2. enter `shutting-down`, detach the HTTP upgrade handler, and stop the HTTP listener from accepting
   new work;
3. visit private connection records in ascending connection ordinal; for each, enter
   `disconnecting`, flip its live fence, invalidate server-owned binding and sequence state, cancel
   its timers, detach its `message` listener, clear its command and delayed-delivery queues, invoke
   authoritative disconnect cleanup, terminate the socket, detach remaining socket listeners,
   clear private references, and enter `closed`;
4. close the `WebSocketServer` after all accepted sockets are terminal;
5. await the HTTP listener and `WebSocketServer` close completions;
6. remove their remaining listeners, cancel transport-level timers, clear connection maps and
   queues, and clear listener/server references; and
7. enter `shutdown` and resolve the stored shutdown promise.

Partial startup failure applies the applicable Server steps in the same ownership order and ends in
`shutdown` with the bind/start error. Shutdown never depends on another simulation tick to release
transport resources. Authoritative disconnect behavior may record removal immediately or by the
already-required two-tick M3 deadline, but the binding is invalid before transport shutdown
continues. A second shutdown performs no socket, listener, queue, timer, binding, entity, or server
operation.

### Public boundaries and telemetry

The browser `WebSocket`, Node HTTP, and `ws` types are private adapter details. Public Protocol,
Core, and Shared APIs and emitted declarations contain no browser WebSocket, `ws`, Node HTTP,
`MessageEvent`, `Buffer`, socket, listener, or transport-queue type. Public Client and Server
networking surfaces also prefer kit-owned configuration, state, result, and telemetry records; they
do not return a raw socket or accept one as authority.

Every state transition emits one structured state record with runtime (`client` or `server`),
scope (`transport` or `connection`), previous state, next state, operation, and the server-issued
connection ID when one exists. Every expected transport failure emits one structured error record
with runtime, operation, state, stable code, expected flag, and optional connection ID. Stable
transport error codes cover bind/connect/upgrade failure, invalid state, binary or oversized frame,
decode failure, send failure, peer error, and shutdown failure.

Records may include monotonic time or server tick for correlation, but never raw message contents,
payload bytes, arbitrary peer error objects, Zod issues, socket objects, or credentials. Expected
peer and decode failures are counted without an uncaught exception. Programmer invariants and
unexpected async failures use the kit's structured runtime-error path and are not swallowed.
Repeated close or shutdown callbacks do not duplicate a state transition or error for the same
cause.

## Consequences

- Browser networking uses the platform implementation while the headless Server has one maintained
  WebSocket server dependency on `ws` 8.x.
- Compression is unavailable, avoiding compression memory/CPU variability and decompression attack
  surface; messages remain subject to the fixed Protocol byte bound.
- The standalone listener makes real loopback tests direct and deterministic, but embedding in an
  existing HTTP server or deploying behind a proxy requires a later decision.
- `ws` can reject an oversized Server ingress message before JSON decode. The native browser API
  cannot impose an equivalent receiver allocation limit before producing a complete string, so the
  Client's Protocol frame bound occurs immediately on event delivery.
- Terminal connection instances simplify authority and cleanup. A new connection requires a new
  Client networking instance because reconnect and resume are unsupported.
- Close fencing plus owned-resource teardown prevents stale callbacks from retaining authority even
  when event delivery races with cleanup.
- Immediate shutdown termination favors bounded deterministic teardown over graceful delivery of
  queued application messages.

## Deliberate exclusions

This decision excludes reconnect/resume, session migration, alternate transports, binary encoding,
per-message compression, production authentication, cryptographic channel identity, TLS and
certificate management, proxy/deployment concerns, shared HTTP-server embedding, origin and CORS
policy, matchmaking, persistence, lag compensation, graceful delivery guarantees, and
heartbeat-based session recovery. WebSocket ping/pong may be observed only as library-level
diagnostics; it does not extend a session, restore authority, or drive gameplay liveness.

## Rejected alternatives

- **A `ws` browser client or a shared socket abstraction:** browsers should use their native
  WebSocket, and a lowest-common-denominator wrapper would leak transport concerns into
  environment-neutral packages.
- **Socket.IO, SockJS, SSE, WebTransport, WebRTC data channels, or HTTP polling:** each introduces an
  alternate protocol, fallback, dependency, or deployment surface not required by the reliable
  ordered loopback slice.
- **MessagePack, CBOR, Protocol Buffers, binary JSON, or raw binary frames:** conflict with ADR
  0005's single inspectable UTF-8 JSON text encoding.
- **Enabled `permessage-deflate`:** adds memory, CPU, negotiation, and decompression behavior without
  evidence that the bounded MVP messages need compression.
- **Client-owned session identifiers or socket-to-entity fields in messages:** possession of an ID
  is not authority; only the live Server record and its binding authorize work.
- **An unbounded raw ingress or outbound queue:** permits memory growth before validation and makes
  shutdown and overload behavior non-objective.
- **Heartbeat-based cleanup or recovery:** close/error plus explicit lifecycle cleanup is sufficient
  for the loopback MVP; a heartbeat must not become implicit resume or session authority.
- **Injecting an externally owned HTTP server:** adds shared-listener ownership and deployment
  lifecycle questions before the standalone Server transport is proven.

## Objective Milestone 3 tests

Milestone 3 must add automated evidence for all of the following:

1. **Real selected stack:** start the standalone Server on `127.0.0.1` and port `0`, connect from two
   independent bundled-Chromium contexts using the native browser WebSocket, and prove the Server is
   using `ws` 8.x. `WebSocket.extensions` is empty and both Server upgrade responses omit
   `permessage-deflate`; no browser bundle contains `ws`.
2. **Encoding and pre-decode bound:** round-trip every ADR 0005 message as one text message. Binary,
   invalid UTF-8, and a fragmented or unfragmented message over the Protocol byte bound are rejected
   with no JSON/schema decoder call, command enqueue, World mutation, or uncaught error. A text
   message exactly at the bound reaches the decoder once.
3. **State and join:** observe the exact Client state path
   `idle -> connecting -> ready -> joining -> joined`, the Server per-connection path
   `connected -> ready -> joining -> joined`, and one state record per edge. A command before join,
   a second join, and a send after disconnect return the documented state/phase failure without
   authoritative mutation.
4. **Server authority:** show that each socket maps to a distinct private connection record and that
   only the valid join creates its server-owned player/entity binding. Forged or cross-client IDs
   never select a binding; closing one socket invalidates only its binding and sequence state.
5. **Close fence:** arrange queued command, snapshot, send-completion, and delayed-delivery callbacks,
   begin close, then run every callback. Observe no decode, enqueue, send, gameplay callback, or
   World mutation after the fence, and observe the queued stale command rejected or discarded under
   the ADR 0005 contract.
6. **Disconnect deadline:** disconnect one Client and advance exactly two Server ticks. Its binding
   and authoritative avatar are absent, its queues and timers are empty, its listeners are removed,
   and the other Client remains joined and functional.
7. **Deterministic idempotent shutdown:** instrument every owned resource and assert the exact Client
   and Server orders above, including ascending Server connection ordinals. After shutdown, there
   are zero open listeners or sockets, registered socket callbacks, queues, timers, bindings, and
   transport references. A second shutdown returns the same resolved promise and records no new
   cleanup operation.
8. **Telemetry:** trigger connect success, invalid phase, binary frame, oversized frame, decode
   failure, peer close, bind failure, and shutdown. Assert one correctly shaped state/error record
   per event, matching reason counters where applicable, no raw payload or vendor object in a
   record, and no uncaught async rejection.
9. **Public boundary:** source, dependency, export, and emitted-declaration checks find no browser
   WebSocket, `ws`, Node HTTP, `MessageEvent`, `Buffer`, socket, listener, or queue type in Protocol,
   Core, or Shared; no raw socket appears in any public networking result; Server alone depends on
   `ws`; and the browser build resolves only the native WebSocket.
10. **Normative loopback scenario:** with deterministic application-level 100 ms RTT, 0-20 ms
    jitter, and no required loss, the complete six-part adopted multiplayer acceptance test passes,
    including next-frame local prediction, exact 60-tick stepping, peer snapshot presentation,
    bounded forced correction, counted rejection cases, and two-tick disconnect cleanup.

These tests establish the bounded same-build loopback transport and lifecycle only. They do not
establish production network security, authentication, proxy compatibility, reconnect/resume,
binary interoperability, delivery during shutdown, nonzero-loss guarantees, or heartbeat recovery.
