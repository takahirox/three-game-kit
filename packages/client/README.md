# `@three-game-kit/client`

Client provides the browser runtime plus rendering, deterministic VFX, semantic input, third-person camera, local collision, assets, networking, prediction, reconciliation, and peer interpolation. Optional Standard Features cover Audio, Character Controller, Animation, and manifest-based Asset Manager use.

## Public imports

- `@three-game-kit/client`
- `@three-game-kit/client/rendering`
- `@three-game-kit/client/input`
- `@three-game-kit/client/camera`
- `@three-game-kit/client/vfx`
- `@three-game-kit/client/collision`
- `@three-game-kit/client/assets`
- `@three-game-kit/client/asset-manager`
- `@three-game-kit/client/audio`
- `@three-game-kit/client/animation`
- `@three-game-kit/client/character-controller`
- `@three-game-kit/client/networking`
- `@three-game-kit/client/replication`

The Standard Feature ownership, authority, configuration, limitations, examples,
and verification contract is documented in
[`docs/features/standard-features.md`](../../docs/features/standard-features.md).

```js
import {
  createMovementInput,
  createSemanticActionInput,
} from "@three-game-kit/client/input";

const input = createMovementInput();
const actions = createSemanticActionInput(["jump", "dash", "interact"]);
input.setMovement(0, 1);
actions.press("jump");
input.dispose();
actions.dispose();
```

Semantic action inputs are caller-owned bounded FIFO queues. `drain()` returns
each queued one-shot action once; `reset()` clears queued actions, and
`dispose()` is idempotent.

`@three-game-kit/client/vfx` provides fixed-capacity burst, trail, and floating
popup pools. Callers submit copied commands with explicit unsigned seeds; the
presentation scheduler supplies monotonic timestamps through `createVfxFeature`.
Inspection reports queue/effect overflow, active effects, and live resources.

## Ownership and disposal

The Client Runtime owns presentation scheduling, its Core World, installed client Features, and client-side prediction state. It presents predicted and replicated state but does not own multiplayer authority. Call `runtime.shutdown()` for runtime-owned cleanup; caller-created input, renderer, collision, asset, transport, and replication adapters must be disposed or closed according to their public API when not transferred to a Feature that owns them.

## Bounded MVP

- Presentation uses an injected frame source with independent simulation and presentation clocks.
- Rendering covers a Three.js scene, static obstacles, and one glTF avatar with at most one animation clip.
- Input covers semantic movement plus bounded caller-defined one-shot actions from programmable sources; collision covers a capsule against a static scene.
- Networking uses the version 1 WebSocket protocol with owner prediction/reconciliation and peer interpolation.

See the [Three Game Kit repository documentation](https://github.com/takahirox/three-game-kit#documentation) for client runtime, lifecycle, and environment contracts.

## Environment and verification

- Node.js 24
- Native ESM
- License: UNLICENSED
- Repository verification: `pnpm verify:m5`
