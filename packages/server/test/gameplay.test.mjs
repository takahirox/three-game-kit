import assert from "node:assert/strict";
import test from "node:test";
import { defineFeatureConfiguration } from "@three-game-kit/core";
import { Runtime } from "@three-game-kit/server";
import {
  createGameFlowServerFeature,
  createHealthServerFeature,
  createSpawnPrefabServerFeature,
  createTriggerAreaServerFeature,
} from "@three-game-kit/server/gameplay";
import {
  createGameFlowRuntime,
  createHealthRuntime,
  createSpawnPrefabRuntime,
  createTriggerAreaRuntime,
} from "@three-game-kit/shared/gameplay";

test("common gameplay server Features execute authoritative systems once per tick and clean ownership", async () => {
  const trigger = createTriggerAreaRuntime([{ id: "danger", shape: "box", center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 } }]);
  const health = createHealthRuntime();
  health.register("hero", 20);
  health.requestDamage("hero", 5, { sourceId: "danger" });
  const spawn = createSpawnPrefabRuntime([{ id: "enemy" }], { create: () => ({}), reuse() {}, release() {} });
  const flow = createGameFlowRuntime({ states: [{ id: "lobby", allowedTo: ["match"] }, { id: "match", allowedTo: ["lobby"] }], initialState: "lobby" });
  const triggerEvents = [];
  const healthEvents = [];
  const runtime = new Runtime({ features: [
    createTriggerAreaServerFeature({ runtime: trigger, readActors: () => [{ id: "hero", position: { x: 0, y: 0, z: 0 } }], publish: (events) => triggerEvents.push(...events) }),
    createHealthServerFeature({ runtime: health, publish: (events) => healthEvents.push(...events) }),
    createSpawnPrefabServerFeature(spawn),
    createGameFlowServerFeature(flow),
  ] });
  assert.equal((await runtime.start()).state, "running");
  assert.deepEqual(runtime.stepExact(3), { ok: true, value: 3 });
  assert.deepEqual(triggerEvents.map(({ kind }) => kind), ["enter", "stay", "stay"]);
  assert.deepEqual(healthEvents.map(({ kind, after }) => [kind, after]), [["damaged", 15]]);
  assert.deepEqual(runtime.scheduleReport.filter(({ phase }) => phase === "gameplay").map(({ systemId }) => systemId), ["trigger-area-server-evaluate", "health-damage-server-apply"]);
  await runtime.shutdown();
  assert.equal(trigger.disposed, true);
  assert.equal(health.disposed, true);
  assert.equal(spawn.disposed, true);
  assert.equal(flow.disposed, true);
});

test("common gameplay server Feature setup rollback disposes every earlier owner", async () => {
  const trigger = createTriggerAreaRuntime([]);
  const health = createHealthRuntime();
  const spawn = createSpawnPrefabRuntime([{ id: "enemy" }], { create: () => ({}), reuse() {}, release() {} });
  const flow = createGameFlowRuntime({ states: [{ id: "boot", allowedTo: [] }], initialState: "boot" });
  const configuration = defineFeatureConfiguration({ defaultValue: () => ({}), parse: () => ({ ok: true, value: {} }) });
  const failure = { id: "zz-failure", description: "failure", runtimeContributions: [], requires: [], conflicts: [], configuration, setup() { throw new Error("forced"); }, dispose() {} };
  const runtime = new Runtime({ features: [
    createTriggerAreaServerFeature({ runtime: trigger, readActors: () => [], publish() {} }),
    createHealthServerFeature({ runtime: health, publish() {} }),
    createSpawnPrefabServerFeature(spawn),
    createGameFlowServerFeature(flow),
    failure,
  ] });
  assert.equal((await runtime.start()).reason, "setup-failed");
  assert.equal(trigger.disposed, true);
  assert.equal(health.disposed, true);
  assert.equal(spawn.disposed, true);
  assert.equal(flow.disposed, true);
});
