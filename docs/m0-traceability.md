# Milestone 0 traceability

- **Status:** Normative Milestone 0 audit
- **Scope:** Foundation MVP executable-contract freeze
- **Requirement inventory:** 31 uniquely owned closed-scope requirements

## Meaning of Milestone 0 completion

Milestone 0 completion means the executable contract is frozen: the supported environment,
package and public boundaries, runtime ownership, ECS and collision choices, lifecycle and
scheduling semantics, protocol and trust rules, observable errors and telemetry, and objective
acceptance procedure all have one adopted meaning.

Milestone 0 completion does **not** mean that packages, runtimes, tests, CI, or release artifacts
have been implemented or executed. Product implementation and test execution remain the work of
Milestones 1–5. Evidence marked complete below is document evidence only.

## Normative basis and precedence

The adopted P0 decisions in the [specification review](./specification-review.md) close and amend
the earlier specification scope. The [milestones](./milestones.md), accepted ADRs,
accepted architecture contracts, [MVP protocol](./protocol/mvp.md), and
[two-client acceptance contract](./testing/two-client-acceptance.md) are normative together. More
specific constants, schemas, phase names, state machines, cleanup orders, and evidence criteria in
those accepted documents control over a summary in this file.

The requirement table below is the sole ownership decomposition of the amended closed scope. Each
ID occurs once and has exactly one owner milestone. Links identify the frozen contract and the
future evidence gate; references in later sections do not create additional requirement ownership.

## Closed-scope requirement ownership

| ID | Amended Foundation MVP requirement | Owner | Contract and required evidence |
| --- | --- | --- | --- |
| F-01 | Minimal kit-owned ECS World, entity/component access, and World-scoped resources | M1 | [ADR 0003 decision](./adr/0003-minimal-kit-owned-ecs.md#decision); [M1 exit criteria](./milestones.md#milestone-1--prove-the-headless-kernel-and-lifecycle) |
| F-02 | Exact 60 Hz fixed-tick scheduling plus bounded wall-clock catch-up | M1 | [Scheduling contract](./architecture/runtime-scheduling.md#simulation-time); [M1 scheduler tests](./architecture/runtime-scheduling.md#milestone-1) |
| F-03 | Static Feature registration, dependency resolution, and validated configuration | M1 | [Feature preflight contract](./architecture/feature-lifecycle.md#resolution-and-preflight-validation); [M1 lifecycle tests](./architecture/feature-lifecycle.md#milestone-1) |
| F-04 | Startup rollback, owned-resource disposal, and idempotent shutdown | M1 | [Rollback and shutdown contract](./architecture/feature-lifecycle.md#rollback-shutdown-and-stopped-results); [M1 exit criteria](./milestones.md#milestone-1--prove-the-headless-kernel-and-lifecycle) |
| F-05 | Authority-neutral Shared Simulation and semantic movement state | M1 | [Package ownership map](./architecture/package-map.md#dependency-and-ownership-map); [M1 deliverables](./milestones.md#milestone-1--prove-the-headless-kernel-and-lifecycle) |
| F-06 | Headless Node Server Runtime shell owning its World and tick driver | M1 | [Runtime ownership](./adr/0002-workspace-package-graph-and-public-exports.md#runtime-ownership); [M1 deliverables](./milestones.md#milestone-1--prove-the-headless-kernel-and-lifecycle) |
| F-07 | Browser Client Runtime with independent simulation and injectable presentation-frame source | M2 | [Presentation-frame contract](./architecture/runtime-scheduling.md#presentation-frame-source); [M2 scheduler tests](./architecture/runtime-scheduling.md#milestone-2) |
| F-08 | Three.js rendering for the bounded browser slice | M2 | [M2 deliverables and evidence](./milestones.md#milestone-2--deliver-the-local-browser-slice) |
| F-09 | Physical keyboard-to-semantic mapping and programmable semantic test input | M2 | [M2 deliverables](./milestones.md#milestone-2--deliver-the-local-browser-slice); [browser control contract](./adr/0007-playwright-browser-testing.md#browser-topology-and-programmable-control) |
| F-10 | Third-person camera for the single local presentation slice | M2 | [M2 deliverables and evidence](./milestones.md#milestone-2--deliver-the-local-browser-slice) |
| F-11 | One capsule-like controller with avatar-versus-static-floor/obstacle collision | M2 | [ADR 0004 decision](./adr/0004-rapier-static-world-collision.md#decision); [M2 collision tests](./adr/0004-rapier-static-world-collision.md#objective-milestone-2-tests) |
| F-12 | URL-based glTF avatar loading with loading/success/failure states, disposal, and at most one clip | M2 | [M2 deliverables and evidence](./milestones.md#milestone-2--deliver-the-local-browser-slice) |
| F-13 | One WebSocket transport using the native browser client and `ws` 8 server | M3 | [ADR 0006 selected boundary](./adr/0006-websocket-transport.md#selected-client-server-and-wire-boundary); [M3 transport tests](./adr/0006-websocket-transport.md#objective-milestone-3-tests) |
| F-14 | One versioned, strict, runtime-validated UTF-8 JSON protocol | M3 | [ADR 0005 decision](./adr/0005-zod-json-protocol-boundary.md#decision); [protocol verification](./protocol/mvp.md#objective-milestone-3-verification) |
| F-15 | Server-issued connection/player/entity identity and connection-derived ownership bindings | M3 | [Server binding contract](./protocol/mvp.md#server-issued-identity-and-binding); [M3 evidence](./milestones.md#milestone-3--prove-authoritative-two-client-networking) |
| F-16 | Owner prediction, authoritative correction/reconciliation, and peer interpolation | M3 | [Client behavior contract](./protocol/mvp.md#client-prediction-reconciliation-and-presentation); [M3 evidence](./testing/two-client-acceptance.md#canonical-observations-and-commands) |
| F-17 | Disconnect fencing, binding/avatar removal, stale-command rejection, and cleanup | M3 | [Disconnect contract](./protocol/mvp.md#disconnect-and-shutdown); [OP-07 evidence](./testing/two-client-acceptance.md#op-07-disconnect-fence-and-peer-survival) |
| F-18 | Browser sandbox using documented public controls and exports | M2 | [M2 deliverables and exit criteria](./milestones.md#milestone-2--deliver-the-local-browser-slice) |
| F-19 | Headless exact-tick tests with objective state and lifecycle assertions | M1 | [M1 exit criteria](./milestones.md#milestone-1--prove-the-headless-kernel-and-lifecycle) |
| F-20 | Normative real-server, two-independent-context multiplayer acceptance scenario | M3 | [Acceptance contract](./testing/two-client-acceptance.md); [M3 exit criteria](./milestones.md#milestone-3--prove-authoritative-two-client-networking) |
| F-21 | Required finite telemetry: Client frame duration; Server tick duration/backlog; entity count; installed Feature IDs; connection state; rejected-command counts by reason; structured runtime errors | M3 | [Telemetry snapshots](./architecture/errors-and-telemetry.md#telemetry-snapshots); [M3 telemetry tests](./architecture/errors-and-telemetry.md#milestone-3) |
| F-22 | External consumer fixture installing packed artifacts without workspace aliases or deep imports | M4 | [Packed-consumer boundary](./adr/0002-workspace-package-graph-and-public-exports.md#internal-paths-and-package-consumption); [M4 exit criteria](./milestones.md#milestone-4--validate-public-extensibility-with-one-optional-feature) |
| F-23 | Exactly one Optional proof: external, server-authoritative Interaction | M4 | [Interaction protocol contract](./protocol/mvp.md#fixed-version-1-boundary); [M4 deliverables and evidence](./milestones.md#milestone-4--validate-public-extensibility-with-one-optional-feature) |
| F-24 | Explicit public export maps and pre-1.0 SemVer policy | M4 | [Public entrypoints](./adr/0002-workspace-package-graph-and-public-exports.md#public-entrypoints); [M4 packaging evidence](./milestones.md#milestone-4--validate-public-extensibility-with-one-optional-feature) |
| F-25 | Automated source, declaration, export-map, runtime-boundary, and packed-consumer checks | M5 | [Required boundary evidence](./architecture/package-map.md#required-boundary-evidence); [M5 workflow evidence](./milestones.md#milestone-5--ship-a-repeatable-foundation-release-candidate) |
| F-26 | Concise, discoverable Feature catalog and per-Feature contract metadata | M4 | [M4 catalog criterion](./milestones.md#milestone-4--validate-public-extensibility-with-one-optional-feature) |
| F-27 | One minimal external client-only example and one complete external cross-runtime example | M4 | [M4 examples](./milestones.md#milestone-4--validate-public-extensibility-with-one-optional-feature) |
| F-28 | Exact supported-environment documentation | M0 | [Supported environments](./supported-environments.md#required-baseline); [ADR 0001 decision](./adr/0001-toolchain-and-supported-environments.md#decision) |
| F-29 | Discoverable known-limitations documentation covering the bounded MVP | M5 | [M5 documentation criterion](./milestones.md#milestone-5--ship-a-repeatable-foundation-release-candidate) |
| F-30 | Repeatable clean-checkout CI-equivalent install, build, typecheck, test, boundary, and packed-consumer workflow | M5 | [M5 deliverables and exit criteria](./milestones.md#milestone-5--ship-a-repeatable-foundation-release-candidate) |
| F-31 | Frame-source flexibility and XR-safe runtime boundaries without WebXR implementation | M2 | [Frame-source contract](./architecture/runtime-scheduling.md#presentation-frame-source); [M2 frame-source evidence](./architecture/runtime-scheduling.md#milestone-2) |

## Amendment adoption and execution map

This table records amendment adoption separately from requirement ownership. It does not duplicate
or subdivide F-01–F-31.

| Amendment | Adopted contract | Future execution gate |
| --- | --- | --- |
| A1 — closed scope | [Closed Foundation MVP amendment](./specification-review.md#p0-the-mvp-boundary-contradicts-the-instruction-to-choose-the-smallest-proof) and F-01–F-31 above | M1–M5, with complete-scope closure at M5 |
| A2 — measurable multiplayer acceptance | [Measurable multiplayer amendment](./specification-review.md#p0-the-defining-multiplayer-proof-is-not-objectively-measurable) and [executable acceptance contract](./testing/two-client-acceptance.md) | M3 |
| A3 — unauthenticated trust model | [Trust and identity amendment](./specification-review.md#p0-trust-and-authority-lack-an-implementable-identity-model) and [server binding contract](./protocol/mvp.md#server-issued-identity-and-binding) | M3 |
| A4 — decision gate and package shape | [ADRs 0001–0007](./adr/README.md), [package map](./architecture/package-map.md), and the accepted contracts linked by this audit | M1 for first toolchain use; M4 for packed-package evidence |
| A5 — minimal Feature descriptor | [Feature descriptor contract](./architecture/feature-lifecycle.md#feature-descriptor) | M1 |
| A6 — static boot lifecycle | [Lifecycle states](./architecture/feature-lifecycle.md#lifecycle-states) and [rollback contract](./architecture/feature-lifecycle.md#rollback-shutdown-and-stopped-results) | M1 |
| A7 — small phase model | [Schedule domains and phases](./architecture/runtime-scheduling.md#schedule-domains-and-phases) | M1, integrated end to end at M3 |
| A8 — bounded physics, assets, animation, telemetry, and visual evidence | [ADR 0004 bounded collision](./adr/0004-rapier-static-world-collision.md#selected-implementation-and-bounded-scope) and [telemetry contract](./architecture/errors-and-telemetry.md#telemetry-snapshots) | M2–M3 |
| A9 — packaging acceptance surface | [ADR 0002 boundary verification](./adr/0002-workspace-package-graph-and-public-exports.md#boundary-verification) | M4, consolidated at M5 |
| A10 — precise authority language | [Protocol purpose and precedence](./protocol/mvp.md#purpose-and-precedence) | M3 |
| A11 — exactly one Optional Interaction proof | [Interaction reservation](./protocol/mvp.md#fixed-version-1-boundary) | M4 |
| A12 — versioned support, documentation, verification, and narrow automation guidance | [Supported environments](./supported-environments.md), [implementation milestone obligations](./milestones.md), and [M5 release gate](./milestones.md#milestone-5--ship-a-repeatable-foundation-release-candidate) | M1–M5, with final closure at M5 |

## Deferred, sequenced, and unsupported capabilities

The entries below are scope statements only. They do not assert that code, packages, adapters,
tests, services, or operational support for these capabilities exist.

### Sequenced to a later MVP milestone

- M0 excludes all product runtime implementation; the owned implementation and test work is
  assigned by F-01–F-31 to M1–M5.
- Three.js, DOM integration, browser frame loops, and Client collision are excluded from M1 and
  first execute in M2.
- Real-time networking, authoritative multiplayer, and Client prediction are excluded from M1–M2
  and first execute end to end in M3.
- The external Interaction proof and packed-consumer execution are held until M4; release-wide
  workflow consolidation is held until M5.

### Unsupported throughout the Foundation MVP

- **Presentation and devices:** WebXR devices, WebXR UI or implementation, audio, post-processing,
  and support claims for browsers, operating systems, or architectures outside the selected gate.
- **Gameplay catalog:** Health, Damage, Combat, Projectiles, Inventory, abilities, vehicles,
  AI/navigation, dialogue, and every Optional Feature other than Interaction.
- **Physics and content systems:** dynamic or general rigid bodies, rigid-body replication, a
  generalized physics abstraction, generalized asset pipelines, asset caching/CDN pipelines,
  generalized or advanced animation graphs, and multiple-clip animation systems.
- **Networking, identity, and persistence:** reconnect/resume, session migration, replay or other
  persistence, matchmaking, production authentication, Client-selected ownership, alternate or
  multiple transports, nonzero-loss guarantees, lag compensation, rollback netcode,
  cryptographic anti-replay, rate limiting beyond fixed message/queue bounds, anti-DDoS, and
  comprehensive anti-cheat or abuse prevention.
- **Feature ecosystem expansion:** runtime Feature add/remove/enable/disable/replacement, runtime
  schedule mutation, optional-dependency or capability-provider solving, automatic enablement,
  runtime version negotiation, marketplace support, package-per-Feature publication mandates,
  generated scaffolding or a scaffolding CLI, speculative packages, alternate technology
  adapters, and roadmap placeholder packages or Feature stubs.
- **Additional runtime topology:** a second required local-host single-player adapter; the
  non-networked local-host option is documentation-only for this MVP.
- **Release and operations:** cloud deployment, a hosted demo, registry publication, production
  operations or SLOs, and production security claims.
- **Quality claims and gates:** deterministic lockstep or cross-platform bit-identical claims,
  mandatory screenshot goldens or visual-regression gates, performance targets beyond collecting
  the required telemetry, and broad browser certification. Screenshots and traces remain
  diagnostic only.

## M0 exit-criteria checklist

- [x] **Every selected technology decision has one accepted choice and consequences.** Evidence:
  [ADR 0001](./adr/0001-toolchain-and-supported-environments.md),
  [ADR 0002](./adr/0002-workspace-package-graph-and-public-exports.md),
  [ADR 0003](./adr/0003-minimal-kit-owned-ecs.md),
  [ADR 0004](./adr/0004-rapier-static-world-collision.md),
  [ADR 0005](./adr/0005-zod-json-protocol-boundary.md),
  [ADR 0006](./adr/0006-websocket-transport.md), and
  [ADR 0007](./adr/0007-playwright-browser-testing.md).
- [x] **The supported environment and platform assumptions are exact.** Evidence:
  [required baseline](./supported-environments.md#required-baseline) fixes Node 24.x, TypeScript 6.0
  strict/ES2023/NodeNext ESM, pnpm 11.24.0, Ubuntu 24.04 x64, and bundled Chromium.
- [x] **The package graph is acyclic and preserves headless and authority-neutral boundaries.**
  Evidence: [dependency and ownership map](./architecture/package-map.md#dependency-and-ownership-map)
  and [required boundary evidence](./architecture/package-map.md#required-boundary-evidence).
- [x] **Schedule, lifecycle, rollback, errors, telemetry, frame-source, and public-boundary behavior
  are concrete.** Evidence: [runtime scheduling](./architecture/runtime-scheduling.md),
  [Feature lifecycle](./architecture/feature-lifecycle.md), and
  [errors and telemetry](./architecture/errors-and-telemetry.md).
- [x] **The protocol has exact envelopes, unknown-field policy, message and queue limits, tick
  window, sequence policy, identity binding, rejection vocabulary, snapshot cadence, and disconnect
  semantics.** Evidence: [ADR 0005 exact bounds](./adr/0005-zod-json-protocol-boundary.md#exact-shared-bounds)
  and the [operational protocol](./protocol/mvp.md).
- [x] **The A2 scenario has objective setup, deterministic network parameters, measurements,
  tolerances, error capture, teardown, and one machine-readable evidence definition without manual
  judgment.** Evidence: [deterministic two-client acceptance](./testing/two-client-acceptance.md).
- [x] **Every amended closed-scope requirement has exactly one owner milestone.** Evidence:
  F-01–F-31 in [Closed-scope requirement ownership](#closed-scope-requirement-ownership).
- [x] **Every review or milestone exclusion is classified without implying support.** Evidence:
  [Deferred, sequenced, and unsupported capabilities](#deferred-sequenced-and-unsupported-capabilities).

With this checklist satisfied, M0 freezes the executable contract only. Implementation artifacts
and executed acceptance evidence are still required from M1 through M5 before an MVP release
candidate can be claimed.
