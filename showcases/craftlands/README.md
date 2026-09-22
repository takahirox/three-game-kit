# Craftlands

Craftlands is a Minecraft-inspired single-player survival sandbox built on documented public `three-game-kit` Features. It is an original showcase: the artwork, rules and code are the repository's own, and the project is not affiliated with Mojang or Microsoft.

It streams an effectively infinite seeded world of chunks with biomes (plains, forest, birch forest, desert, snowy plains, mountains, beaches, rivers and oceans), caves, lava lakes, ore veins and trees. Play the classic loop: punch a tree, craft planks, sticks and a crafting table, build a wooden pickaxe, dig for stone, coal and iron, smelt ingots in a furnace, place torches to push back the dark, eat to keep the hunger bar up, and survive zombies, skeletons and creepers when night falls. Blocks and items are painted at runtime into one 256 × 256 atlas, so nothing is downloaded (see [ASSETS.md](./ASSETS.md)).

## Run

From the repository root:

```sh
pnpm install
pnpm run build
pnpm exec vite --host 127.0.0.1 --port 4174
```

Open <http://127.0.0.1:4174/showcases/craftlands/index.html>. The title screen orbits slowly above the spawn of the current seed. Click **New World**, then click the world to capture the mouse (pointer lock). `Esc` opens the game menu. Append `?seed=42` for a different world and `?distance=8` for a wider simulation / render distance (chunks, default 6).

### Controls

| Input | Action |
| --- | --- |
| `W A S D` / mouse | Move / look |
| `Space` | Jump; swim up; in creative, double-tap to fly and hold to rise |
| `Shift` | Sneak (slower, lower camera, never walks off an edge; descend while flying) |
| `Ctrl` or double-tap `W` | Sprint (wider FOV, drains hunger) |
| Left button | Mine (hold) / attack |
| Right button | Place block, open a crafting table / furnace / chest, hold to eat |
| `1`–`9` / wheel | Select a hotbar slot |
| `E` | Inventory with 2 × 2 crafting; drag stacks with left / right click, `Shift`-click to move or craft all |
| `Q` | Drop one of the held item |
| `T` or `/` | Chat and commands: `/time set day\|night`, `/gamemode creative\|survival`, `/give <item> [n]`, `/tp x y z`, `/spawn <mob>`, `/seed`, `/kill` |
| `F3` / `F5` / `F1` | Debug overlay / cycle first-person → behind → facing camera / hide HUD |
| `F` | Save now (the world also autosaves every 30 s of play and when quitting) |
| **Options…** (title / game menu) | Render distance, FOV, mouse sensitivity and sound volume as Minecraft-style slider buttons, saved in browser storage |

### Touch (phones and tablets)

On a coarse-pointer device the HUD switches to pocket-edition style controls (`?touch=1` forces them, `?touch=0` disables them):

| Gesture | Action |
| --- | --- |
| Touch and drag on the left half | Floating joystick; push it to the rim for a moment to sprint |
| Drag on the right half | Look around |
| Tap the world | Place the held block / use a crafting table, furnace, chest or bed |
| Press and hold the world | Mine or attack; with food in hand, eat |
| ▲ / ▼ buttons | Jump (hold to keep swimming up or, in creative, fly up; double-tap to toggle flight) / sneak toggle (fly down) |
| … / ⤓ beside the hotbar | Inventory (long-press a slot to shift-move it; ✕ closes) / drop one item |
| ◎ / ▐▐ | Camera perspective / game menu |
| Tap a hotbar slot | Select it |

Phones default to a four-chunk render distance and a 1.5× pixel ratio; both can be raised in **Options…**. Landscape orientation is recommended.

## Game structure

- **World.** `src/shared/terrain.ts` derives biome, height, caves, ore veins and trees for any column from the seed alone, so chunks generate identically in any order (trees whose canopy crosses a border are stamped by both chunks). `src/shared/world.ts` keeps a map of loaded 16 × 128 × 16 chunks, a per-chunk edit journal that survives unloading and is what the save stores, furnace and chest block entities, and flood-fill **sky and block lighting** (torches, lava, glowstone and lit furnaces emit light; placing or breaking blocks re-propagates or removes light). The rules load chunks in rings around the player every tick and unload distant ones.
- **Rendering.** `src/client/mesher.ts` builds opaque, cutout (leaves, glass, plants, torches) and water geometry per chunk with per-vertex ambient occlusion, Minecraft-style smooth lighting sampled from the four blocks touching each vertex, biome grass / foliage tints, thin snow layers on snowy plains, and slab-shaped blocks such as beds. `src/client/renderer.ts` shades chunks with a custom gamma-space shader (`brightness = L / (4 − 3L)`), warm torch tint, distance fog that darkens underground, a day / night sky with a square sun and moon, stars, drifting flat clouds, the block outline and ten-stage crack overlay, the first-person block / item / arm, bobbing item drops, and box-model mobs from `src/client/mob-renderer.ts`.
- **Player.** Minecraft speeds (4.317 m/s walk, 5.612 sprint, 1.31 sneak, gravity 32 m/s², 1.25-block jump), per-axis voxel collision, swimming and drowning with an air bar, fall damage from fall distance, cactus and lava damage, hunger with saturation and exhaustion (sprinting, jumping, mining, attacking and regeneration all cost food), regeneration above 18 hunger, starvation below 1, experience orbs that drift to the player and fill the level bar, and creative mode with flight and instant breaking.
- **Mining and placing.** The mining time follows Minecraft's formula from block hardness, tool type and tier (hand, wood, stone, iron, diamond); stone needs a pickaxe to drop cobblestone, ores need the right tier, tools wear out. Broken blocks drop item entities with physics that the player walks over to collect. Placing respects support rules for torches and plants and never overlaps the player or a mob.
- **Beds.** Right-click a bed (three wool over three planks) to set your spawn point; at night, with no monsters within eight blocks, you sleep straight to morning and nearby hostiles despawn.
- **Block updates.** Edits queue neighbour updates: sand and gravel fall when unsupported, torches and plants pop off when their support goes, grass under an opaque block turns to dirt. Random ticks near the player grow saplings into oak trees and spread grass onto lit dirt.
- **Crafting and smelting.** `src/shared/recipes.ts` holds shaped and shapeless recipes (planks, sticks, crafting table, chest, bed, torches, furnace, stone bricks, sandstone, bricks, wool, and pickaxe / axe / shovel / sword in four tiers) with mirrored matching, plus smelting recipes and fuel values. Inventory screens follow Minecraft click semantics (pick up, split, merge, swap, shift-move, craft all).
- **Mobs.** `src/shared/mobs.ts` runs pigs, cows, sheep and chickens (wander, herd spawns on lit grass, drop meat and materials) and zombies, skeletons and creepers (spawn in darkness and at night, chase within 20 blocks; zombies melee, skeletons hold their range and shoot arrows that arc under gravity, creepers hiss through a three-second fuse and explode, cratering the terrain; the undead burn in daylight). Every random roll comes from a seeded hash of the tick and mob id.
- **Sound.** `src/client/sounds.ts` synthesises every clip into an `AudioBuffer` at boot (per-material dig / step / hit noises, hurt, fall, pop, XP orb, level-up, eating, splash, explosion, creeper fuse, and pig / cow / sheep / chicken / zombie / skeleton voices) plus a 48-second calm pentatonic music loop, and registers them with the public Audio Feature. The host maps rule events to clips; mob voices are positional through the Web Audio listener, and playback unlocks on the first click or key.
- **Advancements and creative.** First-time milestones (Getting Wood, Benchmarking, Time to Mine!, Hot Topic, Acquire Hardware, Diamonds!, …) slide in as Minecraft-style toasts. Creative mode replaces the crafting screen with a scrollable palette of every item; clicking takes a full stack, clicking with a stack on the cursor destroys it.
- **Saving.** The Save/Load Feature persists seed, chunk edits, furnace contents, player transform and vitals, the slot-precise inventory, mobs, statistics, time of day and game mode to browser storage (an in-memory adapter in test mode). Autosave runs every thirty seconds of play; `F` saves immediately; the title screen offers **Continue World** when a save exists. Dying in survival scatters the inventory as item drops, as in Minecraft without `keepInventory`.

## Designed for a future authoritative server

Everything under `src/shared/` (blocks, items, recipes, terrain, world, lighting, physics, inventory, mobs, snapshot types) is authority-neutral: no DOM, no Three.js, no device input, and all randomness is seeded. The rules mutate the world only through `World.set`, journal every edit per chunk, and expose the player and mob state as plain data, so a Server Runtime Feature could host the same modules, validate block edits and inventory clicks as semantic actions, and replicate chunk journals and entity snapshots to clients with the kit's protocol. The client-only halves (`src/client/`, `src/main.ts`) consume frozen snapshots and never reach into the rules.

## Public Feature composition

The showcase imports no framework internals. One public Client Runtime installs eleven Features:

| Feature id | Public entrypoint | Role in Craftlands |
| --- | --- | --- |
| `movement-input` | `@three-game-kit/client/input` | Movement command plus the bounded semantic action queue (jump, attack, use, sprint, sneak, hotbar, drop, inventory, escape, chat, save, perspective, debug, HUD, fly) |
| `craftlands.rules` | game-specific | Chunk streaming, player physics and vitals, targeting, mining, placing, crafting, furnaces, item drops, mob simulation, commands, day / night, autosave |
| `health-damage.client` | `@three-game-kit/client/gameplay` + `@three-game-kit/shared/gameplay` | Fall, drowning, cactus, lava, starvation, mob and explosion damage; regeneration; death events |
| `game-flow.client` | `@three-game-kit/client/gameplay` | `title → playing ⇄ paused / dead` state machine |
| `save-load.client` | `@three-game-kit/client/genre` | Versioned world document with validation and restore |
| `ui-hud` | `@three-game-kit/client/gameplay` | Framework-neutral HUD state rendered through a DOM adapter (hearts, hunger, air, XP, hotbar, screens, chat, F3) |
| `debug-devtools.client` | `@three-game-kit/client/advanced` | Player and world diagnostic providers |
| `audio` | `@three-game-kit/client/audio` | Web Audio playback of the runtime-synthesised clip bank (silent driver in test mode) |
| `craftlands.camera` | game-specific | Publishes the first- or third-person eye transform in the camera-view phase |
| `particles` | `@three-game-kit/client/particles` | Instanced block-debris emitter presented by the Runtime |
| `three-rendering` | `@three-game-kit/client/rendering` | Scene, chunk meshes, sky, mobs, drops and held item |

The kit's static-world Collision Feature is not used because a voxel world changes constantly, and the count-based Inventory Feature is not used because Minecraft-style screens need slot-precise semantics (split stacks, cursor stacks, crafting grids, tool damage per stack); `src/shared/inventory.ts` provides those as an authority-neutral module instead.

## Deterministic test mode

Append `?test=1` to disable the animation-frame loop, use an in-memory save adapter and a three-chunk simulation distance. `window.__CRAFTLANDS__` exposes `start`, `continueWorld`, `setMove`, `setLook`, `look`, `setHeld`, `press`, `clickSlot(container, index, button, shift)`, `command`, `give`, `setMode`, `advance(seconds)`, `loadScenario("spawn" | "tree" | "stone" | "iron" | "diamond" | "cliff" | "water" | "cave" | "night" | "crafting" | "furnace" | "chest" | "mobs")`, `setTimeOfDay`, frozen `snapshot()`, `events()`, `errors()`, `inspectRuntime()`, `inspectRenderer()`, `inspectWorld()`, `inspectSave()`, `inspectInventory()`, `inspectLeaks()`, `inspectTouch()`, and `dispose()`. `pnpm run verify:craftlands` runs the public-import boundary check, the asset intake gate, the showcase typecheck, and the Playwright acceptance test.
