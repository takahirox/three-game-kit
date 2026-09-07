# Relic Frontier asset provenance and intake

## Current asset lock

Relic Frontier contains **no third-party binary assets**. The only binary files are two repository-original glTF 2.0 models hand-authored for the CHROMA STRIKE slice and locked below; all other visual content is self-created in repository TypeScript from Three.js primitives, materials, deterministic point data, lighting, and public three-game-kit VFX. The HUD is authored in local HTML/CSS and uses system fonts. This avoids redistribution ambiguity while keeping the first official slice cohesive.

| Asset family | Source/version | License/provenance | Meshes | Materials | Textures | Clips | Bones / SkinnedMesh | Modification |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Ruins, arches, paths, pillars | `src/renderer.ts`, repository version | Original project code, repository license | 28 | 4 shared | 0 | 0 | 0 / 0 | Instanced conceptually through shared geometry/material handles |
| Player and four enemy silhouettes | `src/renderer.ts`, repository version | Original project code, repository license | 10 | 6 shared | 0 | 0 | 0 / 0 | Procedural transform animation |
| Cells, medkits, upgrades, gate, Relic | `src/renderer.ts`, repository version | Original project code, repository license | 14 | 7 shared | 0 | 0 | 0 / 0 | Deterministic emissive presentation |
| VFX pools | `@three-game-kit/client/vfx` 0.1.x | First-party package | bounded pools | pooled | no authored texture | 0 | 0 / 0 | Explicit seeds and lifetimes |
| CHROMA STRIKE pulse rifle | `chroma-strike/assets/chroma-pulse-rifle.gltf`, hand-authored glTF 2.0, 4669 bytes | Repository-original work, repository license, documented in `chroma-strike/assets/MODELS.md` | 9 | 4 | 0 | 0 | 0 / 0 | None; one embedded 648-byte buffer, runtime-loaded by `src/chroma-strike/renderer.ts` as the first-person weapon with a procedural fallback until load |
| CHROMA STRIKE combat bot | `chroma-strike/assets/chroma-combat-bot.gltf`, hand-authored glTF 2.0, 5322 bytes | Repository-original work, repository license, documented in `chroma-strike/assets/MODELS.md` | 12 | 4 | 0 | 0 | 0 / 0 | None; one embedded 648-byte buffer, runtime-loaded by `src/chroma-strike/renderer.ts` and cloned for all five enemies with shared geometry/materials and procedural fallbacks until load |

Authored binary asset size is 9991 bytes across the two locked glTF files; no image, font, or audio file is fetched. Both models are runtime-loaded by the CHROMA STRIKE renderer, which keeps its procedural meshes as fallbacks until each glTF scene attaches and whenever loading fails. WebGL may allocate one internal texture, reported separately from authored texture memory.

## Repeatable intake gate

Run `node scripts/verify-relic-frontier-assets.mjs`. It recursively inventories common model, image, audio, font, and compressed-texture extensions and allows exactly the two locked CHROMA STRIKE glTF files above. For each locked file it checks the glTF 2.0 declaration, the shared authored generator tag, node/mesh/material counts, a single fully embedded base64 buffer whose decoded bytes match the declared byteLength, and documentation in `chroma-strike/assets/MODELS.md`. Any other binary asset, and any missing or structurally drifted locked file, deliberately fails the gate until this document and MODELS.md record source, upstream version, redistribution license, original and optimized sizes, mesh/triangle/material/texture/clip/bone counts, intended runtime use, modifications, and visual verification.

Future external candidates should prefer CC0 KayKit/Kenney families, keep a single visual family, remove unused files/clips, preserve atlases, resize textures only after comparison, and use glTF optimization/compression only after the public Asset Manager supports the chosen decoding path. Before/after measurements must be committed; marketing labels such as “low poly” are not measurements.
