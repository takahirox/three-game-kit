# Three Game Kit

`three-game-kit` is a reusable, modular foundation for bounded Three.js games whose Features can be composed through public JavaScript and TypeScript package APIs.
It is not a game, a general-purpose engine, or a framework that owns a consuming game's application structure.

## Repository status

Milestone 0 is complete: the executable product contract is frozen, including the supported environment,
five intended package and public boundaries, runtime ownership, ECS and collision choices, scheduling and lifecycle
semantics, protocol and trust rules, errors and telemetry, and the objective acceptance procedure.
Milestone 1 implementation is next: the headless kernel and lifecycle, Shared Simulation, exact fixed-tick scheduling,
Feature composition, rollback, and idempotent shutdown.

Milestone 0 completion is documentation evidence only. No implementation packages, runtimes, product tests,
CI workflow, or release artifacts exist yet.

## Bounded MVP

The MVP is one authoritative multiplayer vertical slice, not the full capability catalog described by the original proposal.

- Core ECS/resources, fixed ticks, Feature validation, setup rollback, and disposal.
- Shared Simulation plus browser Client and headless Node Server runtimes with enforced boundaries.
- Browser rendering, semantic keyboard and programmable input, a third-person camera, one capsule-like controller, static-world collision, and one glTF avatar with at most one clip.
- One WebSocket transport and one versioned, runtime-validated JSON protocol with server-owned identity, local prediction, authoritative correction, remote interpolation, and disconnect cleanup.
- A browser sandbox, exact-tick headless tests, the normative two-client test, required telemetry, and one packed external-consumer fixture.
- Explicit public exports, boundary checks, concise Feature documentation, supported environments, limitations, and repeatable CI.

Exactly one Optional Feature, server-authoritative Interaction, proves cross-runtime extensibility.
Audio, WebXR, post-processing, reconnect, production authentication, alternate transports, generalized asset or animation systems, and the other proposed gameplay Features are outside the MVP.

## Architectural boundaries

- Shared Simulation contains authority-neutral rules and cannot depend on Three.js, DOM, WebXR, cameras, audio, or device input.
- Client Runtime owns presentation, physical-to-semantic input mapping, prediction presentation, reconciliation, and remote interpolation.
- Server Runtime owns authoritative multiplayer state, connection/player/entity bindings, validation, fixed ticks, replication, and disconnect cleanup.
- Network input is untrusted; client-provided identity or ownership never grants authority.

## Documentation

- [Milestone 0 traceability](./docs/m0-traceability.md)
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
