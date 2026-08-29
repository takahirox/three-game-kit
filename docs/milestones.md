# Foundation MVP milestones

These milestones implement the closed MVP proposed in [specification-review.md](./specification-review.md). They are ordered by dependency, not by team discipline: documentation, tests, and boundary checks ship with the capability they describe. A milestone is complete only when its exit criteria pass from a clean checkout. Later milestones may refine public APIs, but may not erase runtime, lifecycle, trust, or documentation boundaries established earlier.

Milestones 0 through 5 are complete. The implemented surface includes Core,
Shared semantic movement, the headless Server Runtime, and the local browser Client Runtime with independent
simulation/presentation clocks, semantic input, static collision, third-person camera, rendering, glTF loading,
telemetry, rollback, and cleanup. It now also includes strict Protocol v1 runtime validation, real authoritative
WebSocket networking, server-owned identity, bindings, and validation telemetry, client prediction,
reconciliation, and peer interpolation, deterministic two-context acceptance, and disconnect cleanup.
Milestone 5 consolidates this evidence in a clean CI-equivalent `pnpm verify:m5` release-candidate gate covering
172 Node and WebSocket tests, the M2 and M3 Chromium acceptances, source and package boundary checks, the M4
external-consumer audit, all five cataloged Features, and all five package archives. This is release-candidate
evidence only; it does not claim registry publication or deployment.
See [Milestone 1 verification](./m1-verification.md) and
[Milestone 2 verification](./m2-verification.md), and
[Milestone 3 verification](./m3-verification.md), [Milestone 4 verification](./m4-verification.md), and
[Milestone 5 verification](./m5-verification.md) for acceptance evidence and verification commands.

## Milestone 0 — Freeze the executable contract

**Outcome:** Contributors can name the supported environment, package graph, public surface, runtime ownership, and one objective end-to-end acceptance scenario before product implementation branches.

**Included deliverables:**

- Adopt amendments A1–A12 from the specification review or record a replacement decision with equivalent objective criteria.
- ADRs for TypeScript/module output, package manager and workspace layout, ECS, physics/collision adapter, runtime schema validation, WebSocket implementation, and browser test runner.
- Exact supported Node major, TypeScript target, required CI browser, and platform assumptions.
- A package map for `core`, `shared`, `client`, `server`, and `protocol`, plus the location of the Interaction proof and external-consumer fixture.
- Named server and client schedule phases, fixed-tick and bounded-catch-up policy, frame-source interface, lifecycle state/rollback rules, error shape, and public export policy.
- Versioned protocol envelopes, server-owned identity/binding rules, command sequence and tick-window policy, numeric/message/queue bounds, and disconnect semantics.
- A checked-in acceptance-test description containing every measurement in A2 and a traceability table mapping each MVP requirement to one milestone.

**Explicit exclusions:** Product runtime implementation, speculative packages, generated scaffolding, alternate technology adapters, and roadmap Feature stubs.

**Objective exit criteria:**

- Every decision above exists in a version-controlled ADR with exactly one selected MVP choice and stated consequences.
- The package dependency graph is acyclic and shows no `shared` or `server` dependency on `client`, Three.js, DOM, WebXR, device input, camera, or audio.
- The protocol document contains concrete maximum message size, queued-command bound, accepted tick window, and sequence rules; no placeholder such as “reasonable” or “TBD” remains in an MVP criterion.
- The A2 acceptance scenario identifies setup, deterministic network parameters, observable measurements, tolerances, and teardown without manual visual judgment.
- Every item in the amended closed scope appears once in the traceability table, and every deferred item is explicitly marked unsupported for MVP.

**Dependencies:** None.

**Major risks:** Prematurely abstract choices may survive as ADRs. Keep adapters private unless two implementations are required by the MVP; prefer replaceable package boundaries over universal interfaces.

## Milestone 1 — Prove the headless kernel and lifecycle

**Outcome:** A headless World can be composed from public Core and Shared APIs, advanced by exact fixed ticks, observed, and shut down without browser dependencies or leaked Feature-owned resources.

**Included deliverables:**

- ECS World and shared-resource access, fixed-tick scheduler, documented phases and stable priority/declaration ordering.
- Minimal Feature descriptor and resolver from A5, configuration validation, setup, structured failures, rollback, and idempotent shutdown from A6.
- Shared semantic movement command/state and a headless command source; no physical input types in Shared.
- Server Runtime shell that owns one World, advances exact ticks on demand, and implements bounded wall-clock catch-up with observable backlog.
- Unit and headless integration tests for dependency ordering, duplicates, missing dependencies, cycles, conflicts, configuration failures, partial setup, exact stepping, catch-up bounds, and double shutdown.
- Boundary rules for Shared and Server source plus emitted declarations; initial Feature metadata and verification notes.

**Explicit exclusions:** Three.js, DOM, browser frame loops, real-time networking, physics-backed collision, client prediction, persistence, runtime Feature mutation, and cross-platform deterministic claims.

**Objective exit criteria:**

- A test advances a fresh World by exactly 60 ticks and observes tick index 60 and exactly 60 executions of each registered once-per-tick system.
- Given the same commands and runtime build, two fresh Worlds produce equal serialized test state after 600 exact ticks; documentation states that cross-engine or bit-identical determinism is not promised.
- Duplicate IDs, missing dependencies, cycles, conflicts, and invalid config all fail before the first Feature setup callback.
- A forced failure in the third Feature setup disposes only the first two in reverse setup order and leaves zero registered systems, subscriptions, timers, and owned test resources.
- Two shutdown calls produce the same final zero-resource state and no additional disposal side effects.
- Automated boundary checks fail representative forbidden imports from Shared and Server.

**Dependencies:** Milestone 0.

**Major risks:** ECS and scheduler APIs can become a generalized engine. Expose only operations used by the movement slice and external fixture; add no query DSL, job system, or dynamic graph mutation without an accepted requirement.

## Milestone 2 — Deliver the local browser slice

**Outcome:** One browser client runs the shared movement slice with independent simulation and presentation clocks, renders a controllable avatar and simple collision scene, and cleans up all client-owned resources.

**Included deliverables:**

- Client Runtime with injectable presentation-frame source and fixed simulation scheduler; `requestAnimationFrame` is one adapter, not a global assumption.
- Three.js renderer, semantic keyboard mapping, programmable test input, third-person camera, one capsule-like controller, and only static floor/obstacle collision.
- URL-based glTF loading with loading/success/failure state and ownership/disposal; at most one bundled avatar animation clip.
- Local sandbox scene using public exports and reporting required client telemetry and structured errors.
- Browser tests for movement, collision, render/presentation separation, asset failure, resize/frame-source cleanup, Feature rollback, and two shutdown calls.
- Public API and Feature documentation for each included client capability, including units, ownership, phases, limitations, and verification command.

**Explicit exclusions:** WebXR, audio, post-processing, rigid bodies, animation graphs, asset caching/CDN pipelines, networking, authoritative multiplayer, screenshot golden files, and support claims beyond the selected CI browser.

**Objective exit criteria:**

- Programmable semantic input moves the avatar over a level floor, and a head-on input against the test obstacle never places the avatar beyond the documented collision tolerance.
- A test drives 120 simulation ticks while independently driving 75 presentation frames; both counts and interpolated finite transforms are observed without assuming `requestAnimationFrame` ownership.
- Successful and failed glTF loads expose distinct documented states; shutdown disposes the scene's owned geometries, materials, textures, listeners, and frame callback exactly once.
- The sandbox imports only declared package exports, reports no uncaught runtime errors in the browser smoke test, and exposes frame duration, entity count, installed Feature IDs, and asset/runtime errors.
- Client source and emitted declarations pass boundary checks and do not leak selected physics-library types through public APIs except in a clearly named adapter-specific module.

**Dependencies:** Milestone 1.

**Major risks:** Camera polish, physics abstraction, and asset management can consume the schedule. Acceptance is intentionally functional and bounded to one scene, controller, asset, and clip.

## Milestone 3 — Prove authoritative two-client networking

**Outcome:** Two independent browser clients play the same movement slice through one authoritative headless server, with server-side trust enforcement, local prediction, remote interpolation, forced reconciliation, and deterministic disconnect cleanup.

**Included deliverables:**

- Real WebSocket transport, explicit connect/ready/join/disconnect/shutdown states, and the versioned runtime-validated JSON protocol from Milestone 0.
- Server-assigned connection/player/entity bindings, bounded ingress queue and message size, sequence/tick validation, ownership derivation, finite-value and movement-limit checks, and rejection telemetry.
- Authoritative server command pipeline in the frozen phase order and versioned replication snapshots.
- Owning-client movement prediction and correction; non-owning-client snapshot buffering and interpolation; presentation remains outside simulation ticks.
- Deterministic application-level delay/jitter/drop injector, with the zero-loss 100 ms RTT and 0–20 ms jitter profile used by the normative acceptance test.
- Automated malformed/unknown/stale/unauthorized/impossible command tests, forced-correction test, disconnect cleanup test, and structured connection/runtime error tests.
- Protocol, trust, authority, prediction, interpolation, lifecycle, and “How to verify” documentation updated with actual fields and tolerances.

**Explicit exclusions:** Production authentication, client-selected ownership, reconnect/resume, matchmaking, persistence, lag compensation, rollback netcode, nonzero-loss service guarantees, alternate transports, cryptographic anti-replay, anti-DDoS, and comprehensive anti-cheat.

**Objective exit criteria:**

- The complete six-part A2 acceptance scenario passes repeatedly in CI using one real server and two independent browser contexts.
- The server mutates gameplay state only from schema-valid commands bound to the sending connection; every required rejection case preserves authoritative state and increments exactly one documented reason counter.
- A local action is presented by the owner by its next presentation frame before the delayed server response; a peer never consumes that command directly.
- Forced displacement converges within A2's 0.05-unit and 500-ms limits; all presented transforms remain finite.
- Disconnect removes the binding and owned entity within two server ticks, rejects the queued stale command, and leaves no socket listeners, command queues, or session authority after shutdown.
- Server tick duration/backlog, entity count, installed Feature IDs, connection state, rejected-command reasons, and structured errors are inspectable through documented telemetry.

**Dependencies:** Milestones 1 and 2; all protocol choices from Milestone 0 remain frozen unless an ADR is superseded.

**Major risks:** Nondeterministic physics can tempt lockstep work. Prediction covers only the documented movement state, snapshots remain authoritative, and corrections are expected behavior rather than test failures.

## Milestone 4 — Validate public extensibility with one optional Feature

**Outcome:** An external consumer can install packed kit packages and compose one server-authoritative cross-runtime Interaction Feature entirely through documented public APIs.

**Included deliverables:**

- Interaction Feature with shared intent/state, server proximity/range validation and authoritative state change, client semantic action and presentation, configuration schema, metadata, setup, and disposal.
- One minimal external client-only Feature example and one complete external cross-runtime Interaction example.
- Packed-consumer fixture that installs package tarballs without workspace aliases and exercises Core, Shared, Client, Server, Protocol, and Interaction public exports.
- Export maps, emitted-declaration boundary checks, semantic-versioning policy, compatibility range, catalog entry, and concise per-Feature contract documents.
- Integration tests for missing dependencies, conflicts, invalid Interaction config, out-of-range/unauthorized interaction, replication to both clients, rollback, and shutdown cleanup.

**Explicit exclusions:** Health/Damage, Combat, Inventory, abilities, Projectiles, AI/navigation, dialogue, vehicles, optional dependency/provider solving, hot Feature enable/disable, replacement, a marketplace, and package-per-Feature mandates.

**Objective exit criteria:**

- From outside the monorepo workspace graph, the fixture installs only packed tarballs, builds without path aliases or deep imports, and runs both examples using documented exports.
- An in-range interact intent toggles the authoritative target once and both clients present the replicated state; out-of-range, wrong-owner, malformed, and duplicate-sequence attempts do not change it and emit documented rejection reasons.
- Removing the Interaction package from the consumer configuration leaves the base movement slice buildable and runnable; Core contains no Interaction-specific type or branch.
- A forced Interaction setup failure and two normal shutdown calls satisfy the same zero-resource lifecycle assertions as Milestone 1.
- The catalog lets a human or tool discover ID, purpose, runtimes, dependencies/conflicts, configuration, phases, authority, limitations, public imports, and verification command without reading package internals.

**Dependencies:** Milestone 3.

**Major risks:** The examples may drive new framework abstractions. Change public APIs only for demonstrated external-consumer friction; record other conveniences as post-MVP proposals.

## Milestone 5 — Ship a repeatable foundation release candidate

**Outcome:** A clean checkout produces packages, evidence, demos, and documentation for the bounded MVP through one documented CI-equivalent workflow.

**Included deliverables:**

- Clean-checkout install, build, typecheck, unit/integration/headless, browser acceptance, boundary, and packed-consumer commands wired into CI.
- Browser sandbox and headless server/simulation app using public APIs; no additional showcase demo is required because the two-client Interaction slice is the representative demo.
- Architecture and package-boundary overview; Feature/API/catalog documentation; client-only, server-only, and cross-runtime authoring guides; supported environments; known limitations; and narrow AI workflow guidance from A12.
- The complete cross-runtime narrative: input, intent, prediction, server binding/validation, authoritative tick, replication, reconciliation, remote presentation, cleanup, tests, and documented non-networked single-player option.
- Release checklist including packed artifacts, export inspection, version consistency, license/metadata checks, and archived CI evidence for all normative exit criteria.

**Explicit exclusions:** Any roadmap capability deferred by the review, cloud deployment, a hosted demo, publishing to a registry, production operations/SLOs, broad browser certification, performance targets beyond collecting the required telemetry, and visual-regression screenshot gates.

**Objective exit criteria:**

- On a clean checkout in the documented environment, the CI-equivalent workflow completes without manual steps and runs every command named above.
- All Milestones 1–4 exit tests pass in that workflow, including the real two-context WebSocket scenario and packed external consumer.
- Every publishable package can be packed; its archive contains intended runtime files, declarations, metadata, and documentation and excludes source-only test fixtures and internal workspace paths.
- Every public Feature has catalog metadata, a public-import example, ownership/disposal notes, authority/runtime boundaries, limitations, and a passing verification command; irrelevant template fields are explicitly marked not applicable.
- Documentation has no claim of XR, audio, reconnect, production authentication, deterministic lockstep, nonzero-loss tolerance, or other deferred support, and all known MVP limitations are listed in one discoverable page.
- The release checklist records zero uncaught browser/server errors, zero boundary violations, zero leaked test resources, and passing protocol rejection/disconnect counters for the archived run.

**Dependencies:** Milestone 4.

**Major risks:** A final documentation push can reveal unstable APIs late. Documentation and packed-consumer checks are milestone deliverables throughout; this gate consolidates evidence instead of adding architecture.

## Dependency chain

`M0 decisions → M1 headless kernel → M2 local browser slice → M3 networking → M4 external Interaction proof → M5 release evidence`

M3 legitimately depends on both M1 and M2. All other work should follow the single chain. Roadmap work must not be added to an open MVP milestone unless it replaces, rather than expands, an included deliverable and preserves that milestone's exit criteria.
