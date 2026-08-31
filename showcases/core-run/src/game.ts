import {
  createCollisionFeature,
  createRapierCollisionAdapter,
  type ClientCollisionAdapter,
} from "@three-game-kit/client/collision";
import {
  createInputFeature,
  createMovementInput,
  createSemanticActionInput,
  type MovementInput,
  type SemanticActionInput,
} from "@three-game-kit/client/input";
import { createCameraFeature } from "@three-game-kit/client/camera";
import { createRenderingFeature } from "@three-game-kit/client/rendering";
import { createVfxFeature } from "@three-game-kit/client/vfx";
import { Runtime as ClientRuntime } from "@three-game-kit/client";
import {
  SIMULATION_DT_SECONDS,
  createDeterministicPresentationFrameSource,
  createTelemetryStore,
  type ClientFeatureDescriptor,
  type DeterministicPresentationFrameSource,
  type FeatureLifecycleState,
  type RuntimeErrorCategory,
  type RuntimeErrorRecord,
  type TelemetryStore,
} from "@three-game-kit/core";
import type { CoreRunRenderer } from "./three-renderer.js";
import {
  CORE_RUN_STANDARD_FEATURE_ID,
  createClientFeatureDescriptor,
  createStandardTickFeature,
  type CoreRunFeature,
  type StepContext,
} from "./feature.js";
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
const COLLISION_CAPSULE_RADIUS = 0.5;
const COLLISION_CAPSULE_HALF_HEIGHT = 0.5;
const COLLISION_CONTROLLER_OFFSET = 0.01;
const COLLISION_CENTER_FROM_FEET =
  COLLISION_CAPSULE_RADIUS +
  COLLISION_CAPSULE_HALF_HEIGHT +
  COLLISION_CONTROLLER_OFFSET;
const ARENA_HALF_EXTENT = 18;
const CAMERA_DISTANCE = 13;
const CAMERA_HEIGHT = 9.2;
const CAMERA_LOOK_AT_HEIGHT = 1.2;
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

export interface CoreRunRuntimeInspection {
  readonly lifecycleState: FeatureLifecycleState;
  readonly installedFeatureIds: readonly string[];
  readonly scheduleSystemIds: readonly string[];
  readonly schedulerTick: number;
  readonly gameTick: number;
  /** One-shot semantic actions published by movement-input. */
  readonly semanticActionsPublished: number;
  /** Shared movement translations prepared since the most recent reset. */
  readonly movementTranslationCount: number;
  /** Standard collision moves published since the most recent reset. */
  readonly collisionMoveCount: number;
  readonly collisionContactCount: number;
  readonly collisionAdapterDisposed: boolean;
  readonly presentationFrameCount: number;
  readonly rendererDisposed: boolean | null;
}

export interface CoreRunGameOptions {
  readonly features?: readonly CoreRunFeature[];
  readonly telemetryStore?: TelemetryStore<"client">;
  readonly renderer?: CoreRunRenderer;
}

export interface CoreRunGame {
  readonly dt: number;
  readonly disposed: boolean;
  readonly telemetryStore: TelemetryStore<"client">;
  /** Accumulates elapsed seconds into fixed steps; returns steps executed. */
  advance(seconds: number): number;
  /** Delivers one presentation frame through the public Runtime scheduler. */
  present(timestampMs: number): boolean;
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
  inspectRuntime(): CoreRunRuntimeInspection;
}

/** Default Feature order; earlier Features observe a tick before later ones. */
export function createDefaultFeatures(): readonly CoreRunFeature[] {
  return Object.freeze([
    createRoundTimerFeature(),
    createMovementFeature(),
    createHazardFeature(),
    createJumpPadFeature(),
    createMovingPlatformFeature(),
    createDepositFeature(),
    createCoresFeature(),
  ]);
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizedMovementAxes(x: number, z: number): readonly [number, number] {
  const squaredMagnitude = x * x + z * z;
  if (squaredMagnitude <= 1) return [x, z];
  const scale = (1 - 1e-12) / Math.sqrt(squaredMagnitude);
  return Object.freeze([x * scale, z * scale]);
}

class CoreRunGameImplementation implements CoreRunGame {
  readonly dt = SIMULATION_DT_SECONDS;
  readonly telemetryStore: TelemetryStore<"client">;
  private readonly rules: readonly CoreRunFeature[];
  private readonly descriptors: readonly ClientFeatureDescriptor<unknown>[];
  private readonly runtime: ClientRuntime;
  private readonly renderer: CoreRunRenderer | null;
  private readonly presentationFrames: DeterministicPresentationFrameSource =
    createDeterministicPresentationFrameSource();
  private presentationStarted = false;
  private lastPresentationTimestampMs = -1;
  private readonly collisionAdapter: ClientCollisionAdapter =
    createRapierCollisionAdapter({
      capsuleRadius: COLLISION_CAPSULE_RADIUS,
      capsuleHalfHeight: COLLISION_CAPSULE_HALF_HEIGHT,
      controllerOffset: COLLISION_CONTROLLER_OFFSET,
      boxes: [
        {
          id: "arena-floor",
          center: { x: 0, y: -0.5, z: 0 },
          halfExtents: { x: ARENA_HALF_EXTENT, y: 0.5, z: ARENA_HALF_EXTENT },
        },
      ],
    });
  private collisionMoveCount = 0;
  private collisionContactCount = 0;
  private readonly movementInput: MovementInput = createMovementInput();
  private readonly actionInput: SemanticActionInput<OneShotAction> =
    createSemanticActionInput(ONE_SHOT_ACTIONS);
  private semanticActionsPublished = 0;
  private state: CoreRunState = createCoreRunState();
  private accumulator = 0;
  private isDisposed = false;
  private readonly listeners = new Set<(event: TelemetryEvent) => void>();
  private readonly collected: TelemetryEvent[] = [];
  private readonly errorRecords: RuntimeErrorRecord[] = [];

  constructor(options: CoreRunGameOptions) {
    this.renderer = options.renderer ?? null;
    this.rules = Object.freeze([
      ...(options.features ?? createDefaultFeatures()),
    ]);
    this.telemetryStore =
      options.telemetryStore ?? createTelemetryStore({ runtime: "client" });
    this.resetState();
    const gameDescriptors = this.rules.map((feature, index) =>
      createClientFeatureDescriptor(
        feature,
        Object.freeze([
          index === 0
            ? CORE_RUN_STANDARD_FEATURE_ID
            : (this.rules[index - 1]?.id ?? CORE_RUN_STANDARD_FEATURE_ID),
        ]),
        index - 2,
        {
          state: () => this.state,
          context: () => this.context(this.currentPressed),
          capture: (featureId, operation, cause) =>
            this.capture(featureId, operation, cause),
        },
      ),
    );
    const movementIndex = this.rules.findIndex(
      (feature) => feature.id === "core-run.movement",
    );
    const collisionDescriptor = createCollisionFeature({
      adapter: this.collisionAdapter,
      readStartPosition: () => ({
        ...this.state.movementStart,
        y: this.state.movementStart.y + COLLISION_CENTER_FROM_FEET,
      }),
      readDesiredTranslation: () => this.state.desiredTranslation,
      publish: (result) => {
        const player = this.state.player;
        player.position = Object.freeze({
          ...result.position,
          y: result.grounded
            ? 0
            : result.position.y - COLLISION_CENTER_FROM_FEET,
        });
        player.grounded = result.grounded;
        if (result.grounded && player.velocity.y < 0) {
          player.velocity = Object.freeze({ ...player.velocity, y: 0 });
        }
        this.collisionMoveCount += 1;
        this.collisionContactCount += result.collisionCount;
      },
    });
    const scheduledGameDescriptors =
      movementIndex < 0
        ? gameDescriptors
        : [
            ...gameDescriptors.slice(0, movementIndex + 1),
            collisionDescriptor,
            ...gameDescriptors.slice(movementIndex + 1),
          ];
    const inputDescriptor = createInputFeature({
      input: this.movementInput,
      publish: (command) => {
        this.state.input = Object.freeze({
          moveX: command.x,
          moveY: -command.z,
          cameraYaw: this.state.input.cameraYaw,
        });
      },
      actions: this.actionInput,
      publishAction: (action) => {
        this.currentPressed.add(action as OneShotAction);
        this.semanticActionsPublished += 1;
      },
    });
    const presentationDescriptors: readonly ClientFeatureDescriptor<unknown>[] =
      this.renderer === null
        ? Object.freeze([])
        : Object.freeze([
            createCameraFeature({
              readTarget: () => this.state.player.position,
              readConfiguration: () => ({
                distance: CAMERA_DISTANCE,
                height: CAMERA_HEIGHT,
                lookAtHeight: CAMERA_LOOK_AT_HEIGHT,
                yawRadians: -this.state.input.cameraYaw,
              }),
              publish: (transform) => this.renderer?.setCameraTransform(transform),
            }),
            createVfxFeature({ runtime: this.renderer.vfx }),
            createRenderingFeature({ renderer: this.renderer }),
          ]);
    this.descriptors = Object.freeze([
      createStandardTickFeature(() => {
        this.state.tick += 1;
      }),
      inputDescriptor,
      ...scheduledGameDescriptors,
      ...presentationDescriptors,
    ]);
    this.runtime = new ClientRuntime({
      features: this.descriptors,
      driver: "exact",
      telemetryStore: this.telemetryStore,
      frameSource: this.presentationFrames,
    });
    void this.runtime.start().then((started) => {
      if (
        started.state !== "running" ||
        this.isDisposed ||
        this.renderer === null
      ) {
        return;
      }
      const presentation = this.runtime.startPresentation();
      if (!presentation.ok) return;
      this.presentationStarted = presentation.value;
      if (this.presentationStarted) this.present(0);
    });
  }

  private readonly currentPressed = new Set<OneShotAction>();

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
      this.currentPressed.clear();
      const result = this.runtime.stepExact(1);
      this.currentPressed.clear();
      if (!result.ok) break;
      steps += 1;
    }
    if (steps === MAX_STEPS_PER_ADVANCE) this.accumulator = 0;
    return steps;
  }

  present(timestampMs: number): boolean {
    if (
      this.isDisposed ||
      !this.presentationStarted ||
      !Number.isFinite(timestampMs) ||
      timestampMs < 0
    ) {
      return false;
    }
    const nextTimestampMs = Math.max(
      this.lastPresentationTimestampMs + 1,
      timestampMs,
    );
    this.lastPresentationTimestampMs = nextTimestampMs;
    return this.presentationFrames.deliver(nextTimestampMs);
  }

  setInput(input: Partial<SemanticInput>): void {
    if (this.isDisposed) return;
    const currentMovement = this.movementInput.sample();
    const movement = normalizedMovementAxes(
      finiteOr(input.moveX, currentMovement.x),
      -finiteOr(input.moveY, -currentMovement.z),
    );
    this.movementInput.setMovement(movement[0], movement[1]);
    this.state.input = Object.freeze({
      ...this.state.input,
      cameraYaw: finiteOr(input.cameraYaw, this.state.input.cameraYaw),
    });
  }

  press(action: OneShotAction): void {
    if (this.isDisposed) return;
    try {
      this.actionInput.press(action);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
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
    void this.runtime.shutdown();
    this.movementInput.dispose();
    this.actionInput.dispose();
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
    const lifecycle = this.runtime.inspectLifecycle();
    return Object.freeze({
      activeListeners: this.listeners.size,
      activeSubscriptions: this.isDisposed
        ? 0
        : lifecycle.installedFeatureIds.length,
      activeTimers: 0,
    });
  }

  inspectRuntime(): CoreRunRuntimeInspection {
    const lifecycle = this.runtime.inspectLifecycle();
    return Object.freeze({
      lifecycleState: lifecycle.state,
      installedFeatureIds: Object.freeze(lifecycle.installedFeatureIds.slice(0, 32)),
      scheduleSystemIds: Object.freeze(
        lifecycle.scheduleReport.slice(0, 32).map((entry) => entry.systemId),
      ),
      schedulerTick: this.runtime.tick,
      gameTick: this.state.tick,
      semanticActionsPublished: this.semanticActionsPublished,
      movementTranslationCount: this.state.movementTranslationCount,
      collisionMoveCount: this.collisionMoveCount,
      collisionContactCount: this.collisionContactCount,
      collisionAdapterDisposed: this.collisionAdapter.disposed,
      presentationFrameCount:
        this.runtime.snapshotTelemetry().presentationFrameCount,
      rendererDisposed: this.renderer?.disposed ?? null,
    });
  }

  private resetState(): void {
    this.state = createCoreRunState();
    this.movementInput.reset();
    this.collisionMoveCount = 0;
    this.collisionContactCount = 0;
    this.semanticActionsPublished = 0;
    this.accumulator = 0;
    this.actionInput.reset();
    this.currentPressed.clear();
    for (const feature of this.rules) {
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
