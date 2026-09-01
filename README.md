# Three Game Kit

`three-game-kit` is a reusable, modular foundation for bounded Three.js games whose Features can be composed through public JavaScript and TypeScript package APIs.
It is not a game, a general-purpose engine, or a framework that owns a consuming game's application structure.

## Repository status

Milestones 0 through 4 are complete. Milestone 0 froze the executable product contract, including the
supported environment, package and public boundaries, runtime ownership, scheduling and lifecycle semantics,
protocol and trust rules, errors and telemetry, and the objective acceptance procedure. Milestone 1 implements
the Core ECS, Shared semantic movement, and the headless Server Runtime with exact stepping, bounded catch-up,
rollback, telemetry, and idempotent shutdown.

Milestone 2 implements the local browser Client slice: an injectable presentation-frame source,
independent simulation and presentation clocks, semantic keyboard and programmable input, third-person camera,
static Rapier collision, Three.js rendering, one local glTF avatar, browser telemetry, rollback, and cleanup.

Milestone 3 implements strict Protocol v1 runtime validation, a real WebSocket server with server-owned bindings
and bounded rejection observability, owner prediction and reconciliation, peer interpolation, deterministic
injection, disconnect fencing, exact cleanup, and canonical two-context browser evidence. Milestone 4 adds the
consumer-owned external server-authoritative Interaction proof, range validation and toggle, semantic client
queue/latest snapshot presentation, five packed kit tarballs installed outside the workspace, catalog/authoring
docs, and rollback/idempotent cleanup evidence. Milestone 5 produces a release candidate backed by a clean
`pnpm verify:m5`, audits of all five package archives and all fifteen catalog entries, and complete documentation
and evidence. It does not include registry publication or hosted deployment.

## Bounded MVP

The MVP is one authoritative multiplayer vertical slice, not the full capability catalog described by the original proposal.

- Core ECS/resources, fixed ticks, Feature validation, setup rollback, and disposal.
- Shared Simulation plus browser Client and headless Node Server runtimes with enforced boundaries.
- Browser rendering, semantic keyboard and programmable input, a third-person camera, one capsule-like controller, static-world collision, and one glTF avatar with at most one clip.
- One WebSocket transport and one versioned, runtime-validated JSON protocol with server-owned identity, local prediction, authoritative correction, remote interpolation, and disconnect cleanup.
- A browser sandbox, exact-tick headless tests, the normative two-client test, required telemetry, and one packed external-consumer fixture.
- Explicit public exports, boundary checks, concise Feature documentation, supported environments, limitations, and repeatable CI.

The consumer-owned server-authoritative Interaction example proves cross-runtime extensibility.
WebXR, post-processing, reconnect, production authentication, and alternate transports remain
outside the MVP. The post-MVP Priority S layer adds optional
Audio, Character Controller, Animation, and manifest-based Asset Manager Standard Features without
making them Core dependencies. The Priority A layer adds optional UI/HUD, Trigger/Area,
Health/Damage, Spawn/Prefab, and Game State/Flow Features with Shared rules and explicit
Client/Server authority wrappers.

## Architectural boundaries

- Shared Simulation contains authority-neutral rules and cannot depend on Three.js, DOM, WebXR, cameras, audio, or device input.
- Client Runtime owns presentation, physical-to-semantic input mapping, prediction presentation, reconciliation, and remote interpolation.
- Server Runtime owns authoritative multiplayer state, connection/player/entity bindings, validation, fixed ticks, replication, and disconnect cleanup.
- Network input is untrusted; client-provided identity or ownership never grants authority.

## Documentation

- [Milestone 0 traceability](./docs/m0-traceability.md)
- [Milestone 1 verification](./docs/m1-verification.md)
- [Milestone 2 verification](./docs/m2-verification.md)
- [Milestone 3 verification](./docs/m3-verification.md)
- [Milestone 4 verification](./docs/m4-verification.md)
- [Milestone 5 verification](./docs/m5-verification.md)
- [Release checklist](./docs/release-checklist.md)
- [Canonical foundation Feature catalog](./docs/features/foundation-catalog.json)
- [Milestone 4 catalog evidence](./docs/features/catalog.json)
- [Client Feature contracts](./docs/features/client-features.md)
- [Priority S standard Features](./docs/features/standard-features.md)
- [Priority A common gameplay Features](./docs/features/common-gameplay.md)
- [Priority B genre-expansion Features](./docs/features/genre-expansion.md)
- [Priority C advanced Features](./docs/features/advanced-features.md)
- [Interaction contract](./docs/features/interaction.md)
- [Client-only Feature authoring](./docs/authoring/client-only-feature.md)
- [Server-only Feature authoring](./docs/authoring/server-only-feature.md)
- [Cross-runtime Interaction authoring](./docs/authoring/cross-runtime-interaction.md)
- [Complete cross-runtime narrative](./docs/architecture/cross-runtime-narrative.md)
- [Known limitations](./docs/known-limitations.md)
- [Tool-agnostic AI workflow](./docs/ai-workflow.md)
- [Foundation MVP milestones](./docs/milestones.md)
- [Specification review](./docs/specification-review.md)
- [Supported environments](./docs/supported-environments.md)
- [Package map](./docs/architecture/package-map.md)
- [Runtime scheduling](./docs/architecture/runtime-scheduling.md)
- [Feature lifecycle](./docs/architecture/feature-lifecycle.md)
- [Errors and telemetry](./docs/architecture/errors-and-telemetry.md)
- [MVP protocol](./docs/protocol/mvp.md)
- [Two-client acceptance](./docs/testing/two-client-acceptance.md)
- [Architecture decision record index](./docs/adr/README.md)
