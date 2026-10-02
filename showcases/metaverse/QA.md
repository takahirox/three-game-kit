# Issue #40 verification

Validated with Node 24.12.0, pnpm 11.24.0 and Playwright 1.62.1 bundled Chromium.

| Check | Result |
| --- | --- |
| `pnpm run verify` | Build, workspace typecheck, all 323 Node tests and public export/dependency checks passed |
| `PLAYWRIGHT_PORT=4188 pnpm run verify:metaverse` | Byte-identical asset regeneration, public import gate, showcase typecheck and all four browser tests passed |
| `pnpm run verify:gallery` | Nine links, eighteen WebP covers (816 KiB), and all eighteen development/Pages browser tests passed |
| Pages game smoke | Lantern Court's actual compiled application loaded both GLBs, walked to and toggled the lantern, and disposed under `/three-game-kit/` |
| Visual inspection | Welcome, lit-lantern frame and committed gallery cover reviewed; real rounded skinned visitor, arches, curved roofs, planters, ground paths and shadows visible |

The deterministic acceptance test measures walk/run displacement, idle/walk bone
quaternion changes, all three named animation states, facing, jumping/landing,
range rejection and lantern toggling. It also proves tree occlusion shortens the
camera, structures/perimeter block movement, and reset/replay yields equal state
and animation time. Physical diagonal movement preserves run speed. Normal mode
uses the animation-frame host, physical controls and camera drag.

Normal shutdown and concurrent repeated disposal release controller/Rapier world,
animation set, trigger runtime, asset cache, HUD, renderer-owned geometry/materials,
shadow target, skeleton bone texture, host listeners, pointer capture and RAF.
Healthy paths reported no browser, host or runtime errors. Failed asset intake
reported one expected diagnostic and cleaned up; pending-load disposal fenced late
completion without publishing an avatar or leaving cached resources.

Screenshots and traces are generated under ignored `test-results/`; committed
reproduction recipes, tests, models and gallery covers are the durable evidence.
The browser tests use numeric tolerances for Rapier contact skin, not pixel goldens.
The Pages build retains the repository's shared-chunk size warning and succeeds.
This milestone targets keyboard/pointer browsers; mobile movement, multiplayer and
social services are outside Issue #40.
