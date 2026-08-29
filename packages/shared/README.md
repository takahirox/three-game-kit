# `@three-game-kit/shared`

Shared provides authority-neutral semantic movement rules and static-scene descriptors used consistently by client prediction and server simulation.

## Public imports

- `@three-game-kit/shared`
- `@three-game-kit/shared/movement`

```js
import { createMovementCommand } from "@three-game-kit/shared/movement";

const command = createMovementCommand(0, 1);
```

## Ownership and disposal

Shared movement values and rules own no runtime, transport, renderer, or authoritative state and require no disposal. Callers own the state they pass to these functions. Server validation and state application remain authoritative; using the same rules for client prediction does not transfer authority.

## Bounded MVP

- Movement is limited to normalized semantic X/Z commands and fixed-step translation helpers.
- Collision-facing data describes one capsule controller and static boxes.
- Shared code is independent of browser APIs, rendering, device input, and transport.
- Gameplay orchestration and resource lifecycles belong to the consuming runtime and Features.

See the [Three Game Kit repository documentation](https://github.com/takahirox/three-game-kit#documentation) for architecture and movement contracts.

## Environment and verification

- Node.js 24
- Native ESM
- License: UNLICENSED
- Repository verification: `pnpm verify:m5`
