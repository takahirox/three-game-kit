import * as THREE from "three";
import { createParticleSystem, defineParticleEffect, type ParticleEffectDefinition } from "@three-game-kit/client/particles";

const P = (x = 0, y = 0, z = 0) => ({ x, y, z });
const fade = [{ time: 0, value: 1 }, { time: 0.75, value: 0.7 }, { time: 1, value: 0 }];
const shard = [0, 0.7, 0, -0.25, -0.3, 0.25, 0.25, -0.3, 0.25, 0, 0.7, 0, 0.25, -0.3, 0.25, 0, -0.3, -0.3, 0, 0.7, 0, 0, -0.3, -0.3, -0.25, -0.3, 0.25];
const presets: { id: string; title: string; description: string; definition: ParticleEffectDefinition }[] = [
    { id: "turbulence", title: "Ember turbulence", description: "時間で変わる力と乱流で炎が揺らぎ、火の粉が伸びる。ループ放出と予熱を使用。", definition: { emitters: [
        { id: "main", options: { capacity: 512, rate: 100, durationMs: 2000, loop: true, prewarmMs: 1200, position: P(0, -1.4), shape: { kind: "circle", radius: 0.35 }, velocity: P(0, 1.2), lifetimeMs: [900, 1800], size: [0.18, 0.42], blending: "additive", noise: { strength: 2.5, frequency: 2, scrollSpeed: 1 }, forceOverLife: { y: [{ time: 0, value: 0.3 }, { time: 1, value: 2 }] }, colorOverLife: [{ time: 0, value: 0xffe0a0 }, { time: 0.3, value: 0xff7d20 }, { time: 1, value: 0xa01924 }], opacityOverLife: fade } },
        { id: "sparks", options: { capacity: 128, rate: 24, position: P(0, -1.3), shape: { kind: "cone", radius: 0.3, angle: 0.4 }, speed: [2, 4], lifetimeMs: 1600, size: 0.045, color: 0xffc469, blending: "additive", renderer: { kind: "stretched", velocityScale: 0.12 } } },
    ] } },
    { id: "vortex", title: "Orbital current", description: "リングから生まれた光を渦と吸引力で動かす。軌跡は粒子ごとの履歴から描画。", definition: { emitters: [
        { id: "main", options: { capacity: 128, rate: 24, shape: { kind: "ring", radius: 1.7 }, velocity: P(0, 0.15), lifetimeMs: 4000, size: 0.08, color: 0xa37bff, blending: "additive", forceFields: [{ kind: "vortex", position: P(), axis: P(0, 1), strength: 3, radius: 4 }, { kind: "attractor", position: P(), strength: 1.7, radius: 4 }], trails: { segments: 20, intervalMs: 30, width: 0.035 }, prewarmMs: 1000 } },
    ] } },
    { id: "comet", title: "Ribbon flight", description: "移動距離に応じて光を放出。速度を引き継いだ粒子にリボン状の尾が続く。", definition: { emitters: [
        { id: "main", options: { capacity: 256, rateOverDistance: 35, simulationSpace: "world", velocity: P(), inheritVelocity: 0.25, lifetimeMs: 1600, size: 0.08, color: 0x5be7ff, blending: "additive", drag: 1, trails: { segments: 12, intervalMs: 25, width: 0.025 } } },
    ] } },
    { id: "shards", title: "Crystal impact", description: "立体の結晶が床・球・箱に衝突して跳ねる。速度に向くメッシュ粒子と摩擦を使用。", definition: { emitters: [
        { id: "main", options: { capacity: 128, rate: 18, position: P(0, 1.6), simulationSpace: "world", shape: { kind: "circle", radius: 0.7 }, velocity: P(0.35, -0.5), acceleration: P(0, -4), lifetimeMs: 3500, size: [0.12, 0.24], angularVelocity: [1, 4], color: 0x86dfff, renderer: { kind: "mesh", positions: shard }, collision: { colliders: [{ kind: "plane", normal: P(0, 1), offset: -1.5 }, { kind: "sphere", center: P(-0.5, -0.65), radius: 0.45 }, { kind: "box", min: P(0.4, -1.5, -0.4), max: P(1.1, -0.8, 0.4) }], bounce: 0.65, friction: 0.15, radius: 0.1 }, prewarmMs: 1000 } },
    ] } },
    { id: "cascade", title: "Midnight cascade", description: "上昇する光が消えると花火が開き、火花が床に触れると二次的な光を放つ。", definition: { emitters: [
        { id: "main", options: { capacity: 16, durationMs: 1800, loop: true, bursts: [{ timeMs: 0, count: 1 }], position: P(0, -1.3), velocity: P(0, 3), lifetimeMs: 700, size: 0.12, color: 0xffd67d, blending: "additive", trails: { segments: 16, width: 0.035 } } },
        { id: "bloom", options: { capacity: 512, speed: [0.7, 2], lifetimeMs: [1400, 2200], acceleration: P(0, -1.2), color: 0xff87c4, size: 0.07, blending: "additive", renderer: { kind: "stretched", velocityScale: 0.12 }, collision: { colliders: [{ kind: "plane", normal: P(0, 1), offset: -1.5 }], response: "kill" } } },
        { id: "splash", options: { capacity: 128, shape: { kind: "cone", radius: 0, angle: 1 }, speed: [0.3, 1], lifetimeMs: 300, size: 0.06, color: 0xffffff, blending: "additive" } },
    ], subEmitters: [{ source: "main", target: "bloom", event: "death", count: 80 }, { source: "bloom", target: "splash", event: "collision", count: 3 }] } },
    { id: "surface", title: "Prismatic forge", description: "メッシュの表面と線から放出する二層の光。同じ描画設定のエミッターを1回の描画に統合。", definition: { emitters: [
        { id: "main", options: { capacity: 256, rate: 90, shape: { kind: "mesh", positions: shard }, speed: [0.3, 0.8], size: 0.055, lifetimeMs: 1800, color: 0x58ffc3, blending: "additive", prewarmMs: 1000 } },
        { id: "rim", options: { capacity: 256, rate: 60, shape: { kind: "line", start: P(-1.8, -1), end: P(1.8, -1) }, velocity: P(0, 0.8), lifetimeMs: 1400, size: 0.045, color: 0xaf96ff, blending: "additive", prewarmMs: 1000 } },
    ] } },
];
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(0x080c16); document.body.prepend(renderer.domElement);
const container = document.querySelector("#experiments")!;
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100); camera.position.set(0, 1.8, 7.5); camera.lookAt(0, 0, 0);
const cards = presets.map(preset => {
    const article = document.createElement("article"); article.dataset.id = preset.id;
    article.innerHTML = `<div class="viewport"></div><div class="caption"><h2>${preset.title}</h2><p>${preset.description}</p></div>`; container.append(article);
    const scene = new THREE.Scene();
    const system = createParticleSystem(scene, { camera, cull: true, maxParticles: 2048 });
    const effect = system.createEffect(defineParticleEffect(preset.definition));
    return { id: preset.id, viewport: article.querySelector(".viewport")!, scene, system, effect };
});
let time = 0, clock = 0, lastTime: number | undefined, paused = matchMedia("(prefers-reduced-motion: reduce)").matches, speed = 1, frame = 0, disposed = false;
const pause = document.querySelector<HTMLButtonElement>("#pause")!;
pause.textContent = paused ? "Play" : "Pause";
for (const card of cards) if (paused) card.system.pause();
function draw() {
    if (disposed) return;
    const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); renderer.setScissorTest(false); renderer.clear(); renderer.setScissorTest(true);
    let calls = 0, particles = 0;
    for (const card of cards) {
        const rect = card.viewport.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > h) continue;
        camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix();
        card.effect.cull(camera);
        renderer.setViewport(rect.left, h - rect.bottom, rect.width, rect.height); renderer.setScissor(rect.left, h - rect.bottom, rect.width, rect.height);
        renderer.render(card.scene, camera); calls += renderer.info.render.calls; particles += card.effect.inspect().activeParticleCount;
    }
    document.querySelector("#stats")!.textContent = `${particles.toLocaleString()} visible particles · ${calls} draws`;
}
function present(timestamp: number) {
    const delta = lastTime === undefined ? 0 : Math.max(0, Math.min(100, timestamp - lastTime)); lastTime = timestamp;
    clock += delta;
    if (!paused) time += delta * speed;
    for (const card of cards) {
        if (card.id === "comet") card.effect.setTransform(P(Math.sin(time / 900) * 1.6, Math.cos(time / 650) * 0.8, Math.sin(time / 1200) * 0.5));
        card.system.present(clock);
    }
    draw();
}
function restart() { time = 0; for (const card of cards) { card.effect.restart(); if (paused) card.system.pause(); } present(lastTime ?? 0); }
function burst() { for (const card of cards) card.effect.emit("main", card.id === "cascade" ? 1 : 16); draw(); }
pause.addEventListener("click", () => { paused = !paused; pause.textContent = paused ? "Play" : "Pause"; for (const card of cards) { if (paused) card.system.pause(); else card.system.play(); } });
document.querySelector("#restart")!.addEventListener("click", restart); document.querySelector("#burst")!.addEventListener("click", burst);
document.querySelector<HTMLSelectElement>("#speed")!.addEventListener("change", e => { speed = Number((e.target as HTMLSelectElement).value); for (const card of cards) card.system.setTimeScale(speed); });
document.querySelector<HTMLSelectElement>("#density")!.addEventListener("change", e => { for (const card of cards) card.effect.setParameters({ emissionScale: Number((e.target as HTMLSelectElement).value) }); });
addEventListener("resize", draw); addEventListener("scroll", draw, { passive: true });
function dispose() { if (disposed) return; disposed = true; cancelAnimationFrame(frame); for (const card of cards) card.system.dispose(); renderer.dispose(); renderer.domElement.remove(); }
addEventListener("pagehide", dispose, { once: true });
const testMode = new URLSearchParams(location.search).has("test");
if (testMode) {
    paused = false; pause.textContent = "Pause"; for (const card of cards) card.system.play();
    (window as unknown as { __particleModules: unknown }).__particleModules = {
        present, draw, dispose, burst, restart,
        pixelEnergy: () => cards.map(card => {
            const rect = card.viewport.getBoundingClientRect(), ratio = renderer.getPixelRatio();
            const width = Math.floor(rect.width * ratio), height = Math.floor(rect.height * ratio);
            const pixels = new Uint8Array(width * height * 4), gl = renderer.getContext();
            gl.readPixels(Math.floor(rect.left * ratio), Math.floor((innerHeight - rect.bottom) * ratio), width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            let bright = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! + pixels[i + 1]! + pixels[i + 2]! > 150) bright++;
            return { id: card.id, bright };
        }),
        inspect: () => ({ paused, time, effects: cards.map(c => ({ id: c.id, ...c.effect.inspect() })), geometries: renderer.info.memory.geometries, programs: renderer.info.programs?.length ?? 0, children: cards.reduce((n, c) => n + c.scene.children.length, 0) }),
    };
    for (let i = 0; i <= 90; i++) present(i * 16);
} else {
    const tick = (timestamp: number) => { present(timestamp); if (!disposed) frame = requestAnimationFrame(tick); }; frame = requestAnimationFrame(tick);
}
