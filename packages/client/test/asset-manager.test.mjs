import assert from "node:assert/strict";
import test from "node:test";
import { createDeterministicPresentationFrameSource, defineFeatureConfiguration } from "@three-game-kit/core";
import { createClientRuntime } from "@three-game-kit/client";
import { createAssetManager, createAssetManagerFeature } from "@three-game-kit/client/asset-manager";

function backend() {
  const loads = [];
  const disposedAssets = [];
  let disposed = 0;
  return {
    async load(entry) {
      loads.push(entry.id);
      if (entry.id === "bad") throw new Error("fixture load failed");
      return { id: entry.id };
    },
    disposeAsset(kind, value) { disposedAssets.push([kind, value.id]); },
    dispose() { disposed += 1; },
    inspect: () => ({ loads, disposedAssets, disposed }),
  };
}

const manifest = [
  { id: "hero", kind: "gltf", source: "/hero.gltf", groups: ["boot"] },
  { id: "ground", kind: "texture", source: "/ground.png", groups: ["boot"] },
  { id: "bad", kind: "audio", source: "/bad.ogg", groups: ["optional"] },
];

test("asset manager deduplicates, caches, reports progress, preloads groups, and disposes ownership", async () => {
  const fake = backend();
  const manager = createAssetManager(manifest, fake);
  const progress = [];
  const unsubscribe = manager.subscribeProgress((value) => progress.push(value));
  const first = manager.load("hero");
  const duplicate = manager.load("hero");
  assert.equal(first, duplicate);
  assert.equal((await first).ok, true);
  assert.equal(manager.get("hero").id, "hero");
  const boot = await manager.preloadGroup("boot");
  assert.ok(boot.every((outcome) => outcome.ok));
  assert.deepEqual(fake.inspect().loads, ["hero", "ground"]);
  assert.deepEqual(manager.inspect().cachedIds, ["hero", "ground"]);
  assert.equal(manager.inspect().progress.completed, 2);
  assert.ok(progress.length >= 4);
  unsubscribe();

  const failed = await manager.load("bad");
  assert.equal(failed.failure.code, "load-failed");
  assert.equal((await manager.load("missing")).failure.code, "unknown-asset");
  manager.dispose();
  manager.dispose();
  assert.deepEqual(fake.inspect().disposedAssets, [["gltf", "hero"], ["texture", "ground"]]);
  assert.equal(fake.inspect().disposed, 1);
  assert.equal((await manager.load("hero")).failure.code, "disposed-resource");
});

test("dispose during an in-flight load releases the unpublished value", async () => {
  let resolve;
  const disposedAssets = [];
  const manager = createAssetManager([{ id: "late", kind: "gltf", source: "/late.gltf" }], {
    load: () => new Promise((done) => { resolve = done; }),
    disposeAsset: (kind, value) => disposedAssets.push([kind, value.id]),
    dispose() {},
  });
  const pending = manager.load("late");
  await Promise.resolve();
  manager.dispose();
  resolve({ id: "late" });
  assert.equal((await pending).failure.code, "disposed-resource");
  assert.deepEqual(disposedAssets, [["gltf", "late"]]);
});

test("Asset Manager Feature owns manager through rollback", async () => {
  const fake = backend();
  const manager = createAssetManager(manifest, fake);
  const configuration = defineFeatureConfiguration({ defaultValue: () => ({}), parse: () => ({ ok: true, value: {} }) });
  const failing = { id: "later-failure", description: "failure", runtimeContributions: [], requires: [], conflicts: [], configuration, setup() { throw new Error("fail"); }, dispose() {} };
  const runtime = createClientRuntime({
    features: [createAssetManagerFeature(manager), failing],
    frameSource: createDeterministicPresentationFrameSource(),
  });
  assert.equal((await runtime.boot()).reason, "setup-failed");
  assert.equal(manager.disposed, true);
  assert.equal(fake.inspect().disposed, 1);
});

test("asset manifests reject duplicate IDs and malformed groups", () => {
  const fake = backend();
  assert.throws(() => createAssetManager([manifest[0], manifest[0]], fake), /Duplicate/);
  assert.throws(() => createAssetManager([{ ...manifest[0], groups: [""] }], fake), /group ID/);
});

test("synchronous backend throws are returned as structured failures", async () => {
  const manager = createAssetManager([{ id: "sync", kind: "gltf", source: "/sync.gltf" }], {
    load() { throw new Error("synchronous fixture failure"); },
    disposeAsset() {},
    dispose() {},
  });
  const outcome = await manager.load("sync");
  assert.equal(outcome.failure.code, "load-failed");
  assert.match(outcome.failure.message, /synchronous fixture failure/);
  manager.dispose();
});

test("progress callback failures cannot reject loads", async () => {
  const manager = createAssetManager([{ id: "safe", kind: "gltf", source: "/safe.gltf" }], backend());
  let calls = 0;
  manager.subscribeProgress(() => {
    calls += 1;
    if (calls > 1) throw new Error("observer failure");
  });
  assert.equal((await manager.load("safe")).ok, true);
  assert.ok(calls >= 3);
  manager.dispose();
});

test("asset disposal attempts every resource and backend before reporting the first failure", async () => {
  const attempts = [];
  const manager = createAssetManager([
    { id: "one", kind: "gltf", source: "/one.gltf", groups: ["all"] },
    { id: "two", kind: "texture", source: "/two.png", groups: ["all"] },
  ], {
    async load(entry) { return { id: entry.id }; },
    disposeAsset(kind, value) {
      attempts.push(`${kind}:${value.id}`);
      throw new Error(`dispose ${value.id}`);
    },
    dispose() { attempts.push("backend"); throw new Error("dispose backend"); },
  });
  assert.ok((await manager.preloadGroup("all")).every((outcome) => outcome.ok));
  assert.throws(() => manager.dispose(), /dispose one/);
  assert.deepEqual(attempts, ["gltf:one", "texture:two", "backend"]);
  assert.equal(manager.disposed, true);
  manager.dispose();
});
