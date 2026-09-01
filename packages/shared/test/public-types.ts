import {
  createGameFlowRuntime,
  createHealthRuntime,
  createHudStateStore,
  createSpawnPrefabRuntime,
  createTriggerAreaRuntime,
  type GameFlowOutcome,
  type GameplayVector3,
  type HealthEvent,
  type HudState,
  type PrefabInstance,
  type TriggerAreaEvent,
} from "@three-game-kit/shared/gameplay";

const position: GameplayVector3 = { x: 0, y: 0, z: 0 };
const triggers = createTriggerAreaRuntime([
  { id: "goal", shape: "sphere", center: position, radius: 1 },
]);
const triggerEvents: readonly TriggerAreaEvent[] = triggers.step(1, [
  { id: "player", position },
]);

const health = createHealthRuntime();
health.register("player", 10);
health.requestDamage("player", 1, { sourceId: "hazard", invulnerabilityTicks: 2 });
const healthEvents: readonly HealthEvent[] = health.step(1);

const prefab = createSpawnPrefabRuntime([{ id: "enemy" }], {
  create: () => ({}),
  reuse() {},
  release() {},
});
const instance: PrefabInstance = prefab.spawn("enemy");

const flow = createGameFlowRuntime({
  states: [{ id: "menu", allowedTo: ["play"] }, { id: "play", allowedTo: [] }],
  initialState: "menu",
});
const outcome: GameFlowOutcome = flow.transition("play", { tick: 1 });

const hud = createHudStateStore({ health: 10, maximumHealth: 10 });
const hudState: HudState = hud.update({ score: 1 });

// @ts-expect-error Trigger coordinates must be numbers.
createTriggerAreaRuntime([{ id: "bad", shape: "sphere", center: { x: "0", y: 0, z: 0 }, radius: 1 }]);
// @ts-expect-error HUD snapshots are read-only.
hudState.score = 2;

void [triggerEvents, healthEvents, instance, outcome, hudState];

import {
  createAbilityRuntime,
  createGeneralPhysicsRuntime,
  createInMemorySaveAdapter,
  createInventoryRuntime,
  createProjectileRuntime,
  createSaveLoadRuntime,
  createSimpleAiRuntime,
  type GenreVector3,
  type SaveLoadOutcome,
} from "@three-game-kit/shared/genre";
const genrePosition: GenreVector3 = { x: 0, y: 0, z: 0 };
const genrePhysics = createGeneralPhysicsRuntime();
genrePhysics.addBody({ id: "body", kind: "dynamic", position: genrePosition, halfExtents: { x: 1, y: 1, z: 1 } });
const genreProjectile = createProjectileRuntime([{ id: "bolt", speed: 1, lifetimeTicks: 2 }]);
const genreInventory = createInventoryRuntime([{ id: "key", maximumStack: 1 }]);
const genreAbility = createAbilityRuntime([{ id: "dash", cooldownTicks: 1 }]);
const genreAi = createSimpleAiRuntime();
const genreSave = createSaveLoadRuntime({ currentVersion: 1, capture: () => ({ ok: true }), restore() {}, adapter: createInMemorySaveAdapter() });
const genreSaveOutcome: Promise<SaveLoadOutcome> = genreSave.save("slot");
// @ts-expect-error Physics positions require numeric components.
genrePhysics.addBody({ id: "bad", kind: "dynamic", position: { x: "0", y: 0, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 } });
void [genreProjectile, genreInventory, genreAbility, genreAi, genreSaveOutcome];
