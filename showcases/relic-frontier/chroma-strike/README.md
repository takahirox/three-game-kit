# Chroma Strike

Chroma Strike is an original single-player browser FPS showcase built with Three.js and the public `@three-game-kit/client/vfx` runtime. Its visual direction distills the readable voxel geometry, bright competitive palette, weapon presentation, and fast lobby-to-match flow identified in the Refloom Kirka.io reference without copying Kirka branding, maps, assets, or text.

## Play

Open `/showcases/relic-frontier/chroma-strike/index.html` from the workspace Vite server.

- `WASD`: move relative to view
- Mouse drag or pointer lock: aim
- Left mouse or `Space`: fire
- `R`: reload

Clear five deterministic bots inside the 60-second match. The VX-12 carries 12 rounds and deals 40 damage per hit.

## Deterministic test mode

Append `?test=1` to disable the animation-frame loop. `window.__CHROMA_STRIKE__` exposes semantic input, actions, exact stepping, scenarios, frozen snapshots, event/error history, renderer/VFX inspection, restart, and disposal. The parent Relic Frontier Playwright suite covers the shooter alongside the existing expedition.

Arena geometry is authored from Three.js primitives. The VX-12 viewmodel and all five combat bots are runtime-loaded from the repository-original glTF 2.0 models in `assets/` (`chroma-pulse-rifle.gltf` and `chroma-combat-bot.gltf`) with the Three.js `GLTFLoader`; procedural primitive stand-ins render as fallbacks until each model attaches and whenever loading fails, and `inspectRenderer()` reports the weapon and enemy asset status. No third-party binary assets are used.
