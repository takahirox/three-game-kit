# `@three-game-kit/core`

Core provides the ECS World, runtime scheduling, Feature lifecycle, mailbox, and telemetry primitives used by the kit's client and server runtimes.

## Public imports

- `@three-game-kit/core`

```js
import { createWorld } from "@three-game-kit/core";

const world = createWorld();
world.dispose();
```

## Ownership and disposal

A runtime owns its Core World and installed Feature lifecycle. Runtime shutdown disposes successfully installed Features and then the World. A directly created World is caller-owned and must be released with `world.dispose()`; disposal is terminal and idempotent.

## Bounded MVP

- The ECS supports entities, components, resources, queries, and explicit disposal.
- Scheduling uses fixed named phases and bounded catch-up rather than an arbitrary dependency graph.
- Feature composition is immutable for a runtime boot and follows validated setup, rollback, and reverse-order disposal.
- Telemetry is bounded in-memory runtime evidence, not a general event or persistence system.

See the [Three Game Kit repository documentation](https://github.com/takahirox/three-game-kit#documentation) for architecture and lifecycle contracts.

## Environment and verification

- Node.js 24
- Native ESM
- License: UNLICENSED
- Repository verification: `pnpm verify:m5`
