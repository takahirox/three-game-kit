# Relic Frontier

Relic Frontier is the official integrated `three-game-kit` showcase: a compact, stylized single-player Three.js **third-person melee action** slice assembled from documented public Features. Recover three Energy Cells across the ruins, choose one field upgrade, cut through the Ruin Husks and the Ash Warden, power the chamber mechanism, defeat the Relic Guardian, claim the Relic, and escape to Base Camp. Falling in combat returns you to the last checkpoint beacon.

## Run

From the repository root:

```sh
pnpm install
pnpm run build
pnpm exec vite --host 127.0.0.1 --port 4174
```

Open <http://127.0.0.1:4174/showcases/relic-frontier/index.html>.

Controls: WASD moves (camera-relative; two held keys are normalized into a diagonal), the mouse wheel or middle-drag turns the camera, left mouse is a light attack (tap again during the swing for the second hit of the combo), right mouse is a heavy attack, Space or Shift is a dodge roll with invulnerability frames, Tab locks on to the nearest hostile and cycles through the others, F casts Relic Pulse, E interacts, Q uses a Health Pack, and Esc closes the field briefing. J/K mirror the two attacks for keyboard-only play. The intended route takes approximately 5–10 minutes.

## Game structure

```text
Base Camp checkpoint
  ↓
ruin path — two Ruin Husks (melee)
  ↓
Warden court — Ash Warden (caster) with a Husk escort
  ↓
Chamber Gate checkpoint and power console
  ↓
Relic Guardian
  ↓
claim the Relic, escape to Base Camp, results
```

The compact level keeps the original Base Camp, central ruin path, garden and power-room branches, chamber gate, and Relic chamber. Depth of one coherent combat loop mattered more than map size, so the three Energy Cells now sit on ground-level side branches and the verbs are movement, light/heavy attacks, dodge, lock-on, interact, and one ability.

### Combat

All gameplay windows are tick-authoritative (60 Hz) and the animation clips are stretched to match them, so a swing reads at the same moment it connects:

| Attack | Startup | Active | Recovery | Damage | Volume | Reaction |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Light 1 | 8 | 6 | 12 | 18 | 2.4 m arc, 100° | hit reaction, 0.5 m knockback |
| Light 2 (combo) | 6 | 6 | 16 | 22 | 2.6 m arc, 120° | hit reaction, 0.9 m knockback |
| Heavy | 18 | 8 | 22 | 40 | 2.8 m arc, 140° | stagger, 1.8 m knockback; super armour while active |
| Husk slash | 30 | 6 | 40 | 12 | 2.3 m arc, 100° | hit reaction |
| Warden bolt | 40 | 1 | 30 | 14 | projectile, 11 m/s | hit reaction |
| Guardian sweep | 40 | 10 | 45 | 22 | 4.2 m arc, 170° | stagger, 2.2 m knockback |
| Guardian slam | 55 | 6 | 55 | 30 | 3.4 m sphere at the marked point | stagger, 2.6 m knockback |
| Guardian volley | 45 | 1 | 50 | 16 ×3 | three projectiles, ±0.24 rad | hit reaction |

A dodge lasts 30 ticks, moves for 18, and is invulnerable from tick 2 to 20; it cancels an attack's recovery. The second light attack queues when the button is pressed after the first swing's startup. Light hits interrupt Husk and Warden wind-ups and recoveries but never an active swing; the Guardian ignores light reactions until 70 damage of poise breaks or a heavy lands. Enemies telegraph every attack with a red or violet floor sector that fills during startup; slams mark the impact point.

### Checkpoints and respawn

Two checkpoint beacons — Base Camp and the Chamber Gate beside the power console — activate when entered. Death shows a "signal lost" state, respawns 2.5 s later at the active checkpoint with full health, and resets every living enemy to its spawn; defeated enemies, pickups, inventory, upgrades, the powered mechanism, and Relic ownership all survive death. Projectiles fired before the respawn tick cannot hit the returning player.

## Guidance and HUD

First-time players are guided by deterministic game state rather than scripted timers:

- **Field briefing.** Starting the expedition opens a dismissible briefing (controls plus the five-step goal). "Got it", Esc, or any movement/action input closes it, so it never blocks the AI/QA handle.
- **Objective tracker.** The top-centre HUD shows the current step, the objective sentence, and a compass cue such as `↖ 17 m` to the current target relative to the camera. A stage-coloured in-world beam and floor ring mark the same target.
- **Combat feedback.** A lock-on reticle floats above the target and the top-right panel shows its name and health; the Relic Guardian shows a violet health bar; the suit-integrity bar tracks player health; PULSE and DODGE show remaining cooldown seconds or `READY`; the active checkpoint is named next to the inventory; checkpoint activation and redeploys show a toast; `TAB · LOCK ON` prompts when hostiles are near.
- **Interaction prompts.** A prompt appears near pickups, upgrade pads, the power console, the Relic, and the Base Camp exit.
- **Progression feedback.** Cell count, mechanism activation, Guardian defeat, Relic claim, and escape each advance the tracker, emit bounded `objective-changed` events with VFX/audio, and the results overlay reports score, time, and cells.

Guidance state lives in `snapshot.guidance`, keyed by player ID, so an authoritative co-op version can derive one tracker per connected player without redesign.

## Public Feature composition

The showcase imports no framework internals. One public Client Runtime installs 18 Features:

- semantic `movement-input` and device-neutral one-shot actions;
- `asset-manager` loading the real animated glTF rig through `createThreeAssetBackend`, with deterministic failure evidence, and capability-safe `audio` lifecycle;
- `animation` advancing one `createAnimationCharacterSet` that holds the player and five enemy rigs registered after the asset arrives;
- `character-controller` over the public Rapier collision adapter;
- `trigger-area.client`, `health-damage.client`, `game-flow.client`, and `ui-hud`;
- `projectile.client`, `ability-skill.client`, `simple-ai-navigation.client`, and `inventory.client`;
- `debug-devtools.client`, `third-person-camera`, deterministic `vfx`, and `three-rendering`;
- `relic-frontier.rules`, the sole game-specific scheduled Feature.

The rules Feature also steps three shared runtimes that were extracted from this slice — `createHitQueryRuntime` and `createLockOnRuntime` from `@three-game-kit/shared/genre`, and `createCheckpointRuntime` from `@three-game-kit/shared/gameplay` — see [FRAMEWORK-DISCOVERY.md](./FRAMEWORK-DISCOVERY.md) for what was learned and what stayed game-local. Framework runtimes own validation, scheduling, cooldowns, health, inventory, triggers, navigation state, spatial queries, targeting, respawn scheduling, animation mixing, lifecycle, and cleanup. Showcase code owns level layout, attack tables, enemy state machines, encounter tuning, objective rules, art mapping, and the Relic/escape win condition.

## Character asset

The player and all enemies share one repository-authored rig, `assets/relic-ranger.glb` (17 bones, 11 clips, 264 triangles, 150876 bytes), generated deterministically by `scripts/lib/relic-ranger-rig.mjs` and locked by the asset intake gate. Enemies are `SkeletonUtils` clones with tinted materials; the Guardian is the same rig at 2.05× scale. See [ASSETS.md](./ASSETS.md) for the full intake record.

## AI/QA mode

Open `?test=1` to disable the wall-clock loop and expose `window.__RELIC_FRONTIER__`. The frozen handle supports:

- exact `advance(seconds)` and semantic `setInput` / `press` operations (`attack-light`, `attack-heavy`, `dodge`, `lock-on`, `ability`, `interact`, `use-item`);
- `loadScenario("fresh" | "melee" | "ranged" | "checkpoint" | "mechanism" | "guardian" | "player-death" | "escape")` for known states, and `forcePlayerDeath()`;
- `dismissOnboarding()`, mirroring the briefing button;
- immutable gameplay `snapshot` including per-character `combat` (state, attack, phase, tick counters, invulnerability, hit targets, poise), `animation` cues, `lockOn`, and `checkpoint` state, plus bounded events, runtime errors with context, installed Feature/schedule inspection, and Debug/DevTools captures;
- `inspectAnimation()` (per-character active state/clip/one-shot, clip time and duration, completed and interrupted one-shots, emitted clip events), `inspectCombat()` (attack tables and the Hit Query, Lock-On, and Checkpoint runtime inspections), `inspectAssets()`, `inspectRenderer()` (rig status, skinned meshes, animation events, WebGL/performance telemetry), and `inspectAudio()`;
- a stable top-down debug camera, screenshot readiness, restart, disposal, and leak inspection.

The Playwright acceptance boots cleanly, proves the rig loads through the public Asset Manager and attaches to six characters, checks idle→run→idle animation transitions, traces a heavy attack tick by tick to prove damage lands only inside the active window and that the clip time tracks the tick window, verifies stagger, the light combo, lock-on acquire/cycle/release and automatic release on death, a Relic Pulse that wakes the guard Husk, a dodge that rolls through a Husk slash for a deterministic `attack-dodged`, the Warden's telegraphed cast and projectile hit, forced death → downed HUD → respawn at Base Camp, checkpoint activation and respawn at the Chamber Gate, the Guardian's sweep, slam, stagger, and defeat through the same primitives, Relic acquisition, escape/results, screenshots, restart, and full cleanup including every animation runtime. It also rejects page/console/runtime errors and enforces the performance ceilings.

```sh
pnpm typecheck:relic-frontier
pnpm test:relic-frontier-boundaries
pnpm test:relic-frontier-assets
pnpm test:relic-frontier
pnpm verify:relic-frontier
```

See [framework discovery](./FRAMEWORK-DISCOVERY.md), [asset provenance](./ASSETS.md), [performance budgets](./PERFORMANCE.md), and [authoritative co-op evolution](./ARCHITECTURE.md). The [Chroma Strike](./chroma-strike/README.md) voxel FPS slice lives alongside this game and is unaffected.

## Non-goals

Networking, accounts, matchmaking, cloud saves, procedural worlds, deep crafting, large inventories, extensive dialogue, many weapons, skill trees, equipment rarity, a general animation graph, motion matching, and bespoke external art are intentionally excluded. The goal is one dense, inspectable, finished action slice.
