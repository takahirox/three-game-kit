# Deterministic two-client acceptance

- Status: Normative Milestone 3 acceptance contract
- Runner: Playwright Test with Playwright-bundled Chromium
- Test ID: m3.two-client.canonical.v1

This document defines one executable, state-based acceptance test. Accepted ADRs and docs/protocol/mvp.md remain normative; this document fixes the fixture and observation sequence without relaxing their schemas, phases, bounds, ownership rules, or cleanup orders. Pixel output, screenshots, traces, wall-clock sleeps, and manual judgment are not acceptance evidence.

## Stable Playwright identity

The implementation lives at tests/acceptance/two-client.spec.ts and has exactly this project, title, and ordered test.step names:

| Item | Stable value |
| --- | --- |
| Project | m3-bundled-chromium |
| Test title | M3 canonical two-client authoritative loopback |
| Step 01 | 01 boot real isolated topology |
| Step 02 | 02 predict owner on next injected frame |
| Step 03 | 03 step 60 server ticks and present peer snapshots |
| Step 04 | 04 reconcile forced authority within 500 injected ms |
| Step 05 | 05 reject invalid ingress without authority mutation |
| Step 06 | 06 reject base interaction by phase |
| Step 07 | 07 fence disconnect and preserve peer |
| Step 08 | 08 shutdown twice with zero resources |

The normative project has workers 1, retries 0, and a 30-second wall-time watchdog. The reproduction command is:

    pnpm exec playwright test tests/acceptance/two-client.spec.ts --project=m3-bundled-chromium --workers=1 --retries=0 --grep "M3 canonical two-client authoritative loopback"

A rerun is a new result and cannot replace the first failed manifest.

## Required harness surface

The test uses documented application controls, never package internals. Controls must provide: semantic-action injection; exact Client and Server stepping; explicit presentation-frame delivery; injected application-message time; one-shot Server validation fixtures; phase-aligned forced authoritative displacement; disconnect and shutdown; and detached read-only observations of presentation, simulation, authority, bindings, queues, phase traces, telemetry, errors, and live-resource gauges.

Raw-text send exists only to exercise the Protocol decoder. The ownership fixture makes the next ownership resolution return a foreign owned entity without changing a binding, World, capsule, configuration, or accepted-sequence record. The speed fixture supplies 10.000001 m/s to the next movement-limit validation only, without changing stored configuration or gameplay state. Each fixture is armed for exactly one command, reports one consumption, and is cleared before the next observation. These are validation dependency seams, not new wire fields or authority paths.

The forced-displacement control schedules one Server-owned position and capsule synchronization in the gameplay phase of a named tick. It cannot be called by browser application code outside the test build and never crosses the wire.

Before application code runs, both pages capture window error and unhandledrejection. Playwright captures pageerror and unexpected console errors. The Server harness captures uncaughtException, unhandledRejection, its structured runtime-error observer, and callback failures. Expected Protocol failures must appear only as their structured expected records.

## Canonical topology and fixture

Start one standalone Server on 127.0.0.1 with port 0 and the fixture WebSocket path. Wait for its resolved ws URL. Assert the installed Server dependency reports major 8 for ws, perMessageDeflate is false, upgrade responses omit permessage-deflate, and each browser-native WebSocket has an empty extensions string. No browser bundle may contain ws.

Launch one Playwright browser process and exactly two fresh browser.newContext calls, named A and B, with one page each. Connect and join A completely before creating B, so Server connection ordinals are A = 1 and B = 2. Assert distinct connection, player, wire-entity, runtime-local entity, and application-instance identities.

Set storage marker client-a in A. Assert B cannot read it, then set client-b in B and assert A cannot read it. Assert empty initial cookies, local storage, session storage, Cache Storage, service-worker registrations, permissions, and application globals in both contexts. Two pages in one context do not pass.

Use these exact world values; one world unit is one meter:

| Fixture value | Exact value |
| --- | --- |
| Capsule | radius 0.5, half-height 0.5 |
| Controller | offset 0.01, sliding on, autostep off, snap-to-ground off |
| Gravity | zero in every private Rapier World |
| Floor | ID floor; center (0, -0.5, 0); half-extents (20, 0.5, 20) |
| Obstacle | ID wall; center (2.5, 1, 0); half-extents (0.5, 1, 2); near face x = 2 |
| Movement speed | 6 m/s |
| Downward desired translation | -0.001 m per movement tick |
| A initial capsule center | (1.45, 1.01, 0) |
| B initial capsule center | (0, 1.01, -3) |
| Forced A center | (0.75, 1.01, 0) |

Server allocation by connection ordinal fixes those initial positions. Client A, Client B, and Server each own one distinct private Rapier World, controller, scene copy, and capsule set. Read-only ownership tokens for the three Worlds and three scene copies must be pairwise distinct, while their detached static-scene value digests must match. No observation exposes a Rapier object or handle.

## Network injector and time

Use the ADR 0007 canonical profile without resetting its streams after join:

| Field | Exact value |
| --- | --- |
| Algorithm | xorshift32-v1 |
| Seed | 1592590343, hexadecimal 0x5eed0007 |
| Base RTT | 100 ms, split to 50 ms in each direction |
| Per-message jitter | inclusive integer 0 through 20 ms, added to each one-way complete-message delivery |
| Drop rate | 0 |
| Loss | exactly zero application messages dropped |

Every complete message consumes the jitter draw and then the drop draw, including join, joined, rejected, and drop-rate-zero messages. Stream initialization, direction salts, zero-state replacement, unsigned xorshift operations, and integer mapping are exactly ADR 0007. As an anchor, ordinal 1 Client-to-Server message 1, join, has jitter 7 and delay 57 ms; message 2, the first move command, has jitter 15 and delay 65 ms. A different schedule fails before gameplay.

Injected time starts at 0 and is monotonic. Advancing it drains all due complete-message deliveries ordered by due time, then connection ordinal, then direction with Client-to-Server before Server-to-Client, then route message ordinal. A drain returns only after every admitted synchronous callback completes. It does not advance a Server tick, Client tick, or presentation frame.

Server stepExact uses dt = 1/60 second and does not read or advance injected or wall time. Snapshot-build creates periodic snapshots only where serverTick modulo 3 is zero, exactly 20 opportunities in ticks 1 through 60. Client exact steps do not advance presentation or injected time. An explicit frame uses the current injected timestamp in milliseconds, runs exactly one presentation schedule, and advances no simulation.

The 500 ms correction deadline is measured only on this injected monotonic axis from completion of the reconcile phase. Wall time is used only for Playwright watchdogs and bounded polling for native socket close or process completion. The test must not call waitForTimeout or use Date.now, requestAnimationFrame cadence, CPU duration, or a polling interval as gameplay evidence.

## Canonical observations and commands

Every observation named below is copied into the evidence manifest. At every observation, scan all Client simulation, published, interpolated, camera-target, and rendered transforms observed so far and require every numeric component to be finite.

### OP-01: joined baseline

After both joined responses have been delivered, record injected time t0, tick 0, both exact state paths, identities, positions, authority state, accepted-sequence state, snapshot counts, phase counts, collision counts, error capture, rejection counters, and live resources. Both Clients have received zero snapshots. The complete Server rejection map is zero.

An authority digest contains bindings, accepted sequences, movement-slot reservations, authoritative gameplay components, authoritative avatar positions, and private Server capsule transforms. It deliberately excludes logical tick, telemetry, expected error records, and network schedule records. Rejection gates compare this digest and the explicit Shared and Rapier call counts.

### OP-02: owner next-frame prediction

At t0 inject exactly one semantic action into A: move x = 1, z = 0. Advance A by one exact Client simulation tick. This creates command sequence 1 with intendedTick 1 and runs shared-predict, predictive-collision, and presentation-publish in the same tick.

Before advancing injected time to the command due time, advance it to t0 + 1 ms and deliver exactly one frame to A. Require:

- A presentation-frame count increases by one and A presented x is greater than 1.45;
- A capsule surface does not exceed x = 2.001 and is no farther than 0.011 m from the wall;
- A has sent sequence 1 but the Server has decoded zero commands and both Clients have received zero snapshots;
- B has consumed zero peer commands and its presented A position has not changed; and
- A phase trace is exactly action-sample, command-send, shared-predict, predictive-collision, presentation-publish, followed by remote-interpolation, camera-view, render, frame-telemetry.

Thus the next explicitly injected frame, not a later frame, visibly contains prediction before any authoritative snapshot.

### OP-03: 60 authoritative ticks and peer presentation

Advance injected time to the recorded due time for A command 1 and require one decoded pending command. Call Server stepExact(60) once. Require returned tick 60, dt exactly 1/60 for every system invocation, zero exact-step backlog, and all eight Server phases exactly 60 times in their accepted order.

Require one accepted sequence, one Shared authoritative movement call, one private Server collision call, and no use of a Client collision result. The authoritative A capsule surface never exceeds 2.001 and finishes within 0.011 m of the wall. Snapshot opportunities are exactly ticks 3, 6, 9, through 60: 20 and no others. Every A position in those snapshots is exactly the copied post-collision Server position for its tick.

Drain injected time through delivery of all tick-60 snapshots. Exact-step each Client once for snapshot ingest and reconciliation, then deliver one frame to each at the current injected time. Require A has acknowledged sequence 1 and has no unacknowledged movement history. Require B presents A from buffered authoritative snapshots and its provenance observation is snapshot only. B peer-command ingress and application counts remain zero; all non-snapshot remote-World and remote-presentation mutation counts remain zero. Remote interpolation uses the six-Server-tick target, holds an authoritative sample when unbracketed, and never extrapolates.

### OP-04: forced reconciliation

Schedule the forced A center for gameplay at Server tick 61, then step exactly three ticks to 63. Require the Server position and private capsule are atomically synchronized at tick 61 and the tick-63 snapshot contains exactly that post-gameplay authoritative position.

Deliver that snapshot to A at injected time tr. Record the last presented A position, then exact-step A once. In that single snapshot-ingest then reconcile sequence require: simulation position equals the latest authoritative position within 0.000001 m; acknowledged history is empty; reconcile count increases exactly once; and no easing occurs in simulation, collision, command, or authority.

Without a Client simulation step, deliver frames at tr, tr + 100, tr + 200, tr + 300, tr + 400, and tr + 500 ms, advancing injected time before each. Presentation-only error is Euclidean distance from the latest authoritative position. Require it is finite, never increases, never feeds simulation, and is at most 0.05 m at tr + 500 ms. Server authority and capsule remain unchanged by every Client frame.

### OP-05: rejection table

Run these cases serially. Do not send the next case until the prior delivery, validation where applicable, structured error, counter, and optional rejected response are settled. For each case, snapshot the authority digest, accepted sequence 1, every rejection counter, Shared call count, and Server collision count. Afterward require the same authority digest and accepted sequence, no Shared or Rapier call, exactly one new expected RuntimeErrorRecord with the listed reason, exactly one increment of only the listed rejection counter, and no duplicate record during propagation or wire send.

| Case | Exact input | Exact result |
| --- | --- | --- |
| malformed-json | Raw text containing only a left brace | decode invalid-json; reason and counter schema-invalid |
| unknown-kind | Strict JSON object with protocolVersion 1 and kind unknown-for-v1 | decode, reason, and counter unknown-kind |
| tick-window | Command sequence 2, intendedTick S + 4, move (1, 0), where S is tick before delivery | tick-out-of-window |
| ownership | Arm foreign-owner resolution once; command sequence 2, intendedTick S + 1, move (1, 0) | ownership-violation |
| speed | Arm 10.000001 m/s validation speed once; command sequence 2, intendedTick S + 1, move (1, 0) | movement-limit |

For decoded commands, advance injected time through delivery, then step exactly one Server tick so validation tick and bounds are explicit. S is captured immediately before scheduling that case. Malformed and unknown-kind failures settle at decode and require no Server tick. A malformed input need not receive a wire rejected message because it has no safe sequence; the single rejection observation is its expected record plus schema-invalid counter. Decoded command cases receive exactly one rejected message for sequence 2.

### OP-06: the only Interaction case

No Interaction Feature or interactable entity is installed. Send exactly one otherwise schema-valid command from A with sequence 2, intendedTick S + 1, and action interact targeting B's valid server-issued entity ID. Process it as above. Require phase-invalid, exactly one phase-invalid counter increment, one expected record, one rejected response, no sequence admission, and the unchanged authority digest. This is the only Interaction input in this acceptance test; unknown-target, range, success, replication, and presentation are not exercised here.

### OP-07: disconnect fence and peer survival

From A send a valid sequence 2 move for the next validation tick. Advance injected time only until the Server has decoded it and reports one pending command; do not step the Server. Begin A disconnect and wait only with a wall-time watchdog for the native close callback to report the Server fence observation.

At that observation require immediately: A live fence false; binding and accepted-sequence record absent; decoded, scheduled, movement-slot, snapshot-send, and delayed-delivery queues zero; admission listeners and timers zero; and all already-dispatched callbacks unable to decode, enqueue, send, invoke gameplay, or mutate authority. The purged safely decoded command is recorded exactly once as stale-connection with no wire response and no authoritative mutation. B remains joined with its binding, sequence state, avatar, capsule, socket, and queues unaffected.

Record disconnect Server tick D. Step exactly two Server ticks. By the end of D + 2 require A authoritative avatar, ECS components, private capsule, and all binding maps absent. The recorded removal tick must be D, D + 1, or D + 2. A stale callback cannot recreate any of them.

Prove B remains functional: send B command sequence 1 for its next valid tick with move (1, 0), deliver it, exact-step through its application and the next snapshot opportunity, and deliver that snapshot. Require B authority and owner presentation change, its binding remains joined, and A is still absent.

## Cleanup and terminal gates

Use a finally block so cleanup and the evidence manifest run after the first failed invariant. Stop new input, stop frame delivery, and freeze the first failure. For A and then B, call application shutdown twice. Each pair must return the identical stored promise/result token, produce the same final detached telemetry snapshot, and add no transition, disposal, release, error, counter, observer, or telemetry mutation on the second call.

Assert each final Client snapshot has entityCount 0, an empty installed Feature list, terminal networking state shutdown, and zero for every liveResources gauge. Close A page/context, then B page/context, and assert the harness owns zero pages, contexts, permissions, service workers, storage records, and retained references.

Call standalone Server shutdown twice. Require the identical promise/result token, ascending-ordinal connection cleanup, no second side effect, entityCount 0, empty installed Feature list, transport state shutdown, and zero for every liveResources gauge. Require zero HTTP listeners, WebSocketServer instances, open sockets, socket callbacks, process hooks installed by the fixture, delayed tasks, and retained harness references.

The liveResources check compares the complete accepted gauge object, not a subset: worlds, worldValues, systems, subscriptions, listeners, timers, sockets, serverListeners, mailboxes, queuedItems, queuedDeliveries, bindings, ownedAvatars, presentationRequests, presentationCallbacks, renderResources, physicsWorlds, physicsControllers, physicsColliders, physicsHandles, ledgerRecords, and retainedReferences are all exactly zero.

Finally require zero window errors, unhandledrejection events, pageerror events, unexpected console errors, Server uncaught exceptions, Server unhandled rejections, and unexpected structured runtime errors. Expected rejection records are not uncaught errors. Every captured transform and duration is finite; durations and backlog are non-negative.

## Evidence manifest

Always write testInfo.outputPath("evidence.json") atomically after cleanup. It is the sole machine-readable acceptance artifact; screenshots, video, traces, and console logs are bounded diagnostics only. The manifest is JSON with schemaVersion 1 and these required fields:

- testId, project, title, status, firstFailedInvariant, and reproductionCommand;
- seedDecimal, seedHex, injectorAlgorithm, baseRttMs, jitterMinMs, jitterMaxMs, dropRate, and the complete ordered application-message schedule with route ordinal, direction, message ordinal, enqueue time, jitter, due time, drop draw, and dropped decision;
- Node version, operating system, architecture, Playwright version, bundled Chromium revision, ws version, resolved loopback URL with port redacted, compression observations, and context-isolation observations;
- the complete static scene, capsule, controller, speed, initial positions, and forced position;
- Server tick count, per-phase counts, snapshot opportunity ticks, per-recipient sent and delivered snapshot counts, Client simulation counts, presentation-frame counts, and injected observation times;
- OP-01 through OP-07 values, authority digests, Rapier ownership tokens and value digests, phase traces, finite-transform scan counts, rejection before/delta/after maps, bounded structured errors, and disconnect removal tick;
- final Client A, Client B, Server, and harness cleanup counters, first and second shutdown result tokens, and second-call mutation deltas; and
- uncaught and unhandled capture counts.

The manifest records no raw malformed payload, socket, HTTP object, WebSocket object, Zod issue, Rapier handle, stack, credential, address, full URL, or browser vendor object. On failure it retains the first failed invariant and only the bounded telemetry and structured errors needed to reproduce it. The test passes only if all observations, cleanup assertions, and manifest serialization complete in the canonical no-retry run.
