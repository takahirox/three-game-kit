# Runtime scheduling contract

- **Status:** Accepted
- **Milestone:** M0
- **Applies to:** `@three-game-kit/core`, `@three-game-kit/client`, and `@three-game-kit/server`

## Scope

This document is the accepted scheduler and time contract for the bounded MVP. It fixes the
observable order, clock boundaries, driver limits, ownership, and verification obligations needed
by the headless kernel, local browser slice, and authoritative multiplayer slice. It does not claim
deterministic lockstep or define a general-purpose task scheduler.

## Simulation time

Simulation advances at exactly 60 ticks per simulated second. The logical tick duration is exactly
`dt = 1/60` second; implementations must carry that single constant into every tick context rather
than derive simulation time from a presentation timestamp or a rounded frame duration.

A fresh simulation has integer tick `0`. Immediately before executing a tick, the runtime increments
the tick by one, so the first executed tick is `1`. Tick is a non-negative safe integer, increases
by exactly one for every completed or attempted tick, never decreases, never repeats, and never
wraps. Attempting to advance beyond `Number.MAX_SAFE_INTEGER` is a structured runtime failure and
executes no system for the overflowing tick.

Every tick system receives the current integer tick and the fixed `1/60`-second `dt`. It receives
no presentation delta. Simulation state may be published for presentation, but a presentation
frame, its timestamp, or the time since the previous presentation frame must never advance or scale
simulation.

## Simulation drivers

A runtime selects exactly one simulation driver when it starts. Driver selection is immutable for
that run.

### Exact-step driver

The headless Server exposes `stepExact(count)`, where `count` is a non-negative safe integer. The
call is synchronous. On success it returns only after exactly `count` whole ticks and every phase
in those ticks has completed. It does not read a clock, alter a wall-clock accumulator, synthesize
catch-up telemetry, or schedule later work. `stepExact(0)` is a no-op that returns the current tick.

The Client test surface may invoke the same exact simulation-tick primitive so browser tests can
advance simulation independently from presentation. Exact stepping and wall-clock pumping cannot
be active on the same runtime instance.

### Wall-clock driver

The wall-clock driver obtains elapsed time from its own monotonic simulation clock. Its pump is
independent of the presentation-frame source and must not be fed a presentation timestamp or
presentation-frame delta.

For each pump, in this exact order:

1. Reject a negative or non-finite elapsed value as a structured clock failure without changing
   tick or accumulator state.
2. Add elapsed time to the accumulator, cap the accumulator at exactly `250 ms`, and add the
   truncated amount to discarded-time telemetry.
3. While at least `1/60` second remains and fewer than five ticks have run in this pump, subtract
   one tick duration and execute one complete simulation tick.
4. If five ticks ran and one or more whole tick durations remain, discard those whole durations,
   retain only the sub-tick remainder, and add the discarded amount to discarded-time telemetry.
5. Publish pump telemetry containing elapsed time, backlog before execution, ticks executed, final
   accumulator, discarded time for this pump, and cumulative discarded time.

Thus a pump executes at most five catch-up ticks, the accumulator never exceeds `250 ms`, and a
stall cannot create unbounded future catch-up. Discarded time never changes `dt` and is never
reintroduced. Tick duration, accumulator, backlog, and discarded time use seconds in runtime data;
telemetry may additionally render milliseconds as a derived display value.

## Schedule domains and phases

Server simulation phases are exact names and execute in this exact order:

1. `ingress`
2. `validate-bind`
3. `command-apply`
4. `shared-movement`
5. `authoritative-collision`
6. `gameplay`
7. `snapshot-build`
8. `telemetry`

Client simulation phases are exact names and execute in this exact order:

1. `snapshot-ingest`
2. `reconcile`
3. `action-sample`
4. `command-send`
5. `shared-predict`
6. `predictive-collision`
7. `presentation-publish`
8. `telemetry`

Client presentation frames are a separate schedule domain with these exact phases:

1. `remote-interpolation`
2. `camera-view`
3. `render`
4. `frame-telemetry`

Remote interpolation is presentation-only. Reconciliation and local prediction are simulation-only.
`presentation-publish` publishes a finite, kit-owned snapshot for later frame consumption; it does
not render. Presentation systems may read published simulation state but may not mutate the
simulation World, apply commands, run collision, or execute a simulation phase.

## System ordering

Each tick or presentation system declares exactly one phase from its own domain and one signed safe
integer priority. Negative, zero, and positive priorities are valid. Within a phase, lower priority
runs first.

Equal priorities are ordered by Feature declaration order. Feature declaration order means the
Feature's zero-based position in the runtime's original validated Feature list, not setup completion
order, callback arrival order, or registration timing. If one Feature declares multiple systems at
the same phase and priority, its runtime-contribution declaration order is the final tie-breaker.

Phase order always dominates priority. A system cannot use priority to move into or across another
phase. The MVP has no arbitrary `before`/`after` graph, cross-phase override, system dependency
edge, or runtime schedule mutation.

The runtime resolves and freezes all schedules before the first tick or frame. An inspectable
schedule is available before execution and after stop until disposal. Each entry reports domain,
phase, priority, Feature ID, Feature declaration index, system ID, within-Feature declaration index,
and final execution index. Inspection order must exactly match execution order. Duplicate system IDs
within one runtime are rejected before setup completes.

## Synchronous execution and asynchronous ingress

Tick systems and presentation systems are synchronous and serial. A system must finish before the
next system begins. Returning a Promise or other thenable is a structured invariant failure; the
runtime executes no later system in that tick or frame. A thrown error is reported through the same
structured runtime-error boundary and also aborts the remaining systems in that tick or frame.
There is no parallel, worker, or fire-and-forget system execution.

Asynchronous transport, asset, device, and timer callbacks may only validate/copy data and enqueue it
into an owning bounded mailbox. They may not run a system, mutate the simulation World, reconcile,
apply gameplay, collide, build a snapshot, render, or resume an interrupted phase. Every mailbox has
a finite configured capacity and an explicit overflow result and telemetry counter; no callback may
create an unbounded fallback queue.

A schedule drains queued data only in its later owning phase: Server network data in `ingress`,
Client snapshots in `snapshot-ingest`, and semantic input in `action-sample`. Data enqueued after
a phase begins waits until that phase's next tick. Every delayed callback carries a runtime
generation/live fence and must re-check it before enqueueing, so stopped or disposed runtimes cannot
receive late work.

## Presentation frame source

Client Runtime receives an injectable `PresentationFrameSource` at construction:

```ts
interface PresentationFrameSource {
  request(callback: (timestampMs: number) => void): PresentationFrameRequest;
  cancel(request: PresentationFrameRequest): void;
}
```

`PresentationFrameRequest` is an opaque source-owned handle. `request` schedules at most one
callback invocation and returns its handle synchronously. The callback timestamp is a finite,
monotonically non-decreasing number of milliseconds in the source's monotonic time origin; it is not
Unix time and the runtime must not assume a refresh rate. `cancel` is idempotent. If the callback
has not begun, cancellation prevents it; cancellation after it begins has no further effect.

While running, Client Runtime owns at most one outstanding presentation request. A callback clears
that handle, executes exactly one presentation-frame schedule with the supplied timestamp, and
requests the next frame only after all frame phases finish and only if the runtime is still live.
The timestamp may drive remote interpolation, camera/view calculation, rendering, and frame
telemetry. It must not be converted into simulation ticks or simulation `dt`.

`requestAnimationFrame` plus `cancelAnimationFrame` is the required browser adapter and passes
the browser callback timestamp through unchanged. The source is injected rather than read globally.
A future XR adapter may replace this source at Client construction without changing simulation or
presentation systems. The MVP does not implement WebXR, an XR session, an XR render loop, or
mid-run frame-source replacement.

## State and ownership

- Server Runtime owns its authoritative World, simulation tick, wall-clock accumulator and driver,
  frozen Server schedule, scheduler mailboxes, and scheduling telemetry.
- Client Runtime owns its Client World, simulation tick and driver, frozen Client simulation and
  presentation schedules, published presentation state, outstanding frame-request handle, and
  scheduling telemetry.
- A Feature owns its system declarations and any bounded mailbox or external resource it creates.
  Registration gives the runtime permission to call a system; it does not transfer ownership of the
  Feature's external resources.
- An async adapter owns its listeners, timers, callbacks, copied queued values, capacity, and
  overflow accounting. The runtime owns the live fence that decides whether its data may enter a
  schedule.
- A `PresentationFrameSource` owns its underlying clock and scheduling mechanism. Client Runtime
  owns and cancels only the request handles it creates. It does not dispose an externally supplied
  source.
- Systems borrow the World and tick/frame context for the duration of one synchronous call. They
  must not retain a mutable context for later asynchronous use.

## Stop and disposal

`stop()` is synchronous, terminal, and idempotent. It first flips the runtime live fence, then
cancels its wall-clock pump and pending presentation request, and then prevents exact steps, pumps,
new frame requests, and mailbox admission. A callback already dispatched must observe the fence
before enqueueing or requesting another frame. No system begins after stop starts. Stop retains the
World, frozen schedules, telemetry, and Feature-owned resources for inspection; restart is excluded.

`dispose()` is idempotent and returns the same completion promise after its first call. It invokes
`stop()`, clears scheduler-owned pending mailboxes without executing them, disposes successfully
set-up Features in exact reverse setup order, releases published presentation state and schedule
registrations, and finally disposes the runtime-owned World and scheduler state. Async Feature
disposal may be awaited between ticks, but never from inside a tick or frame system. Callers must
await disposal before treating cleanup as complete.

After disposal there are zero runtime-owned timers, frame requests, callbacks, mailbox entries,
systems, presentation snapshots, or World-held values. Schedule inspection and all operations other
than repeated `stop` or `dispose` return a structured disposed-runtime failure. A second stop or
dispose performs no additional cancellation or cleanup side effect.

## Consequences

- The simulation rate and order are portable and inspectable, but floating-point, collision, and
  application behavior are not promised to be bit-identical across runtimes.
- Long stalls lose simulated wall time after the explicit catch-up budget. Telemetry makes that loss
  observable instead of hiding it through a variable `dt` or a runaway backlog.
- Lower signed priorities are the only within-phase ordering control. Feature declaration order is
  therefore behaviorally significant and must be preserved in reports and tests.
- Simulation and presentation rates may differ freely. High or low display refresh never changes
  the number or size of simulation steps.
- Async work has at least one phase-boundary delay and may be rejected at capacity; bounded memory
  and stable ordering take precedence over implicit immediate execution.

## Deliberate exclusions

The MVP excludes variable-timestep simulation, presentation-delta simulation, time scaling, pause
and resume, restart after stop, runtime Feature or schedule mutation, arbitrary ordering graphs,
cross-phase overrides, asynchronous or parallel systems, worker/job scheduling, priority
preemption, deterministic lockstep, replay clocks, rollback simulation, WebXR implementation, and
mid-run presentation-source replacement.

## Objective milestone tests

### Milestone 1

1. On a fresh headless Server, `stepExact(60)` completes synchronously at tick `60`, supplies
   `dt === 1/60` to every invocation, and executes every registered once-per-tick system exactly 60
   times in the exact Server phase, ascending-priority, Feature-declaration order.
2. A table containing negative, zero, and positive priorities and equal-priority systems from three
   Features produces an inspection report byte-for-byte equivalent in order to the observed
   execution trace. A cross-phase priority, arbitrary edge, duplicate system ID, or phase from the
   wrong domain is rejected before the first tick.
3. `stepExact(0)` changes no count or accumulator. An exact-driven runtime reads no clock, and an
   attempt to activate wall-clock pumping on it returns a structured driver-mode failure.
4. One wall-clock pump with `1000 ms` elapsed caps at `250 ms`, executes exactly five ticks,
   retains less than one tick of accumulator, and reports the truncated input plus post-budget whole
   ticks as discarded time. Repeated sub-tick pumps execute a tick only when their sum reaches
   `1/60` second; no pump executes more than five.
5. A thenable-returning tick system aborts later systems and emits one structured invariant error.
   A delayed callback can enqueue only copied data into a capacity-limited mailbox, is applied only
   at the next owning phase, and increments overflow telemetry without World mutation when full.
6. After `stop()`, further steps and pumps fail without executing a system. Two disposal calls
   leave zero systems, timers, mailbox values, World values, or second-disposal effects.

### Milestone 2

1. The injected test frame source drives exactly 75 presentation frames while exact control drives
   exactly 120 Client simulation ticks. Collision runs exactly 120 times, each presentation phase
   runs exactly 75 times in order, and neither count changes when only the other domain advances.
2. Frame timestamps that are finite and non-decreasing reach all four presentation phases unchanged,
   drive remote interpolation/camera/render/frame telemetry only, and never alter simulation tick or
   `dt`. A decreasing or non-finite timestamp produces one structured frame-source failure and no
   frame systems run.
3. At most one request is outstanding. Cancelling before delivery prevents the callback; stopping
   inside a callback prevents a replacement request; repeated cancel, stop, and dispose add no
   effect. Cleanup leaves zero frame handles and callbacks.
4. The browser `requestAnimationFrame` adapter maps one request, callback timestamp, and
   cancellation to the injected interface without a global frame assumption in Client systems.
   No WebXR API, type, global, or implementation is required by the build or test.
5. Published local transforms and interpolated remote transforms remain finite; presentation reads
   only the latest published simulation state and performs no collision, reconciliation, or World
   mutation.

### Milestone 3

1. `stepExact(60)` advances the authoritative Server by exactly one simulated second and completes
   each tick through `telemetry`; wall-clock catch-up is not used as evidence for this assertion.
2. An instrumented valid command is observed in `ingress`, `validate-bind`, `command-apply`,
   `shared-movement`, `authoritative-collision`, `gameplay`, `snapshot-build`, and
   `telemetry` in exactly that order. The snapshot contains the post-collision authoritative state.
3. Client receipt and prediction trace
   `snapshot-ingest -> reconcile -> action-sample -> command-send -> shared-predict ->
   predictive-collision -> presentation-publish -> telemetry` exactly. The next independently
   delivered frame traces
   `remote-interpolation -> camera-view -> render -> frame-telemetry` without advancing Client
   simulation.
4. A `1000 ms` Server pump during the separate catch-up test executes five ticks, reports bounded
   backlog and cumulative discarded time, and emits no presentation-derived simulation delta.
5. With delayed network callbacks racing stop/disconnect, all copied values wait for their owning
   later phase, full queues reject and count overflow, and callbacks that fail their live-fence
   check cannot enqueue, mutate authority, build a snapshot, or render.
6. The normative two-context test records inspectable Server, Client simulation, and presentation
   schedules; their reports exactly match the phase traces used to prove prediction, authoritative
   collision, snapshot construction, remote interpolation, and cleanup.
