# Afterglow asset provenance

## Current asset lock

Afterglow contains **no binary assets** and **no third-party binary assets**. Every visible element is generated at runtime in repository TypeScript from Three.js primitives, procedural geometry, materials, deterministic point data, lighting, the public `@three-game-kit/client/vfx` pools, and a Three.js `EffectComposer` bloom chain from the `three/examples/jsm` add-ons that ship with the pinned `three` dependency. The HUD is authored in local HTML/CSS and uses system fonts.

| Asset family | Source/version | License/provenance | Meshes | Materials | Textures | Clips | Bones / SkinnedMesh | Modification |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Meridian Descent road, edges, lane marks, gap chevrons | `src/track.ts` spline + `src/renderer.ts` ribbons, repository version | Original project code, repository license | ~70 ribbon meshes | 6 shared | 0 | 0 | 0 / 0 | Built once from the arc-length table |
| Laser gates, pillars, checkpoints, finish gate | `src/renderer.ts`, repository version | Original project code, repository license | ~60 | shared per family | 0 | 0 | 0 / 0 | Pulsing opacity and colour in `render()` |
| Neon city, rooftop beacons, floor grid, stars | `src/renderer.ts` InstancedMesh + LineSegments + Points | Original project code, repository license | 4 instanced draws | 5 | 0 | 0 | 0 / 0 | Deterministic pseudo-random placement |
| Hovercar and ghost | `src/renderer.ts` extruded outline, prisms, tori | Original project code, repository license | ~20 per car | 6 | 0 | 0 | 0 / 0 | Steering roll/yaw and pitch from snapshot |
| Light trails | `src/renderer.ts` ShaderMaterial ribbons | Original project code, repository license | 2 | 2 | 0 | 0 | 0 / 0 | Per-vertex alpha fade, 56-point history |
| Bloom | `three/examples/jsm/postprocessing/UnrealBloomPass.js` from `three` 0.185.x | MIT (Three.js) | — | — | render targets only | — | — | Registered through the public Post-processing Feature |
| VFX pools | `@three-game-kit/client/vfx` 0.1.x | First-party package | bounded pools | pooled | no authored texture | 0 | 0 / 0 | Explicit seeds and lifetimes |

Authored binary asset download size is 0 bytes; no glTF, image, font, or audio file is fetched. WebGL allocates internal render targets for the composer and bloom mip chain, reported through `inspectRenderer().textures` separately from authored texture memory.

## Repeatable intake gate

Run `node scripts/verify-afterglow-assets.mjs`. It recursively inventories common model, image, audio, font, and compressed-texture extensions under the showcase, requires this document to keep the zero-asset statement, and rejects `url()`, `@import`, `@font-face`, and remote `http(s)` references in the stylesheet and page. If an asset is added later, the gate deliberately fails until this document records source URL, upstream version, redistribution license, original and optimized sizes, mesh/triangle/material/texture/clip/bone counts, intended runtime use, modifications, and visual verification.
