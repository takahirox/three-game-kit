import assert from "node:assert/strict";
import test from "node:test";
import { createAbilityRuntime, createGeneralPhysicsRuntime, createInMemorySaveAdapter, createInventoryRuntime, createProjectileRuntime, createSaveLoadRuntime, createSimpleAiRuntime } from "@three-game-kit/shared/genre";

test("General Physics is deterministic, queryable, layer-aware, and disposable", () => {
  const runtime = createGeneralPhysicsRuntime({ gravity: { x: 0, y: 0, z: 0 } });
  runtime.addBody({ id: "wall", kind: "static", position: { x: 2, y: 0, z: 0 }, halfExtents: { x: 0.5, y: 1, z: 1 }, layer: 2 });
  runtime.addBody({ id: "hero", kind: "dynamic", position: { x: 0, y: 0, z: 0 }, halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, velocity: { x: 1, y: 0, z: 0 }, mask: 2 });
  assert.deepEqual(runtime.step(1, 1).map(({ kind }) => kind), ["enter"]);
  assert.equal(runtime.inspect().bodies.find(({ id }) => id === "hero").position.x, 0);
  assert.equal(runtime.raycast({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 5, 2).bodyId, "wall");
  assert.deepEqual(runtime.overlapBox({ x: 2, y: 0, z: 0 }, { x: 0.1, y: 0.1, z: 0.1 }, 2), ["wall"]);
  runtime.dispose(); assert.throws(() => runtime.step(2, 1), /disposed/);
});

test("Projectile reports deterministic movement, hits, expiry, and cleanup", () => {
  const runtime = createProjectileRuntime([{ id: "bolt", speed: 2, lifetimeTicks: 2 }], (_state, next) => next.x >= 2 ? "target" : null);
  assert.equal(runtime.fire("bolt", "hero", { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0).id, "bolt:1");
  assert.deepEqual(runtime.step(1, 0.5).map(({ kind }) => kind), ["moved"]);
  assert.deepEqual(runtime.step(2, 0.5).map(({ kind }) => kind), ["expired"]);
  runtime.fire("bolt", "hero", { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 3, "hit");
  assert.deepEqual(runtime.step(4, 0.5).map(({ kind, targetId }) => [kind, targetId]), [["hit", "target"]]);
  runtime.dispose(); assert.equal(runtime.inspect().disposed, true);
});

test("Inventory enforces capacity and atomic transfer", () => {
  const runtime = createInventoryRuntime([{ id: "potion", maximumStack: 3 }, { id: "key", maximumStack: 1 }]);
  runtime.createContainer("bag", 1); runtime.createContainer("chest", 1);
  assert.deepEqual(runtime.add("bag", "potion", 3), { ok: true, changed: 3 });
  assert.deepEqual(runtime.add("bag", "potion", 1), { ok: false, code: "capacity-exceeded" });
  assert.deepEqual(runtime.transfer("bag", "chest", "potion", 2), { ok: true, changed: 2 });
  assert.deepEqual(runtime.snapshot(), { bag: [{ itemId: "potion", count: 1 }], chest: [{ itemId: "potion", count: 2 }] });
  runtime.createContainer("multi", 2); assert.deepEqual(runtime.add("multi", "potion", 6), { ok: true, changed: 6 });
  assert.deepEqual(runtime.add("multi", "key", 1), { ok: false, code: "capacity-exceeded" });
  runtime.dispose(); assert.deepEqual(runtime.snapshot(), {}); assert.equal(runtime.disposed, true);
});

test("Ability Skill applies cost, casting, cooldown, and rejection", () => {
  let cost = 1;
  const runtime = createAbilityRuntime([{ id: "dash", cooldownTicks: 2, castTicks: 1 }], { validateCost: () => cost > 0, consumeCost: () => { cost -= 1; } });
  runtime.request("hero", "dash", 1); assert.deepEqual(runtime.step(1).map(({ kind }) => kind), ["started"]); assert.deepEqual(runtime.step(2).map(({ kind }) => kind), ["completed"]);
  runtime.request("hero", "dash", 2); assert.deepEqual(runtime.step(2).map(({ code }) => code), ["cooldown"]);
  runtime.request("other", "dash", 3); assert.deepEqual(runtime.step(3).map(({ code }) => code), ["cost-rejected"]);
  runtime.dispose(); assert.equal(runtime.disposed, true);
});

test("Simple AI Navigation uses replaceable policy hooks and deterministic waypoints", () => {
  const runtime = createSimpleAiRuntime({ selectBehavior: () => "patrol", selectTarget: () => "hero" });
  runtime.register("guard", { x: 0, y: 0, z: 0 }, 2); runtime.setWaypoints("guard", [{ x: 2, y: 0, z: 0 }]);
  assert.deepEqual(runtime.step(1, 0.5)[0], { id: "guard", behavior: "patrol", position: { x: 1, y: 0, z: 0 }, targetId: "hero", waypointCount: 1 });
  runtime.dispose(); assert.equal(runtime.disposed, true);
});

test("Save Load supports versions, migration, validation, removal, and disposal", async () => {
  const adapter = createInMemorySaveAdapter(); await adapter.write("old", { schemaVersion: 1, data: { score: 2 } });
  let state = { score: 4, migrated: true };
  const runtime = createSaveLoadRuntime({ currentVersion: 2, capture: () => state, restore: (data) => { state = data; }, validate: (data) => typeof data === "object" && data !== null && "score" in data, migrations: { 1: (data) => ({ ...data, migrated: true }) }, adapter });
  assert.equal((await runtime.save("current")).ok, true); state = { score: 0, migrated: false };
  assert.equal((await runtime.load("old")).ok, true); assert.deepEqual(state, { score: 2, migrated: true });
  assert.equal(await runtime.remove("current"), true); assert.deepEqual(await runtime.load("missing"), { ok: false, code: "not-found" });
  await runtime.dispose(); assert.equal(adapter.inspect().disposed, true);
});
