# Afterglow

Afterglow is a single-player neon survival sprint built on documented public `three-game-kit` Features. Pilot a light-trailing hovercar down **Meridian Descent**, a 1350 m floating highway above a dark city: jump the gaps, thread the laser gates, weave the pillars, ride the boost pads, manage boost heat, and beat your own ghost to the finish line.

The visual direction follows the "dark surfaces, glowing edges, long light trails" language of neon arcade racers. Everything on screen is procedural: there are no downloaded models, textures, fonts, or audio files (see [ASSETS.md](./ASSETS.md)).

## Run

From the repository root:

```sh
pnpm install
pnpm run build
pnpm exec vite --host 127.0.0.1 --port 4174
```

Open <http://127.0.0.1:4174/showcases/afterglow/index.html>.

Controls: `W` / `↑` throttle, `A` / `D` or `←` / `→` steer, `Space` jump, `Shift` boost, `S` / `↓` brake, `R` restart from the results screen. A standard gamepad also works: left stick steers, right trigger throttles, left trigger brakes, `A` jumps or launches, `RB` / `X` boosts, `Start` restarts.

## Game structure

- **Sprint.** One run from the start pad to the finish gate. The clock runs from the "GO" of the countdown until the finish line, crashes included.
- **Hazards.** Three gaps (jump), eight laser gates (`LOW` jump over, `LEFT` / `RIGHT` keep to the other side, `CENTER` take a side), five pillar slaloms, and boost heat: holding boost fills the heat bar and overheating destroys the car.
- **Checkpoints.** Four checkpoint arches record a respawn point. A crash costs about 0.8 s plus the respawn speed, so clean runs win.
- **Boost pads.** Five pads add speed on contact; the car's top speed is 46 m/s (166 km/h) normally and 64 m/s (230 km/h) while boosting.
- **Medals and ghost.** Gold ≤ 0:44, silver ≤ 0:55, bronze ≤ 1:15. The best run is saved (browser storage in normal mode) together with a ghost that replays as a translucent car on later runs.
- **Guidance.** The HUD cue names the next hazard and its distance, the progress bar tracks position along the track, and the velocity and heat gauges show the current state.
- **Game feel.** Every rule outcome is mirrored by bounded VFX from `@three-game-kit/client/vfx`: boost exhaust and heat sparks, speed streaks beside the road, take-off and landing sparks, wall-scrape sparks, near-miss flares beside pillars, gate-clear and checkpoint shockwaves, crash debris, respawn implosions, and finish fireworks. Toast labels (`GO`, `BOOST`, `NEAR MISS`, `GATE CLEAR`, `CHECKPOINT n`, `HARD LANDING`, `SIGNAL RESTORED`), camera shake, boost FOV, and post-processing chromatic aberration / vignette pulses complete the feedback loop.

## Public Feature composition

The showcase imports no framework internals. One public Client Runtime installs twelve Features:

| Feature id | Public entrypoint | Role in Afterglow |
| --- | --- | --- |
| `input-experience-extensions` | `@three-game-kit/client/advanced` | Context-aware bindings (`menu` / `drive`), keyboard and gamepad physical inputs, steering axis with dead zone |
| `afterglow.controls` | game-specific | Translates held throttle / brake / boost and the steering axis into vehicle control requests |
| `vehicles.client` | `@three-game-kit/client/advanced` + `@three-game-kit/shared/advanced` | Driver seat, control validation, and the custom speed / steering integrator |
| `afterglow.rules` | game-specific | Track-space movement, jumps, gravity, hazards, boost heat, checkpoints, ghost recording, cues |
| `trigger-area.client` | `@three-game-kit/client/gameplay` | Checkpoint and finish spheres evaluated against the car's world position |
| `game-flow.client` | `@three-game-kit/client/gameplay` | `title → countdown → running → results` state machine |
| `save-load.client` | `@three-game-kit/client/genre` | Versioned best time and ghost document (browser storage or in-memory adapter) |
| `ui-hud` | `@three-game-kit/client/gameplay` | Framework-neutral HUD state rendered through a DOM adapter |
| `camera-extensions` | `@three-game-kit/client/advanced` | Orbit chase variant driven by the car heading, zoom (FOV) while boosting, shake on crash and hard landing, results transition |
| `vfx` | `@three-game-kit/client/vfx` | Bounded burst, trail, and popup pools for exhaust, streaks, sparks, shockwaves, debris, checkpoints, and fireworks |
| `three-rendering` | `@three-game-kit/client/rendering` | Scene, camera smoothing, trail history, and material animation |
| `post-processing` | `@three-game-kit/client/advanced` | `EffectComposer` adapter with scene, bloom, chromatic-aberration, vignette, and output passes registered as public post-processing passes |

Simulation runs at a fixed 60 Hz in track space (`s` along the spline, `x` across it, `h` above it) so the rules are deterministic; `src/track.ts` converts to world space for the renderer, the camera target, and the trigger areas.

## Deterministic test mode

Append `?test=1` to disable the animation-frame loop. `window.__AFTERGLOW__` exposes `start`, `restart`, `setInput`, `press`, `advance(seconds)`, `loadScenario("start" | "gap" | "laser" | "boost" | "slalom" | "finish")`, `setBloomEnabled`, frozen `snapshot()`, `events()`, `errors()`, `inspectRuntime()`, `inspectRenderer()`, `inspectSave()`, `inspectLeaks()`, and `dispose()`. `pnpm run verify:afterglow` runs the public-import boundary check, the asset intake gate, the showcase typecheck, and the Playwright acceptance test.
