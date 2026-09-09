/// <reference lib="dom" />
import { createDomHudAdapter, type HudAdapter } from "@three-game-kit/client/gameplay";
import { createBrowserStorageSaveAdapter } from "@three-game-kit/client/genre";
import type { HudState } from "@three-game-kit/shared/gameplay";
import { createInMemorySaveAdapter, type SaveAdapter } from "@three-game-kit/shared/genre";
import type { VfxInspection } from "@three-game-kit/client/vfx";
import { createAfterglowGame, type AfterglowGame, type AfterglowLeakInspection, type AfterglowRuntimeInspection, type AfterglowSaveInspection } from "./game.js";
import { createAfterglowRenderer, type AfterglowRenderer, type AfterglowRendererInspection } from "./renderer.js";
import type { Action, AfterglowEvent, AfterglowSnapshot, Scenario } from "./state.js";
import { createMeridianDescent } from "./track.js";

type HostMode = "normal" | "test";
interface HostError { readonly source: string; readonly message: string; }

export interface AfterglowHandle {
  readonly ready: boolean;
  readonly screenshotReady: boolean;
  readonly mode: HostMode;
  readonly status: string;
  start(): void;
  restart(): void;
  dispose(): void;
  setInput(input: Readonly<{ readonly steer?: number; readonly throttle?: boolean; readonly brake?: boolean; readonly boost?: boolean }>): void;
  press(action: Action): void;
  advance(seconds: number): number;
  loadScenario(id: Scenario): void;
  setBloomEnabled(enabled: boolean): void;
  snapshot(): AfterglowSnapshot;
  events(): readonly AfterglowEvent[];
  errors(): readonly HostError[];
  inspectRuntime(): AfterglowRuntimeInspection | null;
  inspectRenderer(): AfterglowRendererInspection | null;
  inspectVfx(): VfxInspection | null;
  inspectSave(): AfterglowSaveInspection | null;
  inspectLeaks(): Readonly<{ hostListeners: number; rafActive: boolean; hostDisposed: boolean; game: AfterglowLeakInspection | null }>;
}

declare global { interface Window { __AFTERGLOW__?: AfterglowHandle; } }

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`Afterglow host: missing ${selector}`);
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#game-canvas");
const hud = requireElement<HTMLElement>("#hud");
const statusElement = requireElement<HTMLElement>("#status");
const mode: HostMode = new URLSearchParams(location.search).get("test") === "1" ? "test" : "normal";
const hostErrors: HostError[] = [];
const held = new Set<string>();
const removers: Array<() => void> = [];
const STEER_KEYS = new Set(["KeyA", "KeyD", "ArrowLeft", "ArrowRight"]);
const GAME_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "ShiftLeft", "ShiftRight", "KeyR", "Enter"]);
let game: AfterglowGame | null = null;
let renderer: AfterglowRenderer | null = null;
let raf: number | null = null;
let disposed = false;
let lastTime = 0;
let gamepadActive = false;
let gamepadId: string | null = null;
const gamepadButtons = new Map<string, boolean>();

function ratio(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function createAfterglowHudAdapter(root: HTMLElement, onAction: (action: string) => void): HudAdapter {
  const dom = createDomHudAdapter(root, { onAction });
  const heatBar = requireElement<HTMLElement>("#heat-bar");
  const speedBar = requireElement<HTMLElement>("#speed-bar");
  const progressBar = requireElement<HTMLElement>("#progress-bar");
  const cue = requireElement<HTMLElement>("#cue");
  const record = requireElement<HTMLElement>("#record");
  const ghostTag = requireElement<HTMLElement>("#ghost-tag");
  const crash = requireElement<HTMLElement>("#crash");
  const toast = requireElement<HTMLElement>("#toast");
  let lastToast = "";
  let lastHeat = -1;
  let lastSpeed = -1;
  let lastProgress = -1;
  return Object.freeze({
    get disposed(): boolean { return dom.disposed; },
    render(state: HudState): void {
      dom.render(state);
      const heat = ratio(state.extras["heat"]);
      if (heat !== lastHeat) { lastHeat = heat; heatBar.style.width = `${Math.round(heat * 100)}%`; }
      const speed = ratio(state.extras["speedRatio"]);
      if (speed !== lastSpeed) { lastSpeed = speed; speedBar.style.width = `${Math.round(speed * 100)}%`; }
      const progress = ratio(state.extras["progress"]);
      if (progress !== lastProgress) { lastProgress = progress; progressBar.style.width = `${Math.round(progress * 100)}%`; }
      root.classList.toggle("is-boosting", state.extras["boosting"] === true);
      root.classList.toggle("is-critical", heat >= 0.85);
      root.classList.toggle("is-dead", state.extras["alive"] === false);
      cue.dataset["kind"] = String(state.extras["cueKind"] ?? "");
      cue.hidden = state.extras["cue"] === "" || state.extras["cue"] === undefined;
      record.hidden = state.extras["record"] !== true;
      ghostTag.hidden = state.extras["ghost"] !== true || state.screen !== "running";
      crash.hidden = state.extras["alive"] !== false;
      const toastText = String(state.extras["toast"] ?? "");
      if (toastText !== lastToast) {
        lastToast = toastText;
        toast.hidden = toastText === "";
        toast.classList.remove("pop");
        void toast.offsetWidth;
        if (toastText !== "") toast.classList.add("pop");
      }
    },
    inspect() { return dom.inspect(); },
    dispose(): void { dom.dispose(); },
  });
}

function createSaveAdapter(): SaveAdapter {
  if (mode === "test") return createInMemorySaveAdapter();
  try {
    if (typeof localStorage !== "undefined") return createBrowserStorageSaveAdapter(localStorage, "afterglow:");
  } catch {}
  return createInMemorySaveAdapter();
}

function listen<T extends EventTarget>(target: T, type: string, listener: EventListener): void {
  target.addEventListener(type, listener);
  removers.push(() => target.removeEventListener(type, listener));
}

function record(source: string, cause: unknown): void {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (hostErrors.length >= 64) hostErrors.shift();
  hostErrors.push(Object.freeze({ source, message }));
  statusElement.textContent = `Runtime error: ${message}`;
}

function statusLine(snapshot: AfterglowSnapshot): string {
  if (snapshot.phase === "results") return `Finished ${snapshot.finishTimeSeconds?.toFixed(2) ?? "?"}s · ${snapshot.deaths} crashes · ${snapshot.medal}`;
  if (snapshot.phase === "running") return `${Math.round(snapshot.car.s)} m · ${Math.round(snapshot.car.speed * 3.6)} km/h · ${snapshot.cue.label || "clear"}`;
  return snapshot.phase === "countdown" ? "Get ready" : "Meridian Descent · press Space to launch";
}

function renderNow(): void {
  if (game === null) return;
  game.present(performance.now());
  statusElement.textContent = statusLine(game.snapshot());
}

function updateSteer(): void {
  const x = (held.has("KeyD") || held.has("ArrowRight") ? 1 : 0) - (held.has("KeyA") || held.has("ArrowLeft") ? 1 : 0);
  game?.setAxis(x);
}

function stepTestFrame(): void {
  if (mode === "test") { game?.advance(1 / 60); renderNow(); }
}

listen(window, "keydown", ((event: KeyboardEvent) => {
  if (!GAME_KEYS.has(event.code)) return;
  event.preventDefault();
  if (event.repeat) return;
  held.add(event.code);
  if (STEER_KEYS.has(event.code)) updateSteer();
  else game?.pressPhysical(event.code);
  stepTestFrame();
}) as EventListener);
listen(window, "keyup", ((event: KeyboardEvent) => {
  if (!GAME_KEYS.has(event.code)) return;
  held.delete(event.code);
  if (STEER_KEYS.has(event.code)) updateSteer();
  else game?.pressPhysical(`${event.code}:up`);
  stepTestFrame();
}) as EventListener);
listen(window, "blur", (() => {
  for (const code of [...held]) if (!STEER_KEYS.has(code)) game?.pressPhysical(`${code}:up`);
  held.clear();
  updateSteer();
}) as EventListener);
listen(canvas, "pointerdown", (() => canvas.focus()) as EventListener);
listen(window, "resize", (() => renderer?.resize()) as EventListener);
listen(window, "error", ((event: ErrorEvent) => record("window.error", event.error ?? event.message)) as EventListener);
listen(window, "unhandledrejection", ((event: PromiseRejectionEvent) => record("unhandledrejection", event.reason)) as EventListener);

function pollGamepad(): void {
  if (game === null || typeof navigator.getGamepads !== "function") return;
  const pad = [...navigator.getGamepads()].find((candidate) => candidate !== null && candidate.connected);
  const nextId = pad?.id || (pad ? "pad" : null);
  if (gamepadId !== null && nextId !== gamepadId) {
    const releases = [...gamepadButtons].filter(([, pressed]) => pressed).map(([name]) => `${name}-up`);
    game.updateGamepad(gamepadId, 0, releases);
    gamepadButtons.clear();
    gamepadActive = false;
    updateSteer();
  }
  gamepadId = nextId;
  if (pad === undefined || pad === null) return;
  const steer = pad.axes[0] ?? 0;
  const pressedNow = new Map<string, boolean>([
    ["a", (pad.buttons[0]?.pressed ?? false)],
    ["x", (pad.buttons[2]?.pressed ?? false)],
    ["rb", (pad.buttons[5]?.pressed ?? false)],
    ["lt", (pad.buttons[6]?.value ?? 0) > 0.4],
    ["rt", (pad.buttons[7]?.value ?? 0) > 0.4],
    ["start", (pad.buttons[9]?.pressed ?? false)],
  ]);
  const edges: string[] = [];
  for (const [name, pressed] of pressedNow) {
    const before = gamepadButtons.get(name) ?? false;
    if (pressed && !before) edges.push(name === "a" || name === "start" ? name : `${name}-down`);
    if (!pressed && before) edges.push(`${name}-up`);
    gamepadButtons.set(name, pressed);
  }
  const active = Math.abs(steer) > 0.12 || [...pressedNow.values()].some(Boolean) || edges.length > 0;
  if (active) { gamepadActive = true; game.updateGamepad(pad.id || "pad", steer, edges); }
  else if (gamepadActive) { gamepadActive = false; updateSteer(); }
}

function boot(): void {
  const track = createMeridianDescent();
  renderer = createAfterglowRenderer(canvas, track, mode === "test");
  const adapter = createAfterglowHudAdapter(hud, (action) => {
    if (action === "start") { game?.start(); stepTestFrame(); }
    if (action === "restart") { game?.restart(); stepTestFrame(); }
  });
  game = createAfterglowGame({ renderer, hudAdapter: adapter, saveAdapter: createSaveAdapter(), track });
  if (mode === "test") {
    queueMicrotask(() => renderNow());
    return;
  }
  lastTime = performance.now();
  const frame = (time: number): void => {
    if (disposed || game === null) return;
    const seconds = Math.min(0.1, Math.max(0, (time - lastTime) / 1_000));
    lastTime = time;
    pollGamepad();
    game.advance(seconds);
    game.present(time);
    statusElement.textContent = statusLine(game.snapshot());
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}

const handle: AfterglowHandle = Object.freeze({
  get ready() { return !disposed && game?.inspectRuntime().lifecycleState === "running"; },
  get screenshotReady() { return renderer?.screenshotReady ?? false; },
  get mode() { return mode; },
  get status() { return statusElement.textContent ?? ""; },
  start() { game?.start(); stepTestFrame(); },
  restart() { game?.restart(); stepTestFrame(); },
  dispose() {
    if (disposed) return;
    disposed = true;
    if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
    game?.dispose();
    for (const remove of removers.splice(0)) remove();
    held.clear();
    statusElement.textContent = "Afterglow disposed";
  },
  setInput(input: Readonly<{ readonly steer?: number; readonly throttle?: boolean; readonly brake?: boolean; readonly boost?: boolean }>) { game?.setInput(input); },
  press(action: Action) { game?.press(action); },
  advance(seconds: number) { const steps = game?.advance(seconds) ?? 0; renderNow(); return steps; },
  loadScenario(id: Scenario) { game?.loadScenario(id); game?.advance(1 / 60); renderNow(); },
  setBloomEnabled(enabled: boolean) { renderer?.setBloomEnabled(enabled); renderNow(); },
  snapshot() { if (game === null) throw new Error("Afterglow is not booted"); return game.snapshot(); },
  events() { return game?.events() ?? Object.freeze([]); },
  errors() {
    const runtime = game?.errors().map((error) => Object.freeze({ source: "runtime", message: error.message })) ?? [];
    return Object.freeze([...hostErrors, ...runtime]);
  },
  inspectRuntime() { return game?.inspectRuntime() ?? null; },
  inspectRenderer() { return game?.inspectRenderer() ?? null; },
  inspectVfx() { return game?.inspectVfx() ?? null; },
  inspectSave() { return game?.inspectSave() ?? null; },
  inspectLeaks() { return Object.freeze({ hostListeners: removers.length, rafActive: raf !== null, hostDisposed: disposed, game: game?.inspectLeaks() ?? null }); },
});

listen(window, "pagehide", ((event: PageTransitionEvent) => {
  if (!event.persisted) handle.dispose();
}) as EventListener);

window.__AFTERGLOW__ = handle;
boot();
