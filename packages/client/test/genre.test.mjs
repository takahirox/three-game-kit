import assert from "node:assert/strict";
import test from "node:test";
import { createDeterministicPresentationFrameSource, defineFeatureConfiguration } from "@three-game-kit/core";
import { createClientRuntime } from "@three-game-kit/client";
import { createAbilitySkillClientFeature, createGeneralPhysicsClientFeature, createInventoryClientFeature, createProjectileClientFeature, createSaveLoadClientFeature, createSimpleAiNavigationClientFeature } from "@three-game-kit/client/genre";
import { createAbilityRuntime, createGeneralPhysicsRuntime, createInMemorySaveAdapter, createInventoryRuntime, createProjectileRuntime, createSaveLoadRuntime, createSimpleAiRuntime } from "@three-game-kit/shared/genre";

function fixtures() {
  const physics = createGeneralPhysicsRuntime({ gravity: { x: 0, y: 0, z: 0 } });
  const projectile = createProjectileRuntime([{ id: "bolt", speed: 1, lifetimeTicks: 5 }]); projectile.fire("bolt", "hero", { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0);
  const inventory = createInventoryRuntime([{ id: "key", maximumStack: 1 }]); inventory.createContainer("bag", 1);
  const ability = createAbilityRuntime([{ id: "dash", cooldownTicks: 1 }]); ability.request("hero", "dash", 1);
  const ai = createSimpleAiRuntime(); ai.register("agent", { x: 0, y: 0, z: 0 }, 1); ai.setWaypoints("agent", [{ x: 1, y: 0, z: 0 }]);
  const saves = createSaveLoadRuntime({ currentVersion: 1, capture: () => ({ ok: true }), restore() {}, adapter: createInMemorySaveAdapter() });
  return { physics, projectile, inventory, ability, ai, saves };
}

test("genre client Features run predictively in stable order and dispose", async () => {
  const f = fixtures(); const projectiles = []; const abilities = []; const agents = [];
  const runtime = createClientRuntime({ frameSource: createDeterministicPresentationFrameSource(), features: [createGeneralPhysicsClientFeature(f.physics), createProjectileClientFeature(f.projectile, (events) => projectiles.push(...events)), createAbilitySkillClientFeature(f.ability, (events) => abilities.push(...events)), createSimpleAiNavigationClientFeature(f.ai, (states) => agents.push(...states)), createInventoryClientFeature(f.inventory), createSaveLoadClientFeature(f.saves)] });
  assert.equal((await runtime.boot()).state, "running"); assert.deepEqual(runtime.stepExact(2), { ok: true, value: 2 });
  assert.equal(projectiles.length, 2); assert.deepEqual(abilities.map(({ kind }) => kind), ["started", "completed"]); assert.equal(agents.length, 2);
  assert.deepEqual(runtime.scheduleReport.filter(({ phase }) => phase === "shared-predict").map(({ systemId }) => systemId), ["general-physics-client-step", "projectile-client-step", "ability-skill-client-step", "simple-ai-navigation-client-step"]);
  await runtime.shutdown(); for (const owned of Object.values(f)) assert.equal(owned.disposed, true);
});

test("genre client ownership rolls back after later setup failure", async () => {
  const f = fixtures(); const configuration = defineFeatureConfiguration({ defaultValue: () => ({}), parse: () => ({ ok: true, value: {} }) });
  const failure = { id: "zz-failure", description: "failure", runtimeContributions: [], requires: [], conflicts: [], configuration, setup() { throw new Error("forced"); }, dispose() {} };
  const runtime = createClientRuntime({ frameSource: createDeterministicPresentationFrameSource(), features: [createGeneralPhysicsClientFeature(f.physics), createInventoryClientFeature(f.inventory), createSaveLoadClientFeature(f.saves), failure] });
  assert.equal((await runtime.boot()).reason, "setup-failed"); assert.equal(f.physics.disposed, true); assert.equal(f.inventory.disposed, true); assert.equal(f.saves.disposed, true);
});
