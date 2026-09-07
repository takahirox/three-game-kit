# CHROMA STRIKE authored models

Both models in this directory are original works hand-authored directly as glTF 2.0 JSON for this repository. No third-party source, generator, or asset pack was used; provenance and license are identical to the repository source code (repository-original, repository license). Each file embeds its single binary buffer as a base64 data URI and references no external files.

## Shared conventions

- Format: glTF 2.0, JSON only, one embedded `data:application/octet-stream;base64` buffer per file; no images, textures, animations, or skins.
- Units and orientation: 1 unit = 1 meter, +Y up, right-handed glTF coordinates.
- Both files embed the same hand-encoded 648-byte unit-cube geometry (24 vertices, 12 triangles, flat normals, uint16 indices). Every named part instances that cube through node translation and scale, which produces the bright low-poly voxel silhouette.

## chroma-pulse-rifle.gltf

- Exact size: 4669 bytes.
- Scale and orientation: muzzle points toward -Z, sight up along +Y; bounding box 0.10 x 0.35 x 1.22 m with x in [-0.05, 0.05], y in [-0.21, 0.14], z in [-0.73, 0.49].
- Counts: 10 nodes (1 root, 9 named parts), 9 meshes, 4 materials (GunmetalSlate, ChromaShellCyan, StrikeCoreMagenta, VoltAmber), 3 accessors, 1 embedded 648-byte buffer.
- Geometry: 24 unique vertices and 12 unique triangles in the shared cube; 216 instanced vertices and 108 instanced triangles across the 9 part meshes.
- Named parts: Receiver, Barrel, BarrelShroud, MuzzleEmitter, EnergyCell, Grip, Stock, SightRail, SightLens.

## chroma-combat-bot.gltf

- Exact size: 5322 bytes.
- Scale and orientation: bot faces +Z and stands on the ground plane y = 0; bounding box 0.64 x 1.41 x 0.30 m with x in [-0.32, 0.32], y in [0, 1.41], z in [-0.13, 0.17].
- Counts: 13 nodes (1 root, 12 named parts), 12 meshes, 4 materials (BotArmorTeal, BotJointGraphite, VisorEmberOrange, CorePulseViolet), 3 accessors, 1 embedded 648-byte buffer.
- Geometry: 24 unique vertices and 12 unique triangles in the shared cube; 288 instanced vertices and 144 instanced triangles across the 12 part meshes.
- Named parts: Pelvis, Torso, ChestCore, Head, Visor, AntennaLeft, ArmLeft, ArmRight, LegLeft, LegRight, FootLeft, FootRight.

Any change to these files must update this document and `scripts/verify-relic-frontier-assets.mjs` together; the intake gate allowlists exactly these two paths and their locked structure and fails on any other binary asset under the showcase.
