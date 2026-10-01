import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createDeterministicPresentationFrameSource, defineFeatureConfiguration } from "@three-game-kit/core";
import { createClientRuntime } from "@three-game-kit/client";
import { createAnimationCharacterSet, createAnimationFeature, createThreeAnimationRuntime } from "@three-game-kit/client/animation";

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

test("animation runtime emits clip events, exposes clip time, and cancels or interrupts one-shots deterministically", () => {
  const { root, clips } = fixture();
  const runtime = createThreeAnimationRuntime({
    root,
    clips,
    states: { idle: "idle", dead: { clip: "run", loop: false, clampWhenFinished: true } },
    initialState: "idle",
    events: [
      { clipId: "run", id: "hit-window", seconds: 0.25 },
      { clipId: "run", id: "start", seconds: 0 },
      { clipId: "idle", id: "footstep", seconds: 0.5 },
    ],
  });
  const events = [];
  runtime.onEvent((event) => events.push(`${event.clipId}:${event.id}@${event.seconds}`));
  runtime.update(0.4);
  runtime.update(0.2);
  assert.deepEqual(events, ["idle:footstep@0.5"]);
  runtime.update(0.9);
  assert.deepEqual(events, ["idle:footstep@0.5", "idle:footstep@0.5"], "looping clips re-fire events after wrapping past them");
  assert.deepEqual(runtime.inspect().registeredEventIds, ["run:hit-window", "run:start", "idle:footstep"]);
  assert.ok(Math.abs(runtime.inspect().activeClipSeconds - 0.5) < 1e-9);
  assert.equal(runtime.inspect().activeClipDuration, 1);

  events.length = 0;
  runtime.playOneShot("run", { crossFadeSeconds: 0, playbackRate: 2 });
  assert.equal(runtime.inspect().activePlaybackRate, 2);
  runtime.update(0.15);
  assert.deepEqual(events, ["run:start@0", "run:hit-window@0.25"], "a rate of 2 crosses 0.25 clip seconds in 0.15 wall seconds");
  assert.equal(runtime.cancelOneShot(), true, "cancelling returns to the state clip");
  assert.equal(runtime.cancelOneShot(), false);
  assert.equal(runtime.inspect().activeOneShotClipId, null);
  assert.equal(runtime.inspect().activeClipId, "idle");
  assert.equal(runtime.inspect().interruptedOneShotCount, 1);

  runtime.playOneShot("run", { crossFadeSeconds: 0 });
  runtime.playOneShot("jump", { crossFadeSeconds: 0 });
  assert.equal(runtime.inspect().interruptedOneShotCount, 2, "replacing an active one-shot counts as an interruption");
  runtime.update(0.2);
  assert.equal(runtime.inspect().completedOneShotCount, 1, "only the surviving one-shot completes");
  assert.equal(runtime.inspect().activeClipId, "idle");

  runtime.setPlaybackRate(0.5);
  assert.equal(runtime.inspect().activePlaybackRate, 0.5);
  runtime.setState("dead");
  runtime.update(1);
  assert.equal(runtime.inspect().activeClipId, "run");
  assert.equal(runtime.inspect().activeState, "dead", "non-looping state clips stay clamped instead of returning to another state");
  assert.equal(runtime.inspect().emittedEventCount, 6, "the clamped state clip fires its own events once");
  assert.throws(() => createThreeAnimationRuntime({ root, clips, events: [{ clipId: "idle", id: "late", seconds: 2 }] }), /within clip/);
  assert.throws(() => runtime.setPlaybackRate(0), /positive/);
  runtime.dispose();
});

test("Animation Feature advances a character set whose runtimes arrive after boot", async () => {
  const { root, clips } = fixture();
  const characters = createAnimationCharacterSet();
  const feature = createAnimationFeature({ id: "animation:characters", characters });
  assert.equal(feature.id, "animation:characters");
  const runtime = createClientRuntime({ features: [feature], frameSource: createDeterministicPresentationFrameSource() });
  assert.equal((await runtime.boot()).state, "running");
  assert.deepEqual(runtime.stepExact(1), { ok: true, value: 1 });
  let heroState = "idle";
  const hero = createThreeAnimationRuntime({ root, clips, states: { idle: "idle", running: "run" } });
  const npc = createThreeAnimationRuntime({ root: new THREE.Object3D(), clips, states: { idle: "idle" } });
  characters.add("hero", hero, () => heroState);
  characters.add("npc", npc, () => "idle");
  assert.throws(() => characters.add("hero", hero, () => "idle"), /Duplicate/);
  assert.deepEqual(runtime.stepExact(2), { ok: true, value: 3 });
  heroState = "running";
  assert.deepEqual(runtime.stepExact(1), { ok: true, value: 4 });
  assert.deepEqual(characters.inspect().characters.map(({ characterId, animation }) => [characterId, animation.activeState]), [["hero", "running"], ["npc", "idle"]]);
  assert.ok(Math.abs(hero.inspect().elapsedSeconds - 3 / 60) < 1e-12);
  assert.equal(characters.remove("npc"), true);
  assert.equal(npc.disposed, true);
  assert.equal(characters.remove("npc"), false);
  await runtime.shutdown();
  assert.equal(characters.disposed, true);
  assert.equal(hero.disposed, true);
  assert.throws(() => characters.add("late", hero, () => "idle"), /disposed/);
});
