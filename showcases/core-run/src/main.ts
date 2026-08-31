/// <reference lib="dom" />
/*
 * Core Run browser host.
 *
 * - Owns every DOM listener and the requestAnimationFrame handle; `dispose()`
 *   removes all of them and is idempotent.
 * - `?test=1` never advances time on its own: every semantic call on
 *   `window.__CORE_RUN__` renders synchronously so screenshots are stable.
 * - Only telemetry events not yet seen by the renderer are handed to it.
 */
import { ticksFromSeconds } from "./feature.js";
import { COMBO_WINDOW_SECONDS } from "./features/deposit.js";
import { createHudViewModel } from "./features/hud.js";
import {
  createCoreRunGame,
  type CoreRunGame,
  type CoreRunLeakCounters,
  type CoreRunRuntimeInspection,
} from "./game.js";
import {
  createCoreRunRenderer,
  type CoreRunRenderer,
  type RendererCounters,
} from "./three-renderer.js";
import type { CoreRunRendererInspection } from "./three-renderer.js";
import type {
  CoreRunSnapshot,
  OneShotAction,
  SemanticInput,
  TelemetryEvent,
} from "./state.js";

export const MAX_FRAME_SECONDS = 0.1;
export const RUNTIME_ERROR_CAPACITY = 64;
export const PENDING_EVENT_CAPACITY = 1024;
export const CAMERA_YAW_PER_PIXEL = 0.005;

export type HostMode = "normal" | "test";
export type HostErrorSource =
  | "window.error"
  | "unhandledrejection"
  | "host"
  | "game";

export interface HostErrorRecord {
  readonly source: HostErrorSource;
  readonly message: string;
  readonly tick: number;
}

export interface CoreRunLeakReport {
  readonly hostListeners: number;
  readonly rafActive: boolean;
  readonly rafHandle: number | null;
  readonly pointerDragging: boolean;
  readonly hostDisposed: boolean;
  readonly game: CoreRunLeakCounters | null;
  readonly renderer: RendererCounters | null;
}

export interface CoreRunTestHandle {
  readonly ready: boolean;
  readonly status: string;
  readonly mode: HostMode;
  readonly screenshotReady: boolean;
  snapshot(): CoreRunSnapshot;
  events(): readonly TelemetryEvent[];
  errors(): readonly HostErrorRecord[];
  setInput(input: Partial<SemanticInput>): void;
  press(action: OneShotAction): void;
  advance(seconds: number): number;
  start(): void;
  retry(): void;
  setDebugCamera(enabled: boolean): void;
  dispose(): void;
  restart(): void;
  inspectLeaks(): CoreRunLeakReport;
  inspectRenderer(): CoreRunRendererInspection | null;
  inspectRuntime(): CoreRunRuntimeInspection | null;
}

declare global {
  interface Window {
    __CORE_RUN__?: CoreRunTestHandle;
  }
}

/* ------------------------------ runtime errors ------------------------------ */

const runtimeErrors: HostErrorRecord[] = [];

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return String(cause);
}

function recordRuntimeError(
  source: HostErrorSource,
  message: string,
  tick: number,
): void {
  if (runtimeErrors.length === RUNTIME_ERROR_CAPACITY) runtimeErrors.shift();
  runtimeErrors.push(Object.freeze({ source, message, tick }));
}

/* ---------------------------------- DOM ---------------------------------- */

interface HostElements {
  readonly canvas: HTMLCanvasElement;
  readonly hudTimer: HTMLElement;
  readonly hudScore: HTMLElement;
  readonly hudComboLabel: HTMLElement;
  readonly hudComboBar: HTMLProgressElement;
  readonly hudCarry: HTMLElement;
  readonly hudDash: HTMLElement;
  readonly overlay: HTMLElement;
  readonly overlayTitle: HTMLElement;
  readonly overlayPremise: HTMLElement;
  readonly overlayControls: HTMLElement;
  readonly startButton: HTMLButtonElement;
  readonly overlayCountdown: HTMLElement;
  readonly results: HTMLElement;
  readonly resultsScore: HTMLElement;
  readonly resultsDeposits: HTMLElement;
  readonly resultsBestCombo: HTMLElement;
  readonly retryButton: HTMLButtonElement;
  readonly status: HTMLElement;
}

function requireElement<T extends HTMLElement>(
  id: string,
  kind: new () => T,
): T {
  const element = document.getElementById(id);
  if (!(element instanceof kind)) {
    throw new Error(`Core Run host: missing element #${id}`);
  }
  return element;
}

function resolveElements(): HostElements {
  return Object.freeze({
    canvas: requireElement("game-canvas", HTMLCanvasElement),
    hudTimer: requireElement("hud-timer", HTMLElement),
    hudScore: requireElement("hud-score", HTMLElement),
    hudComboLabel: requireElement("hud-combo-label", HTMLElement),
    hudComboBar: requireElement("hud-combo-bar", HTMLProgressElement),
    hudCarry: requireElement("hud-carry", HTMLElement),
    hudDash: requireElement("hud-dash", HTMLElement),
    overlay: requireElement("overlay", HTMLElement),
    overlayTitle: requireElement("overlay-title", HTMLElement),
    overlayPremise: requireElement("overlay-premise", HTMLElement),
    overlayControls: requireElement("overlay-controls", HTMLElement),
    startButton: requireElement("start-button", HTMLButtonElement),
    overlayCountdown: requireElement("overlay-countdown", HTMLElement),
    results: requireElement("results", HTMLElement),
    resultsScore: requireElement("results-score", HTMLElement),
    resultsDeposits: requireElement("results-deposits", HTMLElement),
    resultsBestCombo: requireElement("results-best-combo", HTMLElement),
    retryButton: requireElement("retry-button", HTMLButtonElement),
    status: requireElement("status", HTMLElement),
  });
}

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

function setHidden(element: HTMLElement, hidden: boolean): void {
  if (element.hidden !== hidden) element.hidden = hidden;
}

function clampAxis(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

/* --------------------------------- input --------------------------------- */

const MOVE_KEYS = new Map<string, readonly [number, number]>([
  ["KeyW", [0, 1]],
  ["ArrowUp", [0, 1]],
  ["KeyS", [0, -1]],
  ["ArrowDown", [0, -1]],
  ["KeyA", [-1, 0]],
  ["ArrowLeft", [-1, 0]],
  ["KeyD", [1, 0]],
  ["ArrowRight", [1, 0]],
]);

const ONE_SHOT_KEYS = new Map<string, OneShotAction>([
  ["Space", "jump"],
  ["ShiftLeft", "dash"],
  ["ShiftRight", "dash"],
  ["KeyE", "interact"],
]);

interface RegisteredListener {
  readonly target: EventTarget;
  readonly type: string;
  readonly handler: EventListener;
}

/* ---------------------------------- host ---------------------------------- */

class CoreRunHost {
  readonly mode: HostMode;
  private readonly el: HostElements;
  private readonly game: CoreRunGame;
  private readonly renderer: CoreRunRenderer;
  private readonly listeners: RegisteredListener[] = [];
  private readonly unsubscribe: () => void;
  private readonly pendingEvents: TelemetryEvent[] = [];
  private readonly keys = new Set<string>();
  private readonly comboWindowTicks: number;
  private rafHandle: number | null = null;
  private lastFrameMs: number | null = null;
  private cameraYaw = 0;
  private dragPointerId: number | null = null;
  private dragLastX = 0;
  private debugCamera = false;
  private deposits = 0;
  private bestCombo = 0;
  private isDisposed = false;
  private statusText = "";

  constructor(elements: HostElements, mode: HostMode) {
    this.mode = mode;
    this.el = elements;
    this.renderer = createCoreRunRenderer(
      elements.canvas,
      mode === "test" ? { devicePixelRatio: 1 } : {},
    );
    this.game = createCoreRunGame({ renderer: this.renderer });
    this.comboWindowTicks = ticksFromSeconds(COMBO_WINDOW_SECONDS, this.game.dt);
    this.unsubscribe = this.game.subscribe((event) => this.onTelemetry(event));
    this.attachListeners();
    this.setStatus(
      mode === "test"
        ? "Test mode: time advances only via window.__CORE_RUN__.advance()"
        : "Click the arena to focus. WASD move, Space jump, Shift dash, E deposit, drag to look.",
    );
    this.render();
    if (mode === "normal") this.rafHandle = requestAnimationFrame(this.frame);
  }

  get ready(): boolean {
    return (
      this.renderer.screenshotReady &&
      !this.isDisposed &&
      this.game.inspectRuntime().lifecycleState === "running"
    );
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  get status(): string {
    return this.statusText;
  }

  get screenshotReady(): boolean {
    return this.renderer.screenshotReady;
  }

  snapshot(): CoreRunSnapshot {
    return this.game.snapshot();
  }

  events(): readonly TelemetryEvent[] {
    return this.game.events();
  }

  gameErrors(): readonly HostErrorRecord[] {
    return this.game.errors().map((record) =>
      Object.freeze({
        source: "game" as const,
        message: `${record.code}: ${record.message}`,
        tick: record.tick ?? 0,
      }),
    );
  }

  setInput(input: Partial<SemanticInput>): void {
    if (this.isDisposed) return;
    if (input.cameraYaw !== undefined && Number.isFinite(input.cameraYaw)) {
      this.cameraYaw = input.cameraYaw;
    }
    this.game.setInput(input);
    this.render();
  }

  press(action: OneShotAction): void {
    if (this.isDisposed) return;
    this.game.press(action);
    this.render();
  }

  advance(seconds: number): number {
    if (this.isDisposed) return 0;
    const steps = this.game.advance(seconds);
    this.render();
    return steps;
  }

  start(): void {
    if (this.isDisposed) return;
    this.game.start();
    this.render();
  }

  retry(): void {
    if (this.isDisposed) return;
    this.game.retry();
    this.render();
  }

  setDebugCamera(enabled: boolean): void {
    if (this.isDisposed) return;
    this.debugCamera = enabled === true;
    this.render();
  }

  inspectLeaks(): CoreRunLeakReport {
    return Object.freeze({
      hostListeners: this.listeners.length,
      rafActive: this.rafHandle !== null,
      rafHandle: this.rafHandle,
      pointerDragging: this.dragPointerId !== null,
      hostDisposed: this.isDisposed,
      game: this.game.inspectLeaks(),
      renderer: this.renderer.counters(),
    });
  }

  inspectRenderer(): CoreRunRendererInspection {
    return this.renderer.inspect();
  }

  inspectRuntime(): CoreRunRuntimeInspection {
    return this.game.inspectRuntime();
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.endDrag();
    if (document.pointerLockElement === this.el.canvas) {
      try {
        document.exitPointerLock();
      } catch {
        /* pointer lock unsupported */
      }
    }
    for (const entry of this.listeners) {
      entry.target.removeEventListener(entry.type, entry.handler);
    }
    this.listeners.length = 0;
    this.keys.clear();
    this.pendingEvents.length = 0;
    this.unsubscribe();
    this.game.dispose();
    this.setStatus("Core Run host disposed");
  }

  /* ------------------------------- internals ------------------------------- */

  private readonly frame = (timestampMs: number): void => {
    this.rafHandle = null;
    if (this.isDisposed) return;
    try {
      const raw =
        this.lastFrameMs === null ? 0 : (timestampMs - this.lastFrameMs) / 1000;
      const elapsed = Number.isFinite(raw)
        ? Math.max(0, Math.min(MAX_FRAME_SECONDS, raw))
        : 0;
      this.lastFrameMs = timestampMs;
      this.game.advance(elapsed);
      this.render(timestampMs);
    } catch (cause) {
      recordRuntimeError("host", messageOf(cause), this.game.snapshot().tick);
      this.setStatus(`Runtime error stopped the frame loop: ${messageOf(cause)}`);
      return;
    }
    this.rafHandle = requestAnimationFrame(this.frame);
  };

  private render(timestampMs?: number): void {
    if (this.isDisposed) return;
    const snapshot = this.game.snapshot();
    const unseen = this.pendingEvents.splice(0, this.pendingEvents.length);
    this.renderer.prepareFrame(snapshot, unseen, this.debugCamera);
    this.updateDom(snapshot);
    this.game.present(timestampMs ?? snapshot.time * 1000);
  }

  private onTelemetry(event: TelemetryEvent): void {
    if (event.kind === "phaseChanged" && event.to === "countdown") {
      this.deposits = 0;
      this.bestCombo = 0;
    } else if (event.kind === "coreDeposited") {
      this.deposits += 1;
      this.bestCombo = Math.max(this.bestCombo, event.combo);
    }
    if (this.pendingEvents.length === PENDING_EVENT_CAPACITY) {
      this.pendingEvents.shift();
    }
    this.pendingEvents.push(event);
  }

  private updateDom(snapshot: CoreRunSnapshot): void {
    const el = this.el;
    const vm = createHudViewModel(snapshot);
    setText(el.hudTimer, vm.timerLabel);
    setText(el.hudScore, String(vm.score));
    setText(el.hudComboLabel, vm.comboLabel ?? "");
    const progress =
      this.comboWindowTicks > 0
        ? Math.max(0, Math.min(1, snapshot.combo.windowTicks / this.comboWindowTicks))
        : 0;
    if (el.hudComboBar.value !== progress) el.hudComboBar.value = progress;
    setText(el.hudCarry, vm.carryLabel ?? "None");
    const cooldown = snapshot.player.dashCooldownTicks * this.game.dt;
    setText(el.hudDash, vm.dashReady ? "Ready" : `${cooldown.toFixed(1)}s`);
    const dashReady = String(vm.dashReady);
    if (el.hudDash.getAttribute("data-ready") !== dashReady) {
      el.hudDash.setAttribute("data-ready", dashReady);
    }

    const phase = snapshot.phase;
    const showTitle = phase === "title";
    const showResults = phase === "results";
    const countdownText =
      phase === "timeUp"
        ? "TIME UP"
        : phase === "countdown"
          ? (vm.countdownLabel ?? "")
          : "";
    setHidden(el.overlay, phase === "running");
    setHidden(el.overlayTitle, !showTitle);
    setHidden(el.overlayPremise, !showTitle);
    setHidden(el.overlayControls, !showTitle);
    setHidden(el.startButton, !showTitle);
    setText(el.overlayCountdown, countdownText);
    setHidden(el.overlayCountdown, countdownText === "");
    setHidden(el.results, !showResults);
    if (showResults) {
      setText(el.resultsScore, String(vm.score));
      setText(el.resultsDeposits, String(this.deposits));
      setText(el.resultsBestCombo, `x${Math.max(1, this.bestCombo)}`);
    }
  }

  private setStatus(text: string): void {
    this.statusText = text;
    setText(this.el.status, text);
  }

  private listen(target: EventTarget, type: string, handler: EventListener): void {
    target.addEventListener(type, handler);
    this.listeners.push(Object.freeze({ target, type, handler }));
  }

  private attachListeners(): void {
    const canvas = this.el.canvas;
    this.listen(window, "error", (event) => {
      const message =
        event instanceof ErrorEvent ? event.message : "Unknown window error";
      recordRuntimeError("window.error", message, this.game.snapshot().tick);
    });
    this.listen(window, "unhandledrejection", (event) => {
      const message =
        event instanceof PromiseRejectionEvent
          ? messageOf(event.reason)
          : "Unhandled promise rejection";
      recordRuntimeError("unhandledrejection", message, this.game.snapshot().tick);
    });
    this.listen(window, "resize", () => this.renderer.resize());
    this.listen(window, "blur", () => this.clearTransientInput());
    this.listen(document, "visibilitychange", () => {
      if (document.visibilityState === "hidden") this.clearTransientInput();
    });
    this.listen(window, "keydown", (event) => this.onKeyDown(event));
    this.listen(window, "keyup", (event) => this.onKeyUp(event));
    this.listen(canvas, "pointerdown", (event) => this.onPointerDown(event));
    this.listen(canvas, "pointermove", (event) => this.onPointerMove(event));
    this.listen(canvas, "pointerup", (event) => this.onPointerEnd(event));
    this.listen(canvas, "pointercancel", (event) => this.onPointerEnd(event));
    this.listen(canvas, "lostpointercapture", (event) => this.onPointerEnd(event));
    this.listen(canvas, "dblclick", () => this.requestPointerLock());
    this.listen(this.el.startButton, "click", () => {
      this.start();
      this.focusCanvas();
    });
    this.listen(this.el.retryButton, "click", () => {
      this.retry();
      this.focusCanvas();
    });
  }

  private focusCanvas(): void {
    try {
      this.el.canvas.focus({ preventScroll: true });
    } catch {
      /* focus is best-effort */
    }
  }

  private requestPointerLock(): void {
    if (this.mode === "test" || this.isDisposed) return;
    const canvas = this.el.canvas;
    if (typeof canvas.requestPointerLock !== "function") return;
    try {
      const result = canvas.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(() => undefined);
    } catch {
      /* pointer lock is optional */
    }
  }

  private clearTransientInput(): void {
    if (this.isDisposed) return;
    this.keys.clear();
    this.endDrag();
    this.lastFrameMs = null;
    this.game.setInput({ moveX: 0, moveY: 0 });
  }

  private syncMovement(): void {
    let moveX = 0;
    let moveY = 0;
    for (const code of this.keys) {
      const axis = MOVE_KEYS.get(code);
      if (axis === undefined) continue;
      moveX += axis[0];
      moveY += axis[1];
    }
    this.game.setInput({ moveX: clampAxis(moveX), moveY: clampAxis(moveY) });
  }

  private onKeyDown(event: Event): void {
    if (!(event instanceof KeyboardEvent) || this.isDisposed) return;
    const code = event.code;
    const action = ONE_SHOT_KEYS.get(code);
    if (!MOVE_KEYS.has(code) && action === undefined) return;
    if (document.activeElement === this.el.canvas) event.preventDefault();
    if (event.repeat) return;
    if (action !== undefined) {
      this.game.press(action);
      return;
    }
    this.keys.add(code);
    this.syncMovement();
  }

  private onKeyUp(event: Event): void {
    if (!(event instanceof KeyboardEvent) || this.isDisposed) return;
    if (!this.keys.delete(event.code)) return;
    this.syncMovement();
  }

  private onPointerDown(event: Event): void {
    if (!(event instanceof PointerEvent) || this.isDisposed) return;
    if (event.button !== 0) return;
    this.focusCanvas();
    this.dragPointerId = event.pointerId;
    this.dragLastX = event.clientX;
    try {
      this.el.canvas.setPointerCapture(event.pointerId);
    } catch {
      /* capture is best-effort */
    }
  }

  private onPointerMove(event: Event): void {
    if (!(event instanceof PointerEvent) || this.isDisposed) return;
    if (document.pointerLockElement === this.el.canvas) {
      this.applyYawDelta(event.movementX);
      return;
    }
    if (this.dragPointerId !== event.pointerId) return;
    const delta = event.clientX - this.dragLastX;
    this.dragLastX = event.clientX;
    this.applyYawDelta(delta);
  }

  private onPointerEnd(event: Event): void {
    if (!(event instanceof PointerEvent)) return;
    if (this.dragPointerId !== event.pointerId) return;
    this.endDrag();
  }

  private endDrag(): void {
    const pointerId = this.dragPointerId;
    if (pointerId === null) return;
    this.dragPointerId = null;
    try {
      if (this.el.canvas.hasPointerCapture(pointerId)) {
        this.el.canvas.releasePointerCapture(pointerId);
      }
    } catch {
      /* capture already released */
    }
  }

  private applyYawDelta(pixels: number): void {
    if (!Number.isFinite(pixels) || pixels === 0) return;
    const yaw = this.cameraYaw + pixels * CAMERA_YAW_PER_PIXEL;
    this.cameraYaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    this.game.setInput({ cameraYaw: this.cameraYaw });
  }
}

/* ---------------------------------- boot ---------------------------------- */

function isTestMode(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("test") === "1";
  } catch {
    return false;
  }
}

function setStatusText(text: string): void {
  const status = document.getElementById("status");
  if (status !== null) status.textContent = text;
}

const EMPTY_LEAK_REPORT: CoreRunLeakReport = Object.freeze({
  hostListeners: 0,
  rafActive: false,
  rafHandle: null,
  pointerDragging: false,
  hostDisposed: true,
  game: null,
  renderer: null,
});

function boot(): CoreRunTestHandle {
  const mode: HostMode = isTestMode() ? "test" : "normal";
  const slot: { host: CoreRunHost | null; status: string } = {
    host: null,
    status: "",
  };

  const create = (): void => {
    try {
      slot.host = new CoreRunHost(resolveElements(), mode);
      slot.status = slot.host.status;
    } catch (cause) {
      slot.host = null;
      slot.status = `Core Run failed to boot: ${messageOf(cause)}`;
      recordRuntimeError("host", slot.status, 0);
      setStatusText(slot.status);
    }
  };

  const requireHost = (): CoreRunHost => {
    if (slot.host === null) {
      throw new Error(slot.status || "Core Run host is not booted");
    }
    return slot.host;
  };

  create();

  const handle: CoreRunTestHandle = {
    get ready() {
      return slot.host !== null && slot.host.ready;
    },
    get status() {
      return slot.host === null ? slot.status : slot.host.status;
    },
    get mode() {
      return mode;
    },
    get screenshotReady() {
      return slot.host !== null && slot.host.screenshotReady;
    },
    snapshot: () => requireHost().snapshot(),
    events: () => (slot.host === null ? Object.freeze([]) : slot.host.events()),
    errors: () =>
      Object.freeze([
        ...runtimeErrors,
        ...(slot.host === null ? [] : slot.host.gameErrors()),
      ]),
    setInput: (input) => slot.host?.setInput(input),
    press: (action) => slot.host?.press(action),
    advance: (seconds) => slot.host?.advance(seconds) ?? 0,
    start: () => slot.host?.start(),
    retry: () => slot.host?.retry(),
    setDebugCamera: (enabled) => slot.host?.setDebugCamera(enabled),
    dispose: () => slot.host?.dispose(),
    restart: () => {
      slot.host?.dispose();
      create();
    },
    inspectLeaks: () =>
      slot.host === null ? EMPTY_LEAK_REPORT : slot.host.inspectLeaks(),
    inspectRenderer: () => slot.host?.inspectRenderer() ?? null,
    inspectRuntime: () => slot.host?.inspectRuntime() ?? null,
  };

  if (mode === "test" || slot.host === null) window.__CORE_RUN__ = handle;
  return handle;
}

function main(): void {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => boot(), { once: true });
  } else {
    boot();
  }
}

main();
