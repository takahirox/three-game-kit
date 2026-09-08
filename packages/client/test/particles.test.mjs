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
    const trail = x.scene.children[1], start = trail.geometry.getAttribute("segmentStart"), color = trail.geometry.getAttribute("segmentColorB");
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

const constant = value => [{ time: 0, value }, { time: 1, value }];
const xyz = (x = 0, y = 0, z = 0) => ({ x, y, z });

test("curved emission integrates smooth keys and repeated random bursts survive frame partitions and hitches", () => {
    const options = { capacity: 2048, seed: 123, durationMs: 1000, loop: true, lifetimeMs: 5000, speed: 0,
        rate: 20, rateOverTime: [{ time: 0, value: 0, interpolation: "smooth" }, { time: 1, value: 2 }],
        bursts: [{ timeMs: 0, count: [2, 7], cycles: 4, intervalMs: 200, probability: 0.7 }] };
    const a = setup(options), b = setup(options);
    a.emitter.present(0); a.emitter.present(2500);
    for (let t = 0; t <= 2500; t += 25) b.emitter.present(t);
    assert.deepEqual(a.centers(), b.centers());
    assert.deepEqual(Array.from(a.attr("particleDimensions").array), Array.from(b.attr("particleDimensions").array));
    assert.equal(a.emitter.inspect().emittedParticleCount, b.emitter.inspect().emittedParticleCount);
    const curveOnly = setup({ rate: 20, durationMs: 1000, rateOverTime: options.rateOverTime, lifetimeMs: 2000 });
    curveOnly.emitter.present(0); curveOnly.emitter.present(1000);
    assert.equal(curveOnly.emitter.inspect().emittedParticleCount, 20);
    a.emitter.present(1e11); assert.ok(a.emitter.inspect().activeParticleCount <= options.capacity);
    const never = setup({ ...options, bursts: [{ timeMs: 0, count: 1, probability: 0 }], rate: 0 });
    never.emitter.present(0); never.emitter.present(1e11); assert.equal(never.emitter.inspect().emittedParticleCount, 0);
    for (const e of [a, b, curveOnly, never]) e.emitter.dispose();
});

test("curve distributions, random colors, speed modules, and 3D axes are stable through sorting and restart", () => {
    const options = { capacity: 4, seed: 456, bursts: [{ timeMs: 0, count: 4 }], lifetimeMs: 2000, velocity: xyz(2), size: 1,
        startColors: [0xff0000, 0x00ff00, 0x0000ff], sizeAxes: { x: 2, y: 3, z: 4 }, rotation3D: { x: 0.5 }, angularVelocity3D: { y: 2 },
        angularVelocity: 2, angularVelocityOverLife: [{ time: 0, value: 0 }, { time: 1, value: 2 }],
        sizeOverLife: { min: constant(1), max: constant(2) }, sizeBySpeed: { range: [0, 4], curve: constant(2) },
        rotationBySpeed: { range: [0, 4], curve: constant(0.25) }, colorBySpeed: { range: [0, 4], curve: constant(0xffffff) } };
    const a = setup(options); a.emitter.present(0); a.emitter.present(1000);
    const saved = Array.from(a.attr("particleDimensions").array);
    assert.ok(saved.filter((_, i) => i % 3 === 0).every(n => n >= 2 && n <= 4));
    close(saved[1], 1.25); close(a.attr("particleRotation").getY(0), 1);
    assert.deepEqual(Array.from(a.attr("particleScale").array.slice(0, 3)), [2, 3, 4]);
    const appearance = Array.from(a.attr("particleAppearance").array);
    a.emitter.seek(1000); assert.deepEqual(Array.from(a.attr("particleDimensions").array), saved); assert.deepEqual(Array.from(a.attr("particleAppearance").array), appearance);
    a.emitter.dispose();
});

test("sprite FPS, row selection, start frames and interpolation wrap inside the selected row", () => {
    const a = setup({ speed: 0, lifetimeMs: 5000, spriteSheet: { columns: 4, rows: 3, fps: 2, row: 1, startFrame: 3, blend: true } });
    a.emitter.emit(1); a.emitter.present(0); a.emitter.present(250);
    assert.equal(a.attr("particleDimensions").getZ(0), 7); assert.equal(a.attr("particleAtlas").getX(0), 4); close(a.attr("particleAtlas").getY(0), 0.5);
    a.emitter.present(500); assert.equal(a.attr("particleDimensions").getZ(0), 4);
    a.emitter.dispose();
});

test("runtime fields and collision changes preserve position and velocity at the update boundary", () => {
    const a = setup({ velocity: xyz(1), lifetimeMs: 5000, simulationStepMs: 10, renderer: { kind: "stretched" } });
    a.emitter.emit(1); a.emitter.present(0); a.emitter.present(1000); close(a.centers()[0], 1);
    a.emitter.setForceFields([{ kind: "attractor", position: xyz(10), radius: 20, strength: 2 }]);
    close(a.centers()[0], 1); a.emitter.present(1100); assert.ok(a.centers()[0] > 1.1);
    const before = a.centers()[0], velocity = a.attr("particleVelocity").getX(0);
    a.emitter.setForceFields([]); a.emitter.present(1200); close(a.centers()[0], before + velocity * 0.1);
    a.emitter.setCollision({ colliders: [{ kind: "plane", normal: xyz(-1), offset: -1.4 }], bounce: 1 });
    a.emitter.present(1500); assert.ok(a.centers()[0] < 1.4); assert.ok(a.attr("particleVelocity").getX(0) < 0);
    const stable = a.centers(); assert.throws(() => a.emitter.setForceFields([{ kind: "vortex", position: xyz(), radius: 1, strength: 2, axis: xyz() }])); assert.deepEqual(a.centers(), stable);
    a.emitter.dispose();
});

test("velocity limiting is enforced at birth and after acceleration", () => {
    const a = setup({ velocity: xyz(10), acceleration: xyz(10), limitVelocity: 2, lifetimeMs: 2000, renderer: { kind: "stretched" } });
    a.emitter.emit(1); close(a.attr("particleVelocity").getX(0), 2); a.emitter.present(0); a.emitter.present(1000);
    close(a.attr("particleVelocity").getX(0), 2); assert.ok(a.centers()[0] < 2.1); a.emitter.dispose();
});

test("deforming mesh snapshots affect future births while existing particles remain independent", () => {
    let offset = 0;
    const vertices = () => [offset, 0, 0, offset + 1, 0, 0, offset, 1, 0];
    const a = setup({ shape: { kind: "mesh", positions: vertices() }, speed: 0, runtime: { meshPositions: vertices } });
    a.emitter.emit(1); const first = a.centers(); offset = 10; a.emitter.emit(1);
    assert.deepEqual(a.centers().slice(0, 3), first); assert.ok(a.centers()[3] >= 10);
    assert.throws(() => a.emitter.setMeshPositions([0, 0, 0])); a.emitter.dispose();
});

test("custom attributes and update callbacks commit once per fixed step; trigger enter/exit are bounded events", () => {
    let calls = 0;
    const a = setup({ capacity: 2, velocity: xyz(1), lifetimeMs: 2000, simulationStepMs: 100, events: true,
        customAttributes: [{ name: "customHeat", size: 1, value: [0] }], triggers: [{ id: "gate", volume: { kind: "sphere", center: xyz(0.5), radius: 0.2 } }],
        runtime: { update(p) { calls++; p.attributes[0] += p.deltaMs / 1000; } } });
    a.emitter.emit(1); a.emitter.present(0); a.emitter.present(50); a.emitter.present(50);
    assert.equal(calls, 1); close(a.attr("customHeat").getX(0), 0);
    a.emitter.present(1000); assert.equal(calls, 11); close(a.attr("customHeat").getX(0), 1);
    const crossings = a.emitter.drainEvents().filter(e => e.triggerId === "gate"); assert.deepEqual(crossings.map(e => e.kind), ["enter", "exit"]);
    a.emitter.dispose();
});

test("retained trails fade after death, survive sorting and dense reuse, and delay completion", () => {
    let complete = 0;
    const a = setup({ capacity: 2, speed: 0, lifetimeMs: 200, velocity: xyz(1), opacityOverLife: constant(1),
        trails: { segments: 4, intervalMs: 20, width: 0.2, widthOverTrail: [{ time: 0, value: 1 }, { time: 1, value: 0 }], colorOverTrail: [{ time: 0, value: 0xffffff }, { time: 1, value: 0x0000ff }], persistMs: 300 },
        runtime: { onComplete() { complete++; } } });
    a.emitter.emit(1, { color: 0xff0000 }); a.emitter.present(0); a.emitter.present(50); a.emitter.present(100); a.emitter.present(150);
    a.emitter.present(200); assert.equal(a.emitter.inspect().activeParticleCount, 0); assert.equal(a.emitter.inspect().activeTrailCount, 1); assert.equal(complete, 0);
    const trail = a.scene.children[1]; assert.ok(trail.geometry.instanceCount > 0);
    a.emitter.present(500); assert.equal(a.emitter.inspect().activeTrailCount, 0); assert.equal(complete, 1); a.emitter.present(600); assert.equal(complete, 1);
    a.emitter.emit(1); a.emitter.clear(); assert.equal(a.emitter.inspect().activeTrailCount, 0); a.emitter.dispose();
});

test("effect seek replays the sub-emitter DAG from time zero and completion waits for children", () => {
    let completions = 0;
    const definition = defineParticleEffect({ emitters: [
        { id: "source", options: { capacity: 2, bursts: [{ timeMs: 0, count: 1 }], lifetimeMs: 100, velocity: xyz(1) } },
        { id: "child", options: { capacity: 8, lifetimeMs: 200, velocity: xyz(0, 1), noise: { strength: 0.2 } } },
    ], subEmitters: [{ source: "source", target: "child", event: "death", count: 2 }] });
    const parent = new THREE.Group(), effect = createParticleEffect(parent, definition, { onComplete: () => completions++ });
    effect.seek(200); assert.equal(effect.inspect().activeParticleCount, 2); assert.equal(completions, 0);
    const attrs = () => Array.from(parent.children[0].children[1].geometry.getAttribute("particleCenter").array.slice(0, 6));
    const first = attrs(); effect.seek(200); assert.deepEqual(attrs(), first);
    effect.seek(400); assert.equal(effect.inspect().completed, true); assert.equal(completions, 1); effect.present(500); assert.equal(completions, 1); effect.dispose();
});

test("borrowed material/depth/trail textures survive disposal and incompatible settings reject without scene attachment", () => {
    const material = new THREE.ShaderMaterial(), texture = new THREE.Texture(), depth = new THREE.DepthTexture(16, 16), camera = new THREE.PerspectiveCamera();
    let released = 0; for (const r of [material, texture, depth]) r.addEventListener("dispose", () => released++);
    const a = setup({ runtime: { material, trailTexture: texture, softParticles: { depthTexture: depth, camera, width: 16, height: 16 } }, trails: {} });
    assert.equal(a.mesh.material, material); a.emitter.dispose(); assert.equal(released, 0);
    const scene = new THREE.Group();
    for (const bad of [{ rateOverTime: constant(1) }, { bursts: [{ timeMs: 0, count: 2, cycles: 2 }] }, { sizeAxes: { x: -1 } }, { spriteSheet: { columns: 2, rows: 2, row: 2 } }, { customAttributes: [{ name: "position", size: 3 }] }, { runtime: { material: new THREE.MeshBasicMaterial() } }, { triggers: [{ id: "x", volume: { kind: "sphere", center: xyz(), radius: -1 } }] }]) {
        assert.throws(() => createParticleEmitter(scene, bad)); assert.equal(scene.children.length, 0);
    }
    material.dispose(); texture.dispose(); depth.dispose();
});

test("simulation LOD reduces update frequency and offscreen pause resumes without a catch-up jump", () => {
    const parent = new THREE.Group(), camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100); camera.position.z = 10; camera.updateMatrixWorld();
    const system = createParticleSystem(parent, { camera, cull: true, offscreenSimulation: "pause", lod: [{ distance: 0, emissionScale: 1, updateIntervalMs: 100 }] });
    const effect = system.createEffect(defineParticleEffect({ emitters: [{ id: "main", options: { velocity: xyz(1), lifetimeMs: 5000, bursts: [{ timeMs: 0, count: 1 }] } }] }));
    system.present(0); system.present(50); assert.equal(effect.inspect().emitters[0].state.elapsedMs, 0);
    system.present(100); close(effect.inspect().emitters[0].state.elapsedMs, 100);
    effect.setTransform(xyz(1000)); system.present(200); close(effect.inspect().emitters[0].state.elapsedMs, 100);
    effect.setTransform(xyz()); system.present(300); close(effect.inspect().emitters[0].state.elapsedMs, 200); system.dispose();
});

test("collision-killed trails expire relative to the contact step, including long catch-up frames", () => {
    const a = setup({ capacity: 2, velocity: xyz(1), lifetimeMs: 2000, simulationStepMs: 10, opacityOverLife: constant(1),
        collision: { colliders: [{ kind: "plane", normal: xyz(-1), offset: -0.2 }], response: "kill" },
        trails: { segments: 16, intervalMs: 10, persistMs: 100 } });
    a.emitter.emit(1); a.emitter.present(0); a.emitter.present(100); a.emitter.present(500);
    assert.equal(a.emitter.inspect().activeParticleCount, 0); assert.equal(a.emitter.inspect().activeTrailCount, 0);
    assert.equal(a.emitter.inspect().completed, true); a.emitter.dispose();
});

test("borrowed materials are excluded from owned resource counts and callback failures clean up prewarm", () => {
    const material = new THREE.ShaderMaterial(), a = setup({ runtime: { material } });
    assert.equal(a.emitter.inspect().liveResourceCounts.materials, 0); a.emitter.dispose(); material.dispose();
    const scene = new THREE.Group();
    assert.throws(() => createParticleEmitter(scene, { rate: 10, prewarmMs: 200, runtime: { update() { throw new Error("callback failure"); } } }), /callback failure/);
    assert.equal(scene.children.length, 0);
    const b = setup({ events: true, triggers: [{ id: "origin", volume: { kind: "sphere", center: xyz(), radius: 1 } }], runtime: { update(p) { p.position.x = 0.5; } } });
    b.emitter.emit(1); const events = b.emitter.drainEvents(); assert.deepEqual(events.map(e => e.kind), ["birth", "enter"]); assert.equal(events[0].position.x, 0.5); b.emitter.dispose();
});

test("renderer, atlas and borrowed-resource ownership choices are copied from mutable authoring options", () => {
    const material = new THREE.ShaderMaterial(), runtime = { material }, spriteSheet = { columns: 4, rows: 2, row: 0, fps: 1 }, renderer = { kind: "billboard" };
    const a = setup({ runtime, spriteSheet, renderer, speed: 0, lifetimeMs: 2000 });
    delete runtime.material; spriteSheet.row = 1; spriteSheet.fps = 20; renderer.kind = "mesh";
    a.emitter.emit(1); a.emitter.present(0); a.emitter.present(1000); assert.equal(a.attr("particleDimensions").getZ(0), 1);
    let disposals = 0; material.addEventListener("dispose", () => disposals++); a.emitter.dispose(); assert.equal(disposals, 0); material.dispose();
});

test("completion callbacks can release standalone emitters and system-owned effects after routing", () => {
    let standalone;
    standalone = setup({ lifetimeMs: 100, runtime: { onComplete() { standalone.emitter.dispose(); } } });
    standalone.emitter.emit(1); standalone.emitter.present(0); standalone.emitter.present(100); assert.equal(standalone.emitter.inspect().disposed, true);
    const camera = new THREE.PerspectiveCamera(), scene = new THREE.Group(); let effect, called = 0;
    const system = createParticleSystem(scene, { camera, cull: true, onComplete() { called++; effect.dispose(); } });
    effect = system.createEffect(defineParticleEffect({ emitters: [{ id: "main", options: { bursts: [{ timeMs: 0, count: 1 }], lifetimeMs: 100 } }] }));
    system.present(0); system.present(100); assert.equal(called, 1); assert.equal(system.inspect().reservedParticles, 0); system.dispose();
});

test("smooth opacity and paired color/velocity curves use a stable linear-space blend", () => {
    const a = setup({ seed: 0x80000000, speed: 0, lifetimeMs: 4000,
        velocityOverLife: { x: { min: constant(1), max: constant(3) } },
        colorOverLife: { min: constant(0xff0000), max: constant(0x0000ff) },
        opacityOverLife: [{ time: 0, value: 0, interpolation: "smooth" }, { time: 1, value: 1 }] });
    a.emitter.emit(1); a.emitter.present(0); a.emitter.present(1000);
    close(a.centers()[0], 2); close(a.attr("particleAppearance").getX(0), 0.5); close(a.attr("particleAppearance").getZ(0), 0.5); close(a.attr("particleAppearance").getW(0), 0.15625); a.emitter.dispose();
});

test("emitter completion callbacks in effects run after their final child events have been routed", () => {
    let effect, childrenAtCompletion = 0;
    effect = createParticleEffect(new THREE.Group(), defineParticleEffect({ emitters: [
        { id: "source", options: { lifetimeMs: 100, bursts: [{ timeMs: 0, count: 1 }] } },
        { id: "child", options: { lifetimeMs: 300 } },
    ], subEmitters: [{ source: "source", target: "child", event: "death", count: 2 }] }), {
        runtime: { source: { onComplete() { childrenAtCompletion = effect.inspect().activeParticleCount; effect.dispose(); } } },
    });
    effect.present(0); effect.present(100); assert.equal(childrenAtCompletion, 2); assert.equal(effect.inspect().disposed, true);
});

test("explicit manual and parameter colors take precedence over the randomized initial palette", () => {
    const a = setup({ startColors: [0xff0000], speed: 0 });
    a.emitter.emit(1, { color: 0x0000ff }); assert.equal(a.attr("particleAppearance").getZ(0), 1);
    a.emitter.setParameters({ color: 0x00ff00 }); a.emitter.emit(1); assert.equal(a.attr("particleAppearance").getY(1), 1); a.emitter.dispose();
});

test("Hermite and Bezier curves interpolate and integrate without allowing hidden invalid overshoot", () => {
    for (const interpolation of ["hermite", "bezier"]) {
        const s = setup({ rate: 4, durationMs: 1000, lifetimeMs: 2000, speed: 0, rateOverTime: [{ time: 0, value: 0, interpolation, outTangent: 0, outControl: 0 }, { time: 1, value: 2, inTangent: 0, inControl: 2 }], size: 1, sizeOverLife: [{ time: 0, value: 0, interpolation, outTangent: 0, outControl: 0 }, { time: 1, value: 2, inTangent: 0, inControl: 2 }] });
        s.emitter.emit(1); s.emitter.present(0); s.emitter.present(1000);
        close(s.attr("particleDimensions").getX(0), 1); assert.equal(s.emitter.inspect().emittedParticleCount, 5); s.emitter.dispose();
    }
    assert.throws(() => setup({ opacityOverLife: [{ time: 0, value: 0, interpolation: "bezier", outControl: 10 }, { time: 1, value: 1, inControl: 10 }] }), TypeError);
});

test("axis size and angular speed curves commit once per fixed step across frame partitions", () => {
    const constant = value => [{ time: 0, value }, { time: 1, value }];
    const options = { lifetimeMs: 2000, velocity: { x: 2, y: 0, z: 0 }, simulationStepMs: 20, maxSubSteps: 128, sizeAxesOverLife: { x: constant(2), z: constant(3) }, sizeAxesBySpeed: { range: [0, 4], curves: { y: [{ time: 0, value: 1 }, { time: 1, value: 3 }] } }, angularVelocity3D: { x: 2, y: 3 }, angularVelocityAxesOverLife: { x: constant(2) }, angularVelocityAxesBySpeed: { range: [0, 4], curves: { y: [{ time: 0, value: 1 }, { time: 1, value: 3 }] } } };
    const a = setup(options), b = setup(options);
    for (const s of [a, b]) { s.emitter.emit(1); s.emitter.present(0); }
    a.emitter.present(1000); for (const t of [13, 27, 200, 537, 1000]) b.emitter.present(t);
    assert.deepEqual(Array.from(a.attr("particleRotation").array), Array.from(b.attr("particleRotation").array));
    close(a.attr("particleRotation").getX(0), 4); close(a.attr("particleRotation").getY(0), 6);
    assert.deepEqual(Array.from(a.attr("particleScale").array.slice(0, 3)), [2, 2, 3]);
    a.emitter.dispose(); b.emitter.dispose();
});

test("orbital, radial and speed-modifier modules move particles and report effective velocity", () => {
    const constant = value => [{ time: 0, value }, { time: 1, value }];
    const s = setup({ lifetimeMs: 2000, speed: 0, position: { x: 1, y: 0, z: 0 }, orbitalVelocity: { z: constant(Math.PI / 2) }, simulationStepMs: 10, maxSubSteps: 128, events: true });
    s.emitter.emit(1); s.emitter.present(0); s.emitter.present(1000);
    close(s.centers()[0], 0); close(s.centers()[1], 1); s.emitter.dispose();
    const r = setup({ lifetimeMs: 2000, velocity: { x: 1, y: 0, z: 0 }, position: { x: 1, y: 0, z: 0 }, radialVelocity: constant(1), speedModifier: constant(2), simulationStepMs: 10, maxSubSteps: 128 });
    r.emitter.emit(1); r.emitter.present(0); r.emitter.present(1000); close(r.centers()[0], 4); r.emitter.dispose();
});

test("current emitter velocity inheritance changes already living particles", () => {
    const s = setup({ lifetimeMs: 2000, speed: 0, inheritVelocity: 1, inheritVelocityMode: "current", simulationStepMs: 10, maxSubSteps: 128 });
    s.emitter.present(0); s.emitter.emit(1); s.emitter.setTransform({ x: 1, y: 0, z: 0 }); s.emitter.present(1000); close(s.centers()[0], 1);
    s.emitter.present(1500); close(s.centers()[0], 1); s.emitter.dispose();
});

test("emission surfaces, edges, vertices, arcs, hemispheres and image masks constrain births", () => {
    const shapes = [
        [{ kind: "box", halfExtents: { x: 1, y: 2, z: 3 }, emitFrom: "surface" }, p => Math.abs(p[0]) === 1 || Math.abs(p[1]) === 2 || Math.abs(p[2]) === 3],
        [{ kind: "box", halfExtents: { x: 1, y: 2, z: 3 }, emitFrom: "edge" }, p => [1, 2, 3].filter((v, k) => Math.abs(p[k]) === v).length >= 2],
        [{ kind: "sphere", radius: 1, hemisphere: true }, p => p[1] >= 0],
        [{ kind: "mesh", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], emitFrom: "vertex" }, p => p[0] + p[1] === 0 || p[0] === 1 || p[1] === 1],
        [{ kind: "mesh", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], emitFrom: "edge" }, p => p[0] === 0 || p[1] === 0 || Math.abs(p[0] + p[1] - 1) < 1e-6],
        [{ kind: "circle", radius: 1, mask: { width: 2, height: 1, values: [0, 1], channel: "clip" } }, p => p[0] >= 0],
        [{ kind: "mesh", positions: [-1, 0, 0, 1, 0, 0, 0, 1, 0], uvs: [0, 0, 1, 0, 0.5, 1], mask: { width: 2, height: 1, values: [0, 1] } }, p => p[0] >= 0],
    ];
    for (const [shape, check] of shapes) { const s = setup({ shape, speed: 0 }); assert.equal(s.emitter.emit(100), 100); const p = s.centers(); for (let i = 0; i < p.length; i += 3) assert.ok(check(p.slice(i, i + 3)), JSON.stringify(shape)); s.emitter.dispose(); }
    const arc = setup({ shape: { kind: "ring", radius: 1, arc: { angle: Math.PI, mode: "pingPong", speed: Math.PI } }, speed: 0, lifetimeMs: 5000 });
    arc.emitter.present(0); arc.emitter.present(500); arc.emitter.emit(1); close(arc.centers()[0], 0); close(arc.centers()[2], 1); arc.emitter.dispose();
    const empty = setup({ shape: { kind: "circle", radius: 1, mask: { width: 1, height: 1, values: [0] } } }); assert.equal(empty.emitter.emit(100), 0); assert.equal(empty.emitter.inspect().droppedParticleCount, 100); empty.emitter.dispose();
});

test("collision identity, normal, lifetime loss and runtime triggers survive dense removal", () => {
    const s = setup({ lifetimeMs: 1000, velocity: { x: 0, y: -1, z: 0 }, position: { x: 0, y: 0.1, z: 0 }, simulationStepMs: 10, maxSubSteps: 128, events: true, collision: { colliders: [{ id: "floor", kind: "plane", normal: { x: 0, y: 1, z: 0 }, offset: 0 }], lifetimeLoss: 0.5, bounce: 1 } });
    s.emitter.emit(1); s.emitter.present(0); s.emitter.present(200);
    const contact = s.emitter.drainEvents().find(e => e.kind === "collision"); assert.equal(contact.colliderId, "floor"); assert.deepEqual(contact.normal, { x: 0, y: 1, z: 0 }); assert.ok(contact.remainingLifetimeMs <= 400);
    s.emitter.setTriggers([{ id: "zone", volume: { kind: "sphere", center: { x: 0, y: 0, z: 0 }, radius: 5 } }]); s.emitter.present(250); assert.ok(s.emitter.drainEvents().some(e => e.kind === "enter" && e.triggerId === "zone"));
    s.emitter.setTriggers([]); s.emitter.present(600); assert.equal(s.emitter.inspect().activeParticleCount, 0); s.emitter.dispose();
});

test("sub-emitter appearance, lifetime and probability inheritance use immutable event values", () => {
    const parent = new THREE.Group();
    const effect = createParticleEffect(parent, { emitters: [{ id: "a", options: { speed: 0, color: 0xff0080, size: 0.7, rotation3D: { x: 0.3 }, lifetimeMs: 2345 } }, { id: "b", options: { speed: 0 } }, { id: "c", options: {} }], subEmitters: [{ source: "a", target: "b", event: "birth", count: 1, inheritColor: true, inheritSize: true, inheritRotation: true, inheritLifetime: true }, { source: "a", target: "c", event: "birth", count: 1, probability: 0 }] });
    effect.emit("a", 1); effect.present(0);
    const b = parent.children[0].children[1]; close(b.geometry.getAttribute("particleDimensions").getX(0), 0.7); close(b.geometry.getAttribute("particleRotation").getX(0), 0.3);
    assert.equal(b.geometry.getAttribute("particleAppearance").getX(0), 1); assert.equal(effect.inspect().emitters[2].state.activeParticleCount, 0);
    effect.present(2000); assert.equal(effect.inspect().emitters[1].state.activeParticleCount, 1); effect.dispose();
});

test("octave noise is seeded, axis limited, remapped and can affect only size/rotation", () => {
    const options = { seed: 17, speed: 0, lifetimeMs: 2000, noise: { strength: 1, octaves: 4, strengthAxes: { x: 1, y: 0, z: 0 }, positionAmount: 0, rotationAmount: 1, sizeAmount: 0.5, remap: [{ time: 0, value: 0.5 }, { time: 1, value: 0.5 }] } };
    const a = setup(options); a.emitter.emit(1); a.emitter.present(0); a.emitter.present(500);
    assert.deepEqual(a.centers(), [0, 0, 0]); close(a.attr("particleScale").getX(0), 1.25); close(a.attr("particleRotation").getX(0), 0.5); close(a.attr("particleRotation").getY(0), 0); a.emitter.dispose();
});

test("random bursts no longer repeat every 256 occurrences and hitch skipping stays bounded", () => {
    const s = setup({ capacity: 65536, lifetimeMs: 100000, durationMs: 1000, bursts: [{ timeMs: 0, count: [1, 4], cycles: 600, intervalMs: 1, probability: 0.7 }], events: true, eventCapacity: 10000 });
    s.emitter.present(0); s.emitter.present(600);
    const counts = new Array(600).fill(0); for (const e of s.emitter.drainEvents()) if (e.kind === "birth") counts[e.timeMs]++;
    assert.notDeepEqual(counts.slice(0, 256), counts.slice(256, 512)); s.emitter.dispose();
    const h = setup({ capacity: 10, durationMs: 1, loop: true, bursts: [{ timeMs: 0, count: [1, 2], probability: 0.5 }] }); h.emitter.present(0); h.emitter.present(1e12); assert.ok(h.emitter.inspect().skippedBurstCount > 1e6); h.emitter.dispose();
});

test("recorded replay restores manual births, parent motion, parameters and mesh snapshots within a bounded journal", () => {
    const scene = new THREE.Group(); let height = 0;
    const emitter = createParticleEmitter(scene, { recording: {}, simulationSpace: "world", speed: 0, lifetimeMs: 5000, shape: { kind: "mesh", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] }, runtime: { meshPositions: () => [0, height, 0, 1, height, 0, 0, height + 1, 0] } });
    const snapshot = () => { const mesh = scene.children.find(o => o.name === "three-game-kit-particles"); return Array.from(mesh.geometry.getAttribute("particleCenter").array.slice(0, emitter.inspect().activeParticleCount * 3)); };
    emitter.present(100); emitter.emit(1); scene.position.x = 3; height = 4; emitter.present(600); emitter.emit(2); const expected = snapshot();
    scene.position.x = 50; height = 90; emitter.present(1100); emitter.seek(500, "recorded"); assert.deepEqual(snapshot(), expected); assert.equal(scene.position.x, 50);
    emitter.seek(1000, "recorded"); assert.deepEqual(snapshot(), expected); emitter.dispose(); assert.throws(() => emitter.seek(0, "recorded"));
    const bounded = setup({ recording: { maxCommands: 2 }, speed: 0 }); bounded.emitter.present(0); bounded.emitter.emit(1); bounded.emitter.present(100); assert.equal(bounded.emitter.inspect().recordingFull, true); assert.equal(bounded.emitter.inspect().recordedUntilMs, 0); bounded.emitter.seek(0, "recorded"); assert.equal(bounded.emitter.inspect().activeParticleCount, 1); bounded.emitter.dispose();
});

test("recorded replay branches, replays child emissions once, and keeps callback failures outside its valid prefix", () => {
    const group = new THREE.Group();
    const effect = createParticleEffect(group, { emitters: [{ id: "source", options: { recording: {}, lifetimeMs: 100, speed: 0, events: true } }, { id: "child", options: { recording: {}, lifetimeMs: 1000, speed: 0 } }], subEmitters: [{ source: "source", target: "child", event: "death", count: 3 }] });
    effect.present(0); effect.emit("source", 1); effect.present(200);
    const before = effect.inspect().emitters.map(e => e.state.activeParticleCount);
    effect.present(400); effect.seek(200, "recorded"); assert.deepEqual(effect.inspect().emitters.map(e => e.state.activeParticleCount), before);
    effect.emit("child", 1); effect.present(250); effect.seek(250, "recorded"); assert.equal(effect.inspect().emitters[1].state.activeParticleCount, 4); effect.dispose();
    let e; let error;
    e = createParticleEmitter(new THREE.Group(), { recording: {}, speed: 0, runtime: { update() { try { e.seek(0, "recorded"); } catch (caught) { error = caught; } } } });
    e.present(0); e.emit(1); assert.match(error.message, /reenter/); assert.equal(e.inspect().activeParticleCount, 1); e.dispose();
    const broken = createParticleEmitter(new THREE.Group(), { recording: {}, runtime: { update() { throw new Error("update failed"); } } });
    broken.present(0); assert.throws(() => broken.emit(1), /update failed/); assert.equal(broken.inspect().recordingFull, true); broken.seek(0, "recorded"); assert.equal(broken.inspect().activeParticleCount, 0); broken.dispose();
});

test("local inheritance observes parent movement and sub-emitter size/rotation include source axes", () => {
    const s = setup({ speed: 0, lifetimeMs: 2000, inheritVelocity: 1, inheritVelocityMode: "current", simulationStepMs: 10, maxSubSteps: 128 });
    s.emitter.present(0); s.emitter.emit(1); s.scene.position.x = 2; s.emitter.present(1000); close(s.centers()[0], 2); s.emitter.dispose();
    const parent = new THREE.Group(); parent.rotation.z = Math.PI / 2;
    const effect = createParticleEffect(parent, { emitters: [{ id: "source", options: { speed: 0, sizeAxes: { x: 2, y: 3 }, rotation3D: { x: 0.4 }, events: true } }, { id: "child", options: { speed: 0, simulationSpace: "world" } }], subEmitters: [{ source: "source", target: "child", event: "birth", count: 1, inheritSize: true, inheritRotation: true }] });
    effect.emit("source", 1); effect.present(0); const child = parent.children[0].children[1];
    close(child.geometry.getAttribute("particleScale").getX(0), 2); close(child.geometry.getAttribute("particleScale").getY(0), 3);
    const r = child.geometry.getAttribute("particleRotation"); close(r.getX(0), 0.4); close(r.getZ(0), Math.PI / 2); effect.dispose();
});

test("dynamic input replacement commits fractional angular and inherited-velocity previews without a jump", () => {
    const constant = value => [{ time: 0, value }, { time: 1, value }];
    const s = setup({ speed: 0, lifetimeMs: 2000, inheritVelocity: 1, inheritVelocityMode: "current", simulationStepMs: 100, angularVelocity3D: { x: 2 }, angularVelocityAxesOverLife: { x: constant(2) } });
    s.emitter.present(0); s.emitter.emit(1); s.emitter.setTransform({ x: 0.05, y: 0, z: 0 }); s.emitter.present(50);
    close(s.attr("particleRotation").getX(0), 0.2); close(s.centers()[0], 0.05);
    s.emitter.setCollision({ colliders: [] }); close(s.attr("particleRotation").getX(0), 0.2); close(s.centers()[0], 0.05);
    s.emitter.present(100); close(s.centers()[0], 0.05); close(s.attr("particleRotation").getX(0), 0.4); s.emitter.dispose();
});

test("collision lifetime loss ends at the shortened fractional deadline during catch-up", () => {
    const s = setup({ speed: 0, lifetimeMs: 1000, velocity: { x: 0, y: -1, z: 0 }, position: { x: 0, y: 0.05, z: 0 }, simulationStepMs: 10, maxSubSteps: 128, events: true,
        collision: { colliders: [{ kind: "plane", normal: { x: 0, y: 1, z: 0 }, offset: 0 }], bounce: 1, lifetimeLoss: 0.495 } });
    s.emitter.emit(1); s.emitter.present(0); s.emitter.present(1000);
    const death = s.emitter.drainEvents().find(e => e.kind === "death"); close(death.timeMs, 505); assert.equal(s.emitter.inspect().activeParticleCount, 0); s.emitter.dispose();
});

test("custom simulation space and scaling modes share birth, render and culling transforms", () => {
    const root = new THREE.Group(), parent = new THREE.Group(), reference = new THREE.Group(); root.add(parent, reference);
    root.scale.setScalar(3); parent.position.x = 2; parent.scale.setScalar(2); reference.position.x = 10;
    for (const [mode, expectedScale, expectedBirth] of [["hierarchy", 6, 1], ["local", 2, 1], ["shape", 1, 6]]) {
        const e = createParticleEmitter(parent, { scalingMode: mode, size: 1, speed: 0, position: { x: 1, y: 0, z: 0 } }); e.emit(1);
        const mesh = parent.children[0]; close(mesh.geometry.getAttribute("particleCenter").getX(0), expectedBirth);
        mesh.onBeforeRender(); close(new THREE.Vector3().setFromMatrixScale(mesh.matrixWorld).x, expectedScale); e.dispose();
    }
    const e = createParticleEmitter(parent, { simulationSpace: "custom", runtime: { customSimulationSpace: reference }, position: { x: 1, y: 0, z: 0 }, speed: 0 }); e.emit(1);
    const mesh = parent.children[0]; close(mesh.geometry.getAttribute("particleCenter").getX(0), -6);
    reference.position.x = 12; mesh.onBeforeRender(); close(new THREE.Vector3(-6, 0, 0).applyMatrix4(mesh.matrixWorld).x, 18);
    const camera = new THREE.OrthographicCamera(-30, 30, 30, -30, 0.1, 100); camera.position.z = 20; assert.equal(e.cull(camera), true);
    e.dispose(); assert.throws(() => createParticleEmitter(parent, { simulationSpace: "custom" }), /requires/);
});

test("weighted meshes preserve data, stable birth flips and dense sorting across removal", () => {
    const positions = [-1, 0, 0, 1, 0, 0, 0, 1, 0], uvs = [0.2, 0.3, 0.7, 0.4, 0.6, 0.9], normals = [0, 0, 2, 0, 0, 2, 0, 0, 2];
    const s = setup({ capacity: 100, seed: 37, speed: 0, lifetimeMs: 1000, renderer: { kind: "mesh", flip: { x: 0.5, y: 1, z: 0 }, pivot: { x: 0.2, y: 0, z: 0 }, meshes: [{ positions, uvs, normals, weight: 1 }, { positions: positions.map(v => v * 2), weight: 3 }] } });
    s.emitter.emit(80); s.emitter.present(0);
    const drawCounts = () => s.scene.children.map(m => m.geometry.instanceCount);
    assert.equal(drawCounts().reduce((a, b) => a + b), 80); assert.ok(drawCounts()[1] > drawCounts()[0]);
    assert.deepEqual(Array.from(s.mesh.geometry.getAttribute("normal").array), [0, 0, 1, 0, 0, 1, 0, 0, 1]); close(s.mesh.geometry.getAttribute("uv").getX(0), 0.2);
    const before = s.scene.children.map(m => Array.from(m.geometry.getAttribute("particleFlip").array));
    s.emitter.sort(new THREE.PerspectiveCamera(), "youngest"); s.emitter.sort(new THREE.PerspectiveCamera(), "none");
    assert.deepEqual(s.scene.children.map(m => Array.from(m.geometry.getAttribute("particleFlip").array)), before);
    s.emitter.setRenderOrder(17); assert.ok(s.scene.children.every(m => m.renderOrder === 17));
    s.emitter.present(900); s.emitter.emit(10); s.emitter.present(1000); assert.equal(drawCounts().reduce((a, b) => a + b), 10);
    s.emitter.dispose(); assert.equal(s.scene.children.length, 0);
    assert.throws(() => setup({ renderer: { kind: "mesh", positions, normals: [0, 0, 0] } }), /match/);
    assert.throws(() => setup({ renderer: { kind: "mesh", meshes: [{ positions, weight: 0 }] } }), /weights/);
});

test("age sorting can be reversed and disabled without changing simulation", () => {
    const s = setup({ speed: 0, lifetimeMs: 2000 }); s.emitter.present(0); s.emitter.emit(1, { position: { x: 1, y: 0, z: 0 } });
    s.emitter.present(100); s.emitter.emit(1, { position: { x: 2, y: 0, z: 0 } });
    const camera = new THREE.PerspectiveCamera(); s.emitter.sort(camera, "youngest"); assert.equal(s.attr("particleCenter").getX(0), 2);
    s.emitter.sort(camera, "oldest"); assert.equal(s.attr("particleCenter").getX(0), 1);
    s.emitter.sort(camera, "youngest"); s.emitter.sort(camera, "none"); assert.equal(s.attr("particleCenter").getX(0), 1); s.emitter.dispose();
});

test("atlas frame curves support reverse playback, speed selection and interpolation", () => {
    const s = setup({ speed: 0, lifetimeMs: 1000, spriteSheet: { columns: 4, rows: 1, blend: true, frameOverLife: [{ time: 0, value: 3 }, { time: 1, value: 0 }] } });
    s.emitter.emit(1); s.emitter.present(0); s.emitter.present(500); assert.equal(s.attr("particleDimensions").getZ(0), 1); close(s.attr("particleAtlas").getY(0), 0.5); s.emitter.dispose();
    const v = setup({ velocity: { x: 2, y: 0, z: 0 }, spriteSheet: { columns: 4, rows: 1, frameBySpeed: { range: [0, 4], curve: [{ time: 0, value: 0 }, { time: 1, value: 3 }] } } }); v.emitter.emit(1); assert.equal(v.attr("particleDimensions").getZ(0), 1); v.emitter.dispose();
    assert.throws(() => setup({ spriteSheet: { columns: 4, rows: 1, fps: 2, frameOverLife: [{ time: 0, value: 1 }, { time: 1, value: 2 }] } }), /frame|Frame/);
});

test("velocity limits damp excess speed and constrain individual axes by lifetime", () => {
    const options = { velocity: { x: 10, y: -8, z: 0 }, simulationStepMs: 1000 / 60, maxSubSteps: 100, lifetimeMs: 3000, renderer: { kind: "stretched" }, limitVelocity: { axes: { x: [{ time: 0, value: 2 }, { time: 1, value: 1 }], y: [{ time: 0, value: 3 }, { time: 1, value: 3 }] }, dampen: 0.5 } };
    const a = setup(options), b = setup(options); a.emitter.emit(1); b.emitter.emit(1); a.emitter.present(0); b.emitter.present(0);
    a.emitter.present(100); for (let t = 10; t <= 100; t += 10) b.emitter.present(t);
    close(a.attr("particleVelocity").getX(0), b.attr("particleVelocity").getX(0)); assert.ok(a.attr("particleVelocity").getX(0) > 1.9 && a.attr("particleVelocity").getX(0) < 2.2); close(a.attr("particleVelocity").getY(0), -3.078125, 0.01); a.emitter.dispose(); b.emitter.dispose();
});

test("ribbons connect emission order through sorting, deaths and retained endpoints", () => {
    const s = setup({ speed: 0, lifetimeMs: 200, trails: { mode: "ribbon", ribbonCount: 1, persistMs: 200, width: 0.1 } });
    s.emitter.present(0); s.emitter.emit(1, { position: { x: 0, y: 0, z: 0 } }); s.emitter.present(100);
    s.emitter.emit(1, { position: { x: 1, y: 0, z: 0 } }); s.emitter.emit(1, { position: { x: 2, y: 0, z: 0 } });
    const trail = s.scene.children[1]; assert.equal(trail.geometry.instanceCount, 2); assert.equal(s.emitter.inspect().activeTrailCount, 1);
    const values = () => Array.from(trail.geometry.getAttribute("segmentStart").array.slice(0, 6)); const initial = values();
    s.emitter.sort(new THREE.PerspectiveCamera(), "youngest"); assert.deepEqual(values(), initial);
    s.emitter.present(200); assert.equal(trail.geometry.instanceCount, 2); s.emitter.present(400); assert.equal(trail.geometry.instanceCount, 1);
    s.emitter.present(500); assert.equal(trail.geometry.instanceCount, 0); s.emitter.dispose();
});

test("recorded seeking interpolates observed parent motion and restores external callback state", () => {
    let counter = 0;
    const s = setup({ recording: {}, simulationSpace: "world", rateOverDistance: 1, speed: 0, lifetimeMs: 3000, simulationStepMs: 100, maxSubSteps: 100,
        runtime: { captureState: () => ({ counter }), restoreState: value => { counter = value.counter; }, update: p => { counter++; p.attributes[0] = counter; } }, customAttributes: [{ name: "customCount", size: 1 }] });
    s.emitter.present(0); s.scene.position.x = 10; s.emitter.present(1000); const end = counter;
    counter = 9000; s.emitter.seek(500, "recorded"); assert.equal(s.emitter.inspect().activeParticleCount, 5); assert.ok(counter < end); close(s.scene.position.x, 10);
    s.emitter.seek(1000, "recorded"); assert.equal(counter, end); s.emitter.dispose();
    assert.throws(() => setup({ recording: {}, runtime: { captureState: () => ({ value: Infinity }), restoreState() {} } }), /finite/);
});

test("independent reference trails are never combined into a parent-space batch", () => {
    const scene = new THREE.Group(), a = new THREE.Group(), b = new THREE.Group(); scene.add(a, b); b.position.x = 5;
    const definition = { emitters: ["a", "b"].map(id => ({ id, options: { simulationSpace: "custom", blending: "additive", velocity: { x: 1, y: 0, z: 0 }, trails: { width: 0.1 } } })) };
    const effect = createParticleEffect(scene, definition, { runtime: { a: { customSimulationSpace: a }, b: { customSimulationSpace: b } } });
    effect.emit("a", 1); effect.emit("b", 1); effect.present(0); effect.present(100);
    assert.equal(effect.inspect().drawSavings, 0); effect.dispose();
});

test("recorded boundaries do not restore future inputs and full journals capture branched inputs", () => {
    let input = 1;
    const s = setup({ recording: { maxCommands: 4 }, speed: 0, simulationStepMs: 100, lifetimeMs: 1000,
        runtime: { captureState: () => input, restoreState: state => { input = state; }, update: p => { p.velocity.x = input; } } });
    s.emitter.emit(1); s.emitter.present(0); input = 7; s.emitter.present(100);
    s.emitter.seek(0, "recorded"); assert.equal(input, 1);
    s.emitter.seek(100, "recorded"); input = 8; s.emitter.present(200); s.emitter.present(300); assert.equal(s.emitter.inspect().recordingFull, true);
    s.emitter.seek(100, "recorded"); input = 9; s.emitter.present(200); s.emitter.seek(200, "recorded"); assert.equal(input, 9); s.emitter.dispose();
});

test("sub-emitter routing converts custom reference coordinates and inherited velocity", () => {
    const scene = new THREE.Group(), a = new THREE.Group(), b = new THREE.Group(); a.position.x = 10; a.rotation.z = Math.PI / 2; b.position.x = 20; scene.add(a, b);
    const effect = createParticleEffect(scene, { emitters: ["a", "b"].map(id => ({ id, options: { simulationSpace: "custom", velocity: { x: 1, y: 0, z: 0 }, renderer: { kind: "stretched" } } })), subEmitters: [{ source: "a", target: "b", event: "birth", count: 1, inheritVelocity: 1 }] }, { runtime: { a: { customSimulationSpace: a }, b: { customSimulationSpace: b } } });
    effect.emit("a", 1); effect.present(0); const mesh = scene.children[2].children[1];
    close(mesh.geometry.getAttribute("particleCenter").getX(0), -20); close(mesh.geometry.getAttribute("particleVelocity").getX(0), 1); close(mesh.geometry.getAttribute("particleVelocity").getY(0), 0);
    effect.dispose();
});

test("render priority changes split compatible batches and reject invalid settings before attachment", () => {
    const scene = new THREE.Group(); assert.throws(() => createParticleEmitter(scene, { renderOrder: NaN, trails: {} }), TypeError); assert.equal(scene.children.length, 0);
    const effect = createParticleEffect(scene, { emitters: ["a", "b"].map(id => ({ id, options: { blending: "additive" } })) }); effect.emit("a", 1); effect.emit("b", 1);
    effect.setRenderOrder("b", 2); assert.equal(effect.inspect().drawSavings, 0);
    assert.equal(scene.children[0].children.filter(m => m.visible).length, 2);
    effect.setRenderOrder("a", 2); assert.equal(effect.inspect().drawSavings, 1); effect.dispose();
});

test("recorded initial state enforces serialized bytes and captures runtime hook ownership", () => {
    const scene = new THREE.Group();
    assert.throws(() => createParticleEmitter(scene, { recording: { maxBytes: 1024 }, runtime: { captureState: () => "\u0000".repeat(400), restoreState() {} } }), RangeError);
    assert.equal(scene.children.length, 0);
    let value = 1; const runtime = { captureState: () => value, restoreState: state => { value = state; } };
    const emitter = createParticleEmitter(scene, { recording: {}, runtime }); emitter.present(0);
    runtime.captureState = () => 999; runtime.restoreState = () => { throw new Error("replaced hook"); };
    emitter.present(100); value = 50; emitter.seek(100, "recorded"); assert.equal(value, 1); emitter.dispose();
});

test("observed motion interpolates scheduled birth translations and rotations, preserving local space", () => {
    const options = { interpolateMotion: true, simulationSpace: "world", rate: 4, speed: 0, lifetimeMs: 2000, position: { x: 1, y: 0, z: 0 } };
    const s = setup(options); s.emitter.present(0); s.scene.position.x = 4; s.scene.rotation.z = Math.PI; s.emitter.present(1000);
    const positions = s.centers(); close(positions[0], 1 + Math.SQRT1_2); close(positions[1], Math.SQRT1_2); close(positions[3], 2); close(positions[4], 1); close(positions[9], 3); s.emitter.dispose();
    const local = setup({ ...options, simulationSpace: "local" }); local.emitter.present(0); local.scene.position.x = 4; local.emitter.present(1000); assert.deepEqual(local.centers(), [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]); local.emitter.dispose();
});

test("motion interpolation is partition invariant for linear observed paths and pauses discard movement", () => {
    const options = { interpolateMotion: true, simulationSpace: "world", rate: 10, speed: 0, lifetimeMs: 3000, recording: {} };
    const coarse = setup(options), fine = setup(options); coarse.emitter.present(0); fine.emitter.present(0);
    coarse.scene.position.x = 10; coarse.emitter.present(1000); for (let t = 100; t <= 1000; t += 100) { fine.scene.position.x = t / 100; fine.emitter.present(t); }
    assert.deepEqual(coarse.centers(), fine.centers()); coarse.emitter.seek(500, "recorded"); assert.equal(coarse.emitter.inspect().activeParticleCount, 5);
    const replayed = coarse.scene.children[0].geometry.getAttribute("particleCenter"); close(replayed.getX(0), 1); close(replayed.getX(4), 5);
    fine.emitter.pause(); fine.scene.position.x = 100; fine.emitter.present(2000); fine.emitter.play(); fine.emitter.present(2100); close(fine.attr("particleCenter").getX(10), 100); coarse.emitter.dispose(); fine.emitter.dispose();
});

test("drag curves and size/velocity multipliers reduce velocity on fixed steps", () => {
    const options = { velocity: { x: 10, y: 0, z: 0 }, size: 2, lifetimeMs: 3000, simulationStepMs: 100, renderer: { kind: "stretched" }, drag: { coefficient: [{ time: 0, value: 1 }, { time: 1, value: 2 }], multiplyBySize: true, multiplyByVelocity: true } };
    const a = setup(options), b = setup(options); a.emitter.emit(1); b.emitter.emit(1); a.emitter.present(0); b.emitter.present(0); a.emitter.present(200); b.emitter.present(100); b.emitter.present(200);
    close(a.attr("particleVelocity").getX(0), b.attr("particleVelocity").getX(0)); assert.ok(a.attr("particleVelocity").getX(0) < 2); a.emitter.dispose(); b.emitter.dispose();
    assert.throws(() => setup({ drag: true }), TypeError); assert.throws(() => setup({ drag: { coefficient: -1 } }), TypeError);
});

test("camera stretching samples presentation time once per camera, with independent multi-view history", () => {
    const s = setup({ renderer: { kind: "stretched", cameraScale: 1 } }); const camera = new THREE.PerspectiveCamera(); camera.updateMatrixWorld();
    s.emitter.present(0); s.mesh.onBeforeRender(null, null, camera); camera.position.x = 2; camera.updateMatrixWorld(); s.emitter.present(1000); s.mesh.onBeforeRender(null, null, camera);
    close(s.mesh.material.uniforms.cameraVelocity.value.x, 2); s.mesh.onBeforeRender(null, null, camera); close(s.mesh.material.uniforms.cameraVelocity.value.x, 2);
    s.mesh.onBeforeRender(null, null, new THREE.PerspectiveCamera()); close(s.mesh.material.uniforms.cameraVelocity.value.x, 0); s.emitter.dispose();
    for (const alignment of ["facing", "world", "local", "velocity"]) { const s = setup({ renderer: { kind: "billboard", alignment, allowRoll: false } }); s.emitter.dispose(); }
    assert.throws(() => setup({ renderer: { kind: "mesh", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], alignment: "view" } }), /billboard/);
});

test("particle lights are bounded, follow color/age/space, and release their fixed pool", () => {
    const s = setup({ speed: 0, size: 2, lifetimeMs: 1000, color: 0xff0000, lights: { maxLights: 2, intensity: 4, range: 3, sizeAffectsRange: true, alphaAffectsIntensity: true } }); s.scene.position.x = 5;
    s.emitter.emit(8); s.emitter.present(0); const lights = s.scene.children.filter(o => o.isPointLight); assert.equal(lights.length, 2); assert.equal(s.emitter.inspect().activeLightCount, 2);
    close(lights[0].matrixWorld.elements[12], 5); close(lights[0].distance, 6); close(lights[0].color.r, 1); s.emitter.present(500); close(lights[0].intensity, 2);
    const objects = s.emitter.inspect().liveResourceCounts; assert.equal(objects.objects, 3); assert.equal(objects.geometries, 1);
    s.emitter.clear(); assert.equal(s.emitter.inspect().activeLightCount, 0); assert.ok(lights.every(l => l.intensity === 0)); s.emitter.dispose(); assert.equal(s.scene.children.length, 0);
    assert.throws(() => setup({ lights: { maxLights: 33 } }), TypeError);
});

test("lit trails own adapted PBR/shadow materials while preserving the borrowed source", () => {
    const material = new THREE.MeshStandardMaterial(); let disposed = 0; material.addEventListener("dispose", () => disposed++);
    const s = setup({ velocity: { x: 1, y: 0, z: 0 }, trails: { castShadow: true, receiveShadow: true }, runtime: { trailMaterial: material } });
    s.emitter.emit(1); s.emitter.present(0); s.emitter.present(100); const trail = s.scene.children[1]; assert.ok(trail.material.isMeshStandardMaterial); assert.ok(trail.geometry.getAttribute("normal")); assert.ok(trail.geometry.getAttribute("tangent")); assert.ok(trail.customDepthMaterial); assert.equal(trail.castShadow, true);
    assert.equal(s.emitter.inspect().liveResourceCounts.materials, 5); s.emitter.dispose(); assert.equal(disposed, 0); material.dispose();
});

test("global alpha sorting interleaves mesh variants and emitters, enforces a draw budget and restores fast draws", () => {
    const scene = new THREE.Group(), camera = new THREE.PerspectiveCamera(); camera.position.z = 10;
    const effect = createParticleEffect(scene, { emitters: ["red", "blue"].map((id, i) => ({ id, options: { speed: 0, color: i ? 0x0000ff : 0xff0000 } })) });
    effect.emit("red", 1, { position: { x: 0, y: 0, z: -1 } }); effect.emit("red", 1, { position: { x: 0, y: 0, z: 1 } }); effect.emit("blue", 1);
    effect.sort(camera, "distance", { scope: "global", maxParticles: 3 }); const group = scene.children[0]; const proxies = group.children.filter(o => o.name === "three-game-kit-particle-alpha" && o.visible).sort((a, b) => a.renderOrder - b.renderOrder);
    assert.equal(proxies.length, 3); assert.deepEqual(proxies.map(m => m.geometry.getAttribute("particleAppearance").getX(0)), [1, 0, 1]);
    assert.throws(() => effect.sort(camera, "distance", { scope: "global", maxParticles: 2 }), RangeError); assert.equal(group.children.filter(o => o.name === "three-game-kit-particles" && o.visible).length, 2);
    effect.sort(camera, "distance", { scope: "global" }); effect.present(0); assert.equal(group.children.filter(o => o.name === "three-game-kit-particle-alpha" && o.visible).length, 0); effect.dispose(); assert.equal(scene.children.length, 0);
});

test("global sorting spans system-owned effects and tears down its proxy geometries", () => {
    const scene = new THREE.Group(), system = createParticleSystem(scene), camera = new THREE.PerspectiveCamera();
    for (let i = 0; i < 2; i++) { const e = system.createEffect({ emitters: [{ id: "main", options: { speed: 0 } }] }); e.emit("main", 2); }
    system.sort(camera); let proxies = 0; scene.traverse(o => { if (o.name === "three-game-kit-particle-alpha" && o.visible) proxies++; }); assert.equal(proxies, 4);
    system.dispose(); assert.equal(scene.children.length, 0);
});

test("global sorting remains active through culling and does not dispose borrowed vertex buffers", () => {
    const s = setup({ speed: 0 }); s.emitter.emit(3);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10); camera.position.z = 3;
    s.emitter.sort(camera, "distance", { scope: "global" }); const proxies = s.scene.children.filter(o => o.name === "three-game-kit-particle-alpha");
    s.emitter.cull(camera); assert.ok(proxies.every(o => o.visible)); assert.equal(s.mesh.visible, false);
    camera.position.x = 100; s.emitter.cull(camera); assert.ok(proxies.every(o => !o.visible)); camera.position.x = 0; s.emitter.cull(camera); assert.ok(proxies.every(o => o.visible));
    s.emitter.clear(); s.emitter.emit(1); s.emitter.sort(camera, "distance", { scope: "global", maxParticles: 1 }); assert.equal(s.scene.children.filter(o => o.name === "three-game-kit-particle-alpha").length, 1); s.emitter.dispose();
});
