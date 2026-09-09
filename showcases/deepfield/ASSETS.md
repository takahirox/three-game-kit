# Deepfield asset provenance

## Current asset lock

Deepfield contains **no binary assets** and **no third-party binary assets**. The block textures are painted at runtime into a single 64 × 64 RGBA canvas (sixteen 16 × 16 tiles) by `src/atlas.ts` from deterministic hashed noise, then uploaded once as a nearest-filtered Three.js `CanvasTexture`. Terrain, trees, ores, caves, the sky, clouds, the held block, and debris are all generated in repository TypeScript. The HUD is authored in local HTML/CSS and uses system fonts.

| Asset family | Source/version | License/provenance | Meshes | Materials | Textures | Clips | Bones / SkinnedMesh | Modification |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Block atlas | `src/atlas.ts`, repository version | Original project code, repository license | — | — | 1 runtime canvas (64 × 64 × RGBA = 16 384 bytes) | 0 | 0 / 0 | Painted at boot; never fetched |
| Terrain chunks | `src/world.ts` + `src/mesher.ts`, repository version | Original project code, repository license | 36 opaque + 36 water chunk meshes | 2 shared | atlas | 0 | 0 / 0 | Rebuilt per chunk on block edits with per-vertex ambient occlusion |
| Sky, sun, moon, stars, clouds | `src/renderer.ts`, repository version | Original project code, repository license | 17 | 5 | 0 | 0 | 0 / 0 | Colours and positions driven by the deterministic time of day |
| Held block, target outline, crack overlay | `src/renderer.ts`, repository version | Original project code, repository license | 3 | 3 | atlas | 0 | 0 / 0 | UVs retargeted when the hotbar selection changes |
| Block debris | `@three-game-kit/client/particles` 0.1.x | First-party package | 1 instanced emitter | 1 | 0 | 0 | 0 / 0 | Manual `emit` with per-block colours and seeds |

Authored binary asset download size is 0 bytes; no glTF, image, font, or audio file is fetched. GPU texture memory is the runtime atlas plus whatever the particle emitter allocates internally, reported through `inspectRenderer().textures`.

## Repeatable intake gate

Run `node scripts/verify-deepfield-assets.mjs`. It recursively inventories common model, image, audio, font, and compressed-texture extensions under the showcase, requires this document to keep the zero-asset statement and the atlas dimensions, and rejects `url()`, `@import`, `@font-face`, and remote `http(s)` references in the stylesheet and page. If an asset is added later, the gate deliberately fails until this document records source URL, upstream version, redistribution license, original and optimized sizes, mesh/triangle/material/texture/clip/bone counts, intended runtime use, modifications, and visual verification.
