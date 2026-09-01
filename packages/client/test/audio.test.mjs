import assert from "node:assert/strict";
import test from "node:test";
import { createDeterministicPresentationFrameSource, defineFeatureConfiguration } from "@three-game-kit/core";
import { createClientRuntime } from "@three-game-kit/client";
import { createAudioFeature, createAudioRuntime, createSilentAudioDriver, createWebAudioDriver } from "@three-game-kit/client/audio";

function fakeDriver() {
  const voices = [];
  let disposed = 0;
  let unlocks = 0;
  return {
    available: true,
    async unlock() { unlocks += 1; },
    play(buffer, options) {
      let stopped = false;
      const volumes = [options.volume];
      const voice = {
        get stopped() { return stopped; },
        setVolume(value) { volumes.push(value); },
        stop() { stopped = true; },
        buffer,
        options,
        volumes,
      };
      voices.push(voice);
      return voice;
    },
    dispose() { disposed += 1; },
    inspect: () => ({ voices, disposed, unlocks }),
  };
}

function failingFeature() {
  const configuration = defineFeatureConfiguration({
    defaultValue: () => Object.freeze({}),
    parse: () => ({ ok: true, value: Object.freeze({}) }),
  });
  return Object.freeze({
    id: "later-failure",
    description: "forces rollback",
    runtimeContributions: Object.freeze([]),
    requires: Object.freeze([]),
    conflicts: Object.freeze([]),
    configuration,
    setup() { throw new Error("expected setup failure"); },
    dispose() {},
  });
}

test("audio runtime provides unlock, effects, looping music, buses, mute, and idempotent cleanup", async () => {
  const driver = fakeDriver();
  const runtime = createAudioRuntime(driver);
  runtime.registerClip("click", { clip: 1 });
  runtime.registerClip("theme", { clip: 2 });
  assert.deepEqual(await runtime.unlock(), { ok: true });
  assert.equal(driver.inspect().unlocks, 1);

  const effect = runtime.playEffect("click", { volume: 0.5, position: { x: 1, y: 2, z: 3 } });
  assert.equal(effect.ok, true);
  const music = runtime.playMusic("theme", { volume: 0.8 });
  assert.equal(music.ok, true);
  assert.equal(driver.inspect().voices[1].options.loop, true);
  runtime.setBusVolume("effects", 0.4);
  assert.equal(driver.inspect().voices[0].volumes.at(-1), 0.2);
  runtime.setMuted(true);
  assert.ok(driver.inspect().voices.every((voice) => voice.volumes.at(-1) === 0));
  runtime.setMuted(false);
  assert.equal(runtime.inspect().activeVoiceCount, 2);
  runtime.stopAll("effects");
  assert.equal(runtime.inspect().activeVoiceCount, 1);
  assert.equal(runtime.play("missing").failure.code, "unknown-clip");

  runtime.dispose();
  runtime.dispose();
  assert.equal(driver.inspect().disposed, 1);
  assert.equal(runtime.inspect().registeredClipIds.length, 0);
  assert.equal(runtime.play("theme").failure.code, "disposed-resource");
});

test("silent fallback is capability-safe and Audio Feature is released on later setup rollback", async () => {
  const silent = createAudioRuntime(createSilentAudioDriver());
  silent.registerClip("safe", {});
  assert.deepEqual(await silent.unlock(), { ok: true });
  assert.equal(silent.inspect().available, false);
  assert.equal(silent.playEffect("safe").ok, true);

  const runtime = createClientRuntime({
    features: [createAudioFeature(silent), failingFeature()],
    frameSource: createDeterministicPresentationFrameSource(),
  });
  const result = await runtime.boot();
  assert.equal(result.state, "stopped");
  assert.equal(result.reason, "setup-failed");
  assert.equal(silent.disposed, true);
});

test("audio validates registrations, buses, and spatial inputs", () => {
  assert.throws(() => createWebAudioDriver({}), /context is invalid/);
  const runtime = createAudioRuntime();
  assert.throws(() => runtime.registerClip("", {}), /clip ID/);
  runtime.registerClip("clip", {});
  assert.throws(() => runtime.registerClip("clip", {}), /Duplicate/);
  assert.throws(() => runtime.setBusVolume("effects", 2), /\[0, 1\]/);
  assert.throws(() => runtime.play("clip", { position: { x: 0, y: Infinity, z: 0 } }), /position/);
  runtime.dispose();
});
