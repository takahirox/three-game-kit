# Priority B genre-expansion Features

The six Priority B modules are optional, replaceable Features built on the existing Core lifecycle. Shared state lives at `@three-game-kit/shared/genre`; client prediction wrappers live at `@three-game-kit/client/genre`; authoritative headless wrappers live at `@three-game-kit/server/genre`. They are not Core requirements, and consumers may omit or replace any module.

## Feature contracts

- General Physics: `createGeneralPhysicsRuntime`, `createGeneralPhysicsClientFeature`, and `createGeneralPhysicsServerFeature` expose deterministic AABB reference physics, body kinds, gravity/forces/impulses, contacts and sensors, layers/masks, raycasts, and overlap queries. Multiplayer servers own trusted results; client events are predictions.
- Projectile: `createProjectileRuntime`, `createProjectileClientFeature`, and `createProjectileServerFeature` provide deterministic IDs, kinematics, lifetime, and a caller-owned hit hook. Damage and visual presentation remain separate.
- Inventory: `createInventoryRuntime`, `createInventoryClientFeature`, and `createInventoryServerFeature` provide bounded stacks, capacity, add/remove, atomic transfer, snapshots, and explicit failure codes. Server state is authoritative in multiplayer.
- Ability/Skill: `createAbilityRuntime`, `createAbilitySkillClientFeature`, and `createAbilitySkillServerFeature` provide queued requests, cast timing, cooldowns, cancellation state, and replaceable cost hooks. The server validates trusted costs and acceptance.
- Simple AI/Navigation: `createSimpleAiRuntime`, `createSimpleAiNavigationClientFeature`, and `createSimpleAiNavigationServerFeature` provide deterministic waypoint motion plus replaceable behavior and target hooks; `setPosition` relocates an agent for knockback or encounter resets without re-registering it. A navmesh and pathfinder are deliberately not bundled.
- Save/Load: `createSaveLoadRuntime`, `createInMemorySaveAdapter`, `createBrowserStorageSaveAdapter`, `createSaveLoadClientFeature`, and `createSaveLoadServerFeature` provide depth-bounded JSON-like documents, schema versions, migrations, validation, adapters, and explicit outcomes. Authentication, encryption, cloud sync, and conflict resolution remain host responsibilities.

### Combat helpers extracted from Relic Frontier

Two authority-neutral runtimes were promoted from the Relic Frontier melee slice after the same spatial and targeting logic recurred across player attacks, enemy attacks, and the boss. They are plain shared models stepped by a game-owned scheduled Feature; no lifecycle wrapper or catalog entry is added until a second consumer needs one.

- Hit Query: `createHitQueryRuntime().query(volume, candidates, options)` resolves `arc` (origin, yaw, radius, angle), `sphere`, and `capsule` volumes against candidates with optional radii, honours `exclude`, `maxTargets`, and `verticalTolerance`, and returns hits ordered by distance then ID with a normalized XZ direction for knockback. Damage, reactions, and presentation stay caller-owned; `inspect()` reports query and hit counts plus the last hit IDs.
- Lock-On: `createLockOnRuntime({ range, releaseRange })` provides `acquire` (nearest in range), `cycle` (next by distance-then-ID, wrapping within range), `release`, and `step` (drops targets that vanish from the candidate list or leave the hysteresis range), each returning explicit events. The runtime never reads presentation state; the game decides which candidates are valid.

Scheduled client systems run in `shared-predict` at priorities 300–600; scheduled server systems run in `gameplay` at the same priorities. Inventory and Save/Load are passive owners. Successful setup transfers runtime ownership to the Feature; shutdown or later-feature setup failure disposes state and adapters in reverse Feature order. Hooks and publish callbacks stay caller-owned.

The external-style browser consumer is [`examples/genre-expansion`](../../examples/genre-expansion/README.md). Headless tests cover deterministic behavior and both client/server rollback. Run `pnpm verify:genre-expansion`; the same typecheck and Chromium gate are included in `pnpm verify:m5` and CI.
