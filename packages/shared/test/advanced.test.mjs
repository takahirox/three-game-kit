import assert from "node:assert/strict";
import test from "node:test";
import { createDebugDevToolsRuntime, createDialogueRuntime, createVehicleRuntime } from "@three-game-kit/shared/advanced";

test("Dialogue branches deterministically through localized IDs, hooks, and restorable state", () => {
  const effects = [];
  const runtime = createDialogueRuntime([{ id: "intro", startNodeId: "hello", nodes: [{ id: "hello", lineId: "dialogue.hello", choices: [{ id: "accept", targetNodeId: "done", conditionId: "has-key", effectId: "consume-key" }, { id: "leave", targetNodeId: null }] }, { id: "done", lineId: "dialogue.done", nextNodeId: null }] }], { checkCondition: (id) => id === "has-key", applyEffect: (id) => effects.push(id) });
  const start = runtime.start("intro");
  assert.deepEqual(start.choiceIds, ["accept", "leave"]);
  assert.deepEqual(runtime.choose("accept").state.lineId, "dialogue.done");
  assert.deepEqual(effects, ["consume-key"]);
  const saved = runtime.snapshot();
  assert.equal(runtime.advance().state.complete, true);
  assert.equal(runtime.restore(saved).lineId, "dialogue.done");
  runtime.dispose(); assert.equal(runtime.disposed, true);
});

test("Vehicles enforce seats, driver authority, bounded control, and replaceable integration", () => {
  const runtime = createVehicleRuntime([{ id: "kart", seats: [{ id: "driver", role: "driver" }, { id: "passenger", role: "passenger" }], acceleration: 4, braking: 8, steering: 0.5 }]);
  assert.equal(runtime.enter("kart", "hero", "driver").ok, true);
  assert.equal(runtime.enter("kart", "friend", "passenger").ok, true);
  runtime.requestControl("kart", "friend", { throttle: 1, brake: 0, steering: 0 });
  runtime.requestControl("kart", "hero", { throttle: 1, brake: 0, steering: 1 });
  assert.deepEqual(runtime.step(1, 0.5).map(({ kind, code }) => [kind, code]), [["rejected", "not-driver"], ["controlled", null]]);
  assert.deepEqual(runtime.snapshot()[0], { id: "kart", speed: 2, steering: 0.5, occupants: { driver: "hero", passenger: "friend" } });
  assert.equal(runtime.exit("hero").ok, true);
  assert.throws(() => runtime.requestControl("kart", "friend", { throttle: 0, brake: -0.1, steering: 0 }), /between 0 and 1/);
  runtime.dispose(); assert.equal(runtime.disposed, true);
});

test("Debug DevTools captures sorted JSON snapshots and gates semantic injection", () => {
  const injected = [];
  const runtime = createDebugDevToolsRuntime({ teleport: (payload) => injected.push(payload) });
  runtime.registerProvider("telemetry", () => ({ tickDuration: 0.01 }));
  runtime.registerProvider("entities", () => [{ id: "hero" }]);
  const snapshot = runtime.capture(4);
  assert.deepEqual(Object.keys(snapshot.providers), ["entities", "telemetry"]);
  assert.equal(JSON.parse(runtime.exportSnapshot(snapshot)).tick, 4);
  assert.equal(runtime.inject({ kind: "unknown", payload: null }), false);
  assert.equal(runtime.inject({ kind: "teleport", payload: { entityId: "hero" } }), true);
  assert.deepEqual(injected, [{ entityId: "hero" }]);
  runtime.dispose(); assert.equal(runtime.inspect().disposed, true);
});
