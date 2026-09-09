/// <reference lib="dom" />
import { createDomHudAdapter, type HudAdapter } from "@three-game-kit/client/gameplay";
import { createBrowserStorageSaveAdapter } from "@three-game-kit/client/genre";
import type { HudState } from "@three-game-kit/shared/gameplay";
import { createInMemorySaveAdapter, type SaveAdapter } from "@three-game-kit/shared/genre";
import { blockByKey } from "./blocks.js";
import {
  createDeepfieldGame,
  type DeepfieldGame,
  type DeepfieldLeakInspection,
  type DeepfieldRuntimeInspection,
  type DeepfieldSaveInspection,
  type DeepfieldWorldInspection,
} from "./game.js";
import { createDeepfieldRenderer, type DeepfieldRenderer, type DeepfieldRendererInspection } from "./renderer.js";
import type { Action, DeepfieldEvent, DeepfieldSnapshot, HeldInput, Scenario } from "./state.js";

type HostMode = "normal" | "test";
interface HostError { readonly source: string; readonly message: string; }

export interface DeepfieldHandle {
  readonly ready: boolean;
  readonly screenshotReady: boolean;
  readonly mode: HostMode;
  readonly status: string;
  start(): void;
  continueWorld(): void;
  dispose(): void;
  setMove(x: number, z: number): void;
  setLook(yaw: number, pitch: number): void;
  look(deltaYaw: number, deltaPitch: number): void;
  setHeld(patch: Partial<HeldInput>): void;
  press(action: Action): void;
  advance(seconds: number): number;
  loadScenario(id: Scenario): void;
  setTimeOfDay(fraction: number): void;
  snapshot(): DeepfieldSnapshot;
  events(): readonly DeepfieldEvent[];
  errors(): readonly HostError[];
  inspectRuntime(): DeepfieldRuntimeInspection | null;
  inspectRenderer(): DeepfieldRendererInspection | null;
  inspectWorld(): DeepfieldWorldInspection | null;
  inspectSave(): DeepfieldSaveInspection | null;
  inspectInventory(): Readonly<Record<string, number>> | null;
  inspectLeaks(): Readonly<{ hostListeners: number; rafActive: boolean; pointerLocked: boolean; hostDisposed: boolean; game: DeepfieldLeakInspection | null }>;
}

declare global { interface Window { __DEEPFIELD__?: DeepfieldHandle; } }

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`Deepfield host: missing ${selector}`);
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#game-canvas");
const hud = requireElement<HTMLElement>("#hud");
const statusElement = requireElement<HTMLElement>("#status");
const params = new URLSearchParams(location.search);
const mode: HostMode = params.get("test") === "1" ? "test" : "normal";
const seedParam = Number(params.get("seed"));
const hostErrors: HostError[] = [];
const held = new Set<string>();
const removers: Array<() => void> = [];
const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
const GAME_KEYS = new Set([...MOVE_KEYS, "Space", "ShiftLeft", "ShiftRight", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "KeyR", "KeyF", "Enter"]);
let game: DeepfieldGame | null = null;
let renderer: DeepfieldRenderer | null = null;
let raf: number | null = null;
let disposed = false;
let lastTime = 0;

function hexColor(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}

function createDeepfieldHudAdapter(root: HTMLElement, onAction: (action: string) => void): HudAdapter {
  const dom = createDomHudAdapter(root, { onAction });
  const hearts = [...root.querySelectorAll<HTMLElement>("#hearts i")];
  const slots = [...root.querySelectorAll<HTMLElement>("#hotbar .slot")];
  const objectives = [...root.querySelectorAll<HTMLElement>("#objectives li")];
  const mineBar = requireElement<HTMLElement>("#mine-bar");
  const saved = requireElement<HTMLElement>("#saved");
  const continueButton = requireElement<HTMLButtonElement>('[data-hud-action="continue"]');
  let lastHealth = -1;
  let lastSlot = -1;
  return Object.freeze({
    get disposed(): boolean { return dom.disposed; },
    render(state: HudState): void {
      dom.render(state);
      const health = Math.round(state.health);
      if (health !== lastHealth) {
        lastHealth = health;
        hearts.forEach((heart, index) => { heart.dataset["fill"] = health >= (index + 1) * 2 ? "full" : health >= index * 2 + 1 ? "half" : "empty"; });
      }
      const selected = Number(state.extras["selectedSlot"] ?? 0);
      slots.forEach((slot, index) => {
        const key = String(state.extras[`slot${index}Key`] ?? "");
        const count = Number(state.extras[`slot${index}`] ?? 0);
        slot.classList.toggle("selected", index === selected);
        slot.classList.toggle("empty", count <= 0);
        const color = blockByKey(key)?.color ?? 0x888888;
        slot.style.setProperty("--block", hexColor(color));
      });
      if (selected !== lastSlot) lastSlot = selected;
      objectives.forEach((item, index) => { item.classList.toggle("done", state.extras[`objective${index}Done`] === true); });
      mineBar.style.width = `${Math.round(Number(state.extras["mining"] ?? 0) * 100)}%`;
      mineBar.parentElement!.hidden = Number(state.extras["mining"] ?? 0) <= 0;
      root.classList.toggle("is-underwater", state.extras["underwater"] === true);
      root.classList.toggle("is-night", state.extras["night"] === true);
      saved.hidden = state.extras["saved"] !== true;
      continueButton.hidden = state.extras["hasSave"] !== true;
    },
    inspect() { return dom.inspect(); },
    dispose(): void { dom.dispose(); },
  });
}

function createSaveAdapter(): SaveAdapter {
  if (mode === "test") return createInMemorySaveAdapter();
  try {
    if (typeof localStorage !== "undefined") return createBrowserStorageSaveAdapter(localStorage, "deepfield:");
  } catch {}
  return createInMemorySaveAdapter();
}

function listen<T extends EventTarget>(target: T, type: string, listener: EventListener, options?: AddEventListenerOptions): void {
  target.addEventListener(type, listener, options);
  removers.push(() => target.removeEventListener(type, listener, options));
}

function record(source: string, cause: unknown): void {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (hostErrors.length >= 64) hostErrors.shift();
  hostErrors.push(Object.freeze({ source, message }));
  statusElement.textContent = `Runtime error: ${message}`;
}

function statusLine(snapshot: DeepfieldSnapshot): string {
  if (snapshot.phase === "title") return "Deepfield · click LAUNCH, then click the world to capture the mouse";
  if (snapshot.phase === "dead") return `Signal lost · respawning in ${Math.ceil(snapshot.respawnTicks / 60)}s`;
  if (snapshot.phase === "complete") return `All objectives complete · ${snapshot.stats.mined} mined · ${snapshot.stats.placed} placed`;
  const p = snapshot.player.position;
  return `${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)} · ${snapshot.target?.blockName ?? "—"} · day ${snapshot.day}`;
}

function renderNow(): void {
  if (game === null) return;
  game.present(performance.now());
  statusElement.textContent = statusLine(game.snapshot());
}

function stepTestFrame(): void {
  if (mode === "test") { game?.advance(1 / 60); renderNow(); }
}

function updateMove(): void {
  const x = (held.has("KeyD") || held.has("ArrowRight") ? 1 : 0) - (held.has("KeyA") || held.has("ArrowLeft") ? 1 : 0);
  const z = (held.has("KeyS") || held.has("ArrowDown") ? 1 : 0) - (held.has("KeyW") || held.has("ArrowUp") ? 1 : 0);
  game?.setMove(x, z);
}

function pointerLocked(): boolean {
  return document.pointerLockElement === canvas;
}

listen(window, "keydown", ((event: KeyboardEvent) => {
  if (!GAME_KEYS.has(event.code)) return;
  event.preventDefault();
  if (event.repeat) return;
  held.add(event.code);
  if (MOVE_KEYS.has(event.code)) updateMove();
  else if (event.code === "Space") game?.press("jump");
  else if (event.code === "ShiftLeft" || event.code === "ShiftRight") game?.press("sprint-start");
  else if (event.code.startsWith("Digit")) game?.press(`select-${event.code.slice(5)}` as Action);
  else if (event.code === "KeyR") game?.press("respawn");
  else if (event.code === "KeyF") game?.press("save");
  else if (event.code === "Enter") { const phase = game?.snapshot().phase; if (phase === "title") game?.press("start"); else if (phase === "complete") game?.press("continue"); }
  stepTestFrame();
}) as EventListener);
listen(window, "keyup", ((event: KeyboardEvent) => {
  if (!GAME_KEYS.has(event.code)) return;
  held.delete(event.code);
  if (MOVE_KEYS.has(event.code)) updateMove();
  else if (event.code === "ShiftLeft" || event.code === "ShiftRight") game?.press("sprint-end");
  stepTestFrame();
}) as EventListener);
listen(window, "blur", (() => { held.clear(); updateMove(); game?.press("sprint-end"); game?.press("mine-end"); }) as EventListener);
listen(canvas, "click", (() => {
  if (mode === "normal" && game?.snapshot().phase === "playing" && !pointerLocked()) void canvas.requestPointerLock?.();
}) as EventListener);
listen(document, "mousemove", ((event: MouseEvent) => {
  if (!pointerLocked()) return;
  game?.look(-event.movementX * 0.0025, -event.movementY * 0.0025);
}) as EventListener);
listen(canvas, "mousedown", ((event: MouseEvent) => {
  if (mode === "normal" && !pointerLocked()) return;
  if (event.button === 0) game?.press("mine-start");
  if (event.button === 2) { event.preventDefault(); game?.press("place"); }
  stepTestFrame();
}) as EventListener);
listen(document, "mouseup", ((event: MouseEvent) => {
  if (event.button === 0) game?.press("mine-end");
  stepTestFrame();
}) as EventListener);
listen(canvas, "contextmenu", ((event: Event) => event.preventDefault()) as EventListener);
listen(canvas, "wheel", ((event: WheelEvent) => {
  if (!pointerLocked() && mode === "normal") return;
  event.preventDefault();
  game?.press(event.deltaY > 0 ? "next-slot" : "previous-slot");
  stepTestFrame();
}) as EventListener, { passive: false });
listen(document, "pointerlockchange", (() => { if (!pointerLocked()) { held.clear(); updateMove(); game?.press("mine-end"); } }) as EventListener);
listen(window, "resize", (() => renderer?.resize()) as EventListener);
listen(window, "error", ((event: ErrorEvent) => record("window.error", event.error ?? event.message)) as EventListener);
listen(window, "unhandledrejection", ((event: PromiseRejectionEvent) => record("unhandledrejection", event.reason)) as EventListener);

function boot(): void {
  renderer = createDeepfieldRenderer(canvas, mode === "test");
  const adapter = createDeepfieldHudAdapter(hud, (action) => {
    if (action === "start") game?.start();
    if (action === "continue") game?.continueWorld();
    if (action === "respawn") game?.press("respawn");
    if (action === "keep-building") game?.press("continue");
    stepTestFrame();
    if (mode === "normal" && (action === "start" || action === "continue")) void canvas.requestPointerLock?.();
  });
  game = createDeepfieldGame({ renderer, hudAdapter: adapter, saveAdapter: createSaveAdapter(), ...(Number.isSafeInteger(seedParam) && seedParam > 0 ? { seed: seedParam } : {}) });
  if (mode === "test") {
    queueMicrotask(() => renderNow());
    return;
  }
  lastTime = performance.now();
  const frame = (time: number): void => {
    if (disposed || game === null) return;
    const seconds = Math.min(0.1, Math.max(0, (time - lastTime) / 1_000));
    lastTime = time;
    game.advance(seconds);
    game.present(time);
    statusElement.textContent = statusLine(game.snapshot());
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}

const handle: DeepfieldHandle = Object.freeze({
  get ready() { return !disposed && game?.inspectRuntime().lifecycleState === "running"; },
  get screenshotReady() { return renderer?.screenshotReady ?? false; },
  get mode() { return mode; },
  get status() { return statusElement.textContent ?? ""; },
  start() { game?.start(); stepTestFrame(); },
  continueWorld() { game?.continueWorld(); stepTestFrame(); },
  dispose() {
    if (disposed) return;
    disposed = true;
    if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
    if (pointerLocked()) document.exitPointerLock();
    game?.dispose();
    for (const remove of removers.splice(0)) remove();
    held.clear();
    statusElement.textContent = "Deepfield disposed";
  },
  setMove(x: number, z: number) { game?.setMove(x, z); },
  setLook(yaw: number, pitch: number) { game?.setLook(yaw, pitch); },
  look(deltaYaw: number, deltaPitch: number) { game?.look(deltaYaw, deltaPitch); },
  setHeld(patch: Partial<HeldInput>) { game?.setHeld(patch); },
  press(action: Action) { game?.press(action); },
  advance(seconds: number) { const steps = game?.advance(seconds) ?? 0; renderNow(); return steps; },
  loadScenario(id: Scenario) { game?.loadScenario(id); game?.advance(1 / 60); renderNow(); },
  setTimeOfDay(fraction: number) { game?.setTimeOfDay(fraction); game?.advance(1 / 60); renderNow(); },
  snapshot() { if (game === null) throw new Error("Deepfield is not booted"); return game.snapshot(); },
  events() { return game?.events() ?? Object.freeze([]); },
  errors() {
    const runtime = game?.errors().map((error) => Object.freeze({ source: "runtime", message: error.message })) ?? [];
    return Object.freeze([...hostErrors, ...runtime]);
  },
  inspectRuntime() { return game?.inspectRuntime() ?? null; },
  inspectRenderer() { return game?.inspectRenderer() ?? null; },
  inspectWorld() { return game?.inspectWorld() ?? null; },
  inspectSave() { return game?.inspectSave() ?? null; },
  inspectInventory() { return game?.inspectInventory() ?? null; },
  inspectLeaks() { return Object.freeze({ hostListeners: removers.length, rafActive: raf !== null, pointerLocked: pointerLocked(), hostDisposed: disposed, game: game?.inspectLeaks() ?? null }); },
});

window.__DEEPFIELD__ = handle;
boot();
