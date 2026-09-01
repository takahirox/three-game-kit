import assert from "node:assert/strict";
import test from "node:test";
import { Runtime } from "@three-game-kit/server";
import { createDebugDevToolsServerFeature, createDialogueServerFeature, createVehiclesServerFeature } from "@three-game-kit/server/advanced";
import { createDebugDevToolsRuntime, createDialogueRuntime, createVehicleRuntime } from "@three-game-kit/shared/advanced";

test("advanced server Features own authoritative dialogue, vehicles, and structured diagnostics", async () => {
  const dialogue = createDialogueRuntime([{ id: "d", startNodeId: "n", nodes: [{ id: "n", lineId: "line", nextNodeId: null }] }]); dialogue.start("d");
  const vehicles = createVehicleRuntime([{ id: "kart", seats: [{ id: "driver", role: "driver" }], acceleration: 2, braking: 2, steering: 1 }], { validateControl: (_vehicle, actor) => actor === "hero" }); vehicles.enter("kart", "hero", "driver"); vehicles.requestControl("kart", "hero", { throttle: 1, brake: 0, steering: 0 });
  const debug = createDebugDevToolsRuntime(); debug.registerProvider("vehicles", () => vehicles.snapshot()); const events = []; const snapshots = [];
  const host = new Runtime({ features: [createDialogueServerFeature(dialogue), createVehiclesServerFeature(vehicles, (value) => events.push(...value)), createDebugDevToolsServerFeature(debug, (value) => snapshots.push(value))] });
  assert.equal((await host.boot()).state, "running"); assert.deepEqual(host.stepExact(1), { ok: true, value: 1 }); assert.equal(events[0].kind, "controlled"); assert.equal(snapshots[0].providers.vehicles[0].speed, 2 / 60);
  assert.deepEqual(host.scheduleReport.filter(({ phase }) => ["gameplay", "telemetry"].includes(phase)).map(({ systemId }) => systemId), ["vehicles-server-step", "debug-devtools-server-capture"]);
  await host.shutdown(); assert.equal(dialogue.disposed, true); assert.equal(vehicles.disposed, true); assert.equal(debug.disposed, true);
});
