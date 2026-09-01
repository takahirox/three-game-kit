# Relic Frontier

Relic Frontier is the official integrated `three-game-kit` showcase: a compact, stylized single-player Three.js action adventure assembled from documented public Features. Recover three Energy Cells across the ruins, choose one field upgrade, power the chamber mechanism, defeat the Relic Guardian, claim the Relic, and escape to Base Camp.

## Run

From the repository root:

```sh
pnpm install
pnpm run build
pnpm exec vite --host 127.0.0.1 --port 4174
```

Open <http://127.0.0.1:4174/showcases/relic-frontier/index.html>.

Controls: WASD moves, mouse drag turns the camera, Space jumps, Shift dashes, left mouse attacks, right mouse or F casts Relic Pulse, E interacts, and Q uses a Health Pack. The intended first-run route—including exploration and reading the environment—takes approximately 10–15 minutes.

## Game structure

The compact level contains Base Camp, a central ruin path, garden, power-room and tower branches, a chamber gate, and the Relic chamber. Three enemy archetypes demonstrate different readable threats: a hovering Drone, ranged Shooter, and heavy Sentinel. The Relic Guardian reuses the same Health, AI, Ability/Projectile, VFX, and flow boundaries at boss scale.

The mechanism cannot be powered until all three Energy Cells have been recovered. Three camp upgrade pads offer dash cooldown, multi-projectile, or health recovery; choosing one de-emphasizes the others for the current run. Defeating the Guardian reveals the Relic, and only a Relic owner can complete the Base Camp escape trigger.

## Public Feature composition

The showcase imports no framework internals. One public Client Runtime installs 17 Features:

- semantic `movement-input` and device-neutral one-shot actions;
- `asset-manager` with deterministic success/failure evidence and capability-safe `audio` lifecycle;
- `character-controller` over the public Rapier collision adapter;
- `trigger-area.client`, `health-damage.client`, `game-flow.client`, and `ui-hud`;
- `projectile.client`, `ability-skill.client`, `simple-ai-navigation.client`, and `inventory.client`;
- `debug-devtools.client`, `third-person-camera`, deterministic `vfx`, and `three-rendering`;
- `relic-frontier.rules`, the sole game-specific scheduled Feature.

Framework runtimes own validation, scheduling, cooldowns, health, inventory, triggers, navigation state, lifecycle, and cleanup. Showcase code owns only level layout, encounter tuning, objective rules, art mapping, and the Relic/escape win condition.

## AI/QA mode

Open `?test=1` to disable the wall-clock loop and expose `window.__RELIC_FRONTIER__`. The frozen handle supports:

- exact `advance(seconds)` and semantic `setInput` / `press` operations;
- `loadScenario("fresh" | "guardian" | "escape")` for known states and selected encounter spawning/reset;
- immutable gameplay `snapshot`, bounded events, runtime errors, installed Feature/schedule inspection, Debug/DevTools captures, and WebGL/performance telemetry;
- a stable top-down debug camera, screenshot readiness, restart, disposal, and leak inspection.

The Playwright acceptance performs traversal and dash, ability activation/cooldown rejection, inventory/mechanism setup, boss combat, Relic acquisition, escape/results, screenshots, restart, and full cleanup. It also rejects page/console/runtime errors and proves real Three.js WebGL output.

```sh
pnpm typecheck:relic-frontier
pnpm test:relic-frontier-boundaries
pnpm test:relic-frontier
pnpm verify:relic-frontier
```

See [asset provenance](./ASSETS.md), [performance budgets](./PERFORMANCE.md), and [authoritative co-op evolution](./ARCHITECTURE.md).

## First-version non-goals

Networking, accounts, matchmaking, cloud saves, procedural worlds, deep crafting, large inventories, extensive dialogue, and bespoke external art are intentionally excluded. The current goal is one dense, inspectable, finished vertical slice.
