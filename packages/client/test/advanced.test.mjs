import assert from "node:assert/strict";
import test from "node:test";
import { createDeterministicPresentationFrameSource } from "@three-game-kit/core";
import { createClientRuntime } from "@three-game-kit/client";
import { createCameraEffectsRuntime, createCameraExtensionsFeature, createDebugDevToolsClientFeature, createDialogueClientFeature, createInputExperienceFeature, createInputExperienceRuntime, createPostProcessingFeature, createPostProcessingRuntime, createVehiclesClientFeature } from "@three-game-kit/client/advanced";
import { createDebugDevToolsRuntime, createDialogueRuntime, createVehicleRuntime } from "@three-game-kit/shared/advanced";

test("Post-processing owns ordered passes, resize, enable state, render, and complete cleanup", () => {
  const calls = [];
  const adapter = { addPass: (_handle, order) => calls.push(`add:${order}`), removePass: (handle) => calls.push(`remove:${handle}`), setPassEnabled: (handle, enabled) => calls.push(`enabled:${handle}:${enabled}`), resize: (w, h, ratio) => calls.push(`resize:${w}:${h}:${ratio}`), render: () => calls.push("render"), dispose: () => calls.push("dispose") };
  const runtime = createPostProcessingRuntime(adapter);
  runtime.register({ id: "bloom", order: 20, handle: "bloom" }); runtime.register({ id: "color", order: 10, handle: "color", enabled: false });
  runtime.setEnabled("color", true); runtime.resize(800, 600, 2); runtime.render();
  assert.deepEqual(runtime.inspect(), { disposed: false, renderCount: 1, passIds: ["color", "bloom"], enabledPassIds: ["color", "bloom"] });
  runtime.dispose(); assert.deepEqual(calls.slice(-3), ["remove:color", "remove:bloom", "dispose"]);
});

test("Camera extensions provide variants, zoom limits, blends, deterministic shake, and occlusion", () => {
  const runtime = createCameraEffectsRuntime({ kind: "first-person", eyeHeight: 1.6, lookDistance: 5 }, { minimumZoom: 0.5, maximumZoom: 2 });
  assert.equal(runtime.update({ x: 0, y: 0, z: 0 }, 0).lookAt.z, -5);
  runtime.setZoom(5); runtime.transitionTo({ kind: "orbit", distance: 4, height: 2, yaw: 0 }, 10, 0);
  const middle = runtime.update({ x: 0, y: 0, z: 0 }, 5, (_target, desired) => ({ ...desired, z: Math.min(1, desired.z) }));
  assert.equal(middle.zoom, 2); assert.equal(middle.position.z, 1);
  runtime.shake(0.1, 2, 7, 5); assert.notDeepEqual(runtime.update({ x: 0, y: 0, z: 0 }, 5).position, middle.position);
  runtime.dispose(); assert.equal(runtime.disposed, true);
});

test("Input extensions support contexts, rebinding, gamepad, touch, dead zones, and disconnect", () => {
  const runtime = createInputExperienceRuntime({ contexts: { gameplay: { jump: ["gamepad:A", "KeySpace"] }, ui: { confirm: ["gamepad:A"] } }, initialContext: "gameplay", deadZone: 0.2, sensitivity: 1 });
  runtime.updateGamepad("pad-1", 0.6, 0, ["A"]); assert.ok(runtime.sample().x > 0); assert.deepEqual(runtime.drainActions(), ["jump"]);
  runtime.setContext("ui"); runtime.pressPhysical("gamepad:A"); assert.deepEqual(runtime.drainActions(), ["confirm"]);
  runtime.rebind("ui", "confirm", ["touch:tap"]); runtime.updateTouch("screen", 0, 0, ["pause"]); runtime.pressPhysical("touch:tap"); assert.deepEqual(runtime.drainActions(), ["pause", "confirm"]);
  runtime.disconnectDevice("pad-1"); assert.deepEqual(runtime.sample(), { kind: "move", x: 0, z: 0 }); runtime.dispose();
});

test("all advanced client Features compose, schedule, publish, and dispose ownership", async () => {
  const dialogue = createDialogueRuntime([{ id: "d", startNodeId: "n", nodes: [{ id: "n", lineId: "line", nextNodeId: null }] }]); dialogue.start("d");
  const vehicles = createVehicleRuntime([{ id: "kart", seats: [{ id: "driver", role: "driver" }], acceleration: 1, braking: 1, steering: 1 }]); vehicles.enter("kart", "hero", "driver"); vehicles.requestControl("kart", "hero", { throttle: 1, brake: 0, steering: 0 });
  const debug = createDebugDevToolsRuntime(); debug.registerProvider("state", () => ({ ready: true }));
  const input = createInputExperienceRuntime({ contexts: { gameplay: { jump: ["KeySpace"] } }, initialContext: "gameplay" }); input.setAxis(1, 0);
  const post = createPostProcessingRuntime({ addPass() {}, removePass() {}, setPassEnabled() {}, resize() {}, render() {}, dispose() {} });
  const camera = createCameraEffectsRuntime({ kind: "fixed-follow", offset: { x: 0, y: 2, z: 4 }, lookAtHeight: 1 });
  const frames = createDeterministicPresentationFrameSource(); const events = []; const snapshots = []; const movements = []; const transforms = [];
  const host = createClientRuntime({ frameSource: frames, features: [createDialogueClientFeature(dialogue), createVehiclesClientFeature(vehicles, (value) => events.push(...value)), createDebugDevToolsClientFeature(debug, (value) => snapshots.push(value)), createInputExperienceFeature({ runtime: input, publishMovement: (value) => movements.push(value), publishAction() {} }), createCameraExtensionsFeature({ runtime: camera, readTarget: () => ({ x: 0, y: 0, z: 0 }), readTick: () => 1, publish: (value) => transforms.push(value) }), createPostProcessingFeature(post)] });
  assert.equal((await host.boot()).state, "running"); assert.deepEqual(host.stepExact(1), { ok: true, value: 1 }); assert.equal(events.length, 1); assert.equal(snapshots.length, 1); assert.equal(movements.length, 1);
  assert.deepEqual(host.startPresentation(), { ok: true, value: true }); assert.equal(frames.deliver(16), true); assert.equal(transforms.length, 1); assert.equal(post.inspect().renderCount, 1);
  await host.shutdown(); for (const owned of [dialogue, vehicles, debug, input, camera, post]) assert.equal(owned.disposed, true);
});
