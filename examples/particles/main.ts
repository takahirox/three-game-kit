import * as THREE from "three";
import { createTextures } from "./textures.js";
import { createEffect, PRESETS, type Effect, type PresetId } from "./presets.js";

const canvas = document.querySelector<HTMLCanvasElement>("#renderer")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setClearColor(0x000000, 0);
renderer.info.autoReset = false;
const textures = createTextures();
const gallery = document.querySelector<HTMLElement>("#gallery")!;
const focus = document.querySelector<HTMLElement>("#focus")!;
const focusPreview = document.querySelector<HTMLElement>("#focus-preview")!;
const stats = document.querySelector<HTMLOutputElement>("#stats")!;
const testMode = new URLSearchParams(location.search).has("test");
const views = PRESETS.map((preset, index) => {
    const card = document.createElement("button");
    card.className = "card";
    card.dataset.id = preset.id;
    card.style.setProperty("--effect-color", preset.color);
    card.setAttribute("aria-label", `${preset.name} — ${preset.category}`);
    card.innerHTML = `<div class="card-head"><span class="card-number">${String(index + 1).padStart(2, "0")}${"native" in preset ? ' <span class="new-badge">NEW</span>' : ""}</span><span class="expand">↗</span></div><div class="preview" role="img" aria-label="${preset.name}"></div><div class="card-caption"><h3>${preset.name}</h3><span class="tag">${preset.category}</span></div>`;
    card.onclick = () => select(preset.id);
    gallery.append(card);
    return { preset, card, preview: card.querySelector<HTMLElement>(".preview")!, effect: null as Effect | null };
});
let selected: PresetId | null = null;
let filter = "ALL";
let paused = !testMode && matchMedia("(prefers-reduced-motion: reduce)").matches;
let speed = 1, lastTimestamp: number | null = null, frame = 0, disposed = false;
let renderedIds: string[] = [];
let visibleParticleCount = 0;
let returnFocus: HTMLElement | null = null;
const abort = new AbortController();
const listenerOptions = { signal: abort.signal };
function syncPause(): void {
    document.querySelector("#pause-icon")!.textContent = paused ? "▶" : "Ⅱ";
    document.querySelector("#pause-label")!.textContent = paused ? "Play" : "Pause";
    document.querySelector("#pause")!.setAttribute("aria-pressed", String(paused));
    document.querySelector("#pause")!.setAttribute("aria-label", paused ? "Play" : "Pause");
}
function select(id: PresetId | null): void {
    if (disposed) return;
    const preset = PRESETS.find(p => p.id === id);
    if (id !== null && !preset) throw new TypeError("Unknown particle preset");
    if (id !== null && selected === null) returnFocus = document.activeElement as HTMLElement;
    selected = id;
    document.body.classList.toggle("focused", selected !== null);
    focus.hidden = selected === null;
    gallery.closest("main")!.inert = selected !== null;
    if (preset) {
        document.querySelector("#focus-title")!.textContent = preset.name;
        document.querySelector("#focus-category")!.textContent = preset.category + " / PARTICLE EXPERIMENT";
        document.querySelector<HTMLElement>("#focus-category")!.style.color = preset.color;
        document.querySelector("#focus-description")!.textContent = preset.description;
        document.querySelector("#focus-index")!.textContent = `${String(PRESETS.indexOf(preset) + 1).padStart(2, "0")} / ${PRESETS.length}`;
        focusPreview.setAttribute("aria-label", preset.name);
        document.querySelector<HTMLButtonElement>("#back")!.focus({ preventScroll: true });
    } else returnFocus?.focus({ preventScroll: true });
    render(0);
}
function moveSelection(direction: number): void {
    const index = PRESETS.findIndex(p => p.id === selected);
    select(PRESETS[(index + direction + PRESETS.length) % PRESETS.length]!.id);
}
function resize(): void { renderer.setSize(innerWidth, innerHeight, false); render(0); }
function render(deltaMs: number): void {
    if (disposed) return;
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.info.reset();
    renderer.setScissorTest(true);
    renderedIds = []; visibleParticleCount = 0;
    const bottomLimit = document.querySelector(".transport")!.getBoundingClientRect().top;
    for (const view of views) {
        if (selected ? view.preset.id !== selected : view.card.hidden) continue;
        const rect = (selected ? focusPreview : view.preview).getBoundingClientRect();
        const left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
        const top = Math.max(0, rect.top), bottom = Math.min(bottomLimit, rect.bottom);
        if (bottom <= top || right <= left || rect.width === 0 || rect.height === 0) continue;
        view.effect ??= createEffect(view.preset.id, textures);
        const effect = view.effect;
        effect.camera.aspect = rect.width / rect.height;
        effect.camera.updateProjectionMatrix();
        effect.advance(paused ? 0 : deltaMs * speed, true);
        renderer.setViewport(rect.left, innerHeight - rect.bottom, rect.width, rect.height);
        renderer.setScissor(left, innerHeight - bottom, right - left, bottom - top);
        effect.prepareRender?.(renderer);
        renderer.render(effect.scene, effect.camera);
        renderedIds.push(view.preset.id);
        visibleParticleCount += effect.emitters.reduce((n, e) => n + e.inspect().activeParticleCount, 0);
    }
    renderer.setScissorTest(false);
    stats.value = `${renderedIds.length} LIVE ${renderedIds.length === 1 ? "EFFECT" : "EFFECTS"}  /  ${visibleParticleCount.toLocaleString("en-US")} PARTICLES  /  ${renderer.info.render.calls} DRAWS`;
}
function present(timestampMs: number): void {
    if (disposed) return;
    if (!Number.isFinite(timestampMs) || timestampMs < 0 || (lastTimestamp !== null && timestampMs < lastTimestamp)) throw new TypeError("Time must be monotonic");
    const delta = lastTimestamp === null ? 0 : Math.min(timestampMs - lastTimestamp, 64);
    lastTimestamp = timestampMs;
    render(delta);
}
function animate(timestampMs: number): void {
    if (disposed) return;
    if (!paused) present(timestampMs);
    else lastTimestamp = timestampMs;
    frame = requestAnimationFrame(animate);
}
function dispose(): void {
    if (disposed) return;
    disposed = true; cancelAnimationFrame(frame); abort.abort();
    for (const view of views) { view.effect?.dispose(); view.effect = null; }
    for (const texture of Object.values(textures)) texture.dispose();
    renderer.dispose();
}
document.querySelector("#pause")!.addEventListener("click", () => { paused = !paused; syncPause(); }, listenerOptions);
document.querySelector("#burst")!.addEventListener("click", () => {
    for (const view of views) if (renderedIds.includes(view.preset.id)) view.effect?.burst();
    render(0);
}, listenerOptions);
document.querySelector("#restart")!.addEventListener("click", () => {
    for (const view of views) if (selected === null || selected === view.preset.id) { view.effect?.dispose(); view.effect = null; }
    render(0);
}, listenerOptions);
document.querySelector<HTMLInputElement>("#speed")!.addEventListener("input", event => {
    speed = Number((event.target as HTMLInputElement).value);
    document.querySelector("#speed-value")!.textContent = `${speed}×`;
}, listenerOptions);
document.querySelector("#back")!.addEventListener("click", () => select(null), listenerOptions);
document.querySelector("#next")!.addEventListener("click", () => moveSelection(1), listenerOptions);
document.querySelector(".brand")!.addEventListener("click", event => { event.preventDefault(); select(null); scrollTo({ top: 0 }); }, listenerOptions);
for (const button of document.querySelectorAll<HTMLButtonElement>(".filter")) button.addEventListener("click", () => {
    filter = button.dataset.filter!;
    for (const b of document.querySelectorAll<HTMLButtonElement>(".filter")) { b.classList.toggle("active", b === button); b.setAttribute("aria-pressed", String(b === button)); }
    for (const view of views) view.card.hidden = filter === "NEW" ? !("native" in view.preset) : filter !== "ALL" && view.preset.category !== filter;
    render(0);
}, listenerOptions);
addEventListener("keydown", event => {
    const target = event.target as HTMLElement;
    if (target.matches("input, button, a, textarea, select") && event.key === " ") return;
    if (event.key === "Escape" && selected) select(null);
    if (selected && !target.matches("input")) {
        if (event.key === "ArrowRight") { event.preventDefault(); moveSelection(1); }
        if (event.key === "ArrowLeft") { event.preventDefault(); moveSelection(-1); }
    }
    if (event.key === " " && !target.matches("input, textarea, select")) { event.preventDefault(); paused = !paused; syncPause(); }

}, listenerOptions);
addEventListener("resize", resize, listenerOptions);
addEventListener("scroll", () => { if (testMode || paused) render(0); }, listenerOptions);
addEventListener("visibilitychange", () => { lastTimestamp = null; }, listenerOptions);
addEventListener("pagehide", dispose, { ...listenerOptions, once: true });
syncPause(); resize();
if (testMode) {
    Object.assign(window, { __particles: {
        present, dispose, select,
        inspect: () => ({
            selected, paused, speed, filter, presetCount: PRESETS.length, presetIds: PRESETS.map(p => p.id), renderedIds,
            particles: visibleParticleCount, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
            geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
            programs: renderer.info.programs?.length ?? 0,
            initializedCount: views.filter(v => v.effect).length,
            children: views.reduce((n, v) => n + (v.effect?.scene.children.length ?? 0), 0),
            effects: views.filter(v => v.effect).map(v => ({ id: v.preset.id, drawSavings: v.effect!.drawSavings ?? 0, emitters: v.effect!.emitters.map(e => e.inspect()) })),
            emitters: views.flatMap(v => v.effect?.emitters.map(e => e.inspect()) ?? []),
        }),
        pixelEnergy: () => {
            const gl = renderer.getContext(), pixels = new Uint8Array(canvas.width * canvas.height * 4);
            gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            let bright = 0;
            for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) > 80 && pixels[i + 3]! > 10) bright++;
            return bright;
        },
    } });
} else frame = requestAnimationFrame(animate);
