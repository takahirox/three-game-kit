# Core Run

A single-player, browser-only showcase built on `@three-game-kit/core`'s fixed
60 Hz simulation step. You grab glowing Energy Cores, run them back to the Base,
and chain deposits for combo multipliers before a 30-second clock hits zero.

Entry point: [`index.html`](./index.html). Host: [`src/main.ts`](./src/main.ts).
Rules: [`src/game.ts`](./src/game.ts) and [`src/features/`](./src/features/).
Renderer: [`src/three-renderer.ts`](./src/three-renderer.ts) (Three.js WebGL 3D scene).

## Rendering architecture

Core Run owns a real `THREE.Scene`, `THREE.WebGLRenderer`, and
`THREE.PerspectiveCamera` in [`src/three-renderer.ts`](./src/three-renderer.ts).
The camera follows the player in world space from a yaw-controlled
third-person offset. Reusable Three meshes represent the arena, player, cores,
Base, jump pad, moving platform, hazard, and elevated routes, with stylized
lighting and emissive, toon, and standard materials.

- Mesh transforms and animation are derived from `CoreRunSnapshot` and
  `snapshot.time`; rendering never consults a wall clock or `Math.random`.
- Particle, popup, and trail effects use deterministic fixed-capacity rings.
- The showcase imports the public `three` package directly and does not
  deep-import Three Game Kit internals.
- `dispose()` releases geometries, materials, scene objects, and the owned
  WebGL renderer.

## Premise and the 30-second flow

1. **Title** - the overlay shows the premise, the control list, and **Start**.
2. **Countdown** - pressing Start runs a 3-2-1-GO countdown (`COUNTDOWN_SECONDS = 3`).
3. **Running** - exactly 30 s (`ROUND_SECONDS = 30`). Pick up cores, deposit them at the Base, chain combos.
4. **Time up** - a 1 s "TIME UP" card (`TIME_UP_SECONDS = 1`).
5. **Results** - final score, deposit count, best combo, and **Retry**, which resets everything and starts a new countdown.

Phases are `title -> countdown -> running -> timeUp -> results`
([`src/features/round-timer.ts`](./src/features/round-timer.ts)).

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` (or arrow keys) | Move, relative to the camera yaw |
| Mouse: left-drag on the canvas | Rotate the camera (yaw). Double-click requests pointer lock (normal mode only); while locked, mouse movement rotates the camera |
| `Space` | Jump (only while grounded) |
| `Shift` (left or right) | Dash along the facing direction: 0.15 s at 20 m/s, then a 1 s cooldown |
| `E` | Interact: pick up the nearest core within 1.25 m if your hands are empty; deposit the carried core if you are within 2 m of the Base |

Click the canvas to focus it; while focused, game keys are `preventDefault`ed.
Held movement keys are cleared on window `blur` and when the tab becomes hidden.
Key bindings live in `MOVE_KEYS` / `ONE_SHOT_KEYS` in [`src/main.ts`](./src/main.ts).

## Rules

- **Core values** (`CORE_VALUES` in [`src/features/cores.ts`](./src/features/cores.ts)): Blue = 1, Gold = 3, Red = 5.
- **Fixed layout**: exactly 12 cores - 6 blue, 4 gold, 2 red - at hard-coded positions (`CORE_PLACEMENTS`). No randomness.
- **One-core carry limit**: `E` does nothing as a pickup while `carry.coreId` is set. Pickup is also blocked on the same tick as a deposit.
- **Score**: each deposit adds `value * combo`, where `combo` is the number of deposits made without the combo window lapsing (first deposit is x1, the next inside the window is x2, and so on).
- **Combo window**: 5 s (`COMBO_WINDOW_SECONDS = 5`, [`src/features/deposit.ts`](./src/features/deposit.ts)). Every deposit resets the window to 5 s. When it reaches zero the combo count returns to 0 and a `comboExpired` event is emitted.
- Pickup and deposit only work while the phase is `running`.

Worked example (from the Playwright test): blue, then blue within 5 s = 1 + 2 = 3 points; let the window expire, then blue = 1 more point, total 4.

## Level elements and route strategy

All coordinates are `(x, y, z)`; camera yaw 0 looks toward -Z. The arena floor spans +/-18 on X and Z.

| Element | Where | Behaviour |
| --- | --- | --- |
| **Base** | `(0, 0, 6)` (also the player spawn), radius 2 on the XZ plane | Deposit target. Glows brighter while you are carrying a core. |
| **Jump pad** | `(14, 0, 0)`, radius 1 | A grounded player touching it gets an upward impulse of 14 m/s and a `jumpPad` event. |
| **Moving platform** | Centre `(0, 2, -12)`, 4 x 4 m, oscillates +/-4 m on X with a 6 s period | Position is a pure function of simulation time. A player landing on it (falling, within 0.35 m of its height) is carried with it. |
| **Hazard** | Box `x, z` in `[-6, -2]`, `y` in `[0, 2]` | Slow zone: movement speed x0.4 while inside. Emits `hazardEntered` / `hazardExited`. |

Core positions:

- Blue (1): `(4,0,4)`, `(-4,0,4)`, `(4,0,-4)`, `(-4,0,-4)`, `(8,0,0)`, `(-8,0,0)`
- Gold (3): `(10,0,8)`, `(-10,0,8)`, `(10,0,-8)`, `(-10,0,-8)`
- Red (5): `(0,2.5,-12)` - above the moving platform's path; `(14,3,0)` - directly above the jump pad

Route strategy that follows from the layout: the blue cores nearest the Base
(`(4,0,4)` and `(-4,0,4)`) are the quickest way to start a combo; gold cores in
the corners are worth three blues each but cost more travel; the two reds
require the jump pad (`(14,3,0)`) or a timed landing on the moving platform
(`(0,2.5,-12)`). The blue core at `(-4,0,-4)` sits on the edge of the hazard
box, so approach it from outside the slow zone. Dash (1 s cooldown) shortens
every return leg to the Base.

## Running it

From the repository root:

```sh
pnpm install
pnpm run build                                  # builds workspace packages, including @three-game-kit/core
pnpm exec vite --host 127.0.0.1 --port 4174
```

Then open <http://127.0.0.1:4174/showcases/core-run/index.html>.

In normal mode the host drives the simulation from `requestAnimationFrame`; each
frame's elapsed time is clamped to 0.1 s (`MAX_FRAME_SECONDS`) before being fed
to the fixed-step accumulator.

## Deterministic test mode (`?test=1`)

Open `/showcases/core-run/index.html?test=1`. In test mode:

- No `requestAnimationFrame` loop runs and no wall clock is consulted. Time advances only through `window.__CORE_RUN__.advance()`.
- Every semantic call on the handle renders synchronously, so screenshots are stable.
- The renderer uses `devicePixelRatio: 1`, and pointer lock is never requested.
- `window.__CORE_RUN__` is assigned. (In normal mode it is only assigned if the host failed to boot, so the failure is inspectable.)

`window.__CORE_RUN__` implements `CoreRunTestHandle` ([`src/main.ts`](./src/main.ts)):

| Member | Kind | Behaviour |
| --- | --- | --- |
| `ready` | property (`boolean`) | `true` once the host has rendered at least once and is not disposed. |
| `status` | property (`string`) | Current status line (mirrors the `#status` element). In test mode it starts as `Test mode: time advances only via window.__CORE_RUN__.advance()`. |
| `mode` | property (`"normal" \| "test"`) | Boot mode derived from the `test=1` query parameter. |
| `screenshotReady` | property (`boolean`) | `true` once the renderer has drawn at least one full frame and is not disposed. |
| `snapshot()` | method | Frozen `CoreRunSnapshot`: `tick`, `time`, `phase`, `countdownValue`, `remainingSeconds`, `player`, `cores`, `carry`, `score`, `combo`, `platform`. Throws if the host is not booted. |
| `events()` | method | Frozen copy of collected telemetry events (most recent 1024). Empty array if the host is not booted. |
| `errors()` | method | Frozen array of `HostErrorRecord` (`source`, `message`, `tick`): host-level errors followed by game-level errors. |
| `setInput(input)` | method | Merges a partial `SemanticInput` (`moveX`, `moveY`, `cameraYaw`). Non-finite values are ignored; axes are clamped to `[-1, 1]` by the movement feature. |
| `press(action)` | method | Queues a one-shot action (`"jump"`, `"dash"`, `"interact"`) for the next simulation step. Unknown actions are ignored. |
| `advance(seconds)` | method | Accumulates seconds into fixed 1/60 s steps and returns the number of steps executed (max 600 per call; hitting the cap discards the remainder). Non-finite or negative input records an `invalid-advance` error and returns 0. Returns 0 after dispose. |
| `start()` | method | Begins the countdown; no-op unless the phase is `title`. |
| `retry()` | method | Resets all state and begins a new countdown from any phase. |
| `setDebugCamera(enabled)` | method | Toggles a fixed top-down debug camera with an axis gizmo and a text readout. |
| `dispose()` | method | Tears the host down (see below). Idempotent. |
| `restart()` | method | `dispose()` followed by booting a fresh host on the same DOM. |
| `inspectLeaks()` | method | `CoreRunLeakReport`: `hostListeners`, `rafActive`, `rafHandle`, `pointerDragging`, `hostDisposed`, `game` (`activeListeners`, `activeSubscriptions`, `activeTimers`), `renderer` (`frames`, `drawCalls`, `activeParticles`, `activePopups`, `eventsConsumed`). |
| `inspectRenderer()` | method | Read-only Three/WebGL proof: backend, live renderer/scene/camera flags, camera type, scene object/mesh/light counts, render size, and disposed state; returns `null` if the host did not boot. |

Determinism guarantees: the simulation uses `SIMULATION_DT_SECONDS = 1/60`;
the platform position is `platformPosition(time)`; the renderer seeds all
particles from telemetry events with a hash + LCG and never calls
`Math.random`; all motion derives from `snapshot.time`.

## Telemetry events

`TelemetryEvent` is defined in [`src/state.ts`](./src/state.ts). Every event
carries `tick`. Kinds and extra fields:

| `kind` | Extra fields | Emitted when |
| --- | --- | --- |
| `phaseChanged` | `from`, `to` | The round phase changes. |
| `countdown` | `value` (`3`, `2`, `1`, or `"go"`) | The countdown starts and each time the displayed second changes. |
| `jump` | - | A grounded jump is performed. |
| `dash` | - | A dash starts (cooldown was ready). |
| `corePickedUp` | `coreId`, `coreKind` | A core is picked up. |
| `coreDeposited` | `coreId`, `value`, `combo`, `points`, `score` | A core is deposited at the Base. |
| `comboExpired` | `combo` | The 5 s combo window lapses with a non-zero combo. |
| `jumpPad` | - | The jump pad launches the player. |
| `hazardEntered` | - | The player enters the hazard box. |
| `hazardExited` | - | The player leaves the hazard box. |
| `runtimeError` | `featureId`, `message` | A Feature threw during `reset` or `step`. |

The game keeps the most recent 1024 events (`TELEMETRY_EVENT_CAPACITY`). The
host forwards only events not yet seen by the renderer, buffered up to 1024
(`PENDING_EVENT_CAPACITY`), which turns them into bounded particle bursts and
score popups.

## Runtime error behaviour

- **Feature exceptions** are caught per Feature in `reset` and `step`, recorded through the `@three-game-kit/core` telemetry store with code `feature-threw` (category `invariant`), and re-emitted as a `runtimeError` telemetry event. The other Features keep stepping.
- **Listener exceptions** in a telemetry subscriber remove that subscriber and record `listener-threw`.
- **Invalid `advance()` input** records `invalid-advance` (category `expected`).
- **Host-level errors** are captured from `window` `error` and `unhandledrejection` listeners and from the frame loop. If the normal-mode frame loop throws, the loop stops and the status line becomes `Runtime error stopped the frame loop: <message>`.
- **Boot failure** (for example a missing DOM element) sets the status to `Core Run failed to boot: <message>`, records a host error, and still exposes `window.__CORE_RUN__` so the failure can be inspected.
- The host keeps the most recent 64 error records (`RUNTIME_ERROR_CAPACITY`). `errors()` returns host records followed by game records formatted as `<code>: <message>`.

## Verification

The Playwright spec [`tests/core-run.spec.ts`](../../tests/core-run.spec.ts)
drives the showcase exclusively through `?test=1` and `window.__CORE_RUN__`:

- boots cleanly with 12 fixed cores and the expected values, and captures `core-run-title.png`;
- proves the primary renderer owns a live WebGL context, a PerspectiveCamera, and non-empty Three scene/mesh/light counts, so a Canvas2D regression fails;
- runs a deterministic round slice (countdown events `3, 2, 1, "go"`, acceleration to `MAX_SPEED`, jump, dash + cooldown gating, pickup and deposit of core 0) and captures `core-run-running.png`;
- verifies the combo multiplier inside the window, `comboExpired` exactly when the window lapses, and the reset to x1 afterwards;
- runs to `timeUp` and `results`, checks the results DOM, clicks **Retry**, and verifies the clean second round (captures `core-run-results.png`);
- checks the hazard slow-down, the jump pad launch, and that the platform position matches `platformPosition(tick * dt)` and reproduces exactly after `restart()`;
- unit-tests the moving-platform Feature carrying a standing player;
- verifies `dispose()` releases all listeners and handles, is idempotent, and that `restart()` yields a clean state.

Every browser test also asserts no page errors, no console errors, and an empty
`errors()` array. Screenshots are written to the Playwright test output
directory via `testInfo.outputPath(...)`.

Expected commands (repo root):

```sh
pnpm typecheck:core-run
pnpm test:core-run
pnpm verify:core-run
```

These scripts are defined in the root [`package.json`](../../package.json);
CI runs `pnpm verify:core-run`.

[`playwright.config.ts`](../../playwright.config.ts) starts its own server with
`pnpm run build && pnpm exec vite --host 127.0.0.1 --port 4174` and does not
reuse an existing one, so stop any dev server on port 4174 before running the
tests. Type-checking uses [`tsconfig.json`](./tsconfig.json), which maps
`@three-game-kit/core` to the package source.

## Disposal and restart guarantees

`dispose()` on the handle (or the host):

- is idempotent - a second call is a no-op;
- cancels the pending `requestAnimationFrame` (normal mode);
- ends any pointer drag, releases pointer capture, and exits pointer lock if the canvas holds it;
- removes every DOM listener the host registered (`hostListeners` becomes 0);
- clears held keys and pending telemetry, unsubscribes from the game, and disposes the renderer (all particles, popups, and trail points deactivated) and the game (Feature list emptied, pending actions and listeners cleared);
- sets the status to `Core Run host disposed`; afterwards `ready` and `screenshotReady` are `false`, `advance()` returns 0, and every other method is a no-op.

`restart()` disposes the current host and boots a new one on the same DOM. The
new host starts at `tick 0` in the `title` phase with empty `events()`, one
telemetry listener, seven Feature registrations, zero timers, and a single
rendered frame - the spec asserts exactly this via `inspectLeaks()`. The game
owns no timers of its own (`activeTimers` is always 0).

## Non-goals

- No networking, server, or authoritative simulation - this is a local, single-player showcase.
- No audio, no persistence (scores are not saved), no external assets, fonts, or images.
- No procedural or randomised level layout; core placements and platform motion are fixed.
- No gamepad or touch controls beyond the pointer-drag camera.
