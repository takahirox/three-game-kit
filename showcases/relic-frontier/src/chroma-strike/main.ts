/// <reference lib="dom" />
import { createStrikeGame, type StrikeGame } from "./game.js";
import { createStrikeRenderer, type StrikeRenderer, type StrikeRendererInspection } from "./renderer.js";
import type { StrikeAction, StrikeEvent, StrikeInput, StrikeScenario, StrikeSnapshot } from "./state.js";

type StrikeMode = "normal" | "test";
interface StrikeHostError { readonly source: string; readonly message: string; }

export interface ChromaStrikeHandle {
  readonly ready: boolean;
  readonly screenshotReady: boolean;
  readonly mode: StrikeMode;
  start(): void;
  restart(): void;
  setInput(input: Partial<StrikeInput>): void;
  press(action: StrikeAction): void;
  advance(seconds: number): number;
  loadScenario(scenario: StrikeScenario): void;
  snapshot(): StrikeSnapshot;
  events(): readonly StrikeEvent[];
  errors(): readonly StrikeHostError[];
  inspectRenderer(): StrikeRendererInspection | null;
  inspectVfx(): ReturnType<StrikeRenderer["inspectVfx"]> | null;
  inspectLeaks(): Readonly<{ hostListeners: number; rafActive: boolean; hostDisposed: boolean; game: ReturnType<StrikeGame["inspectLeaks"]> | null }>;
  dispose(): void;
}

declare global { interface Window { __CHROMA_STRIKE__?: ChromaStrikeHandle; } }

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`Chroma Strike host: missing ${selector}`);
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#strike-canvas");
const hud = requireElement<HTMLElement>("#strike-hud");
const titleScreen = requireElement<HTMLElement>("#title-screen");
const countdownScreen = requireElement<HTMLElement>("#countdown-screen");
const resultScreen = requireElement<HTMLElement>("#result-screen");
const resultTitle = requireElement<HTMLElement>("#result-title");
const resultCopy = requireElement<HTMLElement>("#result-copy");
const countdownValue = requireElement<HTMLElement>("#countdown-value");
const timerValue = requireElement<HTMLElement>("#timer-value");
const killsValue = requireElement<HTMLElement>("#kills-value");
const healthValue = requireElement<HTMLElement>("#health-value");
const healthBar = requireElement<HTMLElement>("#health-bar");
const ammoValue = requireElement<HTMLElement>("#ammo-value");
const reserveValue = requireElement<HTMLElement>("#reserve-value");
const reloadValue = requireElement<HTMLElement>("#reload-value");
const scoreValue = requireElement<HTMLElement>("#score-value");
const accuracyValue = requireElement<HTMLElement>("#accuracy-value");
const killFeed = requireElement<HTMLElement>("#kill-feed");
const crosshair = requireElement<HTMLElement>("#crosshair");
const status = requireElement<HTMLElement>("#strike-status");
const mode: StrikeMode = new URLSearchParams(location.search).get("test") === "1" ? "test" : "normal";
const hostErrors: StrikeHostError[] = [];
const held = new Set<string>();
const removers: Array<() => void> = [];
let renderer: StrikeRenderer | null = null;
let game: StrikeGame | null = null;
let raf: number | null = null;
let disposed = false;
let lastTime = 0;
let yaw = 0;
let pitch = 0;
let shownEventCount = 0;

function listen(target: EventTarget, type: string, listener: EventListener): void {
  target.addEventListener(type, listener);
  removers.push(() => target.removeEventListener(type, listener));
}

function record(source: string, cause: unknown): void {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (hostErrors.length >= 64) hostErrors.shift();
  hostErrors.push(Object.freeze({ source, message }));
  status.textContent = `Runtime error: ${message}`;
}

function updateMovement(): void {
  const moveX = Number(held.has("KeyD")) - Number(held.has("KeyA"));
  const moveY = Number(held.has("KeyS")) - Number(held.has("KeyW"));
  game?.setInput({ moveX, moveY, yaw, pitch });
}

function updateHud(snapshot: StrikeSnapshot): void {
  hud.dataset.phase = snapshot.phase;
  titleScreen.hidden = snapshot.phase !== "title";
  countdownScreen.hidden = snapshot.phase !== "countdown";
  resultScreen.hidden = snapshot.phase !== "results" && snapshot.phase !== "defeated";
  countdownValue.textContent = snapshot.countdown === 1 ? "GO" : String(snapshot.countdown);
  timerValue.textContent = snapshot.remainingSeconds.toFixed(1);
  killsValue.textContent = `${snapshot.kills}/${snapshot.targetKills}`;
  healthValue.textContent = String(snapshot.player.health);
  healthBar.style.width = `${snapshot.player.health}%`;
  ammoValue.textContent = String(snapshot.ammo).padStart(2, "0");
  reserveValue.textContent = String(snapshot.reserveAmmo).padStart(2, "0");
  reloadValue.textContent = snapshot.reloadSeconds > 0 ? `RELOADING ${snapshot.reloadSeconds.toFixed(1)}` : snapshot.ammo === 0 ? "R · RELOAD" : "";
  scoreValue.textContent = String(snapshot.score).padStart(4, "0");
  accuracyValue.textContent = snapshot.shots === 0 ? "—" : `${Math.round(snapshot.hits / snapshot.shots * 100)}%`;
  if (snapshot.phase === "results" || snapshot.phase === "defeated") {
    resultTitle.textContent = snapshot.result === "arena-clear" ? "ARENA CLEARED" : snapshot.result === "defeated" ? "SIGNAL LOST" : "TIME";
    resultCopy.textContent = `${snapshot.kills} eliminations · ${snapshot.score} points · ${snapshot.shots === 0 ? 0 : Math.round(snapshot.hits / snapshot.shots * 100)}% accuracy`;
  }
  status.textContent = snapshot.phase === "running" ? "Live match · clear all five targets" : snapshot.phase;
  const events = game?.events() ?? [];
  for (const event of events.slice(shownEventCount)) {
    if (event.kind === "hit") {
      crosshair.classList.remove("hit");
      void crosshair.offsetWidth;
      crosshair.classList.add("hit");
    }
    if (event.kind === "enemy-defeated") {
      killFeed.textContent = `${event.subject?.toUpperCase()} // ELIMINATED`;
      killFeed.classList.remove("show");
      void killFeed.offsetWidth;
      killFeed.classList.add("show");
    }
    if (event.kind === "player-hit") {
      hud.classList.remove("damaged");
      void hud.offsetWidth;
      hud.classList.add("damaged");
    }
  }
  shownEventCount = events.length;
}

function renderNow(): void {
  if (game === null) return;
  game.present(performance.now());
  updateHud(game.snapshot());
}

function boot(): void {
  renderer = createStrikeRenderer(canvas, mode === "test");
  game = createStrikeGame(renderer);
  renderNow();
  if (mode === "normal") {
    lastTime = performance.now();
    const frame = (time: number): void => {
      if (disposed || game === null) return;
      game.advance(Math.min(0.1, Math.max(0, (time - lastTime) / 1000)));
      lastTime = time;
      game.present(time);
      updateHud(game.snapshot());
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }
}

listen(window, "keydown", ((event: KeyboardEvent) => {
  if (["KeyW", "KeyA", "KeyS", "KeyD", "KeyR", "Space"].includes(event.code)) event.preventDefault();
  if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) { held.add(event.code); updateMovement(); }
  if (event.code === "KeyR" && !event.repeat) game?.press("reload");
  if (event.code === "Space" && !event.repeat) game?.press("fire");
  if (mode === "test") { game?.advance(1 / 60); renderNow(); }
}) as EventListener);
listen(window, "keyup", ((event: KeyboardEvent) => { held.delete(event.code); updateMovement(); }) as EventListener);
listen(window, "blur", (() => { held.clear(); updateMovement(); }) as EventListener);
listen(window, "mousemove", ((event: MouseEvent) => {
  if (document.pointerLockElement !== canvas && event.buttons !== 1) return;
  yaw += event.movementX * 0.0025;
  pitch = Math.max(-0.82, Math.min(0.82, pitch - event.movementY * 0.0022));
  game?.setInput({ yaw, pitch });
}) as EventListener);
listen(canvas, "mousedown", ((event: MouseEvent) => {
  if (event.button !== 0 || game?.snapshot().phase !== "running") return;
  game.press("fire");
  if (mode === "normal") void canvas.requestPointerLock();
  else { game.advance(1 / 60); renderNow(); }
}) as EventListener);
listen(canvas, "contextmenu", ((event: Event) => event.preventDefault()) as EventListener);
listen(window, "resize", (() => renderer?.resize()) as EventListener);
listen(window, "error", ((event: ErrorEvent) => record("window.error", event.error ?? event.message)) as EventListener);
listen(window, "unhandledrejection", ((event: PromiseRejectionEvent) => record("unhandledrejection", event.reason)) as EventListener);
for (const button of document.querySelectorAll<HTMLElement>("[data-strike-action]")) {
  listen(button, "click", (() => {
    const action = button.dataset.strikeAction;
    if (action === "start") handle.start();
    if (action === "restart") handle.restart();
  }) as EventListener);
}

const handle: ChromaStrikeHandle = Object.freeze({
  get ready() { return !disposed && game !== null && renderer !== null; },
  get screenshotReady() { return renderer?.screenshotReady ?? false; },
  get mode() { return mode; },
  start() { game?.start(); renderNow(); },
  restart() { game?.restart(); shownEventCount = 0; held.clear(); yaw = 0; pitch = 0; renderNow(); },
  setInput(input: Partial<StrikeInput>) { game?.setInput(input); renderNow(); },
  press(action: StrikeAction) { game?.press(action); },
  advance(seconds: number) { const steps = game?.advance(seconds) ?? 0; renderNow(); return steps; },
  loadScenario(scenario: StrikeScenario) { game?.loadScenario(scenario); shownEventCount = 0; renderNow(); },
  snapshot() { if (game === null) throw new Error("Chroma Strike is not booted"); return game.snapshot(); },
  events() { return game?.events() ?? Object.freeze([]); },
  errors() {
    const gameErrors = game?.errors().map((message) => Object.freeze({ source: "game", message })) ?? [];
    return Object.freeze([...hostErrors, ...gameErrors]);
  },
  inspectRenderer() { return renderer?.inspect() ?? null; },
  inspectVfx() { return renderer?.inspectVfx() ?? null; },
  inspectLeaks() { return Object.freeze({ hostListeners: removers.length, rafActive: raf !== null, hostDisposed: disposed, game: game?.inspectLeaks() ?? null }); },
  dispose() {
    if (disposed) return;
    disposed = true;
    if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
    game?.dispose();
    for (const remove of removers.splice(0)) remove();
    held.clear();
    if (document.pointerLockElement === canvas) void document.exitPointerLock();
    status.textContent = "Chroma Strike disposed";
  },
});

window.__CHROMA_STRIKE__ = handle;
boot();
