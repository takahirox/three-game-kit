# Specification review

## Recommendation

Approve the foundation only after the P0 amendments below are adopted. The snapshot preserves the right long-lived boundaries—shared versus client versus server runtime, fixed ticks, explicit ownership, public entrypoints, and an untrusted network—but its current "MVP" combines a runtime kernel, a 3D starter stack, multiplayer netcode, an extension ecosystem, several authoring systems, and release-quality documentation. That is too much to sequence or accept as one unit.

The smallest executable MVP is one vertical slice: two browser clients control simple capsule-like avatars through one authoritative Node server over WebSocket; the client predicts only its own movement, the server validates commands and owns gameplay state, remote clients interpolate snapshots, and forced correction reconciles. One server-authoritative Interaction Feature proves optional cross-runtime extensibility. Everything else should either support that slice or be explicitly deferred.

Priority meanings:

- **P0 — blocker:** a team cannot make compatible implementations or objectively accept the result.
- **P1 — MVP risk:** the requirement is implementable, but invites hidden scope or a fragile sequence.
- **P2 — deferrable:** resolve in documentation before an MVP release; it need not block the first vertical slice.

## Prioritized findings and amendments

### P0. The MVP boundary contradicts the instruction to choose the smallest proof

The required list includes rendering, physics, assets, animation, telemetry, networking, prediction, XR-adjacent boundaries, an ecosystem contract, several apps, demos, guides, AI workflow documentation, and broad CI. Meanwhile, Standard Features also lists audio, XR, and post-processing, without saying whether "Standard" means present in the MVP. "Where practical" is not a scope boundary.

**Amendment A1 — replace the Foundation MVP list with a closed scope.** For MVP, require only:

- Core ECS access, resources, fixed-tick scheduling, Feature registration, validated configuration, startup rollback, and disposal.
- Shared, browser-client, and headless Node server runtimes.
- Three.js rendering; semantic keyboard input plus programmable test input; a third-person camera; one capsule-like movement controller; static floor/obstacle collision; one glTF avatar load; and at most one animation clip.
- WebSocket transport; one versioned JSON protocol with runtime validation; server-assigned connection, session, player, and entity bindings; local movement prediction; correction; remote interpolation; and disconnect cleanup.
- The browser sandbox, headless exact-tick tests, the two-client acceptance scenario, finite telemetry listed in A8, one external consumer fixture, and one optional Interaction Feature.
- Public export maps, package-boundary checks, a concise Feature catalog, the two authoring examples, supported-environment documentation, known limitations, and repeatable CI.

Explicitly exclude audio, WebXR, post-processing, navigation, dialogue, combat, projectiles, inventory, abilities, vehicles, reconnect/resume, replay persistence, matchmaking, production authentication, generalized asset pipelines, generalized animation graphs, multiple transports, runtime Feature replacement, and a scaffolding CLI. They may be roadmap items, not empty package stubs.

### P0. The defining multiplayer proof is not objectively measurable

"Responsive," "normal reconciliation," "modest simulated latency," and "showing" interpolation admit incompatible test results. WebSocket is only suggested, so protocol and test work cannot converge. Packet loss is mentioned although WebSocket provides an ordered reliable byte stream; dropping application messages is a separate fault model.

**Amendment A2 — make one automated acceptance scenario normative.** Use a real loopback WebSocket server and two independent browser contexts. Inject 100 ms round-trip application delay with deterministic jitter in the range 0–20 ms and no required loss. The test must prove:

1. A local semantic movement action affects the owning avatar no later than the next presentation frame, before an authoritative snapshot returns.
2. The server advances exactly 60 fixed ticks for one simulated second when stepped by the test harness; wall-clock catch-up is tested separately.
3. The non-owning client receives and presents the movement without directly applying the peer's commands.
4. A test-only authoritative displacement creates a measurable mismatch, after which the owner converges to within 0.05 world units of the latest authoritative position within 500 ms, with no non-finite transforms or uncaught errors.
5. A malformed message, an unknown message kind, an out-of-window sequence, an ownership violation, and a speed-limit violation are rejected and counted without mutating authoritative gameplay state.
6. Disconnecting one client removes its session binding and owned avatar within two server ticks; a queued command from that connection is then rejected.

Keep a deterministic delay/jitter/drop injector as test infrastructure, but make nonzero loss tolerance and reconnect semantics post-MVP decisions.

### P0. Trust and authority lack an implementable identity model

The snapshot says client IDs are untrusted but does not say who creates identity, how a connection is bound to an entity, what command freshness means, or which invariants validation protects. Production authentication being excluded does not remove these decisions.

**Amendment A3 — define the unauthenticated MVP trust model.** The server allocates opaque connection and player identifiers, creates the owned entity, and stores all bindings server-side. Client messages carry no accepted ownership field. Each command carries protocol version, client sequence, intended simulation tick, action kind, and bounded payload. The server validates envelope, schema, connection phase, monotonic sequence, a documented tick window, ownership derived from the connection, finite numeric values, and movement limits before scheduling the command. Unknown fields are either rejected consistently or stripped consistently; choose and document one policy. Rate limiting beyond fixed queue and message-size bounds is deferred. No identifier resumes authority after disconnect.

### P0. Foundational technology and package decisions are missing

No language level, package manager, package graph, ECS choice, physics choice, schema library, transport library, Node major, browser test target, module format, or public export shape is fixed. Starting multiple packages before these decisions creates expensive churn and makes "ordinary package consumption" unverifiable.

**Amendment A4 — add a decision gate before implementation.** Record short ADRs selecting those items and a package map. Prefer the fewest publishable units: `core`, `shared`, `client`, `server`, and `protocol`, with the optional Interaction proof either a sixth package or an external workspace fixture. Client capabilities remain public subpath exports until independent versioning is demonstrated to be necessary. Pin one Node LTS major and the package-manager version; use the browser bundled with the selected browser-test runner as the required CI browser. No package may be created solely to represent a future capability.

### P1. The Feature contract designs ecosystem machinery before proving composition

Capabilities, optional dependencies, conflicts, ambiguous providers, compatibility metadata, replacement, and removal together imply a solver and dynamic lifecycle. The MVP needs clear composition, not a marketplace-grade resolver.

**Amendment A5 — reduce the MVP Feature descriptor.** Require stable ID, description, runtime contributions, required Feature IDs, declared conflicts, configuration schema/defaults, setup, and dispose. Reject duplicate IDs, missing required IDs, cycles, declared conflicts, and invalid configuration before any setup runs. Do not support optional dependencies, capability-provider selection, hot enable/disable, replacement, or runtime version negotiation in MVP. Package peer dependencies and a documented kit-version range are sufficient compatibility signals. Absence of optional-dependency support must be explicit, not simulated by auto-enablement.

### P1. Lifecycle guarantees are strong but underspecified

"Deterministic," "normally reverses," "safe where practical," and "must not leak" do not define states, rollback behavior, or whether dynamic removal is required.

**Amendment A6 — define a static boot lifecycle.** Resolve and validate the full Feature graph first. Set up in topological dependency order, with declaration order as the documented tie-breaker. If setup fails, dispose only successfully created contributions in exact reverse setup order and return a structured error containing Feature, runtime, operation, and cause. Shutdown uses the same reverse order. A second shutdown is a no-op. Runtime Feature removal/replacement is excluded. Tests must observe zero registered systems, subscriptions, timers, and owned test resources after rollback and after two shutdown calls.

### P1. Correctness-sensitive scheduling has no shared vocabulary

The server pipeline is described in prose, but Features cannot safely target it without named phases and ordering rules. Unconstrained before/after graphs are a likely source of cycles and over-engineering.

**Amendment A7 — freeze a small phase model.** The authoritative tick order is: receive/decode; validate/bind; enqueue by tick and sequence; apply semantic commands; shared gameplay and movement; physics/collision; build replication snapshot; telemetry. Client simulation is: receive snapshots; reconcile owned state; sample semantic actions; create/send command; predict the owned entity; publish presentation state. Remote interpolation and rendering occur only in the presentation frame. Features select one documented phase and an integer priority; equal priorities use Feature declaration order. Cross-phase constraints and arbitrary before/after edges are excluded.

### P1. Several quality requirements are open-ended or unverifiable

"Practical physics," "basic assets/animation where practical," "structured telemetry" with a long wish list, screenshot capture "where practical," and documentation for every possible concern can each become a subsystem.

**Amendment A8 — bind each to the vertical slice.** Physics means only avatar-versus-static-world collision needed by the acceptance scene; no rigid-body networking or physics abstraction beyond the selected adapter. Assets mean URL-based glTF load with loading/success/failure state and disposal; animation means optional playback of one bundled clip. Required telemetry is limited to client frame duration, server tick duration and backlog, entity count, installed Feature IDs, connection state, rejected-command counts by reason, and structured runtime errors. Screenshot comparison is diagnostic and non-gating. A Feature document may mark irrelevant template sections "not applicable."

### P1. Public API and package consumption are asserted but not tested

A build can pass while examples use workspace aliases or deep imports unavailable to consumers. "Semantic versioning or equivalent" also leaves the compatibility promise undecided.

**Amendment A9 — make packaging an acceptance surface.** Use explicit export maps and mark all other paths internal. Pack the publishable workspaces, install the tarballs into a fixture with no workspace aliases, and build and run its minimal external Feature using only documented imports. Adopt semantic versioning for public package APIs; before 1.0, document that minor releases may break public APIs and patch releases may not. Boundary checks must cover source imports, emitted declarations, examples, and the packed-consumer fixture.

### P2. Multiplayer and single-player authority statements can be read differently

"Shared Simulation remains authoritative where practical" conflicts with the server owning authoritative multiplayer truth. The expected non-networked topology is also not selected.

**Amendment A10 — use precise authority language.** Shared Simulation is authority-neutral rule code. In multiplayer, only the Server Runtime owns authoritative state. In non-networked single-player, a local host may own the authoritative World and use the same rules, but a local-host adapter is documentation-only for MVP; it is not a second required runtime path.

### P2. The Optional Feature count and purpose are ambiguous

The text alternates among "one or two," "such as Health/Damage plus Combat or Interaction," and a broad catalog. Implementing two coupled gameplay systems would add scope without testing a new boundary.

**Amendment A11 — require exactly one optional proof.** Use a server-authoritative Interaction Feature: a semantic interact intent is accepted only when the owned avatar is within a configured finite range of a target; the server toggles a replicated target state; both clients present the result. Keep it replaceable and outside Core. Health, Damage, and Combat are deferred.

### P2. Environment, CI, and documentation completion are not closed

"Modern evergreen," "Node.js LTS or equivalent," "verified where practical," and "AI workflow docs" cannot be checked. Requiring full documentation only at the end also risks discovering unusable APIs after implementation.

**Amendment A12 — turn documentation and support into versioned artifacts.** The initial decision milestone records the exact Node major, TypeScript target, required CI browser, and platform assumptions. Every implementation milestone updates relevant Feature metadata, public API notes, limitations, and a short verification command. The final gate requires clean-checkout commands for install, build, typecheck, unit/integration/headless tests, browser acceptance, boundary checks, and packed-consumer verification. Define AI workflow documentation narrowly: discovery from the catalog, composition from public exports, telemetry inspection, test injection, and verification commands. Do not promise support for unspecified agents or IDEs.

## Sequencing risks

1. **Networking before a headless command-driven simulation** will duplicate gameplay logic in client and server. Establish exact-tick shared execution first.
2. **Presentation before frame-driver injection** will bake in `requestAnimationFrame` and make later XR integration expensive. The client runtime should accept a presentation-frame source even though XR itself is deferred.
3. **Publishing many Feature packages early** will freeze accidental APIs. Begin with five packages and public subpaths; split only with evidence.
4. **Physics-backed prediction before reconciliation tests** can turn nondeterminism into an architecture project. Predict the narrow movement state and correct from server snapshots; do not require bit-identical physics.
5. **Docs and external examples after implementation** will hide deep-import and ownership defects. Maintain one packed external fixture as soon as public exports exist.
6. **Fault simulation before protocol invariants** can produce flaky tests rather than evidence. First make exact-tick, validation, and disconnect tests deterministic; add the normative delayed two-client proof afterward.

## Decisions safely deferred

The following do not weaken the deliberate boundaries and should be recorded as unsupported, not implemented speculatively: XR devices and WebXR UI, audio, post-processing, dynamic Feature mutation, optional dependency/provider resolution, reconnect/resume, nonzero-loss guarantees, persistent replay storage, production authentication, comprehensive abuse prevention, additional transports, rigid-body replication, navigation, advanced animation, asset caching/CDN concerns, a CLI, a marketplace, and package-per-Feature publication.

## Review completion test

The amended specification is ready to implement when every P0 amendment has an owner and recorded decision, the A2 scenario can be translated into one automated test without subjective judgment, every Foundation MVP item maps to exactly one milestone below, and every excluded Standard or Optional Feature is named in either an exclusion or the deferred list.
