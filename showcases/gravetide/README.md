# Gravetide

Gravetide is a single-player survivor run built on documented public `three-game-kit` Features, in the spirit of horde-survival games: you only move, your weapons fire on their own, and the graveyard sends an ever-growing tide of bats, ghouls, brutes, and wraiths at you for five minutes. Enemies leave soul gems; gems level you up; every level offers three upgrades to stack. Survive until dawn, or fall and rise again.

Everything on screen is procedural: merged Three.js primitives, instanced pools, a runtime-painted ground, and the public particle module (see [ASSETS.md](./ASSETS.md)).

## Run

From the repository root:

```sh
pnpm install
pnpm run build
pnpm exec vite --host 127.0.0.1 --port 4174
```

Open <http://127.0.0.1:4174/showcases/gravetide/index.html>. Press **Enter** or click **BEGIN THE NIGHT**. Append `?seed=7` for a different spawn sequence and upgrade order.

Controls: `W A S D` / arrows move, weapons fire automatically, `E` or `Space` rings the Grave Bell (a 14-second cooldown shockwave that knocks back and damages everything nearby), `1` `2` `3` or a click choose a level-up card, `Enter` / `R` restart from a results screen.

## Game structure

- **The night.** A run lasts 300 seconds. Six waves add enemy kinds and spawn rates; enemy health also scales with elapsed time. The Grave Warden, an elite that hunts you through the public Simple AI Feature, arrives at 4:00.
- **Weapons (up to four, five levels each).** Bone Whip (arc in front, hits behind at level 4), Spirit Wand (auto-aim bolts through the Projectile Feature), Hallowed Ground (aura), Grave Axe (piercing spinning axes), Silver Knives (projectiles in the facing direction), Moon Lightning (random strikes).
- **Passives (up to four).** Wolf Boots (speed), Ember Heart (max HP), Sand Clock (cooldown), Witch Lens (area), Lodestone (pickup radius), Iron Shroud (contact armor).
- **Souls and levels.** Soul gems fly to you inside the pickup radius. Levelling pauses the run and shows three cards rolled from the seeded generator; when nothing is left to learn a heal card appears.
- **Contact damage.** Touching enemies costs health once per invulnerability window (Health Feature); three shrines heal you on entry every ninety seconds (Trigger Area Feature).
- **Records.** Best time, level, and kills persist through the Save/Load Feature (browser storage in normal mode, in-memory in test mode).

## Public Feature composition

The showcase imports no framework internals. One public Client Runtime installs fifteen Features:

| Feature id | Public entrypoint | Role in Gravetide |
| --- | --- | --- |
| `movement-input` | `@three-game-kit/client/input` | Movement command plus semantic actions (start, restart, choose 1–3, bell) |
| `gravetide.rules` | game-specific | Waves, spawning, horde steering with separation, weapons, gems, levels, timer |
| `trigger-area.client` | `@three-game-kit/client/gameplay` | Three shrine spheres evaluated against the hero |
| `health-damage.client` | `@three-game-kit/client/gameplay` | Hero contact damage with invulnerability windows, healing, and pooled enemy health slots |
| `projectile.client` | `@three-game-kit/client/genre` | Wand bolts and knives with a spatial-grid hit query |
| `ability-skill.client` | `@three-game-kit/client/genre` | The Grave Bell (cooldown + cast time) |
| `simple-ai-navigation.client` | `@three-game-kit/client/genre` | The Grave Warden hunts the hero through waypoints |
| `spawn-prefab.client` | `@three-game-kit/client/gameplay` | Pooled enemy prefabs per kind; the adapter allocates simulation slots |
| `game-flow.client` | `@three-game-kit/client/gameplay` | `title → running ⇄ levelup → results / victory` |
| `save-load.client` | `@three-game-kit/client/genre` | Versioned records document |
| `ui-hud` | `@three-game-kit/client/gameplay` | HUD state rendered through a DOM adapter (bars, loadout, cards, boss bar) |
| `debug-devtools.client` | `@three-game-kit/client/advanced` | Run and hero diagnostic providers |
| `third-person-camera` | `@three-game-kit/client/camera` | High, angled chase camera over the hero |
| `particles` | `@three-game-kit/client/particles` | Sparks, lit cube chunks, and glow emitters presented by the Runtime |
| `three-rendering` | `@three-game-kit/client/rendering` | Scene, instanced pools, and effect meshes |

Whip arcs, the aura, axes, and lightning are game-managed because they hit many targets or pierce, which the single-hit Projectile Feature does not model; the horde itself is steered in the rules because per-tick waypoint updates for hundreds of agents would be wasteful, while the elite demonstrates the AI Feature directly.

## Deterministic test mode

Append `?test=1` to disable the animation-frame loop and use an in-memory save adapter. `window.__GRAVETIDE__` exposes `start`, `restart`, `setMove`, `press`, `advance(seconds)`, `loadScenario("start" | "swarm" | "levelup" | "elite" | "dawn" | "shrine")`, `grantXp`, frozen `snapshot()`, `events()`, `errors()`, `inspectRuntime()`, `inspectRenderer()`, `inspectSave()`, `inspectLeaks()`, and `dispose()`. `pnpm run verify:gravetide` runs the public-import boundary check, the asset intake gate, the showcase typecheck, and the Playwright acceptance test.
