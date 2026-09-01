import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeterministicPresentationFrameSource,
  defineFeatureConfiguration,
} from "@three-game-kit/core";
import { createClientRuntime } from "@three-game-kit/client";
import {
  createGameFlowClientFeature,
  createHealthClientFeature,
  createHudFeature,
  createSpawnPrefabClientFeature,
  createTriggerAreaClientFeature,
} from "@three-game-kit/client/gameplay";
import {
  createGameFlowRuntime,
  createHealthRuntime,
  createHudStateStore,
  createSpawnPrefabRuntime,
  createTriggerAreaRuntime,
} from "@three-game-kit/shared/gameplay";

function prefabRuntime() {
  return createSpawnPrefabRuntime([{ id: "enemy", pooling: true }], {
    create: () => ({}),
    reuse() {},
    release() {},
  });
}

function flowRuntime() {
  return createGameFlowRuntime({
    states: [{ id: "menu", allowedTo: ["play"] }, { id: "play", allowedTo: ["menu"] }],
    initialState: "menu",
  });
}

test("common gameplay client Features run prediction and presentation and release owned runtimes", async () => {
  const trigger = createTriggerAreaRuntime([{ id: "goal", shape: "sphere", center: { x: 0, y: 0, z: 0 }, radius: 1 }]);
  const health = createHealthRuntime();
  health.register("hero", 10);
  health.requestDamage("hero", 2);
  const store = createHudStateStore({ screen: "play", health: 10, maximumHealth: 10 });
  const adapter = {
    disposed: false,
    renders: [],
    render(state) { this.renders.push(state); },
    inspect() { return { disposed: this.disposed, renderCount: this.renders.length, lastRevision: this.renders.at(-1)?.revision ?? null, listenerActive: false }; },
    dispose() { this.disposed = true; },
  };
  const spawn = prefabRuntime();
  const flow = flowRuntime();
  const triggerEvents = [];
  const healthEvents = [];
  const frameSource = createDeterministicPresentationFrameSource();
  const runtime = createClientRuntime({
    frameSource,
    features: [
      createTriggerAreaClientFeature({ runtime: trigger, readActors: () => [{ id: "hero", position: { x: 0, y: 0, z: 0 } }], publish: (events) => triggerEvents.push(...events) }),
      createHealthClientFeature({ runtime: health, publish: (events) => healthEvents.push(...events) }),
      createSpawnPrefabClientFeature(spawn),
      createGameFlowClientFeature(flow),
      createHudFeature({ store, adapter }),
    ],
  });
  assert.equal((await runtime.boot()).state, "running");
  assert.deepEqual(runtime.stepExact(2), { ok: true, value: 2 });
  assert.deepEqual(triggerEvents.map(({ kind }) => kind), ["enter", "stay"]);
  assert.deepEqual(healthEvents.map(({ kind }) => kind), ["damaged"]);
  assert.deepEqual(runtime.startPresentation(), { ok: true, value: true });
  assert.equal(frameSource.deliver(16), true);
  assert.equal(adapter.renders.length, 1);
  await runtime.shutdown();
  assert.equal(trigger.disposed, true);
  assert.equal(health.disposed, true);
  assert.equal(spawn.disposed, true);
  assert.equal(flow.disposed, true);
  assert.equal(store.disposed, true);
  assert.equal(adapter.disposed, true);
});

test("common gameplay client Feature setup rollback disposes every earlier owner", async () => {
  const trigger = createTriggerAreaRuntime([]);
  const health = createHealthRuntime();
  const spawn = prefabRuntime();
  const flow = flowRuntime();
  const store = createHudStateStore();
  const adapter = { disposed: false, render() {}, inspect() { return { disposed: this.disposed, renderCount: 0, lastRevision: null, listenerActive: false }; }, dispose() { this.disposed = true; } };
  const configuration = defineFeatureConfiguration({ defaultValue: () => ({}), parse: () => ({ ok: true, value: {} }) });
  const failure = { id: "zz-failure", description: "failure", runtimeContributions: [], requires: [], conflicts: [], configuration, setup() { throw new Error("forced"); }, dispose() {} };
  const runtime = createClientRuntime({
    frameSource: createDeterministicPresentationFrameSource(),
    features: [
      createTriggerAreaClientFeature({ runtime: trigger, readActors: () => [], publish() {} }),
      createHealthClientFeature({ runtime: health, publish() {} }),
      createSpawnPrefabClientFeature(spawn),
      createGameFlowClientFeature(flow),
      createHudFeature({ store, adapter }),
      failure,
    ],
  });
  assert.equal((await runtime.boot()).reason, "setup-failed");
  assert.equal(trigger.disposed, true);
  assert.equal(health.disposed, true);
  assert.equal(spawn.disposed, true);
  assert.equal(flow.disposed, true);
  assert.equal(store.disposed, true);
  assert.equal(adapter.disposed, true);
});
