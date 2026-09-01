# `@three-game-kit/server`

Server provides the headless authoritative runtime, Rapier collision, authoritative simulation, connection bindings, WebSocket ingress, validation, replication, and cleanup.

## Public imports

- `@three-game-kit/server`
- `@three-game-kit/server/collision`
- `@three-game-kit/server/authoritative`
- `@three-game-kit/server/gameplay`
- `@three-game-kit/server/genre`
- `@three-game-kit/server/advanced`
- `@three-game-kit/server/networking`

```js
import { createServerRuntime } from "@three-game-kit/server";

const runtime = createServerRuntime({ features: [] });
await runtime.boot();
await runtime.shutdown();
```

## Ownership and disposal

The Server Runtime owns authoritative multiplayer state, fixed ticks, its Core World, installed server Features, and runtime-managed player/entity bindings. Server networking derives identity and ownership from live connections. Call `runtime.shutdown()` for terminal, idempotent runtime cleanup; independently created authoritative, collision, or networking adapters remain caller-owned until explicitly transferred and must be shut down or disposed through their public API.

## Bounded MVP

- Simulation uses fixed named phases, exact stepping or bounded wall-clock catch-up, and static-world capsule collision.
- One version 1 WebSocket transport accepts bounded validated commands and emits bounded snapshots or rejections.
- Authority covers server-owned identity, movement application, one optional interaction contract, replication, and disconnect cleanup.
- Common gameplay wrappers run authoritative Trigger and Health rules and own passive Prefab and Flow runtimes.
- Genre wrappers run authoritative optional physics, projectile, ability, and AI systems and own passive inventory and save state.
- Advanced wrappers own authoritative Dialogue, Vehicles, and structured headless Debug/DevTools state.
- Observability is bounded structured telemetry and resource accounting.

See the [Three Game Kit repository documentation](https://github.com/takahirox/three-game-kit#documentation) for server scheduling, lifecycle, and authority contracts.

## Environment and verification

- Node.js 24
- Native ESM
- License: UNLICENSED
- Repository verification: `pnpm verify:m5`
