# ADR 0007: Playwright browser testing

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

Milestone 0 must select one browser runner and turn the Milestone 2 and Milestone 3 browser
requirements into repeatable, machine-verifiable gates. ADR 0001 already fixes Ubuntu 24.04 x64 and
Playwright-bundled Chromium as the required environment. This ADR fixes how that browser is driven
and what counts as browser acceptance evidence.

The local slice needs programmable semantic input, independent simulation and presentation clocks,
observable telemetry and errors, and deterministic cleanup. The multiplayer slice additionally
needs one real loopback WebSocket server, two isolated clients, exact Server tick control, and a
repeatable application-message fault model. Pixel appearance, wall-clock sleeps, or a person
reviewing an image cannot objectively establish those behaviors.

## Decision

### Runner and sole required gate

The MVP uses Playwright Test from the `@playwright/test` package and the Chromium revision installed
by that Playwright release. Exact package and browser revisions belong in the future lockfile and
browser installation record.

The sole required browser gate runs headless Playwright-bundled Chromium on Ubuntu 24.04 x64.
Headed execution may be used for local diagnosis, but it is not a separate gate. The gate uses
Playwright Test assertions and fails on any unmet state, telemetry, error, timing, cleanup, or
resource invariant. The normative projects have retries disabled; a later successful rerun does not
erase the failed run's evidence.

Firefox, Playwright WebKit, system Chrome or Chromium, other operating systems, and other
architectures are non-gating and unsupported for the MVP. They may run as diagnostics, but a result
on them neither blocks nor establishes support. An environment becomes supported only after a later
accepted decision adds it to a repeatable automated gate.

### Browser topology and programmable control

A single Playwright browser process may host the test, but every simulated client uses a distinct
`browser.newContext()`. The Milestone 3 proof creates exactly two fresh contexts and at least one
page in each; two pages in one context do not satisfy the requirement. Contexts share no cookies,
storage, cache, service workers, permissions, or application globals. The test assigns a marker in
each context and asserts that the other context cannot observe it before gameplay begins.

Browser acceptance drives the sandbox only through documented public application controls and a
test-facing observation surface. It must not import package internals. The surface provides:

- programmable semantic actions at the same boundary used after physical keyboard mapping;
- exact advancement of Client simulation ticks and explicit delivery of presentation frames;
- exact advancement of Server ticks through the Server test harness;
- read-only presentation, authoritative-state, binding, queue, and owned-resource observations;
- telemetry and structured error records; and
- idempotent application shutdown.

Programmable input submits semantic actions, not key events, DOM device events, positions, collision
outcomes, or authoritative state. Keyboard smoke coverage may prove the physical-to-semantic adapter
separately, but synthetic keyboard events are not the control source for deterministic movement
acceptance.

Exact stepping is the source of tick-count evidence. A call requesting 60 Server ticks returns only
after ticks 1 through 60 and all their scheduled phases complete, and the test asserts the returned
tick and per-system counts. Wall-clock catch-up has a separate bounded test. Playwright timeouts,
polling, and sleeps are watchdogs only and never prove an exact tick, next-frame, or convergence
criterion.

### Seeded application-level delay, jitter, and drop

The test harness owns one delay/jitter/drop injector between Protocol encode and transport send in
each direction. It schedules or drops complete application messages; it does not alter WebSocket
frames, fragmentation, TCP, browser networking, Protocol validation, or the Server's authoritative
clock.

Every injector profile contains a nonzero unsigned 32-bit seed, a base round-trip delay, an
inclusive jitter range, and a drop rate. Each route uses a versioned xorshift32 stream initialized
from the base seed, stable server connection ordinal, and direction as
`(seed ^ Math.imul(connectionOrdinal, 0x9e3779b9) ^ directionSalt) >>> 0`. Direction salts are
`0xa341316c` for Client-to-Server and `0xc8013ea4` for Server-to-Client; a zero state is replaced
with `0x6d2b79f5`. Each complete message consumes one draw for jitter and one draw for dropping,
including when the configured drop rate is zero, so its ordinal fixes its stream position.
Xorshift steps are `x ^= x << 13`, `x ^= x >>> 17`, and `x ^= x << 5`, with unsigned 32-bit
truncation after each step. For range span N, jitter is `min + floor(draw / 2^32 * N)`; the second
draw divided by `2^32` is compared with the drop rate.

The normative Milestone 3 profile is:

| Field | Value |
| --- | ---: |
| Seed | `1592590343` (`0x5eed0007`) |
| Base round-trip delay | `100 ms` |
| Per-message jitter | `0–20 ms`, inclusive |
| Drop rate | `0` |

The base delay is split evenly between Client-to-Server and Server-to-Client delivery. Jitter is
added at each complete-message delivery. Nonzero drop profiles verify the injector itself, including
a drop-rate-one case, but they are diagnostic infrastructure tests and do not create an MVP
nonzero-loss guarantee.

The canonical seed is fixed for the required gate. Additional seeds may run diagnostically and must
not replace the canonical run. Repeating a test with the same inputs, route ordinals, and seed must
produce the same ordered list of message ordinal, direction, scheduled delay, and drop decision.
Changing the mapping or stream algorithm requires a versioned test-contract change.

Every normative report, on success or failure, records the test ID, seed in decimal and hexadecimal,
injector algorithm version and profile, browser revision, operating system and architecture, Server
tick count, Client simulation tick count, presentation-frame count, and final cleanup counters. A
failure also records the first failed invariant and the relevant bounded telemetry and structured
errors. A reproduction command must accept the reported seed; retries, if used outside the gate,
reuse it rather than silently choosing another seed.

### Observable acceptance and runtime-error capture

Assertions read explicit application state, presentation transforms, telemetry, and structured error
records. They do not infer gameplay correctness from pixels. Required telemetry assertions cover
finite non-negative Client frame duration, finite non-negative Server tick duration and backlog,
entity count, the exact installed Feature ID set, connection state transitions, and
rejected-command counts by reason. Tests that intentionally cause an expected failure assert its
stable structured-error shape, runtime, operation, code, expected flag, and exactly one matching
counter increment. They also assert that unrelated counters and authoritative state are unchanged.

Before application code runs, each page installs capture for `window.error`,
`unhandledrejection`, Playwright `pageerror`, and unexpected console error output. The Server
harness captures uncaught exceptions, unhandled rejections, and the structured runtime-error stream.
Expected structured failures must not appear as uncaught errors. Each test fails if any unexpected
Client or Server runtime error is captured, if a captured transform or timing value is non-finite,
or if an expected error is missing or duplicated.

Screenshots, video, console logs, and Playwright traces may be retained on failure as bounded
diagnostic artifacts. They are never acceptance evidence. There is no manual visual approval,
pixel threshold, or golden screenshot in an MVP gate, and updating an image cannot make a failed
state assertion pass.

### Known-state setup, teardown, and ownership checks

Every browser test starts from a new application instance and fresh World. It uses a new context,
empty browser storage, the canonical seed when normative, explicit Feature configuration, and a
known scene and asset state. Networking tests start one standalone Server on `127.0.0.1` with port
`0`, wait for its resolved URL, and join clients in a declared order so connection ordinals are
stable. Tests do not depend on execution order or state left by another test.

Teardown first stops new input and frames, then calls application shutdown twice, closes pages and
contexts, and shuts down the standalone Server. Before the test process exits, programmatic
assertions prove zero owned frame callbacks, event and socket listeners, timers, pending delayed
deliveries, command and snapshot queues, live bindings, owned avatars, open sockets, HTTP listeners,
registered systems, subscriptions, render resources, and retained test-owned references. The second
shutdown produces no additional disposal side effect. Playwright's automatic context closure is a
backstop, not evidence that application cleanup passed.

## Consequences

- One runner exercises the actual bundled browser, native WebSocket client, independent contexts,
  programmable input, exact clock boundaries, and cleanup assertions.
- The required gate is narrow and reproducible, while additional browsers and hosts do not create
  accidental support commitments.
- A public test-facing control and observation surface is implementation work, but it prevents tests
  from depending on package internals, pixel interpretation, or physical input synthesis.
- Seeded application-message scheduling makes the normative network profile reproducible and
  reportable without claiming deterministic browser rendering, physics, TCP, or cross-platform
  execution.
- Capturing diagnostics increases failure artifact size; retention must remain bounded and artifacts
  cannot substitute for failed programmatic assertions.
- Exact ticks and explicit frames require separate tests for wall-clock catch-up and the normal
  `requestAnimationFrame` adapter.

## Objective Milestone 2 verification

Milestone 2 must provide Playwright Test evidence that:

1. A fresh bundled-Chromium context reaches the known ready state, programmable semantic movement
   changes the owning avatar, and collision against the selected floor and obstacle satisfies ADR
   0004's numeric tolerances without a pixel or screenshot assertion.
2. The harness advances exactly 120 Client simulation ticks and independently delivers exactly 75
   presentation frames. Counts match, collision runs only on simulation ticks, every observed
   presentation transform is finite, and the injected frame source owns scheduling.
3. Successful and failed glTF loads expose their documented states. The failure produces exactly one
   expected structured error and no uncaught error; frame duration, entity count, installed Feature
   IDs, and runtime errors are asserted through telemetry.
4. Runtime-error capture is deliberately exercised with a test fixture and proves that a page error,
   unhandled rejection, unexpected console error, or non-finite transform fails the test.
5. After two application shutdown calls and context closure, all Client-owned render resources,
   callbacks, listeners, timers, systems, subscriptions, and test references have zero live counts
   and no second-disposal side effect.
6. The required run passes on Ubuntu 24.04 x64 bundled Chromium with the complete seed/environment/
   clock/cleanup report and no manual visual or golden-image step.

## Objective Milestone 3 verification

Milestone 3 must provide Playwright Test evidence that:

1. One real loopback `ws` Server and two fresh, storage-isolated bundled-Chromium contexts join in a
   declared order through native browser WebSockets; their connection, player, entity, and
   application globals are distinct.
2. The canonical seed and 100 ms round-trip, 0–20 ms jitter, zero-drop profile produce the same
   recorded application-message schedule on repeated runs. Injector tests prove deterministic
   replay and drop behavior without claiming application tolerance of nonzero loss.
3. Programmable semantic movement is presented by the owner no later than the next explicitly
   delivered presentation frame and before the delayed authoritative response. The peer presents
   replicated movement without consuming the owner's command directly.
4. Test-controlled exact stepping advances precisely 60 Server ticks for one simulated second.
   Forced authoritative displacement then converges within `0.05` world units in `500 ms`; every
   sampled transform is finite and wall-clock catch-up is not used as tick-count evidence.
5. Malformed, unknown-kind, stale or out-of-window, ownership-violating, and movement-limit-violating
   commands each preserve authoritative state and increment exactly one matching rejection counter.
   Telemetry and structured error records have the documented shape and no raw payload or vendor
   object.
6. Disconnecting one Client removes its binding and owned avatar within two test-advanced Server
   ticks; a queued stale command cannot mutate state, and the other Client remains joined.
7. Client and Server runtime-error capture remains empty of unexpected errors throughout the
   scenario. Expected protocol and lifecycle failures are structured, counted once, and do not
   appear as uncaught exceptions or unhandled rejections.
8. Teardown and a repeated shutdown leave every owned socket, listener, timer, delayed delivery,
   queue, binding, avatar, system, subscription, Server listener, context, and retained reference at
   zero, with no additional cleanup side effect.
9. The gate passes on the canonical seed in Ubuntu 24.04 x64 bundled Chromium without retry,
   screenshot comparison, trace interpretation, or manual judgment.

## Rejected alternatives

- **Puppeteer plus a general test runner:** can drive Chromium, but duplicates runner integration and
  browser lifecycle work that Playwright Test provides for this gate.
- **Cypress:** provides browser automation but does not improve the selected two-context,
  test-controlled topology and would add a second browser-testing model.
- **jsdom, happy-dom, or a headless simulation alone:** cannot establish behavior in the required
  real browser, native WebSocket, rendering, or independent-context boundaries.
- **Two pages in one browser context:** share state and do not prove independent clients.
- **A system-installed browser or floating browser channel:** can drift independently from the
  runner and does not reproduce the locked bundled revision.
- **A required multi-browser or multi-operating-system matrix:** adds unsupported scope before an
  automated MVP need exists.
- **Manual playthroughs, visual inspection, or golden screenshots:** are subjective or presentation
  evidence and cannot prove semantic input, authority, ticks, telemetry, errors, or cleanup.
- **Wall-clock sleeps as acceptance synchronization:** are load-sensitive and cannot prove exact
  scheduler or presentation-frame boundaries.
