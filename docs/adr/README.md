# Architecture decision records

Architecture decision records capture choices that must remain stable across the Three Game Kit MVP.
An ADR describes one selected choice, its consequences, and the alternatives rejected at the time of the decision.

## Index

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](./0001-toolchain-and-supported-environments.md) | Accepted | Toolchain and supported environments |
| [0002](./0002-workspace-package-graph-and-public-exports.md) | Accepted | Workspace package graph and public exports |
| [0003](./0003-minimal-kit-owned-ecs.md) | Accepted | Minimal kit-owned ECS |
| [0004](./0004-rapier-static-world-collision.md) | Accepted | Rapier static-world collision |
| [0005](./0005-zod-json-protocol-boundary.md) | Accepted | Zod JSON protocol boundary |
| [0006](./0006-websocket-transport.md) | Accepted | WebSocket transport and connection lifecycle |
| [0007](./0007-playwright-browser-testing.md) | Accepted | Playwright browser testing |

## Conventions

- One ADR may cover tightly coupled choices that must be adopted together.
- Accepted ADRs are normative for the MVP until explicitly superseded.
- Consequences include compatibility limits and maintenance costs, not only benefits.
- A superseding ADR must link to the decision it replaces and preserve its historical text.

The [Milestone 0](../milestones.md#milestone-0--freeze-the-executable-contract) ADR set is complete, and later changes require an explicit superseding ADR.
Product implementation and evidence remain Milestones 1–5.
