import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createDeterministicPresentationFrameSource, defineFeatureConfiguration } from "@three-game-kit/core";
import { createClientRuntime } from "@three-game-kit/client";
import { createAnimationFeature, createThreeAnimationRuntime } from "@three-game-kit/client/animation";

function fixture() {
  const root = new THREE.Object3D();
  const clips = [
    { id: "idle", clip: new THREE.AnimationClip("idle", 1, []) },
    { id: "run", clip: new THREE.AnimationClip("run", 0.5, []) },
    { id: "jump", clip: new THREE.AnimationClip("jump", 0.1, []) },
  ];
  return { root, clips };
}

test("animation runtime supports states, crossfades, one-shots, rates, completion, and cleanup", () => {
  const { root, clips } = fixture();
  const runtime = createThreeAnimationRuntime({
    root,
    clips,
    states: { idle: "idle", running: "run" },
    initialState: "idle",
  });
  assert.equal(runtime.inspect().activeState, "idle");
  runtime.setState("running");
  assert.equal(runtime.inspect().activeClipId, "run");
  runtime.play("idle", { loop: true, crossFadeSeconds: 0, playbackRate: 1.5 });
  const completed = [];
  const unsubscribe = runtime.onComplete((clipId) => completed.push(clipId));
  runtime.playOneShot("jump", { crossFadeSeconds: 0, clampWhenFinished: true });
  runtime.update(0.2);
  assert.deepEqual(completed, ["jump"]);
  assert.equal(runtime.inspect().completedOneShotCount, 1);
  unsubscribe();
  runtime.dispose();
  runtime.dispose();
  assert.equal(runtime.inspect().disposed, true);
  assert.deepEqual(runtime.inspect().registeredClipIds, []);
  assert.throws(() => runtime.update(0.1), /disposed/);
});

test("Animation Feature advances fixed ticks and owns runtime on shutdown", async () => {
  const { root, clips } = fixture();
  const animation = createThreeAnimationRuntime({ root, clips, states: { idle: "idle", running: "run" } });
  let state = "idle";
  const feature = createAnimationFeature({ runtime: animation, readState: () => state });
  const runtime = createClientRuntime({ features: [feature], frameSource: createDeterministicPresentationFrameSource() });
  assert.equal((await runtime.boot()).state, "running");
  assert.deepEqual(runtime.stepExact(2), { ok: true, value: 2 });
  animation.playOneShot("jump", { crossFadeSeconds: 0 });
  assert.deepEqual(runtime.stepExact(3), { ok: true, value: 5 });
  assert.equal(animation.inspect().activeOneShotClipId, "jump");
  assert.equal(animation.inspect().activeClipId, "jump");
  assert.deepEqual(runtime.stepExact(4), { ok: true, value: 9 });
  assert.equal(animation.inspect().activeOneShotClipId, null);
  assert.equal(animation.inspect().activeClipId, "idle");
  state = "running";
  assert.deepEqual(runtime.stepExact(1), { ok: true, value: 10 });
  assert.equal(animation.inspect().activeState, "running");
  assert.ok(Math.abs(animation.inspect().elapsedSeconds - 10 / 60) < 1e-12);
  await runtime.shutdown();
  assert.equal(animation.disposed, true);
});

test("Animation Feature is disposed when a later Feature setup fails", async () => {
  const { root, clips } = fixture();
  const animation = createThreeAnimationRuntime({ root, clips, states: { idle: "idle" } });
  const configuration = defineFeatureConfiguration({ defaultValue: () => ({}), parse: () => ({ ok: true, value: {} }) });
  const failing = { id: "later-failure", description: "failure", runtimeContributions: [], requires: [], conflicts: [], configuration, setup() { throw new Error("fail"); }, dispose() {} };
  const runtime = createClientRuntime({
    features: [createAnimationFeature({ runtime: animation, readState: () => "idle" }), failing],
    frameSource: createDeterministicPresentationFrameSource(),
  });
  assert.equal((await runtime.boot()).reason, "setup-failed");
  assert.equal(animation.disposed, true);
});

test("animation registration and playback reject invalid definitions", () => {
  const { root, clips } = fixture();
  assert.throws(() => createThreeAnimationRuntime({ root, clips: [clips[0], clips[0]] }), /Duplicate/);
  assert.throws(() => createThreeAnimationRuntime({ root, clips, states: { idle: "idle" }, initialState: "missing" }), /Unknown initial/);
  const runtime = createThreeAnimationRuntime({ root, clips, states: { idle: "idle" } });
  assert.throws(() => runtime.setState("missing"), /Unknown animation state/);
  assert.throws(() => runtime.play("missing"), /Unknown animation clip/);
  assert.throws(() => runtime.update(-1), /\[0, 1\]/);
  runtime.dispose();
});
