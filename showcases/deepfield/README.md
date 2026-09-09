# Deepfield

Deepfield is a single-player voxel sandbox built on documented public `three-game-kit` Features: a seeded 96 × 64 × 96 block world with grass, dirt, stone, sand, water, caves, oak trees, and coal / iron / gold / diamond ore. Walk, jump, and swim in first person; hold the left mouse button to mine, press the right button to place; collect blocks into a hotbar; work through a five-step expedition log (punch a tree, dig for stone, strike iron, find a diamond, build something); survive falls; and let the world save itself while you play.

Every block face is drawn from a 64 × 64 texture atlas painted at runtime, and the terrain is meshed per chunk with per-vertex ambient occlusion, so nothing is downloaded (see [ASSETS.md](./ASSETS.md)).

## Run

From the repository root:

```sh
pnpm install
pnpm run build
pnpm exec vite --host 127.0.0.1 --port 4174
```

Open <http://127.0.0.1:4174/showcases/deepfield/index.html>. Click **NEW WORLD**, then click the world to capture the mouse (pointer lock). `Esc` releases it. Append `?seed=42` to generate a different world.

Controls: `W A S D` move, mouse look, left button mine (hold), right button place, `Space` jump / swim up, `Shift` sprint, `1`–`9` or mouse wheel select a hotbar slot, `F` save now, `R` respawn while fallen, `Enter` start or continue.

## Game structure

- **World.** `src/world.ts` generates terrain from fractal value noise (`src/noise.ts`) with a bedrock floor, stone body, dirt / sand cover, water up to sea level, cave carving, ore veins by depth, and oak trees. Edits are journaled against the generated base so a save is only the seed plus the changed blocks.
- **Rendering.** `src/mesher.ts` turns each 16 × 16 × 64 chunk into an opaque and a water geometry with face culling, per-face shading, and four-level vertex ambient occlusion. `src/renderer.ts` owns the atlas, chunk meshes (rebuilt when a block changes), a day / night sky with sun, moon, stars, and drifting clouds, the target outline and crack overlay, the held block, and a block-debris emitter from the public particle module.
- **Player.** An axis-aligned 0.6 × 1.8 body moves with per-axis voxel collision, gravity, jumping, and swimming. Falls faster than 15 m/s cost health through the Health Feature; health regenerates after five seconds without damage. Dying returns you to camp with your inventory intact.
- **Mining and placing.** A grid ray walk finds the targeted block within six metres. Each block has a hardness in seconds; mining fills a crack overlay and drops the block into the inventory. Placing puts the selected hotbar block on the targeted face unless it would overlap the player.
- **Expedition log.** Five objectives are tracked from mined and placed counts. Completing all of them shows a results screen and the world stays open for building.
- **Saving.** The Save/Load Feature persists the seed, block edits, player transform, inventory, statistics, and time of day to browser storage (an in-memory adapter in test mode). Autosave runs every ten seconds of play when something changed; `F` saves immediately; the title screen offers **CONTINUE** when a save exists.

## Public Feature composition

The showcase imports no framework internals. One public Client Runtime installs eleven Features:

| Feature id | Public entrypoint | Role in Deepfield |
| --- | --- | --- |
| `movement-input` | `@three-game-kit/client/input` | Movement command plus the bounded semantic action queue (jump, mine, place, sprint, hotbar, start, continue, respawn, save) |
| `deepfield.rules` | game-specific | Player physics, targeting, mining, placing, objectives, day / night, autosave |
| `inventory.client` | `@three-game-kit/client/genre` + `@three-game-kit/shared/genre` | Sixteen-slot container with 64-stack items for every droppable block |
| `health-damage.client` | `@three-game-kit/client/gameplay` + `@three-game-kit/shared/gameplay` | Fall damage, regeneration, death events |
| `game-flow.client` | `@three-game-kit/client/gameplay` | `title → playing ⇄ dead / complete` state machine |
| `save-load.client` | `@three-game-kit/client/genre` | Versioned world document with validation and restore |
| `ui-hud` | `@three-game-kit/client/gameplay` | Framework-neutral HUD state rendered through a DOM adapter (hearts, hotbar, objectives, clock) |
| `debug-devtools.client` | `@three-game-kit/client/advanced` | Player and world diagnostic providers |
| `deepfield.camera` | game-specific | Publishes the first-person eye transform in the camera-view phase |
| `particles` | `@three-game-kit/client/particles` | Instanced block-debris emitter presented by the Runtime |
| `three-rendering` | `@three-game-kit/client/rendering` | Scene, chunk meshes, sky, and held block |

The kit's static-world Collision Feature is not used: a voxel world changes every time a block is mined or placed, so the rules run their own axis-aligned voxel collision instead of registering thousands of static boxes.

## Deterministic test mode

Append `?test=1` to disable the animation-frame loop and use an in-memory save adapter. `window.__DEEPFIELD__` exposes `start`, `continueWorld`, `setMove`, `setLook`, `look`, `setHeld`, `press`, `advance(seconds)`, `loadScenario("spawn" | "tree" | "stone" | "iron" | "diamond" | "cliff" | "water")`, frozen `snapshot()`, `events()`, `errors()`, `inspectRuntime()`, `inspectRenderer()`, `inspectWorld()`, `inspectSave()`, `inspectInventory()`, `inspectLeaks()`, and `dispose()`. `pnpm run verify:deepfield` runs the public-import boundary check, the asset intake gate, the showcase typecheck, and the Playwright acceptance test.
