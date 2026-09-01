/// <reference lib="dom" />
import { createDomHudAdapter, type HudAdapter } from "@three-game-kit/client/gameplay";
import { createAudioRuntime, createSilentAudioDriver, createWebAudioDriver, type AudioRuntime } from "@three-game-kit/client/audio";
import type { HudState } from "@three-game-kit/shared/gameplay";
import { createRelicFrontierGame, type RelicFrontierGame, type RelicLeakInspection, type RelicRuntimeInspection } from "./game.js";
import { createRelicFrontierRenderer, type RelicFrontierRenderer, type RelicRendererInspection } from "./renderer.js";
import type { RelicAction, RelicEvent, RelicScenario, RelicSnapshot, SemanticInput } from "./state.js";

type HostMode = "normal" | "test";
interface HostError { readonly source: string; readonly message: string; }
export interface RelicFrontierHandle {
  readonly ready: boolean;
  readonly screenshotReady: boolean;
  readonly mode: HostMode;
  readonly status: string;
  start(): void;
  dismissOnboarding(): void;
  restart(): void;
  dispose(): void;
  setInput(input: Partial<SemanticInput>): void;
  press(action: RelicAction): void;
  advance(seconds: number): number;
  loadScenario(id: RelicScenario): void;
  setDebugCamera(enabled: boolean): void;
  snapshot(): RelicSnapshot;
  events(): readonly RelicEvent[];
  errors(): readonly HostError[];
  inspectRuntime(): RelicRuntimeInspection | null;
  inspectRenderer(): RelicRendererInspection | null;
  inspectAssets(): ReturnType<RelicFrontierGame["inspectAssets"]> | null;
  inspectAudio(): ReturnType<RelicFrontierGame["inspectAudio"]> | null;
  inspectLeaks(): Readonly<{ hostListeners: number; rafActive: boolean; hostDisposed: boolean; game: RelicLeakInspection | null }>;
}

declare global { interface Window { __RELIC_FRONTIER__?: RelicFrontierHandle; } }

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`Relic Frontier host: missing ${selector}`);
  return element;
}
const canvas = requireElement<HTMLCanvasElement>("#game-canvas");
const hud = requireElement<HTMLElement>("#hud");
const statusElement = requireElement<HTMLElement>("#status");

function hudRatio(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function createRelicHudAdapter(root: HTMLElement, onAction: (action: string) => void): HudAdapter {
  const dom = createDomHudAdapter(root, { onAction });
  const playerHealth = requireElement<HTMLElement>("#player-health");
  const guardianPanel = requireElement<HTMLElement>("#guardian");
  const guardianHealth = requireElement<HTMLElement>("#guardian-health");
  const onboarding = requireElement<HTMLElement>("#onboarding");
  let lastHealth = -1;
  let lastGuardian = -1;
  let lastGuardianVisible: boolean | null = null;
  let lastOnboarding: boolean | null = null;
  return Object.freeze({
    get disposed(): boolean { return dom.disposed; },
    render(state: HudState): void {
      dom.render(state);
      const health = hudRatio(state.extras.healthRatio);
      if (health !== lastHealth) { lastHealth = health; playerHealth.style.width = `${Math.round(health * 100)}%`; }
      const guardian = hudRatio(state.extras.guardianRatio);
      if (guardian !== lastGuardian) { lastGuardian = guardian; guardianHealth.style.width = `${Math.round(guardian * 100)}%`; }
      const guardianVisible = typeof state.extras.guardian === "string" && state.extras.guardian.length > 0;
      if (guardianVisible !== lastGuardianVisible) { lastGuardianVisible = guardianVisible; guardianPanel.hidden = !guardianVisible; }
      const onboardingVisible = state.extras.onboarding === true;
      if (onboardingVisible !== lastOnboarding) { lastOnboarding = onboardingVisible; onboarding.hidden = !onboardingVisible; }
    },
    inspect() { return dom.inspect(); },
    dispose(): void { dom.dispose(); },
  });
}

const mode: HostMode = new URLSearchParams(location.search).get("test") === "1" ? "test" : "normal";
const hostErrors: HostError[] = [];
let game: RelicFrontierGame | null = null;
let renderer: RelicFrontierRenderer | null = null;
let raf: number | null = null;
let disposed = false;
let lastTime = 0;
let yaw = 0;
let audioContext: AudioContext | null = null;
const held = new Set<string>();
const removers: Array<() => void> = [];

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

function renderNow(): void {
  if (game === null) return;
  game.present(performance.now());
  const snapshot = game.snapshot();
  statusElement.textContent = snapshot.phase === "results"
    ? `Relic secured · Score ${snapshot.score} · ${Math.floor(snapshot.elapsedSeconds)}s`
    : snapshot.objective;
}

function updateMovement(): void {
  const x = (held.has("KeyD") ? 1 : 0) - (held.has("KeyA") ? 1 : 0);
  const y = (held.has("KeyS") ? 1 : 0) - (held.has("KeyW") ? 1 : 0);
  game?.setInput({ moveX: x, moveY: y, cameraYaw: yaw });
}

const actionKeys = new Map<string, RelicAction>([
  ["Space", "jump"], ["ShiftLeft", "dash"], ["ShiftRight", "dash"],
  ["KeyE", "interact"], ["KeyQ", "use-item"], ["KeyF", "ability"],
]);
listen(window, "keydown", ((event: KeyboardEvent) => {
  if (event.code.startsWith("Key") || event.code === "Space" || event.code.startsWith("Shift")) event.preventDefault();
  if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) { held.add(event.code); updateMovement(); }
  if (event.code === "Escape" && !event.repeat) handle.dismissOnboarding();
  const action = actionKeys.get(event.code);
  if (action !== undefined && !event.repeat) { game?.press(action); if (mode === "test") { game?.advance(1 / 60); renderNow(); } }
}) as EventListener);
listen(window, "keyup", ((event: KeyboardEvent) => { held.delete(event.code); updateMovement(); }) as EventListener);
listen(window, "blur", (() => { held.clear(); updateMovement(); }) as EventListener);
listen(canvas, "pointermove", ((event: PointerEvent) => {
  if (event.buttons !== 1) return;
  yaw += event.movementX * 0.005;
  game?.setInput({ cameraYaw: yaw });
}) as EventListener);
listen(canvas, "pointerdown", (() => canvas.focus()) as EventListener);
listen(canvas, "mousedown", ((event: MouseEvent) => {
  if (event.button === 0) { game?.press("attack"); if (mode === "test") { game?.advance(1 / 60); renderNow(); } }
  if (event.button === 2) { event.preventDefault(); game?.press("ability"); if (mode === "test") { game?.advance(1 / 60); renderNow(); } }
}) as EventListener);
listen(canvas, "contextmenu", ((event: Event) => event.preventDefault()) as EventListener);
listen(window, "resize", (() => renderer?.resize()) as EventListener);
listen(window, "error", ((event: ErrorEvent) => record("window.error", event.error ?? event.message)) as EventListener);
listen(window, "unhandledrejection", ((event: PromiseRejectionEvent) => record("unhandledrejection", event.reason)) as EventListener);

function boot(): void {
  renderer = createRelicFrontierRenderer(canvas, mode === "test");
  const audio: AudioRuntime = (() => {
    if (mode === "normal" && typeof AudioContext !== "undefined") {
      audioContext = new AudioContext();
      const runtime = createAudioRuntime(createWebAudioDriver(audioContext));
      for (const [id, frequency] of [["impact", 130], ["pickup", 620], ["victory", 880]] as const) {
        const length = Math.floor(audioContext.sampleRate * 0.14);
        const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
        const data = buffer.getChannelData(0);
        for (let index = 0; index < length; index += 1) data[index] = Math.sin(index / audioContext.sampleRate * frequency * Math.PI * 2) * (1 - index / length) * 0.18;
        runtime.registerClip(id, buffer);
      }
      return runtime;
    }
    const runtime = createAudioRuntime(createSilentAudioDriver());
    for (const id of ["impact", "pickup", "victory"]) runtime.registerClip(id, Object.freeze({ id }));
    return runtime;
  })();
  const adapter = createRelicHudAdapter(hud, (action) => {
    if (action === "start") { game?.start(); renderNow(); }
    if (action === "dismiss-onboarding") handle.dismissOnboarding();
    if (action === "restart") handle.restart();
  });
  game = createRelicFrontierGame({ renderer, hudAdapter: adapter, audio });
  if (mode === "test") {
    queueMicrotask(() => renderNow());
  } else {
    lastTime = performance.now();
    const frame = (time: number): void => {
      if (disposed || game === null) return;
      const seconds = Math.min(0.1, Math.max(0, (time - lastTime) / 1_000));
      lastTime = time;
      game.advance(seconds);
      game.present(time);
      const snapshot = game.snapshot();
      statusElement.textContent = snapshot.phase === "results" ? `Relic secured · Score ${snapshot.score}` : snapshot.objective;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }
}

const handle: RelicFrontierHandle = Object.freeze({
  get ready() { return !disposed && game?.inspectRuntime().lifecycleState === "running"; },
  get screenshotReady() { return renderer?.screenshotReady ?? false; },
  get mode() { return mode; },
  get status() { return statusElement.textContent ?? ""; },
  start() { game?.start(); renderNow(); },
  dismissOnboarding() { game?.dismissOnboarding(); if (mode === "test") game?.advance(1 / 60); renderNow(); },
  restart() {
    game?.dispose();
    void audioContext?.close();
    audioContext = null;
    if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
    game = null;
    renderer = null;
    disposed = false;
    held.clear();
    hostErrors.length = 0;
    boot();
  },
  dispose() {
    if (disposed) return;
    disposed = true;
    if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
    game?.dispose();
    void audioContext?.close();
    audioContext = null;
    for (const remove of removers.splice(0)) remove();
    held.clear();
    statusElement.textContent = "Relic Frontier disposed";
  },
  setInput(input: Partial<SemanticInput>) { game?.setInput(input); renderNow(); },
  press(action: RelicAction) { game?.press(action); },
  advance(seconds: number) { const steps = game?.advance(seconds) ?? 0; renderNow(); return steps; },
  loadScenario(id: RelicScenario) { game?.loadScenario(id); game?.advance(1 / 60); renderNow(); },
  setDebugCamera(enabled: boolean) { game?.setDebugCamera(enabled); renderNow(); },
  snapshot() { if (game === null) throw new Error("Relic Frontier is not booted"); return game.snapshot(); },
  events() { return game?.events() ?? Object.freeze([]); },
  errors() {
    const runtime = game?.errors().map((error) => Object.freeze({ source: "runtime", message: error.message })) ?? [];
    return Object.freeze([...hostErrors, ...runtime]);
  },
  inspectRuntime() { return game?.inspectRuntime() ?? null; },
  inspectRenderer() { return game?.inspectRenderer() ?? null; },
  inspectAssets() { return game?.inspectAssets() ?? null; },
  inspectAudio() { return game?.inspectAudio() ?? null; },
  inspectLeaks() { return Object.freeze({ hostListeners: removers.length, rafActive: raf !== null, hostDisposed: disposed, game: game?.inspectLeaks() ?? null }); },
});

window.__RELIC_FRONTIER__ = handle;
boot();
