import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createParticleEmitter, createParticleFeature } from "@three-game-kit/client/particles";
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
