# Structured errors and telemetry contract

- **Status:** Accepted
- **Milestone:** M0
- **Applies to:** `@three-game-kit/core`, `@three-game-kit/shared`, `@three-game-kit/client`, `@three-game-kit/server`, and transport adapters

## Scope

This document is the accepted structured-error and telemetry contract for the bounded MVP. It
provides the observations required by the headless kernel, local browser slice, authoritative
two-client slice, and their cleanup tests. It is not an observability platform, a logging API, or a
general metrics framework.

The contract refines the error and telemetry wording in the accepted scheduler, Feature lifecycle,
Protocol, transport, and Playwright contracts. Domain result unions remain authoritative for their
operations. Telemetry reports what occurred; it never grants authority, changes a result, or makes
an invalid operation valid.

## Ownership and public boundary

`@three-game-kit/core` owns the public, environment-neutral `RuntimeErrorRecord`, its supporting
kit-owned value types, and the common telemetry snapshot shapes. This adds no package or public
module specifier: the types are exported only from the existing Core root. Protocol remains free of
a Core dependency; Client or Server converts a Protocol failure into a runtime record at the host
boundary.

Every Client Runtime and Server Runtime owns exactly one telemetry store for its lifetime. Shared
systems report through the store of the host executing them. Client and Server transport adapters
report through their owning host's store. There is no process-global store, registry, default sink,
or cross-runtime aggregation. Two Clients and one Server therefore have three independent stores
and independent counter and error-ring sequences.

Public records, snapshots, observer arguments, and emitted declarations contain only deeply
immutable kit-owned data. Implementations copy and freeze values before publication. No public
telemetry value exposes a mutable World value, callback, resource, vendor handle, or borrowed
object.

## Structured runtime errors

### Public record

`RuntimeErrorRecord` is a JSON-serializable record with exactly these fields:

| Field | Contract |
| --- | --- |
| `schemaVersion` | Required literal `1`. |
| `sequence` | Required positive safe integer, allocated monotonically by the owning telemetry store. |
| `code` | Required stable, documented, lower-case kebab-case kit or Feature error code. |
| `category` | Required literal `expected` or `invariant`. |
| `expected` | Required boolean, exactly equivalent to `category === "expected"`; retained to satisfy result and test surfaces that refer to the expected flag. |
| `runtime` | Required literal `client`, `shared`, `server`, or `transport`. |
| `operation` | Required stable lower-case kebab-case operation name. |
| `message` | Required bounded, sanitized human-readable summary; it is diagnostic text, not a matching key. |
| `tick` | Optional non-negative safe integer, present only when the failure is associated with a known simulation tick. |
| `featureId` | Optional sanitized Feature ID, present only when one installed or validating Feature is directly responsible. |
| `entityId` | Optional sanitized kit-owned or server-issued entity correlation ID, present only when a trusted runtime binding established it. |
| `connectionId` | Optional sanitized server-issued connection ID, present only after the Server established that binding. |
| `reasonCode` | Optional exact ADR 0005 rejected-command reason, present only when that vocabulary classifies the rejection. |
| `context` | Required immutable list of zero to 16 bounded sanitized scalar entries. |
| `cause` | Required normalized `RuntimeCauseSummary` or `null`. |

Optional fields are omitted, never serialized as `undefined` and never filled with guessed or
untrusted identifiers. In particular, a Client-supplied target or ownership field cannot populate
`entityId` or `connectionId`. `tick` is omitted for presentation, setup, transport, and other work
that cannot be associated with one exact simulation tick.

`runtime` identifies the layer that failed: a Shared rule uses `shared`; a Client or Server host,
scheduler, or owned adapter uses `client` or `server`; and browser/native-WebSocket or `ws`
transport work uses `transport`. This is the precise runtime value for the structured transport
errors described more generally as Client or Server errors in ADR 0006. Host ownership is still
known from the store containing the record.

A `RuntimeErrorContextEntry` has exactly `key` and `value`. `key` is a stable sanitized string and
`value` is a string, finite number, boolean, or `null`. Entries are ordered by key, contain no
nested arrays or objects, and are diagnostic only. Paths and issue codes may be rendered as bounded
strings; raw rejected values may not.

A `RuntimeCauseSummary` has exactly `name`, `code`, and `message`. `name` and `message` are sanitized
strings and `code` is a sanitized string or `null`. It is a lossy, non-authoritative description.
Code must never branch on the summary, use it for trust or retry decisions, or reconstruct the
thrown object.

### Bounds and sanitization

The limits are fixed for schema version 1:

| Limit | Value |
| --- | ---: |
| Retained runtime-error records per store | `256` |
| UTF-8 bytes in `code` or `operation` | `64` |
| UTF-8 bytes in `message` | `512` |
| Context entries | `16` |
| UTF-8 bytes in a context key | `64` |
| UTF-8 bytes in a context string value | `256` |
| UTF-8 bytes in an optional correlation ID | `128` |
| UTF-8 bytes in cause `name` or non-null `code` | `64` |
| UTF-8 bytes in cause `message` | `512` |
| UTF-8 bytes in one serialized record | `8_192` |

All numbers are finite JSON numbers. Strings replace invalid Unicode and control characters,
remove line-breaking control sequences, and truncate at a valid UTF-8 boundary. Stable `code`,
`operation`, and `reasonCode` values are validated rather than truncated. Context keys with names
such as password, authorization, cookie, token, secret, credential, or their documented aliases are
removed; their values are not inspected or retained. If a source message might contain untrusted
payload text, a URL user-info/query/fragment, credentials, or personal data, the producer supplies a
generic code-specific message instead of copying it.

Sanitization is a final defense, not permission to collect sensitive input. Producers must never
submit raw network text or bytes, headers, cookies, addresses, origins, user-agent values,
configuration values, credentials, personal data, or complete URLs to the record builder. A bound
violation or disallowed value from kit code is itself an invariant failure; it cannot cause an
unbounded fallback record.

An arbitrary thrown value is normalized once. A native `Error` contributes only guarded copies of
its safe name, string code when present, and message. A primitive contributes a generic type name
and a sanitized representation only when it cannot contain sensitive input. An object, function,
symbol, rejected third-party value, or value with unsafe accessors becomes a generic non-Error
summary. The normalizer never serializes, enumerates, retains, or publishes the original value and
never reads or records `stack` by default.

### Classification

`expected` means the operation contract anticipated the outcome and can report it without breaking
a runtime invariant. Examples include invalid Feature configuration, an asset load failure,
invalid lifecycle phase, Protocol decode failure, and a rejected command. Expected does not mean
success and does not permit partial behavior.

`invariant` means kit, Feature, scheduler, adapter, or async behavior violated an internal contract.
Examples include a throwing or thenable-returning synchronous system, non-finite published state,
work after a live fence, counter overflow, cleanup that remains live, or an unexpected rejected
Promise. There is no warning, fatal, vendor, or arbitrary category in the MVP.

A stable `code` classifies the operation-level failure. Each owning public operation or Feature
documents its finite code vocabulary. `reasonCode` is narrower: it is present only for the command
rejection vocabulary fixed below. Messages and cause summaries never substitute for either code.

### Capture once and surface

The boundary that first turns a failure into a domain result owns its one runtime-error record. It
allocates one sequence, appends the record once, and publishes that same immutable record once to
the runtime's structured-error observer. A caller that propagates the result must not record it
again. Implementations use an internal occurrence token or equivalent ownership marker; object
identity, message text, and stack comparison are not deduplication mechanisms. Separate failures
with equal fields remain separate occurrences.

Every Promise, timer, transport callback, asset callback, and device callback started by kit or
Feature code is owned and wrapped at registration. An unexpected throw or rejection is consumed at
that first async boundary, normalized as one `invariant` record, and surfaced through the observer
and the owning operation's structured failure or terminal runtime fault. It cannot be converted to
success, silently ignored, or left as an unhandled rejection. Browser `error` and
`unhandledrejection`, Playwright `pageerror`, and Node uncaught/unhandled hooks are test backstops;
normal runtime capture does not rely on them.

Observer failure is an invariant and cannot prevent rollback or cleanup. The host uses one bounded
emergency fault handoff and stops further observer calls for that observer; it does not recursively
publish an unbounded chain of observer-failure records.

### Expected rejection is side-effect free

A rejected command is classified before command admission. It does not advance accepted sequence
state, enter a command queue, invoke Shared movement or collision, mutate a World, binding, entity,
or authoritative component, or build a snapshot from changed gameplay state. The only permitted
effects are one immutable expected error record, exactly one matching rejected-command counter
increment when `reasonCode` applies, and an optional schema-valid `rejected` wire response when ADR
0005 permits one. Failure to send that response does not undo or duplicate the local observation.

Lifecycle, state, decode, and configuration rejections follow the same rule for the state protected
by the rejected operation. A legal state transition that detects a peer close is not a rejected
operation and remains governed by ADR 0006.

## Telemetry snapshots

Telemetry is a read-only state snapshot, not a stream processor. Schema version 1 has exactly two
host snapshot variants. Both contain these common fields:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Literal `1`. |
| `runtime` | Literal `client` or `server` for the owning host. |
| `telemetrySequence` | Monotonic safe integer changed only when telemetry state changes; taking a snapshot does not increment it. |
| `simulationTick` | Current non-negative safe-integer logical tick. |
| `entityCount` | Current non-negative safe-integer `World.entityCount` gauge. |
| `installedFeatureIds` | Exact immutable resolved installed Feature ID order while running; empty before commit and after shutdown. |
| `droppedWallTimeSeconds` | Cumulative finite non-negative seconds discarded by bounded catch-up. |
| `scheduleReport` | The immutable accepted scheduler inspection report, or `null` before a valid schedule is frozen. |
| `connection` | The bounded connection snapshot below, or `null` when networking is not installed. |
| `liveResources` | The fixed cleanup gauge set below. |
| `structuredRuntimeErrorCount` | Total records accepted by this store since construction. |
| `structuredRuntimeErrorEvictedCount` | Total oldest records evicted from the 256-record ring. |
| `structuredRuntimeErrors` | Zero to 256 retained records in ascending `sequence` order. |

The Client variant additionally contains:

| Field | Meaning |
| --- | --- |
| `clientFrameDurationSeconds` | Duration of the latest completed presentation schedule, or `null` before one completes. |
| `presentationFrameCount` | Number of completed presentation schedules. |

The Server variant additionally contains:

| Field | Meaning |
| --- | --- |
| `serverTickDurationSeconds` | Duration of the latest completed Server tick schedule, or `null` before one completes. |
| `serverBacklogSeconds` | Latest wall-clock pump backlog before execution; exactly `0` for exact-step observations. |
| `rejectedCommandCounts` | Complete ADR 0005 reason map, with every reason present and initialized to `0`. |

There are no additional required MVP metrics. In particular, render statistics, network byte rates,
WebSocket `bufferedAmount`, XR state, asset counts, physics timings, arbitrary Feature measurements,
histograms, percentiles, labels, and tags are not part of the accepted telemetry surface.

### Units and sampling

Durations, backlog, and discarded wall time use seconds. Frame-source callback timestamps remain
milliseconds under the scheduling contract and are never stored in a duration field without
conversion. Counts have unit `count`; entity count and live-resource values are gauges, not
monotonic counters.

Client frame duration spans entry into `remote-interpolation` through completion of
`frame-telemetry`. Server tick duration spans entry into `ingress` through completion of
`telemetry`. Both are measured by a monotonic observation clock, are finite and non-negative, and
never affect simulation, interpolation, scheduling, rejection, or cleanup. An exact-step driver does
not consult a driver clock or accumulator; an exact-step test may supply deterministic observation
timing, including `0`, without changing tick behavior. No production performance target follows
from these samples.

`serverBacklogSeconds` is the pump's backlog-before-execution value from the scheduling contract. It
is capped by that contract and is not inferred from tick duration. `droppedWallTimeSeconds` adds
both input truncation and post-five-tick whole-duration discard, never decreases, and remains zero
for exact stepping. A pump report may be retained by the test observation surface, but the public
MVP telemetry snapshot retains only the latest backlog and the cumulative discarded duration.

`simulationTick`, `presentationFrameCount`, rejection counts, error totals, eviction totals,
transition totals, and `telemetrySequence` are monotonic safe-integer counters. They never wrap,
decrease, or reset on stop. An attempted overflow leaves the counter at its prior value, records an
invariant through the bounded fault handoff, and terminates the affected runtime. Duration totals
never become non-finite.

### Installed Features and schedule report

The installed Feature list is copied from the lifecycle's resolved successful setup order. Failed
or merely declared Features are not installed. The list cannot mutate while running because runtime
Feature mutation is excluded.

The schedule report uses the exact kit-owned entries required by the scheduling contract: domain,
phase, priority, Feature ID, Feature declaration index, system ID, within-Feature declaration index,
and final execution index. Its order is execution order. The Client report contains its simulation
and presentation domains; the Server report contains its simulation domain. Telemetry does not
invent another phase vocabulary or ordering graph.

### Connection state

Connection telemetry preserves ADR 0006's exact state names and one record per legal edge. A
transition record contains monotonic sequence, host runtime (`client` or `server`), scope
(`transport` or `connection`), previous state, next state, operation, optional trusted
`connectionId`, and optional associated tick. It contains no socket, address, origin, close payload,
peer error, or timer.

A Client connection snapshot contains the current Client networking state, total transition count,
evicted transition count, and the most recent transitions. A Server connection snapshot contains
the current Server transport state, a count for every Server per-connection state, total transition
count, evicted transition count, and the most recent transitions. Closed records are removed from
current state counts after their final transition; the transition remains in the bounded history.

Each recent-transition history has fixed capacity `256`, evicts the oldest record before appending a
new record when full, and is returned in sequence order. This history exists only to establish the
ADR 0006 state paths objectively; it is not a general event log. Duplicate close or shutdown
callbacks add neither a transition nor a count.

### Rejected-command reason alignment

`rejectedCommandCounts`, `RuntimeErrorRecord.reasonCode`, and the Protocol `rejected.reason` field
use exactly this ADR 0005 vocabulary, with no aliases:

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

One rejected inbound command attempt increments exactly one reason. Decode failures already named
`unsupported-version`, `unknown-kind`, `wrong-direction`, or `schema-invalid` map directly.
`invalid-json` and `not-json-object` on the Server command ingress map to `schema-invalid` for this
counter while retaining the precise decode failure in the error `code` and sanitized context.
`binary-frame`, `message-too-large`, and `invalid-utf8` cannot establish a command attempt and
therefore create an expected transport error but no rejected-command increment or `reasonCode`.
Encode failures and Client-side snapshot decode failures also do not increment Server command
rejection counters.

The counter increments at the same decision point as the expected rejection record and before an
optional wire response. No failure path increments two reasons, and no later transport callback
reclassifies an already counted rejection.

### Objective-test-only supporting observations

The monotonic simulation tick and presentation frame count, cumulative dropped wall time, frozen
schedule report, connection transition history, and cleanup live-resource gauges exist because the
accepted M1-M3 tests require exact counts, order, catch-up loss, state edges, and zero-resource
proof. They are not an invitation to register additional application metrics.

`liveResources` has exactly these non-negative safe-integer gauges; a runtime uses `0` for a kind it
does not own:

- `worlds`
- `worldValues`
- `systems`
- `subscriptions`
- `listeners`
- `timers`
- `sockets`
- `serverListeners`
- `mailboxes`
- `queuedItems`
- `queuedDeliveries`
- `bindings`
- `ownedAvatars`
- `presentationRequests`
- `presentationCallbacks`
- `renderResources`
- `physicsWorlds`
- `physicsControllers`
- `physicsColliders`
- `physicsHandles`
- `ledgerRecords`
- `retainedReferences`

A gauge increments only after ownership is recorded and decrements only after the item is fenced,
unpublished where applicable, released, and no longer capable of work. It does not contain the
resource, its vendor type, or its identity. `worldValues` counts ECS-held component and resource
values for cleanup evidence; `entityCount` remains the authoritative entity gauge. Test harness
resources such as Playwright pages and browser contexts are outside runtime telemetry and are
asserted by the harness that owns them.

## Store, snapshot, reset, and shutdown behavior

A fresh store starts with sequence and monotonic counters at zero, duration samples `null`, gauges
at zero, the complete rejection map at zero, no connection adapter, an empty installed list, a null
schedule report, and empty bounded histories. Runtime construction is the only reset. There is no
public `reset`, `clear`, delete-record, set-counter, register-metric, or replace-store operation.
Tests reset by constructing a fresh runtime and World.

A telemetry mutation and its `telemetrySequence` increment are atomic with respect to a synchronous
snapshot. `snapshotTelemetry()` returns a deep immutable, detached value representing one complete
store state. It never clears a ring, advances a counter, invokes an observer, or exposes a live
array. Two snapshots without an intervening mutation are deeply equal. Snapshot acquisition does
not read gameplay objects other than the documented scalar gauges and already copied reports.

The runtime-error ring has fixed capacity 256. Append allocates the next error sequence and
increments `structuredRuntimeErrorCount`. If full, it removes exactly the oldest record first and
increments `structuredRuntimeErrorEvictedCount`. A snapshot always satisfies
`structuredRuntimeErrorCount === structuredRuntimeErrorEvictedCount +
structuredRuntimeErrors.length`. Observers still receive each record once even when it is later
evicted; eviction emits no error and does not decrement totals.

`stop()` prevents new runtime work as defined by the scheduler but retains the store for inspection.
During rollback or shutdown, cleanup gauges, lifecycle errors, transport state, and cleanup errors
continue to update after the live fence is flipped. After all owned cleanup attempts complete, the
runtime verifies zero live-resource gauges, zero entity count, an empty installed list, terminal
connection state, and no queued work. A nonzero value is one invariant record and makes the stopped
result unclean; cleanup continues.

Immediately before disposal releases the store and observers, the host publishes one final detached
snapshot to its existing test/observation surface. That final snapshot contains all cleanup errors
and the frozen schedule report. After disposal, runtime snapshot operations return the structured
disposed-runtime failure, but previously returned snapshots remain readable immutable data. A
second stop, dispose, or shutdown returns the cached result and creates no telemetry mutation,
observer call, transition, counter increment, ring record, or new final snapshot.

Telemetry retention ends with the runtime. The store does not write a file, browser storage,
database, network service, or process-global cache.

## Consequences

- Every expected and invariant failure has one stable, environment-neutral public shape while
  domain result unions retain their more specific contracts.
- A fixed error ring and fixed transition history bound retained diagnostic memory; older detail can
  be evicted while monotonic totals and rejection counters preserve objective counts.
- Deep copies, cause normalization, and sanitization add work at failure and snapshot boundaries but
  prevent vendor objects and sensitive inputs from becoming public compatibility or retention
  surfaces.
- Latest-duration samples are sufficient for MVP acceptance and avoid committing to histograms,
  percentiles, sampling systems, or performance promises.
- Per-runtime ownership makes two-Client and Server observations isolated and makes reset and
  shutdown behavior deterministic.
- Exact reason alignment lets Protocol rejection messages, Server counters, and expected error
  records be compared without a translation vocabulary.

## Deliberate exclusions

The MVP includes no exporter, dashboard, tracing or span system, persistent telemetry storage,
remote collection, log shipping, metrics backend, arbitrary metrics registry, dynamic names,
user-defined labels or tags, sampling policy, alerting, production SLO or SLA, performance budget,
profiling system, crash reporter, source-map service, or stack capture by default.

Telemetry contains no PII, account identity, display name, email, IP address, user agent, origin,
full URL, credential, authorization material, cookie, raw network payload, raw configuration value,
DOM object, Three.js object, Rapier type or handle, browser WebSocket, `ws` object, Node HTTP object,
Zod schema or issue, third-party error object, stack, or arbitrary thrown value. Diagnostic files,
Playwright traces, screenshots, video, and console capture remain bounded test artifacts outside
this runtime contract and are not acceptance evidence.

## Objective milestone tests

### Milestone 1

1. A fresh Server snapshot has the exact schema, zero counters and gauges, null duration, empty
   installed IDs and histories, and a complete zero-valued rejection map. Taking it twice causes no
   mutation and yields deeply equal detached values.
2. Exact-step 60 ticks and separately exercise a wall-clock pump. Assert `simulationTick === 60` for
   the exact runtime, non-negative finite tick duration and zero backlog, and the scheduling
   contract's exact backlog and cumulative dropped seconds for the wall-clock runtime. No timing
   sample changes tick or `dt`.
3. Freeze a schedule with tied priorities and assert the telemetry schedule report equals both the
   scheduler inspection report and execution trace field-for-field and in order.
4. Produce one expected lifecycle failure and one throwing or thenable system invariant. Assert one
   record per occurrence, correct category/expected relation, runtime, operation, code, applicable
   Feature and tick, sanitized context and cause, and exactly one observer delivery. Propagation adds
   no duplicate.
5. Append 257 valid fixture errors. Assert total 257, evicted 1, retained sequences 2 through 257 in
   order, a maximum retained length of 256, and immutable earlier snapshots.
6. Attempt to report raw configuration, credentials, stack, vendor objects, non-finite numbers, and
   over-bound text. Assert none appears in serialized records, every record is at most 8,192 UTF-8
   bytes, and JSON round-trip yields only kit-owned data.
7. Force setup rollback and disposal failures. Assert errors are recorded in observed cleanup order,
   cleanup continues, the final snapshot has every live-resource gauge and entity count at zero,
   and repeated shutdown changes no sequence, count, ring, transition, or observer call.

### Milestone 2

1. Drive exactly 120 Client simulation ticks and 75 explicit presentation frames. Assert the two
   counts advance independently, frame duration is finite non-negative seconds, the Client schedule
   report has both exact domains, and no frame advances simulation.
2. Complete and fail glTF loads. Assert the expected load failure returns its documented result,
   produces exactly one sanitized `client` error with no stack or loader object, and does not appear
   in page-error, console-error, or unhandled-rejection capture.
3. Run a throwing presentation fixture and an unexpectedly rejecting owned asset callback. Assert
   each becomes one `invariant` record and one observer delivery, the owning operation fails or the
   runtime stops, later unsafe work does not run, and no raw rejection escapes to browser hooks.
4. Change World membership and complete Feature setup. Assert `entityCount` follows
   `World.entityCount`, installed IDs use resolved setup order, and snapshots cannot mutate either.
5. Exercise the injected and browser frame sources, stop, rollback, and normal shutdown. Assert
   presentation requests/callbacks, listeners, timers, render resources, physics resources,
   mailboxes, ledger records, and retained references all reach zero in the final snapshot; a second
   shutdown has no effect.

### Milestone 3

1. Start one Server and two Clients. Assert three independent stores, error sequences, snapshots,
   installed ID lists, entity gauges, and schedule reports; a mutation in one store changes neither
   of the others.
2. Observe the exact ADR 0006 Client, Server transport, and two Server connection state paths.
   Assert one transition per edge, correct current state/counts, trusted connection IDs only after
   allocation, no duplicate close edge, and bounded chronological transition histories.
3. Table-test all 13 ADR 0005 reasons. Each rejected command preserves accepted sequence, queues,
   bindings, entities, authoritative components, Shared/collision call counts, and snapshots;
   increments exactly one matching reason counter; and emits exactly one expected record with the
   identical `reasonCode`.
4. Deliver invalid JSON and non-object JSON and assert each counts as `schema-invalid` while its
   record preserves the bounded precise decode classification. Deliver binary, oversized, and
   invalid-UTF-8 frames and assert expected transport records but no command counter or reason code.
5. Trigger connect/bind, phase, decode, send, peer, and shutdown failures. Assert stable codes,
   `runtime: transport` for adapter failures, applicable trusted connection correlation only, one
   occurrence each, and no raw payload, peer object, socket, `ws`, Zod issue, credential, or stack.
6. Race delayed command, snapshot, send-completion, and close callbacks with disconnect and shutdown.
   Assert an unexpected callback failure is captured once and surfaced, stale work cannot mutate or
   enqueue, and browser and Node uncaught/unhandled capture remains empty.
7. Run the canonical two-context scenario. Assert finite non-negative Client frame and Server tick
   duration, Server backlog, exact tick/frame counts, entity counts, installed IDs, connection
   telemetry, rejection counters, and bounded structured errors without using telemetry to infer
   authority or mutate the scenario.
8. Disconnect one Client and shut down all runtimes twice. Assert bindings, owned avatars, sockets,
   listeners, server listeners, timers, queues, delayed deliveries, Worlds, systems, render and
   physics resources, ledger records, and retained references are zero in each final snapshot; the
   second shutdown produces no telemetry change.
