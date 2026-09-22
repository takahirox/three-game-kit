# Craftlands asset provenance

## Current asset lock

Craftlands contains **no binary assets** and **no third-party binary assets**. Every texture is painted at runtime into a single 256 × 256 RGBA canvas (a 16 × 16 grid of 16 px tiles) by `src/client/atlas.ts` from deterministic hashed noise and hand-written pixel maps, then uploaded once as a nearest-filtered Three.js `CanvasTexture`. Terrain, caves, ores, trees, the sky, clouds, mobs, item drops, the held item, HUD icons and the title-screen dirt background are all generated in repository TypeScript. The HUD is authored in local HTML/CSS and uses system fonts. No Minecraft texture, model, sound, or font is copied; the artwork is original and merely in the same 16 px style.

| Asset family | Source/version | License/provenance | Meshes | Materials | Textures | Clips | Bones / SkinnedMesh | Modification |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Block / item / mob atlas | `src/client/atlas.ts`, repository version | Original project code, repository license | — | — | 1 runtime canvas (256 × 256 × RGBA = 262 144 bytes) | 0 | 0 / 0 | Painted at boot; never fetched |
| Terrain chunks | `src/shared/terrain.ts`, `src/shared/world.ts`, `src/client/mesher.ts` | Original project code, repository license | 3 meshes per loaded chunk (opaque, cutout, water) | 3 shared `ShaderMaterial`s | atlas | 0 | 0 / 0 | Rebuilt per chunk on edits with vertex AO and smooth sky / block light |
| Sky, sun, moon, stars, clouds | `src/client/renderer.ts` | Original project code, repository license | 2 discs + 1 point cloud + 1 instanced cloud field | 4 | atlas (sun / moon tiles) | 0 | 0 / 0 | Colours and positions driven by the deterministic time of day |
| Mobs and third-person player | `src/client/mob-renderer.ts` | Original project code, repository license | Box-part models built per visible mob | 1 material clone per model | atlas (skin tiles) | 0 | 0 / 0 | Procedural leg / arm swing, head tracking, hurt / burn / fuse tints |
| Item drops, held item, crack overlay, block outline | `src/client/renderer.ts` | Original project code, repository license | 1 per drop + 3 hand meshes + 2 overlays | 6 | atlas | 0 | 0 / 0 | UVs retargeted when the selection changes |
| HUD icons (hearts, hunger, air, item cubes) | `src/client/icons.ts` | Original project code, repository license | — | — | Small runtime canvases converted to data URLs | 0 | 0 / 0 | Isometric cubes composed from atlas tiles in a 2D canvas |
| Block debris | `@three-game-kit/client/particles` 0.1.x | First-party package | 1 instanced emitter | 1 | 0 | 0 | 0 / 0 | Manual `emit` with per-block colours and seeds |

Authored binary asset download size is 0 bytes; no glTF, image, font, or audio file is fetched. GPU texture memory is the runtime atlas plus whatever the particle emitter allocates internally, reported through `inspectRenderer().textures`.

## Repeatable intake gate

Run `node scripts/verify-craftlands-assets.mjs`. It recursively inventories common model, image, audio, font, and compressed-texture extensions under the showcase, requires this document to keep the zero-asset statement and the atlas dimensions, and rejects `url()`, `@import`, `@font-face`, and remote `http(s)` references in the stylesheet and page (runtime data URLs are assigned from TypeScript, never referenced from CSS). If an asset is added later, the gate deliberately fails until this document records source URL, upstream version, redistribution license, original and optimized sizes, mesh/triangle/material/texture/clip/bone counts, intended runtime use, modifications, and visual verification.
