import assert from "node:assert/strict";
import test from "node:test";
import { createAbilityRuntime, createGeneralPhysicsRuntime, createHitQueryRuntime, createInMemorySaveAdapter, createInventoryRuntime, createLockOnRuntime, createProjectileRuntime, createSaveLoadRuntime, createSimpleAiRuntime } from "@three-game-kit/shared/genre";

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
  assert.deepEqual(runtime.setPosition("guard", { x: 5, y: 0, z: 0 }).position, { x: 5, y: 0, z: 0 }, "knockback and encounter resets relocate an agent without re-registering it");
  assert.deepEqual(runtime.step(2, 0.5)[0].position, { x: 4, y: 0, z: 0 });
  assert.throws(() => runtime.setPosition("missing", { x: 0, y: 0, z: 0 }), /Unknown AI agent/);
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

test("Hit Query resolves arc, sphere, and capsule volumes deterministically with filters and limits", () => {
  const runtime = createHitQueryRuntime();
  const candidates = [
    { id: "front", position: { x: 0, y: 0, z: 2 } },
    { id: "front-far", position: { x: 0, y: 0, z: 5 } },
    { id: "side", position: { x: 2, y: 0, z: 0 }, radius: 0.5 },
    { id: "behind", position: { x: 0, y: 0, z: -2 } },
    { id: "above", position: { x: 0, y: 6, z: 1 } },
    { id: "edge", position: { x: 1.3, y: 0, z: 1.3 } },
  ];
  const arc = runtime.query({ kind: "arc", origin: { x: 0, y: 0, z: 0 }, yaw: 0, radius: 3, angle: Math.PI / 2 }, candidates);
  assert.deepEqual(arc.map(({ id }) => id), ["edge", "front"], "arc hits are ordered by distance then id and exclude far, behind, side, and vertical outliers");
  assert.ok(Math.abs(arc[0].direction.x - Math.SQRT1_2) < 1e-12 && arc[0].direction.y === 0 && Math.abs(arc[0].direction.z - Math.SQRT1_2) < 1e-12);
  assert.deepEqual(runtime.query({ kind: "arc", origin: { x: 0, y: 0, z: 0 }, yaw: Math.PI / 2, radius: 3, angle: 0.2 }, candidates).map(({ id }) => id), ["side"], "candidate radius widens the angular reach");
  assert.deepEqual(runtime.query({ kind: "sphere", center: { x: 0, y: 0, z: 0 }, radius: 2.1 }, candidates, { maxTargets: 2, exclude: ["front"] }).map(({ id }) => id), ["edge", "behind"]);
  assert.deepEqual(runtime.query({ kind: "capsule", start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 6 }, radius: 0.5 }, candidates).map(({ id }) => id), ["front", "front-far"]);
  assert.deepEqual(runtime.inspect(), { disposed: false, queryCount: 4, hitCount: 7, lastHitIds: ["front", "front-far"] });
  assert.throws(() => runtime.query({ kind: "arc", origin: { x: 0, y: 0, z: 0 }, yaw: 0, radius: 0, angle: 1 }, []), /positive/);
  assert.throws(() => runtime.query({ kind: "sphere", center: { x: 0, y: 0, z: 0 }, radius: 1 }, [], { maxTargets: 0 }), /positive integer/);
  runtime.dispose();
  assert.throws(() => runtime.query({ kind: "sphere", center: { x: 0, y: 0, z: 0 }, radius: 1 }, []), /disposed/);
});

test("Lock-On acquires, cycles, releases, and drops invalid or distant targets deterministically", () => {
  const runtime = createLockOnRuntime({ range: 10 });
  const origin = { x: 0, y: 0, z: 0 };
  const enemies = [
    { id: "b", position: { x: 0, y: 0, z: 4 } },
    { id: "a", position: { x: 0, y: 0, z: 4 } },
    { id: "far", position: { x: 0, y: 0, z: 30 } },
    { id: "c", position: { x: 6, y: 0, z: 0 } },
  ];
  assert.deepEqual(runtime.acquire(origin, enemies, 1), { kind: "acquired", targetId: "a", reason: null, tick: 1 });
  assert.equal(runtime.acquire(origin, enemies, 2), null, "re-acquiring the nearest target is a no-op");
  assert.deepEqual(runtime.cycle(origin, enemies, 3), { kind: "cycled", targetId: "b", reason: null, tick: 3 });
  assert.deepEqual(runtime.cycle(origin, enemies, 4), { kind: "cycled", targetId: "c", reason: null, tick: 4 });
  assert.deepEqual(runtime.cycle(origin, enemies, 5), { kind: "cycled", targetId: "a", reason: null, tick: 5 }, "cycling wraps within range and never reaches the distant candidate");
  assert.deepEqual(runtime.step(6, origin, enemies), []);
  assert.deepEqual(runtime.step(7, origin, enemies.filter(({ id }) => id !== "a")), [{ kind: "released", targetId: "a", reason: "invalid", tick: 7 }]);
  assert.equal(runtime.targetId, null);
  assert.equal(runtime.cycle(origin, [], 8), null, "cycling with nothing in range acquires nothing");
  assert.deepEqual(runtime.acquire(origin, enemies, 9), { kind: "acquired", targetId: "a", reason: null, tick: 9 });
  assert.deepEqual(runtime.step(10, { x: 0, y: 0, z: -9 }, enemies), [{ kind: "released", targetId: "a", reason: "out-of-range", tick: 10 }], "release uses the hysteresis range");
  assert.deepEqual(runtime.acquire(origin, enemies, 11), { kind: "acquired", targetId: "a", reason: null, tick: 11 });
  assert.deepEqual(runtime.release(12), { kind: "released", targetId: "a", reason: "manual", tick: 12 });
  assert.equal(runtime.release(13), null);
  assert.deepEqual(runtime.inspect(), { disposed: false, targetId: null, lockedTick: null, acquireCount: 6, releaseCount: 3, range: 10, releaseRange: 12.5 });
  assert.throws(() => createLockOnRuntime({ range: 10, releaseRange: 5 }), /at least range/);
  runtime.dispose();
  assert.throws(() => runtime.acquire(origin, enemies, 14), /disposed/);
});
