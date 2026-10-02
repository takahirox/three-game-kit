# Lantern Court

A minimal single-player Web3D social-world foundation for Issue #40. Enter a quiet,
32 × 32 metre garden courtyard as a real animated glTF visitor, explore its arcades,
and light or extinguish the central lantern. There is no multiplayer or backend.

## Run

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm exec vite --host 127.0.0.1 --port 4174
```

Open <http://127.0.0.1:4174/showcases/metaverse/index.html> and select **Enter the court**.
The root gallery links to the showcase, and `pnpm run build:pages` includes it.
Requires a keyboard/pointer browser with WebGL; touch camera dragging works, but
mobile movement controls are outside this milestone.

| Control | Action |
| --- | --- |
| WASD / arrow keys | Camera-relative walk |
| Shift | Run (4.8 m/s; walking is 2.4 m/s) |
| Space | Jump; land on the courtyard ground |
| Drag the world / Q and C | Orbit the third-person camera |
| E / interaction button | Toggle the lantern when within 2.5 metres |
| R / Restart | Reset position, animation clock, camera and lantern |
| Leave | Dispose the runtime and all owned resources; reload to return |

A profile label identifies the local visitor. Movement input clears when the browser
loses focus. Animation blends idle, walk and run over 0.18 seconds; the avatar faces
its movement direction. Simplified solid colliders prevent walking through pillars,
benches, planters, the lantern and perimeter. The camera stays above the visitor and
uses the public third-person camera transform, shortened by a local scene raycast
when a roof, prop or wall obstructs the view.

## Public Feature composition

One Client Runtime installs `movement-input`, `asset-manager`, `character-controller`
(with the public Rapier collision adapter), `animation`, `third-person-camera`,
`ui-hud`, `three-rendering`, and the showcase-local `metaverse.rules` Feature.
Animation, input sampling, locomotion and rules run at 60 Hz with the deterministic
presentation frame source. Three.js lives in the renderer and asset/animation adapters.
There are no Core or reusable Feature changes.

The existing [Interaction capability](../../docs/features/interaction.md) is a
server-session command/replication contract; adding that session would exceed this
single-player milestone. The smallest local implementation uses the public
`createTriggerAreaRuntime` for inclusive range checks, with a semantic `interact`
action and one boolean toggle in `metaverse.rules`. It does not need networking.

`src/world.ts` holds immutable authored positions and collider data. The snapshot
contains stable visitor/target IDs, profile/appearance, transform, velocity,
locomotion and lantern state as detached, frozen plain data. Presentation consumes
that state rather than owning it. These are concrete seams for later authoritative
simulation, profile or remote-avatar work; no Presence, Rooms, replication, social
systems or speculative persistence is implemented.

See [ASSETS.md](./ASSETS.md) for original asset authoring, provenance, size and intake.

## Deterministic QA

Append `?test=1` to disable the animation-frame host loop. Wait for
`window.__METAVERSE__.ready`, then use the same path as browser controls:

```js
const court = window.__METAVERSE__;
court.start();
court.setMove(0, -1); // semantic local camera-relative axis
court.advance(2.5);  // fixed 60 Hz simulation; one presentation frame
court.setMove(0, 0);
court.press('interact');
court.advance(0.2);
court.snapshot();
court.inspectAnimation();
await court.dispose();
```

The handle also exposes `reset` / `restart`, `setMove(x,z,run)`, `setLook(yawRadians)`,
`press('jump' | 'interact')`, `inspectRuntime`, `inspectAssets`, `inspectRenderer`,
`errors` and `inspectLeaks`. `advance(seconds)` accepts 0–20 seconds and retains
fractional fixed steps. Semantic movement axes must lie within the unit disc;
physical keyboard diagonals are normalized. Reset clears held input, world state
and animation time.
Disposal is asynchronous and idempotent; wait for it before inspecting leak results.
Host/runtime errors remain inspectable afterward. No load-scenario teleport is
needed to exercise the main interaction path.

```sh
pnpm run verify:metaverse
pnpm run typecheck
pnpm run build:pages
```

The asset gate also checks public imports and the authority-neutral world module.
Browser tests cover asset loading, actual animated bone poses, walk/run speed,
facing, jumping, inclusive proximity and range rejection, toggle rendering, camera,
pillar/boundary collision, deterministic reset/replay, physical controls, focus loss,
normal animation-frame operation and complete disposal. Screenshots go to
`test-results`. To use a free port: `PLAYWRIGHT_PORT=4188 pnpm run verify:metaverse`.

Recorded execution results and visual review: [QA.md](./QA.md).
