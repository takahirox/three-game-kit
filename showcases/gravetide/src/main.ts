/// <reference lib="dom" />
import { createDomHudAdapter, type HudAdapter } from "@three-game-kit/client/gameplay";
import { createBrowserStorageSaveAdapter } from "@three-game-kit/client/genre";
import type { HudState } from "@three-game-kit/shared/gameplay";
import { createInMemorySaveAdapter, type SaveAdapter } from "@three-game-kit/shared/genre";
import { createGravetideGame, type GravetideGame, type GravetideLeakInspection, type GravetideRuntimeInspection, type GravetideSaveInspection } from "./game.js";
import { createGravetideRenderer, type GravetideRenderer, type GravetideRendererInspection } from "./renderer.js";
import type { Action, GravetideEvent, GravetideSnapshot, Scenario } from "./state.js";

type HostMode = "normal" | "test";
interface HostError { readonly source: string; readonly message: string; }

export interface GravetideHandle {
  readonly ready: boolean;
  readonly screenshotReady: boolean;
  readonly mode: HostMode;
  readonly status: string;
  start(): void;
  restart(): void;
  dispose(): void;
  setMove(x: number, z: number): void;
  press(action: Action): void;
  advance(seconds: number): number;
  loadScenario(id: Scenario): void;
  grantXp(amount: number): void;
  snapshot(): GravetideSnapshot;
  events(): readonly GravetideEvent[];
  errors(): readonly HostError[];
  inspectRuntime(): GravetideRuntimeInspection | null;
  inspectRenderer(): GravetideRendererInspection | null;
  inspectSave(): GravetideSaveInspection | null;
  inspectLeaks(): Readonly<{ hostListeners: number; rafActive: boolean; hostDisposed: boolean; game: GravetideLeakInspection | null }>;
}

declare global { interface Window { __GRAVETIDE__?: GravetideHandle; } }

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`Gravetide host: missing ${selector}`);
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
const GAME_KEYS = new Set([...MOVE_KEYS, "Space", "Enter", "KeyE", "KeyR", "Digit1", "Digit2", "Digit3"]);
let game: GravetideGame | null = null;
let renderer: GravetideRenderer | null = null;
let raf: number | null = null;
let disposed = false;
let lastTime = 0;

function hexColor(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}

function createGravetideHudAdapter(root: HTMLElement, onAction: (action: string) => void): HudAdapter {
  const dom = createDomHudAdapter(root, { onAction });
  const hpBar = requireElement<HTMLElement>("#hp-bar");
  const xpBar = requireElement<HTMLElement>("#xp-bar");
  const eliteBar = requireElement<HTMLElement>("#elite-bar");
  const elitePanel = requireElement<HTMLElement>("#elite");
  const cards = [...root.querySelectorAll<HTMLElement>("#cards .card")];
  const shrine = requireElement<HTMLElement>("#shrine");
  const bell = requireElement<HTMLElement>("#bell");
  return Object.freeze({
    get disposed(): boolean { return dom.disposed; },
    render(state: HudState): void {
      dom.render(state);
      hpBar.style.width = `${Math.round(Math.max(0, Math.min(1, Number(state.extras["hpRatio"] ?? 0))) * 100)}%`;
      xpBar.style.width = `${Math.round(Math.max(0, Math.min(1, Number(state.extras["xpRatio"] ?? 0))) * 100)}%`;
      const elite = String(state.extras["elite"] ?? "");
      elitePanel.hidden = elite === "";
      eliteBar.style.width = `${Math.round(Math.max(0, Math.min(1, Number(state.extras["eliteRatio"] ?? 0))) * 100)}%`;
      cards.forEach((card, index) => {
        const title = String(state.extras[`card${index}Title`] ?? "");
        card.hidden = title === "";
        card.style.setProperty("--card", hexColor(Number(state.extras[`card${index}Color`] ?? 0xffffff)));
        card.dataset["kind"] = String(state.extras[`card${index}Kind`] ?? "");
      });
      shrine.hidden = state.extras["shrine"] === "" || state.extras["shrine"] === undefined;
      bell.classList.toggle("ready", state.extras["bellReady"] === true);
      root.classList.toggle("is-hurt", Number(state.extras["hpRatio"] ?? 1) < 0.3 && state.screen === "running");
    },
    inspect() { return dom.inspect(); },
    dispose(): void { dom.dispose(); },
  });
}

function createSaveAdapter(): SaveAdapter {
  if (mode === "test") return createInMemorySaveAdapter();
  try {
    if (typeof localStorage !== "undefined") return createBrowserStorageSaveAdapter(localStorage, "gravetide:");
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

function statusLine(snapshot: GravetideSnapshot): string {
  if (snapshot.phase === "title") return "Gravetide · press Enter or click BEGIN THE NIGHT";
  if (snapshot.phase === "levelup") return "Level up · press 1, 2 or 3";
  if (snapshot.phase === "results" || snapshot.phase === "victory") return `${snapshot.result === "dawn" ? "Dawn reached" : "Fallen"} · ${snapshot.kills} kills · level ${snapshot.hero.level}`;
  return `${Math.round(snapshot.remainingSeconds)}s left · ${snapshot.enemies.alive} enemies · level ${snapshot.hero.level}`;
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

listen(window, "keydown", ((event: KeyboardEvent) => {
  if (!GAME_KEYS.has(event.code)) return;
  event.preventDefault();
  if (event.repeat) return;
  held.add(event.code);
  if (MOVE_KEYS.has(event.code)) updateMove();
  else if (event.code === "Digit1") game?.press("choose-1");
  else if (event.code === "Digit2") game?.press("choose-2");
  else if (event.code === "Digit3") game?.press("choose-3");
  else if (event.code === "KeyE" || event.code === "Space") game?.press("bell");
  else if (event.code === "Enter") { const phase = game?.snapshot().phase; if (phase === "title") game?.press("start"); else if (phase === "results" || phase === "victory") game?.press("restart"); }
  else if (event.code === "KeyR") game?.press("restart");
  stepTestFrame();
}) as EventListener);
listen(window, "keyup", ((event: KeyboardEvent) => {
  if (!GAME_KEYS.has(event.code)) return;
  held.delete(event.code);
  if (MOVE_KEYS.has(event.code)) updateMove();
  stepTestFrame();
}) as EventListener);
listen(window, "blur", (() => { held.clear(); updateMove(); }) as EventListener);
listen(canvas, "pointerdown", (() => canvas.focus()) as EventListener);
listen(window, "resize", (() => renderer?.resize()) as EventListener);
listen(window, "error", ((event: ErrorEvent) => record("window.error", event.error ?? event.message)) as EventListener);
listen(window, "unhandledrejection", ((event: PromiseRejectionEvent) => record("unhandledrejection", event.reason)) as EventListener);

function boot(): void {
  renderer = createGravetideRenderer(canvas, mode === "test");
  const adapter = createGravetideHudAdapter(hud, (action) => {
    if (action === "start") game?.start();
    if (action === "restart") game?.restart();
    if (action === "choose-1" || action === "choose-2" || action === "choose-3") game?.press(action);
    stepTestFrame();
  });
  game = createGravetideGame({ renderer, hudAdapter: adapter, saveAdapter: createSaveAdapter(), ...(Number.isSafeInteger(seedParam) && seedParam > 0 ? { seed: seedParam } : {}) });
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

const handle: GravetideHandle = Object.freeze({
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
    statusElement.textContent = "Gravetide disposed";
  },
  setMove(x: number, z: number) { game?.setMove(x, z); },
  press(action: Action) { game?.press(action); },
  advance(seconds: number) { const steps = game?.advance(seconds) ?? 0; renderNow(); return steps; },
  loadScenario(id: Scenario) { game?.loadScenario(id); game?.advance(1 / 60); renderNow(); },
  grantXp(amount: number) { game?.grantXp(amount); game?.advance(1 / 60); renderNow(); },
  snapshot() { if (game === null) throw new Error("Gravetide is not booted"); return game.snapshot(); },
  events() { return game?.events() ?? Object.freeze([]); },
  errors() {
    const runtime = game?.errors().map((error) => Object.freeze({ source: "runtime", message: error.message })) ?? [];
    return Object.freeze([...hostErrors, ...runtime]);
  },
  inspectRuntime() { return game?.inspectRuntime() ?? null; },
  inspectRenderer() { return game?.inspectRenderer() ?? null; },
  inspectSave() { return game?.inspectSave() ?? null; },
  inspectLeaks() { return Object.freeze({ hostListeners: removers.length, rafActive: raf !== null, hostDisposed: disposed, game: game?.inspectLeaks() ?? null }); },
});

window.__GRAVETIDE__ = handle;
boot();
