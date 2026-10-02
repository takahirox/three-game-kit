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


## Issue #42 mobile controls

Validated with Node 24.12.0, pnpm 11.24.0 and Playwright 1.62.1 bundled Chromium.

| Check | Result |
| --- | --- |
| `pnpm run verify` | Workspace build/typecheck, all 323 Node tests and public export/dependency checks passed |
| `PLAYWRIGHT_PORT=4189 pnpm run verify:metaverse` | Asset/public-import gate, showcase typecheck and all nine browser tests passed |
| `pnpm run build:pages` | Production bundle passed; existing shared-chunk size warning remains |
| Pages phone smoke | Compiled application under `/three-game-kit/` entered, walked, interacted once, jumped and left using real touch; cleanup passed |
| Visual inspection | Portrait 390×844 and landscape 844×390 lit-lantern captures reviewed; stick, action buttons and lantern prompt fit without overlap |

`tests/metaverse-touch.spec.ts` runs real Chromium touch contacts in touch-capable
390×844 phone portrait, 844×390 phone landscape and 1024×768 tablet contexts. Each
enters through the welcome button, walks via the stick, simultaneously drags the
camera with a second finger, taps Run and Jump while moving, reaches the lantern,
and interacts with a second finger while holding movement. Primary-finger taps
also toggle exactly once through the existing HUD. No keyboard, mouse or
programmable movement is used for these mobile play paths. Buttons and stick are
checked for at least 48px targets and viewport bounds.

The cancellation test covers the dead zone, full-speed normalized diagonals,
non-finite camera coordinates, touch cancellation, blur, restart and resize. Holding
Jump does not repeat or emit another jump on release. Disposal while both pointer
captures are active leaves zero adapter/host listeners and captures, a disposed
input-experience runtime with no device IDs or queued actions, and stopped game
resources. The five existing desktop, asset-failure and pending-load tests remain
passing. Mobile paths reported no browser, host or runtime errors.

The adapter uses the public input-experience runtime for touch axes/actions and
publishes into the existing semantic movement/action Feature. The game rules,
camera configuration and renderer quality remain unchanged. Browser emulation is
repeatable acceptance evidence; physical-device performance tuning was not needed
to implement or validate this input/presentation change. Screenshots remain under
ignored `test-results/`; the checked-in tests are the reproduction recipe.
