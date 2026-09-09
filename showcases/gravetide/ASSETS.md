# Gravetide asset provenance

## Current asset lock

Gravetide contains **no binary assets** and **no third-party binary assets**. The ground is a 64 × 64 RGBA noise texture painted at runtime into a canvas by `src/renderer.ts` and repeated across the arena; every prop, enemy, weapon, gem, and effect is built from Three.js primitives merged with the `BufferGeometryUtils` add-on that ships with the pinned `three` dependency, or emitted by the public particle module. The HUD is authored in local HTML/CSS and uses system fonts.

| Asset family | Source/version | License/provenance | Meshes | Materials | Textures | Clips | Bones / SkinnedMesh | Modification |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Ground | `src/renderer.ts` canvas noise, repeated 48 × 48 | Original project code, repository license | 1 | 1 | 1 runtime canvas (64 × 64 × RGBA = 16 384 bytes) | 0 | 0 / 0 | Painted at boot; never fetched |
| Graveyard props (tombstones, crosses, dead trees, fence) | `src/renderer.ts` merged primitives, seeded placement | Original project code, repository license | 4 instanced draws + 4 walls | 3 | 0 | 0 | 0 / 0 | Deterministic seed 77 layout |
| Hero | `src/renderer.ts` capsule, spheres, cylinders, boxes | Original project code, repository license | 6 | 5 | 0 | 0 | 0 / 0 | Bob, lean, hurt flash from snapshot |
| Enemies (bat, ghoul, brute, wraith, elite) | `src/renderer.ts` merged primitives, one `InstancedMesh` per kind | Original project code, repository license | 5 instanced draws (up to 604 instances) | 5 | 0 | 0 | 0 / 0 | Per-instance colour flash, facing and bob |
| Gems, bolts, knives, axes | `src/renderer.ts` `InstancedMesh` pools | Original project code, repository license | 4 instanced draws | 4 | 0 | 0 | 0 / 0 | Positions from the deterministic simulation |
| Whip arcs, hallowed ground, bell ring, lightning pillars, shrines | `src/renderer.ts` rings, circles, cylinders | Original project code, repository license | ~20 | ~14 | 0 | 0 | 0 / 0 | Opacity and scale driven per frame |
| Sparks, chunks, glow | `@three-game-kit/client/particles` 0.1.x | First-party package | 3 emitters (2304 particles) | 3 | 0 | 0 | 0 / 0 | Manual `emit` with per-event colours and seeds |

Authored binary asset download size is 0 bytes; no glTF, image, font, or audio file is fetched. GPU texture memory is the runtime ground texture plus whatever the particle emitters allocate internally, reported through `inspectRenderer().textures`.

## Repeatable intake gate

Run `node scripts/verify-gravetide-assets.mjs`. It recursively inventories common model, image, audio, font, and compressed-texture extensions under the showcase, requires this document to keep the zero-asset statement and the runtime texture dimensions, and rejects `url()`, `@import`, `@font-face`, and remote `http(s)` references in the stylesheet and page. If an asset is added later, the gate deliberately fails until this document records source URL, upstream version, redistribution license, original and optimized sizes, mesh/triangle/material/texture/clip/bone counts, intended runtime use, modifications, and visual verification.
