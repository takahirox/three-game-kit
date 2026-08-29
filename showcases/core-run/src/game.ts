import {
  SIMULATION_DT_SECONDS,
  createTelemetryStore,
  type RuntimeErrorCategory,
  type RuntimeErrorRecord,
  type TelemetryStore,
} from "@three-game-kit/core";
import type { CoreRunFeature, StepContext } from "./feature.js";
import { createCoresFeature } from "./features/cores.js";
import { createDepositFeature } from "./features/deposit.js";
import { createHazardFeature } from "./features/hazard.js";
import { createJumpPadFeature } from "./features/jump-pad.js";
import { createMovementFeature } from "./features/movement.js";
import { createMovingPlatformFeature } from "./features/moving-platform.js";
import {
  beginCountdown,
  countdownValue,
  createRoundTimerFeature,
  remainingSeconds,
} from "./features/round-timer.js";
import {
  createCoreRunState,
  type CoreRunSnapshot,
  type CoreRunState,
  type OneShotAction,
  type SemanticInput,
  type TelemetryEvent,
} from "./state.js";

export const MAX_STEPS_PER_ADVANCE = 600;
export const TELEMETRY_EVENT_CAPACITY = 1024;
const ONE_SHOT_ACTIONS: readonly OneShotAction[] = Object.freeze([
  "jump",
  "dash",
  "interact",
]);

export interface CoreRunLeakCounters {
  /** Telemetry listeners currently subscribed. */
  readonly activeListeners: number;
  /** Feature registrations still attached to the simulation. */
  readonly activeSubscriptions: number;
  /** Host timers owned by the game; always 0 because the game owns none. */
  readonly activeTimers: number;
}

export interface CoreRunGameOptions {
  readonly features?: readonly CoreRunFeature[];
  readonly telemetryStore?: TelemetryStore<"client">;
}

export interface CoreRunGame {
  readonly dt: number;
  readonly disposed: boolean;
  readonly telemetryStore: TelemetryStore<"client">;
  /** Accumulates elapsed seconds into fixed steps; returns steps executed. */
  advance(seconds: number): number;
  setInput(input: Partial<SemanticInput>): void;
  press(action: OneShotAction): void;
  start(): void;
  retry(): void;
  dispose(): void;
  snapshot(): CoreRunSnapshot;
  subscribe(listener: (event: TelemetryEvent) => void): () => void;
  events(): readonly TelemetryEvent[];
  errors(): readonly RuntimeErrorRecord[];
  inspectLeaks(): CoreRunLeakCounters;
}

/** Default Feature order; earlier Features observe a tick before later ones. */
export function createDefaultFeatures(): readonly CoreRunFeature[] {
  return Object.freeze([
    createRoundTimerFeature(),
    createHazardFeature(),
    createMovementFeature(),
    createJumpPadFeature(),
    createMovingPlatformFeature(),
    createDepositFeature(),
    createCoresFeature(),
  ]);
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

class CoreRunGameImplementation implements CoreRunGame {
  readonly dt = SIMULATION_DT_SECONDS;
  readonly telemetryStore: TelemetryStore<"client">;
  private features: readonly CoreRunFeature[];
  private state: CoreRunState = createCoreRunState();
  private accumulator = 0;
  private isDisposed = false;
  private readonly pending = new Set<OneShotAction>();
  private readonly listeners = new Set<(event: TelemetryEvent) => void>();
  private readonly collected: TelemetryEvent[] = [];
  private readonly errorRecords: RuntimeErrorRecord[] = [];

  constructor(options: CoreRunGameOptions) {
    this.features = Object.freeze([
      ...(options.features ?? createDefaultFeatures()),
    ]);
    this.telemetryStore =
      options.telemetryStore ?? createTelemetryStore({ runtime: "client" });
    this.resetState();
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  advance(seconds: number): number {
    if (this.isDisposed) return 0;
    if (!Number.isFinite(seconds) || seconds < 0) {
      this.record(
        "invalid-advance",
        "core-run-advance",
        "advance() requires finite, non-negative seconds",
        "expected",
        null,
      );
      return 0;
    }
    this.accumulator += seconds;
    let steps = 0;
    while (
      this.accumulator >= this.dt - 1e-9 &&
      steps < MAX_STEPS_PER_ADVANCE
    ) {
      this.accumulator -= this.dt;
      this.step();
      steps += 1;
    }
    if (steps === MAX_STEPS_PER_ADVANCE) this.accumulator = 0;
    return steps;
  }

  setInput(input: Partial<SemanticInput>): void {
    if (this.isDisposed) return;
    const current = this.state.input;
    this.state.input = Object.freeze({
      moveX: finiteOr(input.moveX, current.moveX),
      moveY: finiteOr(input.moveY, current.moveY),
      cameraYaw: finiteOr(input.cameraYaw, current.cameraYaw),
    });
  }

  press(action: OneShotAction): void {
    if (this.isDisposed || !ONE_SHOT_ACTIONS.includes(action)) return;
    this.pending.add(action);
  }

  start(): void {
    if (this.isDisposed || this.state.round.phase !== "title") return;
    beginCountdown(this.state, this.context(new Set()));
  }

  retry(): void {
    if (this.isDisposed) return;
    this.resetState();
    beginCountdown(this.state, this.context(new Set()));
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.features = Object.freeze([]);
    this.pending.clear();
    this.listeners.clear();
  }

  snapshot(): CoreRunSnapshot {
    const state = this.state;
    return Object.freeze({
      tick: state.tick,
      time: state.tick * this.dt,
      phase: state.round.phase,
      countdownValue: countdownValue(state, this.dt),
      remainingSeconds: remainingSeconds(state, this.dt),
      player: Object.freeze({ ...state.player }),
      cores: Object.freeze(
        state.cores.map((core) => Object.freeze({ ...core })),
      ),
      carry: Object.freeze({ ...state.carry }),
      score: Object.freeze({ ...state.score }),
      combo: Object.freeze({ ...state.combo }),
      platform: Object.freeze({ ...state.platform }),
    });
  }

  subscribe(listener: (event: TelemetryEvent) => void): () => void {
    if (typeof listener !== "function") {
      throw new TypeError("Telemetry listener must be a function");
    }
    if (this.isDisposed) return () => undefined;
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  events(): readonly TelemetryEvent[] {
    return Object.freeze([...this.collected]);
  }

  errors(): readonly RuntimeErrorRecord[] {
    return Object.freeze([...this.errorRecords]);
  }

  inspectLeaks(): CoreRunLeakCounters {
    return Object.freeze({
      activeListeners: this.listeners.size,
      activeSubscriptions: this.features.length,
      activeTimers: 0,
    });
  }

  private resetState(): void {
    this.state = createCoreRunState();
    this.accumulator = 0;
    this.pending.clear();
    for (const feature of this.features) {
      try {
        feature.reset(this.state, this.dt);
      } catch (cause) {
        this.capture(feature.id, "core-run-reset", cause);
      }
    }
  }

  private context(pressed: ReadonlySet<OneShotAction>): StepContext {
    return Object.freeze({
      tick: this.state.tick,
      dt: this.dt,
      time: this.state.tick * this.dt,
      pressed,
      emit: (event: TelemetryEvent) => this.emit(event),
    });
  }

  private step(): void {
    this.state.tick += 1;
    const pressed = new Set(this.pending);
    this.pending.clear();
    const context = this.context(pressed);
    for (const feature of this.features) {
      try {
        feature.step(this.state, context);
      } catch (cause) {
        this.capture(feature.id, "core-run-step", cause);
      }
    }
  }

  private capture(featureId: string, operation: string, cause: unknown): void {
    const record = this.record(
      "feature-threw",
      operation,
      `Core Run Feature threw during ${operation}`,
      "invariant",
      featureId,
      cause,
    );
    this.emit({
      kind: "runtimeError",
      tick: this.state.tick,
      featureId,
      message: record.cause?.message ?? record.message,
    });
  }

  private emit(event: TelemetryEvent): void {
    if (this.collected.length === TELEMETRY_EVENT_CAPACITY) this.collected.shift();
    this.collected.push(event);
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (cause) {
        this.listeners.delete(listener);
        this.record(
          "listener-threw",
          "core-run-emit",
          "A telemetry listener threw and was removed",
          "invariant",
          null,
          cause,
        );
      }
    }
  }

  private record(
    code: string,
    operation: string,
    message: string,
    category: RuntimeErrorCategory,
    featureId: string | null,
    cause?: unknown,
  ): RuntimeErrorRecord {
    const record = this.telemetryStore.recordRuntimeError({
      code,
      category,
      runtime: "client",
      operation,
      message,
      tick: this.state.tick,
      ...(featureId === null ? {} : { featureId }),
      context: Object.freeze([]),
      ...(cause === undefined ? {} : { cause }),
    });
    this.errorRecords.push(record);
    return record;
  }
}

export function createCoreRunGame(options: CoreRunGameOptions = {}): CoreRunGame {
  return new CoreRunGameImplementation(options);
}
