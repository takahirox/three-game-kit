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

Controls: WASD moves (two held keys are normalized into a diagonal), mouse drag turns the camera, Space jumps, Shift dashes, left mouse attacks, right mouse or F casts Relic Pulse, E interacts, Q uses a Health Pack, and Esc closes the field briefing. The intended first-run route—including exploration and reading the environment—takes approximately 10–15 minutes.

## Game structure

The compact level contains Base Camp, a central ruin path, garden, power-room and tower branches, a chamber gate, and the Relic chamber. Three enemy archetypes demonstrate different readable threats: a hovering Drone, ranged Shooter, and heavy Sentinel. The Relic Guardian reuses the same Health, AI, Ability/Projectile, VFX, and flow boundaries at boss scale.

The mechanism cannot be powered until all three Energy Cells have been recovered. Three camp upgrade pads offer dash cooldown, multi-projectile, or health recovery; choosing one de-emphasizes the others for the current run. Defeating the Guardian reveals the Relic, and only a Relic owner can complete the Base Camp escape trigger.

## Guidance and HUD

First-time players are guided by deterministic game state rather than scripted timers:

- **Field briefing.** Starting the expedition opens a dismissible briefing (controls plus the five-step goal). "Got it", Esc, or any movement/action input closes it, so it never blocks the AI/QA handle.
- **Objective tracker.** The top-centre HUD shows the current step (`STEP 1/5 · ENERGY CELLS` → chamber mechanism → Relic Guardian → claim the Relic → escape to Base Camp), the objective sentence, and a compass cue such as `↖ 17 m` to the current target relative to the camera. A stage-coloured in-world beam and floor ring mark the same target, and the objective light follows it.
- **Interaction prompts.** A prompt appears near pickups, upgrade pads, the power console, the Relic, and the Base Camp exit (for example `E · TAKE ENERGY CELL`, `MECHANISM NEEDS 3 ENERGY CELLS`, `SPACE · JUMP TO REACH THE CELL`, `E · ESCAPE TO BASE CAMP`).
- **Readable landmarks.** Energy Cells are elongated yellow crystals on yellow rings, Health Packs are green crates with a white cross, upgrade pads are flat discs, the power console is a pedestal whose top turns from coral to cyan once powered, and Base Camp is marked by an amber ring and flag.
- **Combat feedback.** The Relic Guardian shows a violet health bar while active and glows brighter as it is damaged; the suit-integrity bar tracks player health; PULSE and DASH show remaining cooldown seconds or `READY`.
- **Progression feedback.** Cell count, mechanism activation, Guardian defeat, Relic claim, and escape each advance the tracker, emit bounded `objective-changed` events with VFX/audio, and the results overlay reports score, time, and cells.

Guidance state lives in `snapshot.guidance`, keyed by player ID, so an authoritative co-op version can derive one tracker per connected player without redesign.

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

- exact `advance(seconds)` and semantic `setInput` / `press` operations (movement axes outside the unit disc are normalized before they reach the public movement command);
- `loadScenario("fresh" | "mechanism" | "guardian" | "escape")` for known states and selected encounter spawning/reset;
- `dismissOnboarding()`, mirroring the briefing button;
- immutable gameplay `snapshot` (including per-player `guidance`), bounded events, runtime errors, installed Feature/schedule inspection, Debug/DevTools captures, and WebGL/performance telemetry;
- a stable top-down debug camera, screenshot readiness, restart, disposal, and leak inspection.

The Playwright acceptance performs the field briefing (visible, then dismissed through the HUD button), traversal and dash, simultaneous W+D keyboard input (asserting no unit-disc error and a diagonal displacement), a real Energy Cell pickup with its prompt, the `mechanism` scenario and console activation, ability activation/cooldown rejection with Guardian health and cooldown HUD readouts, boss combat, Relic acquisition, escape/results, guidance stage and HUD assertions at every step, screenshots, restart, and full cleanup. It also rejects page/console/runtime errors and proves real Three.js WebGL output.

```sh
pnpm typecheck:relic-frontier
pnpm test:relic-frontier-boundaries
pnpm test:relic-frontier
pnpm verify:relic-frontier
```

See [asset provenance](./ASSETS.md), [performance budgets](./PERFORMANCE.md), and [authoritative co-op evolution](./ARCHITECTURE.md).

## First-version non-goals

Networking, accounts, matchmaking, cloud saves, procedural worlds, deep crafting, large inventories, extensive dialogue, and bespoke external art are intentionally excluded. The current goal is one dense, inspectable, finished vertical slice.
