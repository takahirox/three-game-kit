import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createParticleEmitter, createParticleFeature, defineParticleEffect, createParticleEffect, createParticleSystem } from "@three-game-kit/client/particles";
import { createClientRuntime } from "@three-game-kit/client";
import { createDeterministicPresentationFrameSource } from "@three-game-kit/core";

function setup(options = {}) {
    const scene = new THREE.Group();
    const emitter = createParticleEmitter(scene, options);
    const mesh = scene.children[0];
    const attr = name => mesh.geometry.getAttribute(name);
    const centers = () => Array.from(attr("particleCenter").array.slice(0, emitter.inspect().activeParticleCount * 3));
    return { scene, emitter, mesh, attr, centers };
}
function close(actual, expected, epsilon = 1e-5) { assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`); }

test("seeded rate and scheduled bursts have identical output across frame partitions", () => {
    const options = { capacity: 100, seed: 42, rate: 12, lifetimeMs: 3000, speed: [1, 3], bursts: [{ timeMs: 0, count: 2 }, { timeMs: 250, count: 3 }], acceleration: { x: 1, y: -9.8, z: 0 }, drag: 0.5 };
    const coarse = setup(options), fine = setup(options);
    coarse.emitter.present(100); coarse.emitter.present(1100);
    for (const time of [100, 200, 350, 500, 850, 1100]) fine.emitter.present(time);
    assert.equal(coarse.emitter.inspect().activeParticleCount, 17);
    assert.deepEqual(coarse.centers(), fine.centers());
    assert.deepEqual(coarse.emitter.inspect(), fine.emitter.inspect());
    coarse.emitter.dispose(); fine.emitter.dispose();
});

test("manual emission before the first frame, zero deltas, expiry, and monotonic time", () => {
    const { emitter, centers, mesh } = setup({ lifetimeMs: 100, speed: 0, position: { x: 1, y: 2, z: 3 } });
    assert.equal(emitter.emit(2), 2);
    emitter.present(5000); emitter.present(5000);
    assert.deepEqual(centers(), [1, 2, 3, 1, 2, 3]);
    emitter.present(5100);
    assert.equal(emitter.inspect().expiredParticleCount, 2);
    assert.equal(mesh.geometry.instanceCount, 0);
    assert.equal(mesh.visible, false);
    for (const time of [5099, NaN, Infinity, -1]) assert.throws(() => emitter.present(time), TypeError);
    assert.equal(emitter.inspect().presentationTimeMs, 5100);
    emitter.dispose();
});

test("analytic acceleration and drag, appearance curves, angular motion, and sprite frames", () => {
    const { emitter, attr } = setup({ speed: 2, shape: { kind: "cone", radius: 0, angle: 0 }, lifetimeMs: 2000,
        acceleration: { x: 2, y: 0, z: 0 }, drag: 1, size: 2, angle: 0.25, angularVelocity: 2,
        sizeOverLife: [{ time: 0, value: 0 }, { time: 0.5, value: 2 }, { time: 1, value: 1 }],
        opacityOverLife: [{ time: 0, value: 1 }, { time: 1, value: 0 }],
        colorOverLife: [{ time: 0, value: 0xff0000 }, { time: 1, value: 0x0000ff }], spriteSheet: { columns: 2, rows: 2 } });
    emitter.emit(1); emitter.present(0); emitter.present(1000);
    close(attr("particleCenter").getX(0), 2 * Math.exp(-1));
    close(attr("particleCenter").getY(0), 2 * (1 - Math.exp(-1)));
    close(attr("particleDimensions").getX(0), 4);
    close(attr("particleDimensions").getY(0), 2.25);
    assert.equal(attr("particleDimensions").getZ(0), 2);
    assert.deepEqual(Array.from(attr("particleAppearance").array.slice(0, 4)), [0.5, 0, 0.5, 0.5]);
    emitter.dispose();
});

test("shapes sample bounded volumes, surfaces, and oriented cones", () => {
    for (const shape of [{ kind: "point" }, { kind: "sphere", radius: 2 }, { kind: "sphere", radius: 2, surface: true }, { kind: "box", halfExtents: { x: 1, y: 2, z: 3 } }, { kind: "cone", radius: 2, angle: 0.2 }]) {
        const { emitter, centers } = setup({ shape, speed: 0 });
        emitter.emit(200);
        const data = centers();
        for (let i = 0; i < data.length; i += 3) {
            const [x, y, z] = data.slice(i, i + 3), length = Math.hypot(x, y, z);
            if (shape.kind === "point") assert.equal(length, 0);
            if (shape.kind === "sphere") { assert.ok(length <= 2.00001); if (shape.surface) close(length, 2); }
            if (shape.kind === "box") assert.ok(Math.abs(x) <= 1 && Math.abs(y) <= 2 && Math.abs(z) <= 3);
            if (shape.kind === "cone") { assert.equal(y, 0); assert.ok(length <= 2.00001); }
        }
        emitter.dispose();
    }
    const oriented = setup({ shape: { kind: "cone", radius: 0, angle: 0 }, rotation: { x: 0, y: 0, z: -Math.PI / 2 }, lifetimeMs: 2000 });
    oriented.emitter.emit(1); oriented.emitter.present(0); oriented.emitter.present(1000);
    close(oriented.centers()[0], 1); close(oriented.centers()[1], 0);
    oriented.emitter.dispose();
});

test("world space captures transformed birth position and velocity; local space follows its parent", () => {
    for (const simulationSpace of ["world", "local"]) {
        const { emitter, scene, mesh, centers } = setup({ simulationSpace, position: { x: 1, y: 0, z: 0 }, shape: { kind: "cone", radius: 0, angle: 0 }, lifetimeMs: 2000 });
        scene.position.x = 10; scene.rotation.z = Math.PI / 2; scene.scale.setScalar(2);
        emitter.emit(1); emitter.present(0);
        if (simulationSpace === "world") { close(centers()[0], 10); close(centers()[1], 2); }
        else assert.deepEqual(centers(), [1, 0, 0]);
        scene.position.x = 20;
        emitter.present(1000);
        if (simulationSpace === "world") { close(centers()[0], 8); close(centers()[1], 2); assert.equal(mesh.material.defines.WORLD_SPACE, 1); }
        else { assert.deepEqual(centers(), [1, 1, 0]); assert.equal(mesh.material.defines.WORLD_SPACE, undefined); }
        emitter.dispose();
    }
});

test("capacity, long hitches, stopped emission, and finite duration stay bounded", () => {
    const { emitter, mesh, attr } = setup({ capacity: 8, rate: 1e6, lifetimeMs: 1000, durationMs: 1e12 });
    const buffers = [attr("particleCenter").array, attr("particleAppearance").array, attr("particleDimensions").array];
    emitter.present(0); emitter.present(1e12);
    assert.ok(emitter.inspect().activeParticleCount <= 8);
    assert.ok(emitter.inspect().droppedParticleCount > 1e12);
    assert.equal(mesh.geometry.instanceCount, emitter.inspect().activeParticleCount);
    assert.deepEqual(buffers, [attr("particleCenter").array, attr("particleAppearance").array, attr("particleDimensions").array]);
    emitter.dispose();
    const finite = setup({ rate: 10, durationMs: 200, lifetimeMs: 1000 });
    finite.emitter.present(0); finite.emitter.present(200); assert.equal(finite.emitter.inspect().activeParticleCount, 2);
    finite.emitter.present(300); assert.equal(finite.emitter.inspect().activeParticleCount, 2);
    finite.emitter.dispose();
    const stopped = setup({ rate: 10, lifetimeMs: 200 });
    stopped.emitter.present(0); stopped.emitter.setEmitting(false); stopped.emitter.present(1000);
    assert.equal(stopped.emitter.inspect().activeParticleCount, 0);
    stopped.emitter.setEmitting(true); stopped.emitter.present(1100);
    assert.equal(stopped.emitter.inspect().activeParticleCount, 1);
    stopped.emitter.clear(); assert.equal(stopped.mesh.visible, false);
    stopped.emitter.dispose();
});

test("dense pool swap removal and reuse do not overwrite surviving particles", () => {
    const { emitter, centers } = setup({ capacity: 3, speed: 0 });
    emitter.emit(1, { position: { x: 1, y: 0, z: 0 }, lifetimeMs: 100 });
    emitter.emit(1, { position: { x: 2, y: 0, z: 0 }, lifetimeMs: 500 });
    emitter.emit(1, { position: { x: 3, y: 0, z: 0 }, lifetimeMs: 500 });
    assert.equal(emitter.emit(1), 0);
    emitter.present(0); emitter.present(100);
    assert.deepEqual(centers(), [3, 0, 0, 2, 0, 0]);
    assert.equal(emitter.emit(1, { position: { x: 4, y: 0, z: 0 } }), 1);
    assert.deepEqual(centers(), [3, 0, 0, 2, 0, 0, 4, 0, 0]);
    emitter.dispose();
});

test("configuration and emissions are copied; invalid input cannot mutate state or attach resources", () => {
    const position = { x: 1, y: 2, z: 3 }, shape = { kind: "sphere", radius: 0 }, sizeOverLife = [{ time: 0, value: 1 }, { time: 1, value: 1 }];
    const { emitter, centers } = setup({ position, shape, sizeOverLife, speed: 0 });
    position.x = 99; shape.radius = 100; sizeOverLife[0].value = 99;
    emitter.emit(1); assert.deepEqual(centers(), [1, 2, 3]);
    for (const overrides of [{ seed: -1 }, { size: [2, 1] }, { position: null }, { color: 1.5 }, { unknown: true }]) {
        const before = emitter.inspect(); assert.throws(() => emitter.emit(1, overrides), TypeError); assert.deepEqual(emitter.inspect(), before);
    }
    emitter.dispose();
    for (const options of [null, { capacity: 0 }, { capacity: 1e8 }, { rate: NaN }, { lifetimeMs: 0 }, { shape: null }, { shape: { kind: "cone", radius: 1, angle: 4 } }, { shape: { kind: "box", halfExtents: { x: -1, y: 0, z: 0 } } }, { shape: { kind: "sphere", radius: 1, surface: 1 } }, { simulationSpace: "screen" }, { texture: {} }, { blending: "unknown" }, { sizeOverLife: [{ time: 0, value: 1 }] }, { opacityOverLife: [{ time: 0, value: 1 }, { time: 0, value: 0 }] }, { spriteSheet: { rows: 0, columns: 1 } }, { bursts: [{ timeMs: -1, count: 1 }] }]) {
        const scene = new THREE.Scene(); assert.throws(() => createParticleEmitter(scene, options), TypeError); assert.equal(scene.children.length, 0);
    }
});

test("explicit emission seed reproduces a burst after clearing a reused pool", () => {
    const { emitter, centers } = setup();
    emitter.emit(4, { seed: 42 }); emitter.present(0); emitter.present(100);
    const first = centers(); emitter.clear();
    emitter.emit(4, { seed: 42 }); emitter.present(200);
    assert.deepEqual(centers(), first); emitter.dispose();
});

test("Feature schedules emitters and disposes only owned geometry/material exactly once", async () => {
    const texture = new THREE.Texture(); let textureDisposals = 0; texture.addEventListener("dispose", () => textureDisposals++);
    const { emitter, mesh, scene } = setup({ texture, rate: 10 });
    let disposals = 0; mesh.geometry.addEventListener("dispose", () => disposals++); mesh.material.addEventListener("dispose", () => disposals++);
    const frameSource = createDeterministicPresentationFrameSource();
    const feature = createParticleFeature({ emitters: [emitter] });
    const client = createClientRuntime({ frameSource, features: [feature] });
    assert.equal((await client.boot()).state, "running");
    client.startPresentation(); frameSource.deliver(0); frameSource.deliver(100);
    assert.equal(emitter.inspect().activeParticleCount, 1);
    await client.shutdown(); emitter.dispose();
    assert.equal(disposals, 2); assert.equal(textureDisposals, 0); assert.equal(scene.children.length, 0);
    assert.deepEqual(emitter.inspect().liveResourceCounts, { objects: 0, geometries: 0, materials: 0 });
    for (const action of [() => emitter.emit(1), () => emitter.present(0), () => emitter.clear(), () => emitter.setEmitting(true), () => emitter.setTransform({ x: 0, y: 0, z: 0 })]) assert.throws(action, /disposed/);
    texture.dispose();
});

test("optional alpha sorting preserves per-particle appearance and updates after camera movement", () => {
    const { emitter, centers, attr } = setup({ speed: 0, simulationSpace: "world" });
    emitter.emit(1, { position: { x: 0, y: 0, z: -1 }, color: 0xff0000, size: 1 });
    emitter.emit(1, { position: { x: 0, y: 0, z: -3 }, color: 0x00ff00, size: 2 });
    emitter.emit(1, { position: { x: 0, y: 0, z: -2 }, color: 0x0000ff, size: 3 });
    const camera = new THREE.PerspectiveCamera(); emitter.sort(camera);
    assert.deepEqual(centers(), [0, 0, -3, 0, 0, -2, 0, 0, -1]);
    assert.deepEqual(Array.from(attr("particleDimensions").array.slice(0, 9)), [2, 0, 0, 3, 0, 0, 1, 0, 0]);
    assert.deepEqual(Array.from(attr("particleAppearance").array.slice(0, 12)), [0, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1]);
    // WebGL consumes update ranges after uploading the preceding frame.
    for (const name of ["particleCenter", "particleAppearance", "particleDimensions"]) attr(name).clearUpdateRanges();
    camera.rotation.y = Math.PI; emitter.sort(camera);
    for (const name of ["particleCenter", "particleAppearance", "particleDimensions"]) {
        const attribute = attr(name);
        assert.deepEqual(attribute.updateRanges, [{ start: 0, count: 3 * attribute.itemSize }]);
    }
    assert.deepEqual(centers(), [0, 0, -1, 0, 0, -2, 0, 0, -3]);
    emitter.present(0); emitter.sort(camera);
    assert.deepEqual(centers(), [0, 0, -1, 0, 0, -2, 0, 0, -3]);
    emitter.dispose(); assert.throws(() => emitter.sort(camera), /disposed/);
});

test("restart resets schedule and randomness while retaining monotonic absolute time", () => {
    const { emitter, centers } = setup({ seed: 3, rate: 10, bursts: [{ timeMs: 0, count: 2 }], lifetimeMs: 1000 });
    emitter.present(1_800_000_000_000); emitter.present(1_800_000_000_100);
    const first = centers(); emitter.setEmitting(false); emitter.restart();
    emitter.present(1_800_000_000_200);
    assert.deepEqual(centers(), first); assert.equal(emitter.inspect().emitting, true);
    assert.throws(() => emitter.present(0), /monotonic/);
    emitter.dispose(); assert.throws(() => emitter.restart(), /disposed/);
});

test("very small drag approaches ballistic motion without cancellation", () => {
    const { emitter, centers } = setup({ speed: 0, drag: 1e-20, acceleration: { x: 2, y: 0, z: 0 }, lifetimeMs: 2000 });
    emitter.emit(1); emitter.present(0); emitter.present(1000); close(centers()[0], 1); emitter.dispose();
});

// Module-level regression coverage exercises observable particle state rather than shader text.
const P = (x = 0, y = 0, z = 0) => ({ x, y, z });
const C = (a, b = a) => [{ time: 0, value: a }, { time: 1, value: b }];

test("looped rate/bursts, start delay and prewarm honor cycle boundaries and skip long hitches", () => {
    const x = setup({ capacity: 100, rate: 10, durationMs: 200, loop: true, startDelayMs: 50, bursts: [{ timeMs: 0, count: 1 }], speed: 0, lifetimeMs: 1000 });
    x.emitter.present(0); x.emitter.present(49); assert.equal(x.emitter.inspect().activeParticleCount, 0);
    x.emitter.present(50); assert.equal(x.emitter.inspect().activeParticleCount, 1);
    x.emitter.present(250); assert.equal(x.emitter.inspect().activeParticleCount, 4);
    x.emitter.present(450); assert.equal(x.emitter.inspect().activeParticleCount, 7);
    x.emitter.pause(); x.emitter.present(1000); assert.equal(x.emitter.inspect().elapsedMs, 450);
    x.emitter.play(); x.emitter.setTimeScale(2); x.emitter.present(1100); assert.equal(x.emitter.inspect().elapsedMs, 650);
    x.emitter.prewarm(200); assert.equal(x.emitter.inspect().elapsedMs, 850);
    assert.equal(x.emitter.inspect().presentationTimeMs, 1100);
    x.emitter.present(1e12); assert.ok(x.emitter.inspect().activeParticleCount <= 100); assert.ok(x.emitter.inspect().droppedParticleCount > 1e6);
    x.emitter.dispose();
    const warm = setup({ rate: 10, prewarmMs: 500, speed: 0 });
    assert.equal(warm.emitter.inspect().activeParticleCount, 5);
    warm.emitter.present(10000); assert.equal(warm.emitter.inspect().activeParticleCount, 5);
    warm.emitter.restart(); assert.equal(warm.emitter.inspect().activeParticleCount, 5); warm.emitter.dispose();
});

test("new shape samples are bounded, copied and mesh sampling is weighted by triangle area", () => {
    for (const shape of [{ kind: "circle", radius: 2 }, { kind: "ring", radius: 2, innerRadius: 1 }, { kind: "ring", radius: 2 }, { kind: "line", start: P(-1, 2), end: P(3, 2) }]) {
        const x = setup({ shape, speed: 0 }); x.emitter.emit(400);
        const positions = x.centers();
        for (let i = 0; i < positions.length; i += 3) {
            const [px, py, pz] = positions.slice(i, i + 3);
            if (shape.kind === "line") { assert.ok(px >= -1 && px <= 3); close(py, 2); close(pz, 0); }
            else { close(py, 0); const r = Math.hypot(px, pz); assert.ok(r <= 2.00001); if (shape.kind === "ring") assert.ok(r >= (shape.innerRadius ?? 2) - 0.00001); }
        }
        x.emitter.dispose();
    }
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 10, 0, 0, 13, 0, 0, 10, 3, 0];
    const x = setup({ capacity: 4096, shape: { kind: "mesh", positions }, speed: 0 }); positions.fill(99); x.emitter.emit(4096);
    const data = x.centers(); let large = 0;
    for (let i = 0; i < data.length; i += 3) { if (data[i] >= 10) large++; close(data[i + 2], 0); }
    assert.ok(large / 4096 > 0.87 && large / 4096 < 0.93); x.emitter.dispose();
});

test("distance emission interpolates moving world parents and inherited velocity uses simulation seconds", () => {
    const x = setup({ rateOverDistance: 2, simulationSpace: "world", speed: 0, lifetimeMs: 10000 });
    x.emitter.present(0); x.scene.position.x = 2; x.emitter.present(1000);
    assert.deepEqual(x.centers(), [0.5, 0, 0, 1, 0, 0, 1.5, 0, 0, 2, 0, 0]);
    x.emitter.pause(); x.scene.position.x = 100; x.emitter.present(2000); x.emitter.play(); x.emitter.present(2100);
    assert.equal(x.emitter.inspect().emittedParticleCount, 4); x.emitter.dispose();
    const y = setup({ simulationSpace: "world", rate: 1, speed: 0, inheritVelocity: 0.5, lifetimeMs: 10000 });
    y.emitter.present(0); y.scene.position.x = 2; y.emitter.present(1000); y.emitter.setEmitting(false); y.emitter.present(2000);
    close(y.centers()[0], 3); y.emitter.dispose();
});

test("explicit velocity is rotated, overridden at birth, and parameter updates are atomic", () => {
    const x = setup({ velocity: P(2), rotation: P(0, 0, Math.PI / 2), lifetimeMs: 5000 });
    x.emitter.emit(1); x.emitter.present(0); x.emitter.present(1000); close(x.centers()[0], 0); close(x.centers()[1], 2);
    assert.throws(() => x.emitter.setParameters({ sizeScale: 2, color: -1 }), TypeError);
    x.emitter.setParameters({ speedScale: 2, sizeScale: 3, color: 0xff0000 }); x.emitter.emit(1, { velocity: P(0, 1), size: 1 });
    x.emitter.present(2000); close(x.centers()[3], -2); close(x.attr("particleDimensions").getX(1), 3);
    assert.equal(x.attr("particleAppearance").getX(1), 1); assert.equal(x.attr("particleAppearance").getY(1), 0); x.emitter.dispose();
});

test("fixed-step velocity/force curves are frame-partition independent without catch-up drops", () => {
    const options = { velocity: P(), lifetimeMs: 3000, simulationStepMs: 10, velocityOverLife: { x: C(0, 6) }, forceOverLife: { y: C(2) }, noise: { strength: 0.5, frequency: 2 }, seed: 42 };
    const a = setup(options), b = setup(options); a.emitter.emit(10); b.emitter.emit(10); a.emitter.present(0); b.emitter.present(0);
    a.emitter.present(1000); for (const t of [13, 50, 155, 360, 681, 999, 1000]) b.emitter.present(t);
    assert.deepEqual(a.centers(), b.centers()); a.emitter.dispose(); b.emitter.dispose();
    const pure = setup({ velocity: P(), lifetimeMs: 2000, simulationStepMs: 10, velocityOverLife: { x: C(0, 4) }, forceOverLife: { y: C(2) } });
    pure.emitter.emit(1); pure.emitter.present(0); pure.emitter.present(1000); close(pure.centers()[0], 1); close(pure.centers()[1], 1); pure.emitter.dispose();
});

test("noise replay, attraction, repulsion, vortex and bounded numerical catch-up", () => {
    const noisy = setup({ velocity: P(), noise: { strength: 1 }, lifetimeMs: 10000 });
    noisy.emitter.emit(1, { seed: 99 }); noisy.emitter.present(0); noisy.emitter.present(1000); const first = noisy.centers();
    noisy.emitter.clear(); noisy.emitter.emit(1, { seed: 99 }); noisy.emitter.present(2000); assert.deepEqual(noisy.centers(), first);
    noisy.emitter.present(9000); assert.ok(noisy.emitter.inspect().droppedSimulationMs > 0); noisy.emitter.dispose();
    for (const strength of [1, -1]) {
        const x = setup({ position: P(1), velocity: P(), forceFields: [{ kind: "attractor", position: P(), strength, radius: 10 }], lifetimeMs: 5000 });
        x.emitter.emit(1); x.emitter.present(0); x.emitter.present(1000); assert.equal(x.centers()[0] < 1, strength > 0); x.emitter.dispose();
    }
    const x = setup({ position: P(1), velocity: P(), forceFields: [{ kind: "vortex", position: P(), axis: P(0, 1), strength: 1, radius: 10 }], lifetimeMs: 5000 });
    x.emitter.emit(1); x.emitter.present(0); x.emitter.present(1000); assert.ok(x.centers()[2] < 0); x.emitter.dispose();
});

test("swept plane, sphere and box collisions prevent tunneling and emit bounded snapshots", () => {
    for (const collider of [{ kind: "plane", normal: P(1), offset: 0 }, { kind: "sphere", center: P(-1), radius: 1 }, { kind: "box", min: P(-2, -1, -1), max: P(0, 1, 1) }]) {
        const x = setup({ position: P(1), velocity: P(-1000), simulationStepMs: 10, events: true, collision: { colliders: [collider], bounce: 1 }, lifetimeMs: 1000 });
        x.emitter.emit(1); x.emitter.present(0); x.emitter.present(10);
        assert.ok(x.centers()[0] >= 0); const events = x.emitter.drainEvents(); assert.deepEqual(events.map(e => e.kind), ["birth", "collision"]);
        assert.ok(events[1].velocity.x > 0); assert.equal(x.emitter.drainEvents().length, 0); assert.ok(Object.isFrozen(events[1].position)); x.emitter.dispose();
    }
    const kill = setup({ position: P(0, 1), velocity: P(0, -100), simulationStepMs: 10, events: true, collision: { colliders: [{ kind: "plane", normal: P(0, 1), offset: 0 }], response: "kill" } });
    kill.emitter.emit(1); kill.emitter.present(0); kill.emitter.present(20); assert.equal(kill.emitter.inspect().activeParticleCount, 0);
    assert.deepEqual(kill.emitter.drainEvents().map(e => e.kind), ["birth", "collision", "death"]); kill.emitter.dispose();
});

test("death events use final positions, queues overflow predictably, and dense reuse retains identities", () => {
    const x = setup({ events: true, eventCapacity: 4, velocity: P(1), lifetimeMs: 1000 });
    x.emitter.emit(2); x.emitter.present(0); const births = x.emitter.drainEvents(); x.emitter.present(1000);
    const deaths = x.emitter.drainEvents(); assert.deepEqual(deaths.map(e => e.particleId).sort(), births.map(e => e.particleId).sort());
    for (const e of deaths) close(e.position.x, 1);
    x.emitter.emit(10); assert.equal(x.emitter.drainEvents().length, 4); assert.equal(x.emitter.inspect().droppedEventCount, 6); x.emitter.dispose();
});

test("stretched and mesh particle data and trail histories survive sorting, reuse, culling and disposal", () => {
    for (const renderer of [{ kind: "stretched", lengthScale: 2 }, { kind: "mesh", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] }]) {
        const x = setup({ capacity: 3, renderer, trails: { segments: 4, intervalMs: 10 }, velocity: P(1), lifetimeMs: 1000, simulationSpace: "world" });
        const trail = x.scene.children[1]; let releases = 0;
        for (const child of x.scene.children) { child.geometry.addEventListener("dispose", () => releases++); child.material.addEventListener("dispose", () => releases++); }
        x.emitter.emit(1, { lifetimeMs: 20 }); x.emitter.emit(1, { position: P(0, 1) }); x.emitter.present(0);
        for (const t of [10, 20, 30, 40]) x.emitter.present(t);
        assert.ok(trail.geometry.instanceCount > 0 && trail.geometry.instanceCount <= 4);
        assert.equal(trail.geometry.getAttribute("segmentStart").getY(0), 1);
        const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100); camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0);
        assert.equal(x.emitter.cull(camera), true); camera.position.x = 1000; camera.lookAt(1000, 0, 0);
        assert.equal(x.emitter.cull(camera), false); assert.equal(x.mesh.visible, false); assert.equal(trail.visible, false);
        camera.position.x = 0; camera.lookAt(0, 0, 0); assert.equal(x.emitter.cull(camera), true); x.emitter.sort(camera);
        x.emitter.dispose(); x.emitter.dispose(); assert.equal(releases, 4); assert.equal(x.scene.children.length, 0);
    }
});

test("new module validation fails before resources are attached and inputs stay copied", () => {
    const invalid = [
        { loop: true }, { loop: true, durationMs: 0 }, { timeScale: -1 }, { prewarmMs: Infinity }, { rateOverDistance: -1 },
        { velocity: P(NaN) }, { velocityOverLife: { w: C(1) } }, { noise: { strength: -1 } },
        { forceFields: [{ kind: "vortex", position: P(), axis: P(), strength: 1, radius: 1 }] },
        { collision: { colliders: [{ kind: "plane", normal: P(), offset: 0 }] } },
        { collision: { colliders: [{ kind: "box", min: P(), max: P() }] } },
        { shape: { kind: "mesh", positions: Array(9).fill(0) } }, { shape: { kind: "ring", radius: 1, innerRadius: 2 } },
        { renderer: { kind: "mesh", positions: [0, 0, 0] } }, { renderer: { kind: "stretched", velocityScale: -1 } },
        { trails: { segments: 100 } }, { capacity: 65536, trails: { segments: 64 } }, { eventCapacity: 0 }, { maxSubSteps: 0 },
    ];
    for (const options of invalid) { const scene = new THREE.Group(); assert.throws(() => createParticleEmitter(scene, options), TypeError); assert.equal(scene.children.length, 0); }
    const options = { events: true, velocity: P(1), forceFields: [{ kind: "attractor", position: P(), strength: 0, radius: 1 }] };
    const x = setup(options); options.events = false; options.velocity.x = 100; options.forceFields[0].strength = 100;
    x.emitter.emit(1); assert.equal(x.emitter.drainEvents().length, 1); x.emitter.present(0); x.emitter.present(500); close(x.centers()[0], 0.5); x.emitter.dispose();
    for (const action of [() => x.emitter.pause(), () => x.emitter.play(), () => x.emitter.prewarm(0), () => x.emitter.setParameters({}), () => x.emitter.setTimeScale(1), () => x.emitter.drainEvents(), () => x.emitter.cull(new THREE.Camera())]) assert.throws(action, /disposed/);
});

test("serializable effects route birth/death sub-emitters in topological order and catch up child motion", () => {
    const definition = defineParticleEffect({ emitters: [
        { id: "grandchild", options: { capacity: 8, velocity: P(), lifetimeMs: 2000 } },
        { id: "child", options: { capacity: 8, velocity: P(2), lifetimeMs: 100 } },
        { id: "parent", options: { capacity: 8, velocity: P(1), lifetimeMs: 100, bursts: [{ timeMs: 0, count: 1 }] } },
    ], subEmitters: [
        { source: "parent", target: "child", event: "death", count: 1 },
        { source: "child", target: "grandchild", event: "death", count: 1 },
    ] });
    assert.ok(Object.isFrozen(definition.emitters[0].options));
    const scene = new THREE.Group(), effect = createParticleEffect(scene, JSON.parse(JSON.stringify(definition)));
    effect.present(0); effect.present(300);
    assert.deepEqual(effect.inspect().emitters.map(e => e.state.activeParticleCount), [1, 0, 0]);
    const g = scene.children[0].children[0].geometry.getAttribute("particleCenter"); close(g.getX(0), 0.3);
    effect.dispose(); assert.equal(scene.children.length, 0);
});

test("sub-emitters convert world birth positions and inherited velocities under transformed parents", () => {
    const scene = new THREE.Group(); scene.position.x = 10; scene.scale.setScalar(2); scene.rotation.z = Math.PI / 2;
    const effect = createParticleEffect(scene, { emitters: [
        { id: "parent", options: { capacity: 4, simulationSpace: "world", position: P(1), velocity: P(1), lifetimeMs: 100, bursts: [{ timeMs: 0, count: 1 }] } },
        { id: "child", options: { capacity: 4, simulationSpace: "world", rotation: P(0, 0, Math.PI / 2), velocity: P(), lifetimeMs: 1000 } },
    ], subEmitters: [{ source: "parent", target: "child", event: "death", count: 1, inheritVelocity: 1 }] });
    effect.present(0); effect.present(200);
    const attr = scene.children[0].children[1].geometry.getAttribute("particleCenter"); close(attr.getX(0), 10); close(attr.getY(0), 2.4); effect.dispose();
});

test("effects reject cyclic graphs and missing textures, roll back partial allocation, and bound event fan-out", () => {
    const scene = new THREE.Group();
    assert.throws(() => createParticleEffect(scene, { emitters: [{ id: "a", options: {} }], subEmitters: [{ source: "a", target: "a", event: "birth", count: 1 }] }), /acyclic/);
    assert.equal(scene.children.length, 0);
    assert.throws(() => createParticleEffect(scene, { emitters: [{ id: "a", options: {} }, { id: "b", options: { texture: "missing" } }] }), /Missing/); assert.equal(scene.children.length, 0);
    const effect = createParticleEffect(scene, { emitters: [{ id: "a", options: { capacity: 8, bursts: [{ timeMs: 0, count: 8 }] } }, { id: "b", options: { capacity: 8 } }], subEmitters: [{ source: "a", target: "b", event: "birth", count: 65536 }] });
    effect.present(0); assert.equal(effect.inspect().activeParticleCount, 16); assert.equal(effect.inspect().droppedSubEmitterCount, 8 * 65536 - 8); effect.dispose();
});

test("compatible additive emitters batch while retaining individual playback, culling and resource ownership", () => {
    const scene = new THREE.Group();
    const effect = createParticleEffect(scene, { emitters: [
        { id: "a", options: { capacity: 8, speed: 0, blending: "additive", bursts: [{ timeMs: 0, count: 2 }] } },
        { id: "b", options: { capacity: 8, speed: 0, blending: "additive", bursts: [{ timeMs: 0, count: 3 }] } },
    ] });
    effect.present(0); assert.equal(effect.inspect().drawSavings, 1);
    const group = scene.children[0]; const batch = group.children.find(c => c.name === "three-game-kit-particle-batch");
    assert.equal(batch.geometry.instanceCount, 5); assert.equal(group.children.filter(c => c.visible).length, 1);
    effect.pause(); effect.present(1000); assert.equal(batch.geometry.instanceCount, 5);
    effect.emit("a", 1); assert.equal(batch.geometry.instanceCount, 6); effect.setParameters({ color: 0xff0000 }); effect.play();
    const camera = new THREE.PerspectiveCamera(); camera.position.z = 10;
    effect.cull(camera); assert.equal(batch.visible, true); camera.position.x = 1000; effect.cull(camera); assert.equal(batch.visible, false);
    effect.clear(); assert.equal(batch.geometry.instanceCount, 0); effect.restart(); effect.present(1000); assert.equal(batch.geometry.instanceCount, 5);
    let releases = 0; for (const c of group.children) c.geometry.addEventListener("dispose", () => releases++);
    effect.dispose(); effect.dispose(); assert.equal(releases, 3); assert.equal(scene.children.length, 0);
});

test("systems enforce aggregate capacity, release reservations, propagate playback and apply distance LOD", () => {
    const scene = new THREE.Group(), camera = new THREE.PerspectiveCamera(); camera.position.z = 10;
    const system = createParticleSystem(scene, { maxParticles: 16, camera, cull: true, lod: [{ distance: 5, emissionScale: 0.5 }, { distance: 20, emissionScale: 0 }] });
    const definition = { emitters: [{ id: "a", options: { capacity: 8, rate: 10, speed: 0, lifetimeMs: 5000 } }] };
    const a = system.createEffect(definition), b = system.createEffect(definition);
    assert.throws(() => system.createEffect(definition), /budget/); assert.equal(system.inspect().reservedParticles, 16);
    system.present(0); system.present(500); system.present(1000); assert.equal(system.inspect().activeParticleCount, 10);
    system.pause(); system.present(2000); assert.equal(system.inspect().activeParticleCount, 10);
    system.play(); a.setTransform(P(100)); b.setTransform(P(100)); system.present(3000); assert.equal(system.inspect().activeParticleCount, 10);
    assert.ok(a.inspect().emitters[0].state.culled);
    a.dispose(); assert.equal(system.inspect().reservedParticles, 8); const c = system.createEffect(definition); assert.equal(system.inspect().reservedParticles, 16);
    system.setTimeScale(2); system.present(3500); assert.equal(c.inspect().emitters[0].state.elapsedMs, 1000);
    system.dispose(); system.dispose(); assert.equal(system.inspect().reservedParticles, 0); assert.equal(scene.children.length, 0);
    assert.throws(() => system.createEffect(definition), /disposed/);
});

test("billboard culling remains conservative under nonuniform parent scaling", () => {
    const x = setup({ size: 1, speed: 0 }); x.scene.scale.set(10, 0.01, 0.01); x.scene.position.y = 5;
    x.emitter.emit(1); const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100); camera.position.z = 5;
    // Center is outside the view, but the world-sized billboard extends into it.
    assert.equal(x.emitter.cull(camera), true); x.emitter.dispose();
});

test("paused sorting retains trail colors and effect sorting preserves additive batch visibility", () => {
    const x = setup({ capacity: 4, trails: { segments: 4, intervalMs: 10 }, velocity: P(1), lifetimeMs: 5000 });
    x.emitter.emit(1, { position: P(0, 1, -1), color: 0xff0000 }); x.emitter.emit(1, { position: P(0, 2, -2), color: 0x00ff00 });
    x.emitter.present(0); x.emitter.present(100); x.emitter.sort(new THREE.PerspectiveCamera()); x.emitter.pause(); x.emitter.present(200);
    const trail = x.scene.children[1], start = trail.geometry.getAttribute("segmentStart"), color = trail.geometry.getAttribute("particleAppearance");
    for (let i = 0; i < trail.geometry.instanceCount; i++) { if (start.getY(i) === 1) { close(color.getX(i), 1); close(color.getY(i), 0); } else { close(color.getX(i), 0); close(color.getY(i), 1); } }
    x.emitter.dispose();
    const scene = new THREE.Group(), effect = createParticleEffect(scene, { emitters: [
        { id: "a", options: { capacity: 4, blending: "additive", bursts: [{ timeMs: 0, count: 1 }] } },
        { id: "b", options: { capacity: 4, blending: "additive", bursts: [{ timeMs: 0, count: 1 }] } },
    ] });
    effect.present(0); effect.sort(new THREE.PerspectiveCamera()); assert.equal(scene.children[0].children.filter(c => c.visible).length, 1);
    assert.equal(scene.children[0].children.at(-1).geometry.instanceCount, 2); effect.dispose();
});

test("collision friction reduces tangential velocity and reports contact positions", () => {
    const x = setup({ position: P(0, 0.05), velocity: P(2, -10), simulationStepMs: 10, events: true,
        collision: { colliders: [{ kind: "plane", normal: P(0, 1), offset: 0 }], bounce: 0.5, friction: 0.25 } });
    x.emitter.emit(1); x.emitter.present(0); x.emitter.present(10);
    const event = x.emitter.drainEvents().find(e => e.kind === "collision");
    close(event.position.y, 0, 0.00001); close(event.velocity.x, 1.5); close(event.velocity.y, 5); x.emitter.dispose();
});

test("loop schedule remains deterministic for fractional periods and rates", () => {
    for (const durationMs of [17.3, 100, 101.7]) {
        const options = { capacity: 4096, durationMs, rate: 173.2, loop: true, bursts: [{ timeMs: 0, count: 2 }, { timeMs: durationMs, count: 1 }], lifetimeMs: 5000 };
        const a = setup(options), b = setup(options); a.emitter.present(0); b.emitter.present(0); a.emitter.present(1000);
        for (let t = 5; t <= 1000; t += 5) b.emitter.present(t);
        assert.deepEqual(a.centers(), b.centers()); assert.equal(a.emitter.inspect().droppedParticleCount, 0); a.emitter.dispose(); b.emitter.dispose();
    }
});

test("particle Feature accepts an owned system and releases nested effects on shutdown", async () => {
    const scene = new THREE.Group(), system = createParticleSystem(scene);
    system.createEffect({ emitters: [{ id: "a", options: { rate: 10 } }] });
    const frameSource = createDeterministicPresentationFrameSource();
    const client = createClientRuntime({ frameSource, features: [createParticleFeature({ emitters: [system] })] });
    assert.equal((await client.boot()).state, "running"); client.startPresentation(); frameSource.deliver(0); frameSource.deliver(100);
    assert.equal(system.inspect().activeParticleCount, 1); await client.shutdown(); assert.equal(scene.children.length, 0); assert.equal(system.inspect().disposed, true);
});
