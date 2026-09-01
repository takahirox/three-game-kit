import assert from "node:assert/strict";
import test from "node:test";
import {
  createGameFlowRuntime,
  createHealthRuntime,
  createHudStateStore,
  createSpawnPrefabRuntime,
  createTriggerAreaRuntime,
} from "@three-game-kit/shared/gameplay";

test("Trigger Area emits deterministic enter, stay, and exit events with layer filtering", () => {
  const runtime = createTriggerAreaRuntime([
    { id: "sphere", shape: "sphere", center: { x: 0, y: 0, z: 0 }, radius: 2, layers: ["player"] },
    { id: "box", shape: "box", center: { x: 5, y: 0, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 } },
  ]);
  const actors = [
    { id: "z", position: { x: 0, y: 0, z: 0 }, layers: ["npc"] },
    { id: "a", position: { x: 1, y: 0, z: 0 }, layers: ["player"] },
  ];
  assert.deepEqual(runtime.step(1, actors), [{ kind: "enter", areaId: "sphere", actorId: "a", tick: 1 }]);
  assert.deepEqual(runtime.step(2, actors), [{ kind: "stay", areaId: "sphere", actorId: "a", tick: 2 }]);
  assert.deepEqual(runtime.step(3, [{ id: "a", position: { x: 5, y: 0, z: 0 } }]), [
    { kind: "enter", areaId: "box", actorId: "a", tick: 3 },
    { kind: "exit", areaId: "sphere", actorId: "a", tick: 3 },
  ]);
  assert.deepEqual(runtime.inspect().activePairs, [{ areaId: "box", actorId: "a" }]);
  runtime.dispose();
  runtime.dispose();
  assert.throws(() => runtime.step(4, []), /disposed/);
  assert.throws(() => createTriggerAreaRuntime([{ id: "bad", shape: "sphere", center: { x: 0, y: 0, z: 0 }, radius: 0 }]), /positive/);
});

test("Health applies bounded queued damage, healing, death, reset, and invulnerability", () => {
  const health = createHealthRuntime();
  health.register("hero", 100);
  health.requestDamage("hero", 30, { sourceId: "trap", invulnerabilityTicks: 2 });
  assert.deepEqual(health.step(5).map(({ kind, after }) => ({ kind, after })), [{ kind: "damaged", after: 70 }]);
  health.requestDamage("hero", 50);
  assert.deepEqual(health.step(6), []);
  health.requestHealing("hero", 100, "potion");
  assert.equal(health.step(7)[0].appliedAmount, 30);
  health.requestDamage("hero", 500, { sourceId: "boss" });
  assert.deepEqual(health.step(8).map(({ kind }) => kind), ["damaged", "died"]);
  health.requestHealing("hero", 10);
  assert.deepEqual(health.step(9), []);
  assert.deepEqual(health.reset("hero", 40), { id: "hero", current: 40, maximum: 100, dead: false, invulnerableUntilTick: 0 });
  assert.equal(health.inspect().ignoredRequestCount, 2);
  health.dispose();
  assert.throws(() => health.register("other", 1), /disposed/);
});

test("Spawn Prefab preserves caller IDs, immutable data, pooling, and ownership on adapter failure", () => {
  let nextHandle = 1;
  let failReuse = false;
  const operations = [];
  const adapter = {
    create(instance) { const handle = { value: nextHandle++ }; operations.push(["create", instance.id, handle.value]); return handle; },
    reuse(handle, instance) { operations.push(["reuse", instance.id, handle.value]); if (failReuse) throw new Error("reuse failed"); },
    release(handle, mode) { operations.push(["release", mode, handle.value]); },
  };
  const runtime = createSpawnPrefabRuntime([
    { id: "enemy", components: { health: 10, tags: ["flying"] }, resources: { mesh: "bat.glb" }, pooling: true },
    { id: "coin", pooling: false },
  ], adapter);
  const first = runtime.spawn("enemy", "boss");
  assert.equal(Object.isFrozen(first.components.tags), true);
  assert.equal(runtime.despawn("boss"), true);
  const reused = runtime.spawn("enemy");
  assert.equal(reused.reused, true);
  assert.equal(reused.id, "enemy:1");
  runtime.despawn(reused.id);
  failReuse = true;
  assert.throws(() => runtime.spawn("enemy"), /reuse failed/);
  assert.deepEqual(runtime.inspect().pooledCounts, { enemy: 1 });
  failReuse = false;
  runtime.spawn("coin");
  runtime.dispose();
  assert.equal(runtime.inspect().activeInstances.length, 0);
  assert.ok(operations.some(([operation, mode]) => operation === "release" && mode === "destroy"));
  assert.throws(() => createSpawnPrefabRuntime([{ id: "bad", components: { date: new Date() } }], adapter), /plain/);
});

test("Game Flow enforces transitions, bounds telemetry, rolls back failed hooks, and disposes", () => {
  const hooks = [];
  let failPlay = false;
  const flow = createGameFlowRuntime({
    states: [
      { id: "boot", allowedTo: ["menu"] },
      { id: "menu", allowedTo: ["play"] },
      { id: "play", allowedTo: ["menu"] },
    ],
    initialState: "boot",
    traceCapacity: 2,
    onEnter(state, from) { hooks.push(["enter", state, from]); if (state === "play" && failPlay) throw new Error("failed"); },
    onExit(state, to) { hooks.push(["exit", state, to]); },
  });
  assert.equal(flow.transition("play").failure.failureCode, "transition-not-allowed");
  assert.equal(flow.transition("menu", { reason: "loaded", tick: 1 }).ok, true);
  failPlay = true;
  assert.equal(flow.transition("play").failure.failureCode, "hook-failed");
  assert.equal(flow.state, "menu");
  assert.equal(flow.inspect().transitions.length, 2);
  assert.ok(hooks.some((entry) => entry[0] === "enter" && entry[1] === "menu" && entry[2] === "play"));
  assert.ok(hooks.some((entry) => entry[0] === "exit" && entry[1] === "play" && entry[2] === "menu"));
  flow.dispose();
  assert.deepEqual(flow.inspect().transitions, []);
  assert.throws(() => flow.transition("play"), /disposed/);
});

test("HUD store publishes immutable snapshots and safely cleans subscriptions", () => {
  const store = createHudStateStore({ screen: "menu", health: 10, maximumHealth: 10, extras: { wave: 1 } });
  const revisions = [];
  const unsubscribe = store.subscribe((state) => revisions.push(state.revision));
  const next = store.update({ screen: "play", score: 25, extras: { wave: 2 } });
  assert.deepEqual(revisions, [0, 1]);
  assert.equal(next.score, 25);
  assert.equal(Object.isFrozen(next.extras), true);
  unsubscribe();
  store.update({ paused: true });
  assert.deepEqual(revisions, [0, 1]);
  assert.throws(() => store.subscribe(() => { throw new Error("initial listener"); }), /initial listener/);
  store.dispose();
  assert.throws(() => store.update({ score: 1 }), /disposed/);
});
