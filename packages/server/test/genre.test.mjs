import assert from "node:assert/strict";
import test from "node:test";
import { defineFeatureConfiguration } from "@three-game-kit/core";
import { Runtime } from "@three-game-kit/server";
import { createAbilitySkillServerFeature, createGeneralPhysicsServerFeature, createInventoryServerFeature, createProjectileServerFeature, createSaveLoadServerFeature, createSimpleAiNavigationServerFeature } from "@three-game-kit/server/genre";
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

test("genre server Features run authoritatively in stable order and dispose", async () => {
  const f = fixtures(); const abilities = [];
  const runtime = new Runtime({ features: [createGeneralPhysicsServerFeature(f.physics), createProjectileServerFeature(f.projectile), createAbilitySkillServerFeature(f.ability, (events) => abilities.push(...events)), createSimpleAiNavigationServerFeature(f.ai), createInventoryServerFeature(f.inventory), createSaveLoadServerFeature(f.saves)] });
  assert.equal((await runtime.start()).state, "running"); assert.deepEqual(runtime.stepExact(2), { ok: true, value: 2 }); assert.deepEqual(abilities.map(({ kind }) => kind), ["started", "completed"]);
  assert.deepEqual(runtime.scheduleReport.filter(({ phase }) => phase === "gameplay").map(({ systemId }) => systemId), ["general-physics-server-step", "projectile-server-step", "ability-skill-server-step", "simple-ai-navigation-server-step"]);
  await runtime.shutdown(); for (const owned of Object.values(f)) assert.equal(owned.disposed, true);
});

test("genre server ownership rolls back after later setup failure", async () => {
  const f = fixtures(); const configuration = defineFeatureConfiguration({ defaultValue: () => ({}), parse: () => ({ ok: true, value: {} }) });
  const failure = { id: "zz-failure", description: "failure", runtimeContributions: [], requires: [], conflicts: [], configuration, setup() { throw new Error("forced"); }, dispose() {} };
  const runtime = new Runtime({ features: [createGeneralPhysicsServerFeature(f.physics), createInventoryServerFeature(f.inventory), createSaveLoadServerFeature(f.saves), failure] });
  assert.equal((await runtime.start()).reason, "setup-failed"); assert.equal(f.physics.disposed, true); assert.equal(f.inventory.disposed, true); assert.equal(f.saves.disposed, true);
});
