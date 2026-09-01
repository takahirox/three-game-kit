# Relic Frontier asset provenance and intake

## Current asset lock

Relic Frontier currently contains **no third-party binary assets**. All visual content is self-created in repository TypeScript from Three.js primitives, materials, deterministic point data, lighting, and public three-game-kit VFX. The HUD is authored in local HTML/CSS and uses system fonts. This avoids redistribution ambiguity while keeping the first official slice cohesive.

| Asset family | Source/version | License/provenance | Meshes | Materials | Textures | Clips | Bones / SkinnedMesh | Modification |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Ruins, arches, paths, pillars | `src/renderer.ts`, repository version | Original project code, repository license | 28 | 4 shared | 0 | 0 | 0 / 0 | Instanced conceptually through shared geometry/material handles |
| Player and four enemy silhouettes | `src/renderer.ts`, repository version | Original project code, repository license | 10 | 6 shared | 0 | 0 | 0 / 0 | Procedural transform animation |
| Cells, medkits, upgrades, gate, Relic | `src/renderer.ts`, repository version | Original project code, repository license | 14 | 7 shared | 0 | 0 | 0 / 0 | Deterministic emissive presentation |
| VFX pools | `@three-game-kit/client/vfx` 0.1.x | First-party package | bounded pools | pooled | no authored texture | 0 | 0 / 0 | Explicit seeds and lifetimes |

Initial authored asset download size is 0 bytes; no glTF, image, font, or audio file is fetched. WebGL may allocate one internal texture, reported separately from authored texture memory.

## Repeatable intake gate

Run `node scripts/verify-relic-frontier-assets.mjs`. It recursively inventories common model, image, audio, font, and compressed-texture extensions. The current expected count is zero. If an asset is added later, the gate deliberately fails until this document records source URL, upstream version, redistribution license, original and optimized sizes, mesh/triangle/material/texture/clip/bone counts, intended runtime use, modifications, and visual verification.

Future external candidates should prefer CC0 KayKit/Kenney families, keep a single visual family, remove unused files/clips, preserve atlases, resize textures only after comparison, and use glTF optimization/compression only after the public Asset Manager supports the chosen decoding path. Before/after measurements must be committed; marketing labels such as “low poly” are not measurements.
