import { Runtime as ClientRuntime } from "@three-game-kit/client";
import {
  createCameraEffectsRuntime,
  createCameraExtensionsFeature,
  createInputExperienceFeature,
  createInputExperienceRuntime,
  createPostProcessingFeature,
  createVehiclesClientFeature,
  type AdvancedCameraTransform,
  type CameraVariant,
} from "@three-game-kit/client/advanced";
import { createGameFlowClientFeature, createHudFeature, createTriggerAreaClientFeature, type HudAdapter } from "@three-game-kit/client/gameplay";
import { createSaveLoadClientFeature } from "@three-game-kit/client/genre";
import { createRenderingFeature } from "@three-game-kit/client/rendering";
import { createVfxFeature, type VfxInspection } from "@three-game-kit/client/vfx";
import {
  createDeterministicPresentationFrameSource,
  createTelemetryStore,
  defineFeatureConfiguration,
  type ClientFeatureDescriptor,
  type ClientFeatureSetupContext,
  type RuntimeErrorRecord,
} from "@three-game-kit/core";
import { createVehicleRuntime, type VehicleControl } from "@three-game-kit/shared/advanced";
import { createGameFlowRuntime, createHudStateStore, createTriggerAreaRuntime } from "@three-game-kit/shared/gameplay";
import { createSaveLoadRuntime, type SaveAdapter, type SaveValue } from "@three-game-kit/shared/genre";
import type { AfterglowRenderer, AfterglowRendererInspection } from "./renderer.js";
import {
  CAR_ID,
  COUNTDOWN_TICKS,
  DRIVER_SEAT,
  DT,
  GHOST_INTERVAL_TICKS,
  NEUTRAL_HELD,
  NO_CUE,
  PLAYER_ID,
  RESPAWN_TICKS,
  SAVE_SLOT,
  SAVE_VERSION,
  TUNING,
  createCar,
  createState,
  formatTime,
  medalFor,
  snapshotOf,
  vec3,
  type Action,
  type AfterglowEvent,
  type AfterglowSnapshot,
  type CueSnapshot,
  type DeathCause,
  type GhostSample,
  type HeldInput,
  type MutableState,
  type Phase,
  type Scenario,
  type Vec3,
} from "./state.js";
import { createMeridianDescent, featureStart, type Track, type TrackFeature } from "./track.js";

const MAX_STEPS = 1_200;
const CUE_RANGE = 150;
const CHASE_DISTANCE = 11.5;
const CHASE_HEIGHT = 4.2;
const EMPTY = defineFeatureConfiguration<Readonly<Record<string, never>>>({
  defaultValue: () => Object.freeze({}),
  parse(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) && Reflect.ownKeys(value).length === 0
      ? { ok: true as const, value: Object.freeze({}) }
      : { ok: false as const, issues: [{ path: [], code: "empty-object-required" }] };
  },
});

export const INPUT_CONTEXTS = Object.freeze({
  menu: Object.freeze({
    start: Object.freeze(["Space", "Enter", "gamepad:start", "gamepad:a"]),
  }),
  drive: Object.freeze({
    "throttle-start": Object.freeze(["KeyW", "ArrowUp", "gamepad:rt-down"]),
    "throttle-end": Object.freeze(["KeyW:up", "ArrowUp:up", "gamepad:rt-up"]),
    "brake-start": Object.freeze(["KeyS", "ArrowDown", "gamepad:lt-down"]),
    "brake-end": Object.freeze(["KeyS:up", "ArrowDown:up", "gamepad:lt-up"]),
    jump: Object.freeze(["Space", "gamepad:a"]),
    "boost-start": Object.freeze(["ShiftLeft", "ShiftRight", "gamepad:rb-down", "gamepad:x-down"]),
    "boost-end": Object.freeze(["ShiftLeft:up", "ShiftRight:up", "gamepad:rb-up", "gamepad:x-up"]),
    restart: Object.freeze(["KeyR", "gamepad:start"]),
  }),
});

export interface AfterglowRuntimeInspection {
  readonly lifecycleState: string;
  readonly installedFeatureIds: readonly string[];
  readonly scheduleSystemIds: readonly string[];
  readonly schedulerTick: number;
  readonly inputContext: string;
  readonly vehicle: Readonly<{ readonly speed: number; readonly steering: number; readonly driver: string | null }>;
  readonly cameraVariant: string;
}

export interface AfterglowSaveInspection {
  readonly ready: boolean;
  readonly lastLoad: string | null;
  readonly lastSave: string | null;
  readonly bestTimeMs: number | null;
  readonly ghostSamples: number;
}

export interface AfterglowLeakInspection {
  readonly activeListeners: number;
  readonly activeFeatures: number;
  readonly disposed: boolean;
}

export interface AfterglowGame {
  readonly disposed: boolean;
  readonly track: Track;
  advance(seconds: number): number;
  present(timestampMs: number): boolean;
  start(): void;
  restart(): void;
  setInput(input: Readonly<{ readonly steer?: number; readonly throttle?: boolean; readonly brake?: boolean; readonly boost?: boolean }>): void;
  press(action: Action): void;
  pressPhysical(input: string): void;
  setAxis(x: number): void;
  updateGamepad(deviceId: string, x: number, buttons: readonly string[]): void;
  loadScenario(id: Scenario): void;
  snapshot(): AfterglowSnapshot;
  events(): readonly AfterglowEvent[];
  errors(): readonly RuntimeErrorRecord[];
  inspectRuntime(): AfterglowRuntimeInspection;
  inspectRenderer(): AfterglowRendererInspection | null;
  inspectVfx(): VfxInspection | null;
  inspectSave(): AfterglowSaveInspection;
  inspectLeaks(): AfterglowLeakInspection;
  subscribe(listener: (event: AfterglowEvent) => void): () => void;
  dispose(): void;
}

export interface AfterglowGameOptions {
  readonly renderer?: AfterglowRenderer;
  readonly hudAdapter: HudAdapter;
  readonly saveAdapter: SaveAdapter;
  readonly track?: Track;
}

function gameFeature(id: string, description: string, priority: number, run: (tick: number) => void): ClientFeatureDescriptor<Readonly<Record<string, never>>> {
  let active = false;
  const contribution = Object.freeze({
    kind: "system" as const,
    id: `${id}.step`,
    domain: "client-simulation" as const,
    phase: "shared-predict" as const,
    priority,
    run({ tick }: { readonly tick: number }): void { if (active) run(tick); },
  });
  return Object.freeze({
    id,
    description,
    runtimeContributions: Object.freeze([contribution]),
    requires: Object.freeze([]),
    conflicts: Object.freeze([]),
    configuration: EMPTY,
    setup({ ledger }: ClientFeatureSetupContext<Readonly<Record<string, never>>>): void { active = true; ledger.activateSystem(contribution.id); },
    dispose(): void { active = false; },
  });
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

function cueLabel(feature: TrackFeature): string {
  switch (feature.kind) {
    case "gap": return "GAP AHEAD · JUMP";
    case "boost": return "BOOST PAD";
    case "pillar": return "PILLARS · WEAVE";
    case "checkpoint": return "CHECKPOINT";
    case "finish": return "FINISH LINE";
    case "gate":
      return feature.gate === "low" ? "LASER LOW · JUMP" : feature.gate === "left" ? "LASER LEFT · KEEP RIGHT" : feature.gate === "right" ? "LASER RIGHT · KEEP LEFT" : "LASER CENTER · TAKE A SIDE";
  }
}

function flattenGhost(samples: readonly GhostSample[]): readonly number[] {
  const result: number[] = [];
  for (const sample of samples) result.push(Math.round(sample.s * 100) / 100, Math.round(sample.x * 100) / 100, Math.round(sample.h * 100) / 100);
  return result;
}

function unflattenGhost(values: readonly number[]): readonly GhostSample[] {
  const result: GhostSample[] = [];
  for (let index = 0; index + 2 < values.length; index += 3) result.push(Object.freeze({ s: values[index]!, x: values[index + 1]!, h: values[index + 2]! }));
  return Object.freeze(result);
}

function isSaveDocument(data: SaveValue): data is Readonly<{ readonly bestTimeMs: number; readonly ghost: readonly number[] }> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const record = data as Readonly<Record<string, SaveValue>>;
  return typeof record["bestTimeMs"] === "number" && record["bestTimeMs"] > 0 && Array.isArray(record["ghost"]) && record["ghost"].length % 3 === 0 && record["ghost"].every((value) => typeof value === "number");
}

class Game implements AfterglowGame {
  readonly track: Track;
  private state: MutableState = createState();
  private readonly renderer: AfterglowRenderer | null;
  private readonly pressed = new Set<Action>();
  private readonly listeners = new Set<(event: AfterglowEvent) => void>();
  private readonly collected: AfterglowEvent[] = [];
  private tickEvents: AfterglowEvent[] = [];
  private toast = "";
  private toastUntilTick = -1;
  private wasBoosting = false;
  private readonly errorRecords: RuntimeErrorRecord[] = [];
  private readonly telemetry = createTelemetryStore({
    runtime: "client",
    observeRuntimeError: (record) => {
      if (this.errorRecords.length >= 64) this.errorRecords.shift();
      this.errorRecords.push(record);
    },
  });
  private readonly frames = createDeterministicPresentationFrameSource();
  private readonly input = createInputExperienceRuntime({ contexts: INPUT_CONTEXTS, initialContext: "menu", deadZone: 0.12 });
  private readonly vehicles = createVehicleRuntime(
    [{ id: CAR_ID, seats: [{ id: DRIVER_SEAT, role: "driver" }], acceleration: TUNING.acceleration, braking: TUNING.braking, steering: 1 }],
    { integrate: (vehicle, control, dt) => this.integrate(vehicle.speed, vehicle.steering, control, dt) },
  );
  private readonly flow = createGameFlowRuntime({
    initialState: "title",
    states: [
      { id: "title", allowedTo: ["countdown", "running"] },
      { id: "countdown", allowedTo: ["running"] },
      { id: "running", allowedTo: ["results"] },
      { id: "results", allowedTo: ["countdown", "running"] },
    ],
  });
  private readonly hud = createHudStateStore({ screen: "title", extras: this.hudExtras() });
  private readonly triggers: ReturnType<typeof createTriggerAreaRuntime>;
  private readonly camera = createCameraEffectsRuntime({ kind: "orbit", distance: CHASE_DISTANCE, height: CHASE_HEIGHT, yaw: 0 }, { minimumZoom: 0.5, maximumZoom: 2 });
  private readonly saveLoad: ReturnType<typeof createSaveLoadRuntime>;
  private readonly runtime: ClientRuntime;
  private cameraVariantKind = "orbit";
  private resultsTick = -1;
  private speedOverride: number | null = 0;
  private speedImpulse = 0;
  private lastWallTick = -100;
  private accumulator = 0;
  private presentationStarted = false;
  private lastTimestamp = -1;
  private isDisposed = false;
  private saveReady = false;
  private lastLoad: string | null = null;
  private lastSave: string | null = null;

  constructor(options: AfterglowGameOptions) {
    this.track = options.track ?? createMeridianDescent();
    this.renderer = options.renderer ?? null;
    this.state.car.position = this.track.worldPosition(0, 0, 0);
    this.state.car.heading = this.track.frame(0).heading;
    const entered = this.vehicles.enter(CAR_ID, PLAYER_ID, DRIVER_SEAT);
    if (!entered.ok) throw new Error(`Afterglow pilot could not enter the car: ${entered.code}`);
    this.triggers = createTriggerAreaRuntime([
      ...this.track.checkpoints.map((checkpoint) => ({ id: checkpoint.id, shape: "sphere" as const, center: this.track.worldPosition(checkpoint.s, 0, 0), radius: 9 })),
      { id: this.track.finish.id, shape: "sphere", center: this.track.worldPosition(this.track.finish.s, 0, 0), radius: 9 },
    ]);
    this.saveLoad = createSaveLoadRuntime({
      currentVersion: SAVE_VERSION,
      adapter: options.saveAdapter,
      capture: () => ({ bestTimeMs: this.state.bestTimeMs ?? 0, ghost: flattenGhost(this.state.bestGhost) }),
      validate: (data) => isSaveDocument(data),
      restore: (data) => {
        if (!isSaveDocument(data)) throw new TypeError("Afterglow save data is invalid");
        this.state.bestTimeMs = data.bestTimeMs;
        this.state.bestGhost = unflattenGhost(data.ghost);
      },
    });
    void this.saveLoad.load(SAVE_SLOT).then((outcome) => {
      this.lastLoad = outcome.ok ? "loaded" : outcome.code;
      this.saveReady = true;
      if (outcome.ok) this.emit("progress-loaded", SAVE_SLOT, this.state.bestTimeMs ?? 0);
    });

    const features: ClientFeatureDescriptor<unknown>[] = [
      createInputExperienceFeature({
        runtime: this.input,
        publishMovement: (command) => { this.state.steer = clampUnit(command.x); },
        publishAction: (action) => this.handleAction(action as Action),
      }),
      gameFeature("afterglow.controls", "Translates semantic pilot input into vehicle control requests", 600, () => this.requestControls()),
      createVehiclesClientFeature(this.vehicles, (events) => {
        for (const event of events) {
          if (event.kind === "controlled") { this.state.car.speed = event.state.speed; this.state.car.steering = event.state.steering; }
          else if (event.kind === "rejected") this.emit("control-rejected", event.code ?? "unknown");
        }
      }),
      gameFeature("afterglow.rules", "Advances the deterministic Meridian Descent sprint rules", 800, (tick) => this.stepRules(tick)),
      createTriggerAreaClientFeature({
        runtime: this.triggers,
        readActors: () => [{ id: PLAYER_ID, position: this.state.car.position }],
        publish: (events) => { for (const event of events) if (event.kind === "enter") this.state.triggered.add(event.areaId); },
      }),
      createGameFlowClientFeature(this.flow),
      createSaveLoadClientFeature(this.saveLoad),
      createHudFeature({ store: this.hud, adapter: options.hudAdapter }),
    ];
    if (this.renderer !== null) {
      const renderer = this.renderer;
      features.push(
        createCameraExtensionsFeature({
          runtime: this.camera,
          readTarget: () => this.cameraTarget(),
          readTick: () => this.state.tick,
          publish: (transform: AdvancedCameraTransform) => renderer.setCameraTransform(transform),
        }),
        createVfxFeature({ runtime: renderer.vfx }),
        createRenderingFeature({ renderer }),
        createPostProcessingFeature(renderer.postProcessing),
      );
    }
    this.runtime = new ClientRuntime({ features, driver: "exact", telemetryStore: this.telemetry, frameSource: this.frames });
    void this.runtime.start().then((started) => {
      if (started.state !== "running" || this.isDisposed || this.renderer === null) return;
      const presentation = this.runtime.startPresentation();
      if (presentation.ok) this.presentationStarted = presentation.value;
      if (this.presentationStarted) this.present(0);
    });
    this.publishFrame();
  }

  get disposed(): boolean { return this.isDisposed; }

  // --- Feature callbacks -------------------------------------------------

  private integrate(speed: number, steering: number, control: VehicleControl, dt: number): Readonly<{ speed: number; steering: number }> {
    let next = speed;
    if (this.speedOverride !== null) { next = this.speedOverride; this.speedOverride = null; }
    next += this.speedImpulse;
    this.speedImpulse = 0;
    const boosting = this.state.car.boosting;
    const maximum = boosting ? TUNING.boostSpeed : TUNING.maxSpeed;
    const acceleration = boosting ? TUNING.boostAcceleration : TUNING.acceleration;
    next += control.throttle * acceleration * dt;
    next -= control.brake * TUNING.braking * dt;
    next -= next * TUNING.drag * dt * (control.throttle > 0 ? 0.35 : 1);
    if (next > maximum) next = maximum + (next - maximum) * Math.exp(-2.4 * dt);
    next = Math.max(0, next);
    const nextSteering = steering + (control.steering - steering) * Math.min(1, TUNING.steeringResponse * dt);
    return Object.freeze({ speed: next, steering: nextSteering });
  }

  private requestControls(): void {
    const driving = this.state.phase === "running" && this.state.car.alive;
    const throttle = driving && (this.state.held.throttle || this.state.held.boost) ? 1 : 0;
    const brake = driving && this.state.held.brake ? 1 : 0;
    const steering = driving ? this.state.steer : 0;
    this.vehicles.requestControl(CAR_ID, PLAYER_ID, { throttle, brake, steering });
  }

  private handleAction(action: Action): void {
    switch (action) {
      case "throttle-start": this.setHeld({ throttle: true }); return;
      case "throttle-end": this.setHeld({ throttle: false }); return;
      case "brake-start": this.setHeld({ brake: true }); return;
      case "brake-end": this.setHeld({ brake: false }); return;
      case "boost-start": this.setHeld({ boost: true }); return;
      case "boost-end": this.setHeld({ boost: false }); return;
      default: this.pressed.add(action);
    }
  }

  private setHeld(patch: Partial<HeldInput>): void {
    this.state.held = Object.freeze({ ...this.state.held, ...patch });
  }

  private cameraTarget(): Vec3 {
    const car = this.state.car;
    const frame = this.track.frame(car.s);
    const lead = this.state.phase === "results" ? 0 : 3.5;
    return vec3(
      car.position.x + frame.forward.x * lead + frame.up.x * 0.8,
      car.position.y + frame.forward.y * lead + frame.up.y * 0.8,
      car.position.z + frame.forward.z * lead + frame.up.z * 0.8,
    );
  }

  // --- Events -------------------------------------------------------------

  private emit(kind: string, subject?: string, value?: number): void {
    const event: AfterglowEvent = Object.freeze({ kind, tick: this.state.tick, ...(subject === undefined ? {} : { subject }), ...(value === undefined ? {} : { value }) });
    if (this.collected.length >= 512) this.collected.shift();
    this.collected.push(event);
    this.tickEvents.push(event);
    for (const listener of this.listeners) listener(event);
  }

  private showToast(label: string, ticks = 50): void {
    this.toast = label;
    this.toastUntilTick = this.state.tick + ticks;
  }

  private seed(salt: number): number {
    return (this.state.tick * 2654435761 + salt * 40503) >>> 0;
  }

  private streak(start: Vec3, end: Vec3, color: number, width: number, lifetimeMs: number, salt = 0): void {
    this.renderer?.vfx.enqueue({ kind: "trail", start, end, color, width, lifetimeMs, seed: this.seed(salt) });
  }

  private popup(position: Vec3, color: number, size: number, lifetimeMs: number, salt = 0): void {
    this.renderer?.vfx.enqueue({ kind: "popup", position, color, size, lifetimeMs, seed: this.seed(salt) });
  }

  /** Radiating debris / shockwave lines around a track-space point. */
  private shockwave(s: number, x: number, h: number, colors: readonly number[], radius: number, lifetimeMs: number, lines = 8): void {
    const frame = this.track.frame(s);
    const origin = this.track.worldPosition(s, x, h);
    for (let index = 0; index < lines; index += 1) {
      const angle = (index / lines) * Math.PI * 2 + this.state.tick * 0.07;
      const lift = 0.4 + (index % 3) * 0.5;
      const dx = Math.cos(angle) * radius;
      const dz = Math.sin(angle) * radius;
      const end = vec3(
        origin.x + frame.right.x * dx + frame.forward.x * dz + frame.up.x * lift,
        origin.y + frame.right.y * dx + frame.forward.y * dz + frame.up.y * lift,
        origin.z + frame.right.z * dx + frame.forward.z * dz + frame.up.z * lift,
      );
      this.streak(origin, end, colors[index % colors.length] ?? 0xffffff, 2, lifetimeMs, index);
    }
  }

  /** Continuous presentation feedback: exhaust, speed streaks, heat sparks, boost start/stop. */
  private ambientVfx(tick: number): void {
    const car = this.state.car;
    if (!car.alive) return;
    if (car.boosting && !this.wasBoosting) {
      this.camera.shake(0.14, 6, tick, tick);
      this.shockwave(car.s - 1.5, car.x, car.h + 0.5, [0xffb340, 0xff6a3d], 2.6, 260, 6);
      this.emit("boost-started", PLAYER_ID, car.heat);
    }
    this.wasBoosting = car.boosting;
    if (car.boosting && tick % 3 === 0) {
      const side = tick % 6 === 0 ? -0.55 : 0.55;
      this.burst(tick % 2 === 0 ? 0xffb340 : 0xff6a3d, 6, 2.6, 380, this.track.worldPosition(car.s - 2.4, car.x + side, car.h + 0.5));
    }
    if (car.speed > 28 && tick % 2 === 0) {
      const side = tick % 4 < 2 ? -1 : 1;
      const lateral = side * (7.5 + ((tick * 7) % 5));
      const height = 0.4 + ((tick * 13) % 4) * 0.9;
      const ahead = car.s + 34 + ((tick * 3) % 22);
      const length = 5 + car.speed * 0.16;
      this.streak(this.track.worldPosition(ahead, lateral, car.h + height), this.track.worldPosition(ahead - length, lateral, car.h + height), car.boosting ? 0xffc27a : 0x2ad9ee, 1, car.boosting ? 200 : 240, tick % 7);
    }
    if (car.heat > 0.75 && tick % 5 === 0) {
      this.burst(car.heat > 0.92 ? 0xff2d7a : 0xff6a3d, 5, 2.2, 320, this.track.worldPosition(car.s - 1.6, car.x + (tick % 10 === 0 ? 0.7 : -0.7), car.h + 0.9));
      if (car.heat > 0.92 && tick % 10 === 0) this.camera.shake(0.07, 3, tick, tick);
    }
  }

  private fireworks(tick: number): void {
    if (this.resultsTick < 0 || tick - this.resultsTick > 260 || (tick - this.resultsTick) % 11 !== 0) return;
    const index = (tick - this.resultsTick) / 11;
    const colors = [0xffb340, 0x35f2ff, 0xff2d7a, 0x7dffb0, 0xfff0a8];
    const car = this.state.car;
    const position = this.track.worldPosition(car.s + ((index * 5) % 16) - 6, ((index * 7) % 11) - 5, car.h + 3 + ((index * 3) % 5));
    this.burst(colors[index % colors.length] ?? 0xffffff, 34 + ((index * 9) % 20), 6 + (index % 3) * 2, 1300, position);
    if (index % 3 === 0) this.popup(position, colors[(index + 2) % colors.length] ?? 0xffffff, 0.6, 900, index);
  }

  private burst(color: number, count: number, speed: number, lifetimeMs: number, position: Vec3 = this.state.car.position): void {
    this.renderer?.vfx.enqueue({ kind: "burst", position, count, color, speed, lifetimeMs, seed: (this.state.tick * 2654435761 + count) >>> 0 });
  }

  private transition(phase: Phase, reason: string): boolean {
    const outcome = this.flow.transition(phase, { tick: this.state.tick, reason });
    if (!outcome.ok) return false;
    this.state.phase = phase;
    this.input.setContext(phase === "countdown" || phase === "running" ? "drive" : "menu");
    this.emit("phase-changed", phase);
    return true;
  }

  // --- Run lifecycle -------------------------------------------------------

  private resetRun(): void {
    this.state.car = createCar();
    this.state.car.position = this.track.worldPosition(0, 0, 0);
    this.state.car.heading = this.track.frame(0).heading;
    this.state.elapsedTicks = 0;
    this.state.deaths = 0;
    this.state.checkpointsPassed = 0;
    this.state.checkpointIndex = 0;
    this.state.passed.clear();
    this.state.triggered.clear();
    this.state.runGhost = [];
    this.state.newRecord = false;
    this.state.finishTimeMs = null;
    this.state.medal = "none";
    this.state.cue = NO_CUE;
    this.state.held = NEUTRAL_HELD;
    this.speedOverride = 0;
    this.speedImpulse = 0;
    this.resultsTick = -1;
    this.toast = "";
    this.toastUntilTick = -1;
    this.wasBoosting = false;
    this.camera.setVariant({ kind: "orbit", distance: CHASE_DISTANCE, height: CHASE_HEIGHT, yaw: this.state.car.heading });
    this.camera.setZoom(1);
    this.cameraVariantKind = "orbit";
  }

  private beginCountdown(): void {
    if (this.state.phase !== "title" && this.state.phase !== "results") return;
    this.resetRun();
    if (!this.transition("countdown", this.state.phase === "title" ? "pilot-start" : "pilot-retry")) return;
    this.state.countdownTicks = COUNTDOWN_TICKS;
    this.emit("countdown-started", PLAYER_ID);
  }

  private beginRun(): void {
    if (!this.transition("running", "countdown-complete")) return;
    this.state.countdownTicks = 0;
    const car = this.state.car;
    this.burst(0x35f2ff, 36, 5, 700, this.track.worldPosition(car.s, car.x, car.h + 0.4));
    this.shockwave(car.s, car.x, car.h + 0.3, [0x35f2ff, 0xbfe9ff, 0x7dffb0], 7, 480, 12);
    this.popup(this.track.worldPosition(car.s + 6, 0, 4), 0x35f2ff, 0.6, 600);
    this.showToast("GO", 30);
    this.emit("run-started", PLAYER_ID);
  }

  private die(cause: DeathCause): void {
    const car = this.state.car;
    if (!car.alive) return;
    car.alive = false;
    car.deathCause = cause;
    car.respawnTicks = RESPAWN_TICKS;
    car.boosting = false;
    this.state.deaths += 1;
    this.speedOverride = 0;
    this.camera.shake(0.55, 28, this.state.tick, this.state.tick);
    this.burst(cause === "overheat" ? 0xff7a2a : 0xff2d7a, 64, 9, 950);
    this.burst(0x35f2ff, 32, 5.5, 750);
    this.burst(0xfff0a8, 20, 12, 500);
    this.shockwave(car.s, car.x, car.h + 0.6, cause === "overheat" ? [0xff7a2a, 0xffb340, 0xff2d7a] : [0xff2d7a, 0xffb340, 0x35f2ff], 6, 700, 12);
    this.toast = "";
    this.toastUntilTick = -1;
    this.emit("crashed", cause, this.state.deaths);
  }

  private respawn(): void {
    const car = this.state.car;
    const checkpoint = this.track.checkpoints.find((item) => item.index === this.state.checkpointIndex);
    car.s = checkpoint?.s ?? 0;
    car.x = 0;
    car.h = 0;
    car.verticalSpeed = 0;
    car.heat = 0;
    car.grounded = true;
    car.alive = true;
    car.deathCause = null;
    car.respawnTicks = 0;
    car.boosting = false;
    this.speedOverride = TUNING.respawnSpeed;
    this.speedImpulse = 0;
    for (const pad of this.track.boosts) this.state.triggered.delete(pad.id);
    for (const key of [...this.state.triggered]) if (key.startsWith("near:")) this.state.triggered.delete(key);
    this.burst(0x35f2ff, 40, 4, 650, this.track.worldPosition(car.s, 0, 0.5));
    this.shockwave(car.s, 0, 0.6, [0x35f2ff, 0xbfe9ff], 5, 420, 10);
    this.popup(this.track.worldPosition(car.s, 0, 3.5), 0x35f2ff, 0.5, 600);
    this.showToast("SIGNAL RESTORED", 40);
    this.emit("respawned", checkpoint?.id ?? "start", car.s);
  }

  private finish(): void {
    const finishMs = Math.round(this.state.elapsedTicks * DT * 1000);
    this.state.finishTimeMs = finishMs;
    this.state.medal = medalFor(finishMs / 1000);
    this.state.car.boosting = false;
    this.state.held = NEUTRAL_HELD;
    if (this.state.bestTimeMs === null || finishMs < this.state.bestTimeMs) {
      this.state.bestTimeMs = finishMs;
      this.state.bestGhost = Object.freeze([...this.state.runGhost]);
      this.state.newRecord = true;
      void this.saveLoad.save(SAVE_SLOT).then((outcome) => {
        this.lastSave = outcome.ok ? "saved" : outcome.code;
        this.emit(outcome.ok ? "progress-saved" : "progress-save-failed", SAVE_SLOT, finishMs);
      });
    }
    this.transition("results", "finish-line");
    this.resultsTick = this.state.tick;
    this.camera.transitionTo({ kind: "orbit", distance: 15, height: 5.5, yaw: this.state.car.heading + Math.PI * 0.72 }, 90, this.state.tick);
    this.camera.setZoom(1);
    this.burst(0xffb340, 72, 10, 1400, this.state.car.position);
    this.burst(0x35f2ff, 48, 7, 1200, this.state.car.position);
    this.shockwave(this.state.car.s, this.state.car.x, this.state.car.h + 1, [0xfff0a8, 0xffb340, 0x35f2ff, 0x7dffb0], 9, 900, 16);
    this.showToast(this.state.newRecord ? "NEW RECORD" : "FINISH", 90);
    this.emit("finished", this.state.medal, finishMs);
  }

  // --- Simulation ---------------------------------------------------------

  private stepRules(tick: number): void {
    const state = this.state;
    state.tick = tick;
    this.tickEvents = [];
    if (this.toastUntilTick >= 0 && tick > this.toastUntilTick) { this.toast = ""; this.toastUntilTick = -1; }
    if (this.pressed.has("start") || this.pressed.has("restart")) {
      if (state.phase === "title" || state.phase === "results") this.beginCountdown();
    }
    if (state.phase === "countdown") {
      state.countdownTicks = Math.max(0, state.countdownTicks - 1);
      if (state.countdownTicks === 0) this.beginRun();
    }
    if (state.phase === "running") { this.stepRun(tick); this.ambientVfx(tick); }
    else { state.car.boosting = false; this.wasBoosting = false; }
    if (state.phase === "results") this.fireworks(tick);
    this.pressed.clear();
    this.updatePose();
    this.updateCue();
    this.updateCamera(tick);
    this.publishFrame();
  }

  private stepRun(tick: number): void {
    const state = this.state;
    const car = state.car;
    state.elapsedTicks += 1;
    if (!car.alive) {
      car.respawnTicks = Math.max(0, car.respawnTicks - 1);
      if (car.respawnTicks === 0) this.respawn();
      return;
    }
    car.boosting = state.held.boost && car.heat < 1 && car.speed > 4;
    car.heat = Math.max(0, Math.min(1, car.heat + (car.boosting ? TUNING.heatRise : -TUNING.heatFall) * DT));
    if (car.heat >= 1) { this.die("overheat"); return; }

    const previousS = car.s;
    car.s += car.speed * DT;
    const limit = this.track.halfWidth - TUNING.carHalfWidth;
    car.x += car.steering * TUNING.lateralSpeed * DT * Math.min(1, car.speed / 18);
    if (car.x > limit || car.x < -limit) {
      car.x = Math.max(-limit, Math.min(limit, car.x));
      this.speedImpulse -= car.speed * TUNING.wallScrape;
      if (tick - this.lastWallTick > 6) {
        this.lastWallTick = tick;
        const edge = car.x + Math.sign(car.x) * TUNING.carHalfWidth;
        this.burst(tick % 12 === 0 ? 0xfff0a8 : 0x35f2ff, 12, 3.5, 340, this.track.worldPosition(car.s, edge, car.h + 0.3));
        this.streak(this.track.worldPosition(car.s - 3, edge, car.h + 0.25), this.track.worldPosition(car.s + 1, edge, car.h + 0.25), 0x35f2ff, 2, 220, 3);
        this.emit("wall-scrape", car.x > 0 ? "right" : "left");
      }
    }

    if (this.pressed.has("jump") && car.grounded) {
      car.grounded = false;
      car.verticalSpeed = TUNING.jumpSpeed;
      this.burst(0x35f2ff, 14, 3.2, 320, this.track.worldPosition(car.s - 1, car.x, car.h + 0.15));
      this.streak(this.track.worldPosition(car.s - 2.2, car.x - 1.1, 0.1), this.track.worldPosition(car.s - 4.5, car.x - 1.4, 0.1), 0x35f2ff, 2, 260, 1);
      this.streak(this.track.worldPosition(car.s - 2.2, car.x + 1.1, 0.1), this.track.worldPosition(car.s - 4.5, car.x + 1.4, 0.1), 0x35f2ff, 2, 260, 2);
      this.emit("jumped", PLAYER_ID, car.speed);
    }
    if (car.grounded && !this.track.roadExists(car.s)) {
      car.grounded = false;
      car.verticalSpeed = 0;
      this.emit("left-road", this.track.gapAt(car.s)?.id ?? "edge");
    }
    if (!car.grounded) {
      car.verticalSpeed -= TUNING.gravity * DT;
      car.h += car.verticalSpeed * DT;
      if (car.h <= 0) {
        if (car.h > -0.6 && this.track.roadExists(car.s)) {
          const impact = -car.verticalSpeed;
          car.h = 0;
          car.verticalSpeed = 0;
          car.grounded = true;
          if (impact > 6) this.camera.shake(Math.min(0.25, impact * 0.02), 8, tick, tick);
          this.burst(0x35f2ff, Math.min(40, 12 + Math.round(impact * 2)), 3.5 + impact * 0.2, 420, this.track.worldPosition(car.s, car.x, 0.2));
          this.shockwave(car.s, car.x, 0.2, [0x35f2ff, 0xbfe9ff], 2.5 + impact * 0.25, 280, 6);
          if (impact > 9) this.showToast("HARD LANDING", 30);
          this.emit("landed", PLAYER_ID, impact);
        } else if (car.h < -3) {
          this.die("fall");
          return;
        }
      }
    }

    for (const gate of this.track.gates) {
      if (gate.s <= previousS || gate.s > car.s) continue;
      const half = TUNING.carHalfWidth;
      const hit = gate.gate === "low" ? car.h < TUNING.lowBarClearance
        : gate.gate === "left" ? car.x - half < 0
        : gate.gate === "right" ? car.x + half > 0
        : Math.abs(car.x) - half < this.track.halfWidth / 3;
      if (hit) { this.die("laser"); return; }
      this.burst(0xff86b6, 18, 4.5, 520, this.track.worldPosition(gate.s, car.x, car.h + 0.8));
      this.shockwave(gate.s, car.x, car.h + 0.6, [0xff2d7a, 0xff86b6], 3.5, 320, 8);
      this.popup(this.track.worldPosition(gate.s, 0, 5.2), 0xff86b6, 0.5, 700);
      this.showToast("GATE CLEAR", 36);
      this.emit("gate-cleared", gate.id);
    }
    for (const pillar of this.track.pillars) {
      if (Math.abs(pillar.s - car.s) > 2.2 || car.h >= TUNING.pillarHeight) continue;
      const clearance = Math.abs(car.x - pillar.x) - TUNING.pillarHalfWidth - TUNING.carHalfWidth;
      if (clearance < 0) { this.die("crash"); return; }
      const key = `near:${pillar.id}`;
      if (clearance < 1.3 && !state.triggered.has(key)) {
        state.triggered.add(key);
        const side = Math.sign(car.x - pillar.x) || 1;
        this.burst(0xffb340, 16, 4, 420, this.track.worldPosition(pillar.s, pillar.x + side * TUNING.pillarHalfWidth, car.h + 1.2));
        this.streak(this.track.worldPosition(pillar.s - 2, pillar.x + side * TUNING.pillarHalfWidth, 0.5), this.track.worldPosition(pillar.s + 3, pillar.x + side * TUNING.pillarHalfWidth, 3.2), 0xffb340, 2, 360, 4);
        this.showToast("NEAR MISS", 36);
        this.emit("near-miss", pillar.id, clearance);
      }
    }
    for (const pad of this.track.boosts) {
      if (state.triggered.has(pad.id)) { if (car.s > pad.s1 + 40) state.triggered.delete(pad.id); continue; }
      if (car.grounded && car.s >= pad.s0 && car.s <= pad.s1) {
        state.triggered.add(pad.id);
        this.speedImpulse += TUNING.boostPadGain;
        this.burst(0xffb340, 34, 7, 700, this.track.worldPosition(car.s, car.x, 0.4));
        this.burst(0xfff0a8, 16, 3, 400, this.track.worldPosition(car.s + 1, car.x, 0.8));
        for (const lateral of [-4, -1.5, 1.5, 4]) this.streak(this.track.worldPosition(pad.s0, lateral, 0.15), this.track.worldPosition(pad.s1 + 14, lateral, 0.15), 0xffb340, 2, 420, lateral + 5);
        this.camera.shake(0.1, 5, tick, tick);
        this.showToast("BOOST", 30);
        this.emit("boost-pad", pad.id, car.speed);
      }
    }
    for (const checkpoint of this.track.checkpoints) {
      if (state.passed.has(checkpoint.id) || !state.triggered.has(checkpoint.id) || car.s < checkpoint.s - 12) continue;
      state.passed.add(checkpoint.id);
      state.checkpointIndex = checkpoint.index;
      state.checkpointsPassed = state.passed.size;
      this.popup(this.track.worldPosition(checkpoint.s, 0, 9.5), 0x7dffb0, 0.6, 900);
      this.burst(0x7dffb0, 36, 6, 900, this.track.worldPosition(checkpoint.s, 0, 6.5));
      this.burst(0x35f2ff, 20, 4, 700, this.track.worldPosition(checkpoint.s, car.x, car.h + 0.6));
      this.shockwave(checkpoint.s, 0, 6.8, [0x7dffb0, 0x35f2ff, 0xbfe9ff], 8, 520, 12);
      this.showToast(`CHECKPOINT ${checkpoint.index}`, 40);
      this.emit("checkpoint", checkpoint.id, checkpoint.index);
    }
    if (state.elapsedTicks % GHOST_INTERVAL_TICKS === 0) state.runGhost.push(Object.freeze({ s: car.s, x: car.x, h: car.h }));
    if (car.s >= this.track.finish.s) this.finish();
  }

  private updatePose(): void {
    const car = this.state.car;
    car.s = Math.max(0, Math.min(this.track.length, car.s));
    const frame = this.track.frame(car.s);
    car.heading = frame.heading;
    car.position = this.track.worldPosition(car.s, car.x, car.h);
  }

  private updateCue(): void {
    const state = this.state;
    if (state.phase !== "running" || !state.car.alive) { state.cue = state.phase === "running" ? state.cue : NO_CUE; return; }
    let next: TrackFeature | null = null;
    for (const feature of this.track.features) {
      const start = featureStart(feature);
      if (feature.kind === "checkpoint" && state.passed.has(feature.id)) continue;
      if (feature.kind === "boost" && state.triggered.has(feature.id)) continue;
      if (start < state.car.s - 1) continue;
      if (start - state.car.s > CUE_RANGE) break;
      next = feature;
      break;
    }
    const cue: CueSnapshot = next === null ? NO_CUE : Object.freeze({ kind: next.kind, label: cueLabel(next), distance: Math.max(0, Math.round(featureStart(next) - state.car.s)) });
    if (cue.kind !== state.cue.kind || cue.label !== state.cue.label) this.emit("cue-changed", cue.label);
    state.cue = cue;
  }

  private updateCamera(tick: number): void {
    const state = this.state;
    const car = state.car;
    if (state.phase === "results") {
      if (this.resultsTick >= 0 && tick - this.resultsTick > 90) {
        const yaw = car.heading + Math.PI * 0.72 + (tick - this.resultsTick - 90) * 0.0045;
        this.camera.setVariant({ kind: "orbit", distance: 15, height: 5.5, yaw });
      }
      this.cameraVariantKind = "orbit-results";
      return;
    }
    const variant: CameraVariant = { kind: "orbit", distance: CHASE_DISTANCE + (car.alive ? 0 : 3), height: CHASE_HEIGHT + Math.max(0, car.h) * 0.35, yaw: car.heading + car.steering * 0.08 };
    this.camera.setVariant(variant);
    this.camera.setZoom(car.boosting ? 0.84 : car.speed > TUNING.maxSpeed + 4 ? 0.9 : 1);
    this.cameraVariantKind = "orbit";
  }

  private hudExtras(): Record<string, string | number | boolean> {
    const state = this.state;
    const car = state.car;
    const best = state.bestTimeMs === null ? "—" : formatTime(state.bestTimeMs / 1000);
    return {
      track: this.track?.name ?? "Meridian Descent",
      speed: Math.round(car.speed * 3.6),
      speedRatio: Math.min(1, car.speed / TUNING.boostSpeed),
      heat: car.heat,
      heatLabel: car.heat >= 0.85 ? "CRITICAL" : car.boosting ? "BOOSTING" : "HEAT",
      boosting: car.boosting,
      time: formatTime(state.elapsedTicks * DT),
      checkpoints: `${state.checkpointsPassed}/${this.track?.checkpoints.length ?? 4}`,
      deaths: state.deaths,
      best,
      cue: state.cue.label,
      cueDistance: state.cue.kind === null ? "" : `${state.cue.distance} m`,
      cueKind: state.cue.kind ?? "",
      countdown: state.phase === "countdown" ? (state.countdownTicks > COUNTDOWN_TICKS * 0.66 ? "3" : state.countdownTicks > COUNTDOWN_TICKS * 0.33 ? "2" : "1") : "GO",
      medal: state.medal.toUpperCase(),
      finishTime: state.finishTimeMs === null ? "" : formatTime(state.finishTimeMs / 1000),
      record: state.newRecord,
      ghost: state.bestGhost.length > 0,
      alive: car.alive,
      deathCause: car.deathCause ?? "",
      progress: Math.min(1, car.s / (this.track?.finish.s ?? 1)),
      toast: this.toast ?? "",
    };
  }

  private publishFrame(): void {
    this.hud.update({ screen: this.state.phase, score: this.state.checkpointsPassed, timerSeconds: this.state.elapsedTicks * DT, extras: this.hudExtras() });
    this.renderer?.prepare(this.snapshot(), Object.freeze([...this.tickEvents]));
  }

  // --- Public API ----------------------------------------------------------

  advance(seconds: number): number {
    if (this.isDisposed || !Number.isFinite(seconds) || seconds < 0) return 0;
    this.accumulator += seconds;
    let steps = 0;
    while (this.accumulator >= DT - 1e-9 && steps < MAX_STEPS) {
      this.accumulator -= DT;
      const result = this.runtime.stepExact(1);
      if (!result.ok) break;
      steps += 1;
    }
    if (steps === MAX_STEPS) this.accumulator = 0;
    return steps;
  }

  present(timestampMs: number): boolean {
    if (this.isDisposed || !this.presentationStarted || !Number.isFinite(timestampMs) || timestampMs < 0) return false;
    this.lastTimestamp = Math.max(timestampMs, this.lastTimestamp + 1);
    return this.frames.deliver(this.lastTimestamp);
  }

  start(): void { if (!this.isDisposed && this.state.phase === "title") this.pressed.add("start"); }
  restart(): void { if (!this.isDisposed && this.state.phase === "results") this.pressed.add("restart"); }

  setInput(input: Readonly<{ readonly steer?: number; readonly throttle?: boolean; readonly brake?: boolean; readonly boost?: boolean }>): void {
    if (this.isDisposed) return;
    if (input.steer !== undefined) this.input.setAxis(clampUnit(input.steer), 0);
    const patch: { throttle?: boolean; brake?: boolean; boost?: boolean } = {};
    if (input.throttle !== undefined) patch.throttle = input.throttle;
    if (input.brake !== undefined) patch.brake = input.brake;
    if (input.boost !== undefined) patch.boost = input.boost;
    this.setHeld(patch);
  }

  press(action: Action): void { if (!this.isDisposed) this.handleAction(action); }
  pressPhysical(input: string): void { if (!this.isDisposed) this.input.pressPhysical(input); }
  setAxis(x: number): void { if (!this.isDisposed) this.input.setAxis(clampUnit(x), 0); }
  updateGamepad(deviceId: string, x: number, buttons: readonly string[]): void { if (!this.isDisposed) this.input.updateGamepad(deviceId, clampUnit(x), 0, buttons); }

  loadScenario(id: Scenario): void {
    if (this.isDisposed) return;
    if (this.state.phase === "title" || this.state.phase === "results") {
      this.resetRun();
      this.transition("running", "qa-scenario");
      this.emit("run-started", PLAYER_ID);
    }
    if (this.state.phase === "countdown") this.beginRun();
    const target = id === "gap" ? this.track.gaps[0]!.s0 - 55
      : id === "laser" ? this.track.gates[0]!.s - 40
      : id === "boost" ? this.track.boosts[0]!.s0 - 40
      : id === "slalom" ? this.track.pillars[2]!.s - 40
      : id === "finish" ? this.track.finish.s - 50
      : 0;
    const car = this.state.car;
    car.s = Math.max(0, target);
    car.x = 0;
    car.h = 0;
    car.verticalSpeed = 0;
    car.grounded = true;
    car.alive = true;
    car.deathCause = null;
    car.respawnTicks = 0;
    car.heat = 0;
    car.boosting = false;
    this.speedOverride = id === "start" ? 0 : 34;
    this.speedImpulse = 0;
    this.state.triggered.clear();
    for (const checkpoint of this.track.checkpoints) {
      if (checkpoint.s <= car.s) { this.state.passed.add(checkpoint.id); this.state.checkpointIndex = checkpoint.index; }
    }
    this.state.checkpointsPassed = this.state.passed.size;
    this.updatePose();
    this.updateCue();
    this.publishFrame();
    this.emit("scenario-loaded", id, car.s);
  }

  snapshot(): AfterglowSnapshot { return snapshotOf(this.state, this.track.checkpoints.length, this.track.length); }
  events(): readonly AfterglowEvent[] { return Object.freeze([...this.collected]); }
  errors(): readonly RuntimeErrorRecord[] { return Object.freeze([...this.errorRecords]); }
  inspectRuntime(): AfterglowRuntimeInspection {
    const life = this.runtime.inspectLifecycle();
    const vehicle = this.vehicles.disposed ? null : this.vehicles.snapshot()[0] ?? null;
    return Object.freeze({
      lifecycleState: life.state,
      installedFeatureIds: Object.freeze([...life.installedFeatureIds]),
      scheduleSystemIds: Object.freeze(life.scheduleReport.map(({ systemId }) => systemId)),
      schedulerTick: this.runtime.tick,
      inputContext: this.input.disposed ? "" : this.input.inspect().context,
      vehicle: Object.freeze({ speed: vehicle?.speed ?? 0, steering: vehicle?.steering ?? 0, driver: vehicle?.occupants[DRIVER_SEAT] ?? null }),
      cameraVariant: this.cameraVariantKind,
    });
  }
  inspectRenderer(): AfterglowRendererInspection | null { return this.renderer?.inspect() ?? null; }
  inspectVfx(): VfxInspection | null { return this.renderer?.vfx.inspect() ?? null; }
  inspectSave(): AfterglowSaveInspection {
    return Object.freeze({ ready: this.saveReady, lastLoad: this.lastLoad, lastSave: this.lastSave, bestTimeMs: this.state.bestTimeMs, ghostSamples: this.state.bestGhost.length });
  }
  inspectLeaks(): AfterglowLeakInspection {
    return Object.freeze({ activeListeners: this.listeners.size, activeFeatures: this.isDisposed ? 0 : this.runtime.inspectLifecycle().installedFeatureIds.length, disposed: this.isDisposed });
  }
  subscribe(listener: (event: AfterglowEvent) => void): () => void {
    if (this.isDisposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    void this.runtime.shutdown();
    this.listeners.clear();
    this.pressed.clear();
  }
}

export function createAfterglowGame(options: AfterglowGameOptions): AfterglowGame {
  return new Game(options);
}
