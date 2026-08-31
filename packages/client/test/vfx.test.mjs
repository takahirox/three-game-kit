import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createDeterministicPresentationFrameSource } from "@three-game-kit/core";
import { createClientRuntime } from "@three-game-kit/client";
import { createVfxFeature, createVfxRuntime } from "../dist/vfx.js";
const burst = Object.freeze({ kind: "burst", position: Object.freeze({ x: 1, y: 2, z: 3 }), count: 4, color: 0x12abef, speed: 2, lifetimeMs: 500, seed: 4294967295 });
const trail = Object.freeze({ kind: "trail", start: Object.freeze({ x: 0, y: 0, z: 0 }), end: Object.freeze({ x: 1, y: 2, z: 3 }), color: 0xabcdef, width: 2, lifetimeMs: 300, seed: 7 });
const popup = Object.freeze({ kind: "popup", position: Object.freeze({ x: 2, y: 3, z: 4 }), color: 0xff00ff, size: 0.5, lifetimeMs: 200, seed: 9 });
function renderedBurst(seed) { const scene = new THREE.Scene(); const runtime = createVfxRuntime(scene); runtime.enqueue({ ...burst, seed }); runtime.present(10); runtime.present(110); const points = scene.getObjectByProperty("isPoints", true); assert.ok(points); const values = Array.from(points.geometry.getAttribute("position").array.slice(0, burst.count * 3)); runtime.dispose(); return values; }
test("burst output is deterministic from explicit unsigned seeds", () => { assert.deepEqual(renderedBurst(42), renderedBurst(42)); assert.notDeepEqual(renderedBurst(42), renderedBurst(43)); });
test("burst, trail, and popup commands are copied, validated, and advanced by monotonic presentation time", () => { const scene = new THREE.Scene(); const runtime = createVfxRuntime(scene); const mutablePosition = { x: 1, y: 2, z: 3 }; runtime.enqueue({ ...burst, position: mutablePosition }); runtime.enqueue(trail); runtime.enqueue(popup); mutablePosition.x = 99; runtime.present(100); assert.deepEqual(runtime.inspect(), { disposed: false, presentationTimeMs: 100, queuedCommandCount: 0, activeBurstCount: 1, activeTrailCount: 1, activePopupCount: 1, counters: { submittedCommandCount: 3, presentedCommandCount: 3, commandOverflowCount: 0, effectOverflowCount: 0, expiredEffectCount: 0 }, liveResourceCounts: { groups: 1, objects: 32, geometries: 24, materials: 32, retainedReferences: 89 } }); const points = scene.getObjectByProperty("isPoints", true); assert.ok(points); assert.equal(points.geometry.getAttribute("position").getX(0), 1); assert.throws(() => runtime.present(99), /monotonic/); assert.throws(() => runtime.present(Number.NaN), /presentation time/); runtime.present(600); assert.equal(runtime.inspect().activeBurstCount, 0); assert.equal(runtime.inspect().activeTrailCount, 0); assert.equal(runtime.inspect().activePopupCount, 0); assert.equal(runtime.inspect().counters.expiredEffectCount, 3); runtime.dispose(); });
test("commands reject malformed vectors, colors, counts, dimensions, lifetimes, seeds, and extra fields", () => { const runtime = createVfxRuntime(new THREE.Scene(), { maxBurstParticles: 4 }); for (const command of [{ ...burst, position: { x: 0, y: 0 } }, { ...burst, color: 16777216 }, { ...burst, count: 5 }, { ...burst, speed: 0 }, { ...burst, lifetimeMs: Infinity }, { ...burst, seed: -1 }, { ...trail, width: Number.NaN }, { ...popup, size: -1 }, { ...popup, extra: true }, { kind: "unknown" }])
    assert.throws(() => runtime.enqueue(command), TypeError); runtime.dispose(); });
test("command and effect pools use deterministic drop-oldest and ring overflow", () => { const runtime = createVfxRuntime(new THREE.Scene(), { commandCapacity: 2, burstEffectCapacity: 1, trailEffectCapacity: 1, popupEffectCapacity: 1, maxBurstParticles: 4 }); runtime.enqueue({ ...burst, color: 1 }); runtime.enqueue({ ...burst, color: 2 }); runtime.enqueue({ ...burst, color: 3 }); assert.equal(runtime.inspect().counters.commandOverflowCount, 1); runtime.present(0); const inspection = runtime.inspect(); assert.equal(inspection.activeBurstCount, 1); assert.equal(inspection.counters.presentedCommandCount, 2); assert.equal(inspection.counters.effectOverflowCount, 1); runtime.dispose(); });
test("all owned Three.js resources are completely and idempotently disposed", () => { const scene = new THREE.Scene(); const runtime = createVfxRuntime(scene, { burstEffectCapacity: 2, trailEffectCapacity: 2, popupEffectCapacity: 2 }); const root = scene.children[0]; assert.ok(root); const geometries = new Set(); const materials = new Set(); root.traverse((object) => { if (object.geometry && object.isSprite !== true)
    geometries.add(object.geometry); if (object.material)
    materials.add(object.material); }); let disposeEvents = 0; for (const resource of [...geometries, ...materials])
    resource.addEventListener("dispose", () => { disposeEvents += 1; }); runtime.enqueue(burst); runtime.enqueue(trail); runtime.enqueue(popup); runtime.present(0); runtime.dispose(); runtime.dispose(); assert.equal(disposeEvents, geometries.size + materials.size); assert.equal(scene.children.includes(root), false); assert.deepEqual(runtime.inspect().liveResourceCounts, { groups: 0, objects: 0, geometries: 0, materials: 0, retainedReferences: 0 }); assert.throws(() => runtime.enqueue(burst), /disposed/); assert.throws(() => runtime.present(1), /disposed/); });

test("VFX Feature presents and releases its owned runtime", async () => {
    const frameSource = createDeterministicPresentationFrameSource();
    const runtime = createVfxRuntime(new THREE.Scene());
    runtime.enqueue(burst);
    const feature = createVfxFeature({ runtime });
    const client = createClientRuntime({ features: [feature], frameSource });

    assert.equal((await client.boot()).state, "running");
    assert.deepEqual(
        feature.runtimeContributions.map(({ id, domain, phase, priority }) => ({
            id,
            domain,
            phase,
            priority,
        })),
        [{
            id: "vfx-present",
            domain: "client-presentation",
            phase: "render",
            priority: -100,
        }],
    );
    assert.deepEqual(client.startPresentation(), { ok: true, value: true });
    assert.equal(frameSource.deliver(25), true);
    assert.equal(runtime.inspect().presentationTimeMs, 25);
    assert.equal(runtime.inspect().activeBurstCount, 1);

    await client.shutdown();
    assert.equal(runtime.inspect().disposed, true);
    assert.deepEqual(runtime.inspect().liveResourceCounts, {
        groups: 0,
        objects: 0,
        geometries: 0,
        materials: 0,
        retainedReferences: 0,
    });
});
