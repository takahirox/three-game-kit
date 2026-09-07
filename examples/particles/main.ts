import * as THREE from "three";
import { createParticleEmitter } from "@three-game-kit/client/particles";

const canvas = document.querySelector("canvas")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x080d19);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 3, 14); camera.lookAt(0, 1.8, 0);

// A procedural four-frame atlas. Applications can supply any borrowed Three.js texture.
const side = 64, data = new Uint8Array(side * side * 4);
for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const cell = Math.floor(x / 32) + Math.floor(y / 32) * 2;
    const dx = ((x % 32) + 0.5) / 16 - 1, dy = ((y % 32) + 0.5) / 16 - 1;
    const distance = Math.hypot(dx, dy), ring = cell / 4;
    const alpha = Math.max(0, 1 - Math.abs(distance - ring) * (cell === 0 ? 1.5 : 5)) * Math.max(0, 1 - distance);
    const i = (y * side + x) * 4;
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = Math.round(alpha * 255);
}
const atlas = new THREE.DataTexture(data, side, side);
atlas.magFilter = THREE.LinearFilter; atlas.minFilter = THREE.LinearFilter; atlas.needsUpdate = true;
const emitters = [
    createParticleEmitter(scene, {
        capacity: 2048, seed: 19, rate: 240, position: { x: -3.4, y: 0, z: 0 },
        shape: { kind: "cone", radius: 0.15, angle: 0.3 }, speed: [4, 7], lifetimeMs: [700, 1500],
        acceleration: { x: 0, y: -6, z: 0 }, blending: "additive", size: [0.025, 0.085], color: 0xffbc63,
        colorOverLife: [{ time: 0, value: 0xffffff }, { time: 1, value: 0xff2200 }],
    }),
    createParticleEmitter(scene, {
        capacity: 1024, seed: 20, rate: 55, position: { x: 0, y: 0.3, z: 0 },
        shape: { kind: "sphere", radius: 0.3 }, speed: [0.05, 0.3], lifetimeMs: [2000, 4000],
        acceleration: { x: 0.15, y: 1.3, z: 0 }, drag: 0.6, size: [0.25, 0.55], color: 0x7098ae,
        angle: [0, Math.PI * 2], angularVelocity: [-0.3, 0.3],
        sizeOverLife: [{ time: 0, value: 0.3 }, { time: 1, value: 3 }],
        opacityOverLife: [{ time: 0, value: 0 }, { time: 0.2, value: 0.22 }, { time: 1, value: 0 }],
    }),
    createParticleEmitter(scene, {
        capacity: 1024, seed: 21, rate: 65, position: { x: 3.4, y: 1.3, z: 0 },
        shape: { kind: "box", halfExtents: { x: 0.4, y: 0.4, z: 0.4 } }, speed: [0.4, 1.3], lifetimeMs: [1000, 2200],
        acceleration: { x: 0, y: 0.5, z: 0 }, size: [0.15, 0.4], angle: [0, Math.PI * 2], angularVelocity: [-2, 2],
        blending: "additive", texture: atlas, spriteSheet: { columns: 2, rows: 2 },
        colorOverLife: [{ time: 0, value: 0x54ffe2 }, { time: 0.5, value: 0x7baaff }, { time: 1, value: 0xe05fff }],
        sizeOverLife: [{ time: 0, value: 0.1 }, { time: 0.3, value: 1 }, { time: 1, value: 0.1 }],
    }),
];
const output = document.querySelector("output")!;
let disposed = false, frame = 0, time = 0, emitting = true;
function resize(): void { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
function present(timestampMs: number): void {
    if (disposed) return;
    time = timestampMs;
    for (const emitter of emitters) emitter.present(timestampMs);
    emitters[1]!.sort(camera);
    renderer.render(scene, camera);
    output.value = `${emitters.reduce((n, e) => n + e.inspect().activeParticleCount, 0)} particles / ${renderer.info.render.calls} draw calls`;
}
function animate(timestamp: number): void { present(timestamp); frame = requestAnimationFrame(animate); }
function dispose(): void {
    if (disposed) return;
    disposed = true; cancelAnimationFrame(frame); removeEventListener("resize", resize);
    for (const emitter of emitters) emitter.dispose(); atlas.dispose(); renderer.dispose();
}
document.querySelector<HTMLButtonElement>("#emission")!.onclick = event => {
    emitting = !emitting; for (const emitter of emitters) emitter.setEmitting(emitting);
    (event.currentTarget as HTMLButtonElement).textContent = emitting ? "Pause emission" : "Resume emission";
};
document.querySelector<HTMLButtonElement>("#burst")!.onclick = () => { for (const emitter of emitters) emitter.emit(120); present(time); };
document.querySelector<HTMLButtonElement>("#restart")!.onclick = () => {
    for (const emitter of emitters) emitter.restart(); emitting = true;
    document.querySelector("#emission")!.textContent = "Pause emission"; present(time);
};
resize(); addEventListener("resize", resize); addEventListener("pagehide", dispose, { once: true });
present(0);
if (new URLSearchParams(location.search).has("test")) {
    Object.assign(window, { __particles: {
        present, dispose,
        inspect: () => ({ emitters: emitters.map(e => e.inspect()), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, programs: renderer.info.programs?.length ?? 0, children: scene.children.length }),
        pixelEnergy: () => {
            const gl = renderer.getContext(), pixels = new Uint8Array(canvas.width * canvas.height * 4);
            gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            let bright = 0; for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) > 80) bright++;
            return bright;
        },
    } });
} else frame = requestAnimationFrame(animate);
