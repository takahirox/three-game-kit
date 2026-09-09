import { Runtime as ClientRuntime } from "@three-game-kit/client";
import { createDebugDevToolsClientFeature } from "@three-game-kit/client/advanced";
import { createGameFlowClientFeature, createHealthClientFeature, createHudFeature, type HudAdapter } from "@three-game-kit/client/gameplay";
import { createInventoryClientFeature, createSaveLoadClientFeature } from "@three-game-kit/client/genre";
import { createInputFeature, createMovementInput, createSemanticActionInput } from "@three-game-kit/client/input";
import { createParticleFeature } from "@three-game-kit/client/particles";
import { createRenderingFeature } from "@three-game-kit/client/rendering";
import {
  createDeterministicPresentationFrameSource,
  createTelemetryStore,
  defineFeatureConfiguration,
  type ClientFeatureDescriptor,
  type ClientFeatureSetupContext,
  type RuntimeErrorRecord,
} from "@three-game-kit/core";
import { createDebugDevToolsRuntime, type DebugSnapshot } from "@three-game-kit/shared/advanced";
import { createGameFlowRuntime, createHealthRuntime, createHudStateStore } from "@three-game-kit/shared/gameplay";
import { createInventoryRuntime, createSaveLoadRuntime, type SaveAdapter, type SaveValue } from "@three-game-kit/shared/genre";
import { AIR, DIAMOND_ORE, HOTBAR_ITEMS, IRON_ORE, ITEM_KEYS, LOG, STONE, WATER, blockById, blockByKey } from "./blocks.js";
import type { DeepfieldRenderer, DeepfieldRendererInspection } from "./renderer.js";
import {
  AUTOSAVE_TICKS,
  DAY_TICKS,
  DEFAULT_SEED,
  DT,
  NEUTRAL_HELD,
  OBJECTIVES,
  PLAYER_ID,
  RESPAWN_TICKS,
  SAVE_SLOT,
  SAVE_VERSION,
  START_TIME,
  TUNING,
  createPlayer,
  createState,
  formatClock,
  vec3,
  type Action,
  type DeepfieldEvent,
  type DeepfieldSnapshot,
  type HeldInput,
  type HotbarSlot,
  type MutableState,
  type ObjectiveSnapshot,
  type Phase,
  type Scenario,
} from "./state.js";
import { VoxelWorld, WORLD, type Vec3 } from "./world.js";

const MAX_STEPS = 1_200;
const ACTIONS: readonly Action[] = Object.freeze([
  "jump", "mine-start", "mine-end", "place", "sprint-start", "sprint-end",
  "select-1", "select-2", "select-3", "select-4", "select-5", "select-6", "select-7", "select-8", "select-9",
  "next-slot", "previous-slot", "start", "continue", "respawn", "save",
]);
const EMPTY = defineFeatureConfiguration<Readonly<Record<string, never>>>({
  defaultValue: () => Object.freeze({}),
  parse(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) && Reflect.ownKeys(value).length === 0
      ? { ok: true as const, value: Object.freeze({}) }
      : { ok: false as const, issues: [{ path: [], code: "empty-object-required" }] };
  },
});

export interface DeepfieldRuntimeInspection {
  readonly lifecycleState: string;
  readonly installedFeatureIds: readonly string[];
  readonly scheduleSystemIds: readonly string[];
  readonly schedulerTick: number;
  readonly debugProviders: readonly string[];
}

export interface DeepfieldWorldInspection {
  readonly seed: number;
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  readonly editCount: number;
  readonly spawn: Vec3;
}

export interface DeepfieldSaveInspection {
  readonly ready: boolean;
  readonly lastLoad: string | null;
  readonly lastSave: string | null;
  readonly hasSave: boolean;
  readonly editCount: number;
}

export interface DeepfieldLeakInspection {
  readonly activeListeners: number;
  readonly activeFeatures: number;
  readonly disposed: boolean;
}

export interface DeepfieldGame {
  readonly disposed: boolean;
  readonly world: VoxelWorld;
  advance(seconds: number): number;
  present(timestampMs: number): boolean;
  start(): void;
  continueWorld(): void;
  setMove(x: number, z: number): void;
  setLook(yaw: number, pitch: number): void;
  look(deltaYaw: number, deltaPitch: number): void;
  setHeld(patch: Partial<HeldInput>): void;
  press(action: Action): void;
  loadScenario(id: Scenario): void;
  setTimeOfDay(fraction: number): void;
  snapshot(): DeepfieldSnapshot;
  events(): readonly DeepfieldEvent[];
  errors(): readonly RuntimeErrorRecord[];
  debugSnapshot(): DebugSnapshot | null;
  inspectRuntime(): DeepfieldRuntimeInspection;
  inspectRenderer(): DeepfieldRendererInspection | null;
  inspectWorld(): DeepfieldWorldInspection;
  inspectSave(): DeepfieldSaveInspection;
  inspectInventory(): Readonly<Record<string, number>>;
  inspectLeaks(): DeepfieldLeakInspection;
  subscribe(listener: (event: DeepfieldEvent) => void): () => void;
  dispose(): void;
}

export interface DeepfieldGameOptions {
  readonly renderer?: DeepfieldRenderer;
  readonly hudAdapter: HudAdapter;
  readonly saveAdapter: SaveAdapter;
  readonly seed?: number;
}

type Contribution = ClientFeatureDescriptor<Readonly<Record<string, never>>>["runtimeContributions"][number];

function feature(id: string, description: string, contribution: Contribution, onSetup: () => void, onDispose: () => void): ClientFeatureDescriptor<Readonly<Record<string, never>>> {
  return Object.freeze({
    id,
    description,
    runtimeContributions: Object.freeze([contribution]),
    requires: Object.freeze([]),
    conflicts: Object.freeze([]),
    configuration: EMPTY,
    setup({ ledger }: ClientFeatureSetupContext<Readonly<Record<string, never>>>): void { onSetup(); ledger.activateSystem(contribution.id); },
    dispose(): void { onDispose(); },
  });
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

type SaveShape = Readonly<{
  readonly seed: number;
  readonly edits: readonly number[];
  readonly player: Readonly<{ x: number; y: number; z: number; yaw: number; pitch: number }>;
  readonly items: readonly (readonly [string, number])[];
  readonly stats: Readonly<{ mined: number; placed: number; deaths: number; minedByKey: Readonly<Record<string, number>> }>;
  readonly timeTicks: number;
  readonly playTicks: number;
  readonly selectedSlot: number;
}>;

function isSaveShape(data: SaveValue): data is SaveShape {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const record = data as Readonly<Record<string, SaveValue>>;
  const player = record["player"];
  const stats = record["stats"];
  return typeof record["seed"] === "number"
    && Array.isArray(record["edits"]) && record["edits"].every((value) => typeof value === "number")
    && typeof player === "object" && player !== null && !Array.isArray(player)
    && Array.isArray(record["items"])
    && typeof stats === "object" && stats !== null && !Array.isArray(stats)
    && typeof record["timeTicks"] === "number" && typeof record["playTicks"] === "number" && typeof record["selectedSlot"] === "number";
}

class Game implements DeepfieldGame {
  readonly world: VoxelWorld;
  private readonly spawn: Vec3;
  private state: MutableState;
  private readonly renderer: DeepfieldRenderer | null;
  private readonly movement = createMovementInput();
  private readonly actions = createSemanticActionInput(ACTIONS);
  private readonly pressed = new Set<Action>();
  private readonly listeners = new Set<(event: DeepfieldEvent) => void>();
  private readonly collected: DeepfieldEvent[] = [];
  private tickEvents: DeepfieldEvent[] = [];
  private readonly errorRecords: RuntimeErrorRecord[] = [];
  private readonly telemetry = createTelemetryStore({
    runtime: "client",
    observeRuntimeError: (record) => {
      if (this.errorRecords.length >= 64) this.errorRecords.shift();
      this.errorRecords.push(record);
    },
  });
  private readonly frames = createDeterministicPresentationFrameSource();
  private readonly inventory = createInventoryRuntime(ITEM_KEYS.map((id) => ({ id, maximumStack: 64 })));
  private readonly health = createHealthRuntime();
  private readonly flow = createGameFlowRuntime({
    initialState: "title",
    states: [
      { id: "title", allowedTo: ["playing"] },
      { id: "playing", allowedTo: ["dead", "complete", "title"] },
      { id: "dead", allowedTo: ["playing"] },
      { id: "complete", allowedTo: ["playing"] },
    ],
  });
  private readonly hud = createHudStateStore({ screen: "title", health: TUNING.maximumHealth, maximumHealth: TUNING.maximumHealth, extras: {} });
  private readonly debug = createDebugDevToolsRuntime();
  private readonly saveLoad: ReturnType<typeof createSaveLoadRuntime>;
  private readonly runtime: ClientRuntime;
  private accumulator = 0;
  private presentationStarted = false;
  private lastTimestamp = -1;
  private isDisposed = false;
  private lastDebug: DebugSnapshot | null = null;
  private saveReady = false;
  private lastLoad: string | null = null;
  private lastSave: string | null = null;
  private saving = false;

  constructor(options: DeepfieldGameOptions) {
    this.world = new VoxelWorld(options.seed ?? DEFAULT_SEED);
    this.spawn = this.world.findSpawn();
    this.state = createState(this.spawn);
    this.renderer = options.renderer ?? null;
    this.renderer?.attachWorld(this.world);
    this.inventory.createContainer(PLAYER_ID, 16);
    this.health.register(PLAYER_ID, TUNING.maximumHealth);
    this.debug.registerProvider("player", () => ({ x: this.state.player.position.x, y: this.state.player.position.y, z: this.state.player.position.z, health: this.state.player.health, phase: this.state.phase }));
    this.debug.registerProvider("world", () => ({ seed: this.world.seed, edits: this.world.editCount, mined: this.state.stats.mined, placed: this.state.stats.placed }));

    this.saveLoad = createSaveLoadRuntime({
      currentVersion: SAVE_VERSION,
      adapter: options.saveAdapter,
      capture: () => this.captureSave(),
      validate: (data) => isSaveShape(data),
      restore: (data) => this.restoreSave(data),
    });
    void this.saveLoad.load(SAVE_SLOT).then((outcome) => {
      this.lastLoad = outcome.ok ? "loaded" : outcome.code;
      this.saveReady = true;
      this.state.hasSave = outcome.ok;
      if (outcome.ok) this.emit("world-loaded", SAVE_SLOT, this.world.editCount);
      this.publishFrame();
    });

    const features: ClientFeatureDescriptor<unknown>[] = [
      createInputFeature({
        input: this.movement,
        publish: (command) => { this.state.move = Object.freeze({ x: command.x, z: command.z }); },
        actions: this.actions,
        publishAction: (action) => this.handleAction(action as Action),
      }),
      feature("deepfield.rules", "Advances the deterministic voxel sandbox rules", { kind: "system", id: "deepfield.rules.step", domain: "client-simulation", phase: "shared-predict", priority: 50, run: ({ tick }: { readonly tick: number }) => this.stepRules(tick) }, () => undefined, () => undefined),
      createInventoryClientFeature(this.inventory),
      createHealthClientFeature({ runtime: this.health, publish: (events) => this.applyHealthEvents(events) }),
      createGameFlowClientFeature(this.flow),
      createSaveLoadClientFeature(this.saveLoad),
      createHudFeature({ store: this.hud, adapter: options.hudAdapter }),
      createDebugDevToolsClientFeature(this.debug, (value) => { this.lastDebug = value; }),
    ];
    if (this.renderer !== null) {
      const renderer = this.renderer;
      features.push(
        feature("deepfield.camera", "Publishes the first-person eye transform each presentation frame", { kind: "system", id: "deepfield.camera.view", domain: "client-presentation", phase: "camera-view", priority: 0, run: () => renderer.setCamera(this.eyePosition(), this.state.player.yaw, this.state.player.pitch) }, () => undefined, () => undefined),
        createParticleFeature({ emitters: [renderer.debris] }),
        createRenderingFeature({ renderer }),
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

  // --- Events -------------------------------------------------------------------

  private emit(kind: string, subject?: string, value?: number): void {
    const event: DeepfieldEvent = Object.freeze({ kind, tick: this.state.tick, ...(subject === undefined ? {} : { subject }), ...(value === undefined ? {} : { value }) });
    if (this.collected.length >= 512) this.collected.shift();
    this.collected.push(event);
    this.tickEvents.push(event);
    for (const listener of this.listeners) listener(event);
  }

  private transition(phase: Phase, reason: string): boolean {
    const outcome = this.flow.transition(phase, { tick: this.state.tick, reason });
    if (!outcome.ok) return false;
    this.state.phase = phase;
    this.emit("phase-changed", phase);
    return true;
  }

  private handleAction(action: Action): void {
    switch (action) {
      case "mine-start": this.state.held = Object.freeze({ ...this.state.held, mine: true }); return;
      case "mine-end": this.state.held = Object.freeze({ ...this.state.held, mine: false }); return;
      case "sprint-start": this.state.held = Object.freeze({ ...this.state.held, sprint: true }); return;
      case "sprint-end": this.state.held = Object.freeze({ ...this.state.held, sprint: false }); return;
      default: this.pressed.add(action);
    }
  }

  // --- Save / load ------------------------------------------------------------------

  private captureSave(): SaveValue {
    const items = Object.entries(this.inventoryCounts()).filter(([, count]) => count > 0).map(([key, count]) => [key, count] as const);
    const player = this.state.player;
    return {
      seed: this.world.seed,
      edits: this.world.serializeEdits(),
      player: { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.yaw, pitch: player.pitch },
      items: items.map(([key, count]) => [key, count]),
      stats: { mined: this.state.stats.mined, placed: this.state.stats.placed, deaths: this.state.stats.deaths, minedByKey: { ...this.state.stats.minedByKey } },
      timeTicks: this.state.timeTicks,
      playTicks: this.state.playTicks,
      selectedSlot: this.state.selectedSlot,
    };
  }

  private restoreSave(data: SaveValue): void {
    if (!isSaveShape(data)) throw new TypeError("Deepfield save data is invalid");
    if (data.seed !== this.world.seed) throw new TypeError("Deepfield save belongs to a different world seed");
    this.world.resetEdits();
    this.world.applyEdits(data.edits);
    for (const [key, count] of Object.entries(this.inventoryCounts())) if (count > 0) this.inventory.remove(PLAYER_ID, key, count);
    for (const entry of data.items) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || typeof entry[1] !== "number") continue;
      if (blockByKey(entry[0]) !== undefined && entry[1] > 0) this.inventory.add(PLAYER_ID, entry[0], Math.min(64, Math.floor(entry[1])));
    }
    const player = this.state.player;
    player.position = vec3(data.player.x, data.player.y, data.player.z);
    player.yaw = data.player.yaw;
    player.pitch = data.player.pitch;
    player.velocity = vec3(0, 0, 0);
    this.state.stats = { mined: data.stats.mined, placed: data.stats.placed, deaths: data.stats.deaths, minedByKey: { ...data.stats.minedByKey } };
    this.state.timeTicks = data.timeTicks;
    this.state.playTicks = data.playTicks;
    this.state.selectedSlot = Math.max(0, Math.min(8, Math.floor(data.selectedSlot)));
    this.state.dirtySinceSave = false;
  }

  private requestSave(reason: string): void {
    if (this.saving || this.isDisposed) return;
    this.saving = true;
    void this.saveLoad.save(SAVE_SLOT).then((outcome) => {
      this.saving = false;
      this.lastSave = outcome.ok ? "saved" : outcome.code;
      if (outcome.ok) { this.state.hasSave = true; this.state.lastSaveTick = this.state.tick; this.state.dirtySinceSave = false; }
      this.emit(outcome.ok ? "world-saved" : "world-save-failed", reason, this.world.editCount);
    });
  }

  // --- Lifecycle ---------------------------------------------------------------------

  private newWorld(): void {
    this.world.resetEdits();
    for (const [key, count] of Object.entries(this.inventoryCounts())) if (count > 0) this.inventory.remove(PLAYER_ID, key, count);
    this.state.player = createPlayer(this.spawn);
    this.health.reset(PLAYER_ID);
    this.state.stats = { mined: 0, placed: 0, deaths: 0, minedByKey: {} };
    this.state.timeTicks = Math.round(START_TIME * DAY_TICKS);
    this.state.playTicks = 0;
    this.state.selectedSlot = 0;
    this.state.completedAnnounced = false;
    this.state.dirtySinceSave = true;
    this.state.miningProgress = 0;
    this.state.miningKey = null;
    this.state.held = NEUTRAL_HELD;
  }

  private beginPlay(reason: string): void {
    if (this.state.phase !== "title") return;
    this.transition("playing", reason);
    this.emit("play-started", reason);
  }

  private die(cause: string): void {
    this.state.respawnTicks = RESPAWN_TICKS;
    this.state.stats.deaths += 1;
    this.state.held = NEUTRAL_HELD;
    this.state.miningProgress = 0;
    this.renderer?.emitDebris(this.state.player.position, 0xff5b68, 40, this.state.tick);
    this.transition("dead", cause);
    this.emit("player-died", cause, this.state.stats.deaths);
  }

  private respawn(): void {
    this.state.player.position = this.spawn;
    this.state.player.velocity = vec3(0, 0, 0);
    this.state.player.grounded = false;
    this.health.reset(PLAYER_ID);
    this.state.player.health = TUNING.maximumHealth;
    this.state.respawnTicks = 0;
    this.transition("playing", "respawn");
    this.emit("respawned", PLAYER_ID);
  }

  private applyHealthEvents(events: readonly { readonly kind: string; readonly entityId: string; readonly after: number; readonly appliedAmount: number }[]): void {
    for (const event of events) {
      if (event.entityId !== PLAYER_ID) continue;
      this.state.player.health = event.after;
      if (event.kind === "damaged") { this.state.player.lastDamageTick = this.state.tick; this.emit("player-damaged", PLAYER_ID, event.appliedAmount); }
      if (event.kind === "healed") this.emit("player-healed", PLAYER_ID, event.appliedAmount);
      if (event.kind === "died" && this.state.phase === "playing") this.die("fall");
    }
  }

  // --- Simulation --------------------------------------------------------------------

  private stepRules(tick: number): void {
    const state = this.state;
    state.tick = tick;
    this.tickEvents = [];
    if (state.phase === "title") {
      if (this.pressed.has("start")) { this.newWorld(); this.beginPlay("new-world"); }
      else if (this.pressed.has("continue") && state.hasSave) this.beginPlay("continue");
    } else if (state.phase === "dead") {
      state.respawnTicks = Math.max(0, state.respawnTicks - 1);
      if (state.respawnTicks === 0 || this.pressed.has("respawn")) this.respawn();
    } else if (state.phase === "complete") {
      if (this.pressed.has("continue") || this.pressed.has("start")) { this.transition("playing", "keep-building"); }
    }
    if (state.phase === "playing") this.stepPlay(tick);
    if (this.pressed.has("save") && state.phase !== "title") this.requestSave("manual");
    this.pressed.clear();
    this.publishFrame();
  }

  private stepPlay(tick: number): void {
    const state = this.state;
    const player = state.player;
    state.playTicks += 1;
    state.timeTicks = (state.timeTicks + 1) % DAY_TICKS;
    this.handleHotbar();

    // --- Movement ---
    const inWater = this.world.isLiquid(Math.floor(player.position.x), Math.floor(player.position.y + 0.4), Math.floor(player.position.z))
      || this.world.isLiquid(Math.floor(player.position.x), Math.floor(player.position.y + 1.2), Math.floor(player.position.z));
    player.inWater = inWater;
    player.eyeInWater = this.world.isLiquid(Math.floor(player.position.x), Math.floor(player.position.y + TUNING.eyeHeight), Math.floor(player.position.z));
    player.sprinting = state.held.sprint && state.move.z < -0.1 && !inWater;
    const speed = inWater ? TUNING.waterSpeed : player.sprinting ? TUNING.sprintSpeed : TUNING.walkSpeed;
    const forwardX = -Math.sin(player.yaw);
    const forwardZ = -Math.cos(player.yaw);
    const rightX = Math.cos(player.yaw);
    const rightZ = -Math.sin(player.yaw);
    const wishX = (forwardX * -state.move.z + rightX * state.move.x) * speed;
    const wishZ = (forwardZ * -state.move.z + rightZ * state.move.x) * speed;
    let vx = player.velocity.x;
    let vy = player.velocity.y;
    let vz = player.velocity.z;
    const control = player.grounded || inWater ? 1 : TUNING.airControl;
    vx += (wishX - vx) * Math.min(1, control * 0.45);
    vz += (wishZ - vz) * Math.min(1, control * 0.45);
    if (this.pressed.has("jump")) {
      if (inWater) vy = TUNING.swimSpeed;
      else if (player.grounded) { vy = TUNING.jumpSpeed; player.grounded = false; this.emit("jumped", PLAYER_ID); }
    }
    vy -= (inWater ? TUNING.waterGravity : TUNING.gravity) * DT;
    const terminal = inWater ? TUNING.waterTerminalSpeed : TUNING.terminalSpeed;
    if (vy < -terminal) vy = -terminal;
    if (inWater && vy > TUNING.swimSpeed) vy = TUNING.swimSpeed;
    const resolved = this.moveWithCollision(player.position, vx * DT, vy * DT, vz * DT);
    player.position = resolved.position;
    if (resolved.hitX) vx = 0;
    if (resolved.hitZ) vz = 0;
    if (resolved.hitY) {
      if (vy < 0) {
        const impact = -vy;
        player.grounded = true;
        if (!inWater && impact > TUNING.fallDamageSpeed) {
          const damage = Math.max(1, Math.round((impact - TUNING.fallDamageSpeed) * TUNING.fallDamageScale));
          this.health.requestDamage(PLAYER_ID, damage, { sourceId: "fall", invulnerabilityTicks: 10 });
          this.renderer?.emitDebris(vec3(player.position.x, player.position.y, player.position.z), 0x8a5a33, 18, tick);
          this.emit("hard-landing", PLAYER_ID, impact);
        } else if (impact > 9) this.emit("landed", PLAYER_ID, impact);
      }
      vy = 0;
    } else player.grounded = false;
    player.velocity = vec3(vx, vy, vz);
    if (player.position.y < -8) { this.health.requestDamage(PLAYER_ID, 100, { sourceId: "void" }); }

    // --- Health regeneration ---
    if (player.health < player.maximumHealth && tick - player.lastDamageTick > TUNING.regenDelayTicks && tick - player.regenTick >= TUNING.regenIntervalTicks) {
      player.regenTick = tick;
      this.health.requestHealing(PLAYER_ID, 1, "regeneration");
    }

    // --- Targeting, mining, placing ---
    this.updateTarget();
    this.stepMining(tick);
    if (this.pressed.has("place")) this.placeBlock(tick);

    // --- Objectives & autosave ---
    if (!state.completedAnnounced && this.objectives().every((objective) => objective.done)) {
      state.completedAnnounced = true;
      this.transition("complete", "objectives-complete");
      this.requestSave("complete");
      this.renderer?.emitDebris(vec3(player.position.x, player.position.y + 1.5, player.position.z), 0xffd166, 60, tick);
      this.emit("objectives-complete", PLAYER_ID, state.playTicks);
    }
    if (state.dirtySinceSave && state.playTicks % AUTOSAVE_TICKS === 0) this.requestSave("autosave");
  }

  private handleHotbar(): void {
    for (let slot = 1; slot <= 9; slot += 1) if (this.pressed.has(`select-${slot}` as Action)) { this.state.selectedSlot = slot - 1; this.emit("slot-selected", HOTBAR_ITEMS[slot - 1] ?? "", slot - 1); }
    if (this.pressed.has("next-slot")) { this.state.selectedSlot = (this.state.selectedSlot + 1) % 9; this.emit("slot-selected", HOTBAR_ITEMS[this.state.selectedSlot] ?? "", this.state.selectedSlot); }
    if (this.pressed.has("previous-slot")) { this.state.selectedSlot = (this.state.selectedSlot + 8) % 9; this.emit("slot-selected", HOTBAR_ITEMS[this.state.selectedSlot] ?? "", this.state.selectedSlot); }
  }

  private overlapsSolid(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    const x0 = Math.floor(minX);
    const y0 = Math.floor(minY);
    const z0 = Math.floor(minZ);
    const x1 = Math.floor(maxX - 1e-6);
    const y1 = Math.floor(maxY - 1e-6);
    const z1 = Math.floor(maxZ - 1e-6);
    for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) for (let z = z0; z <= z1; z += 1) if (this.world.isSolid(x, y, z)) return true;
    return false;
  }

  private moveWithCollision(position: Vec3, dx: number, dy: number, dz: number): { position: Vec3; hitX: boolean; hitY: boolean; hitZ: boolean } {
    const half = TUNING.halfWidth;
    const height = TUNING.height;
    let x = position.x;
    let y = position.y;
    let z = position.z;
    let hitX = false;
    let hitY = false;
    let hitZ = false;
    // Y axis
    let ny = y + dy;
    if (this.overlapsSolid(x - half, ny, z - half, x + half, ny + height, z + half)) {
      hitY = true;
      ny = dy < 0 ? Math.floor(ny) + 1 : Math.floor(ny + height) - height - 1e-4;
      if (this.overlapsSolid(x - half, ny, z - half, x + half, ny + height, z + half)) ny = y;
    }
    y = ny;
    // X axis
    let nx = x + dx;
    if (this.overlapsSolid(nx - half, y, z - half, nx + half, y + height, z + half)) {
      hitX = true;
      nx = dx > 0 ? Math.floor(nx + half) - half - 1e-4 : Math.floor(nx - half) + 1 + half + 1e-4;
      if (this.overlapsSolid(nx - half, y, z - half, nx + half, y + height, z + half)) nx = x;
    }
    x = nx;
    // Z axis
    let nz = z + dz;
    if (this.overlapsSolid(x - half, y, nz - half, x + half, y + height, nz + half)) {
      hitZ = true;
      nz = dz > 0 ? Math.floor(nz + half) - half - 1e-4 : Math.floor(nz - half) + 1 + half + 1e-4;
      if (this.overlapsSolid(x - half, y, nz - half, x + half, y + height, nz + half)) nz = z;
    }
    z = nz;
    return { position: vec3(x, y, z), hitX, hitY, hitZ };
  }

  private eyePosition(): Vec3 {
    const player = this.state.player;
    return vec3(player.position.x, player.position.y + TUNING.eyeHeight, player.position.z);
  }

  private viewDirection(): Vec3 {
    const player = this.state.player;
    const cosPitch = Math.cos(player.pitch);
    return vec3(-Math.sin(player.yaw) * cosPitch, Math.sin(player.pitch), -Math.cos(player.yaw) * cosPitch);
  }

  private updateTarget(): void {
    const hit = this.world.raycast(this.eyePosition(), this.viewDirection(), TUNING.reach);
    if (hit === null) { this.state.target = null; return; }
    const definition = blockById(hit.id);
    const previous = this.state.target;
    this.state.target = Object.freeze({ x: hit.x, y: hit.y, z: hit.z, normal: hit.normal, blockKey: definition.key, blockName: definition.name, distance: hit.distance });
    if (previous === null || previous.x !== hit.x || previous.y !== hit.y || previous.z !== hit.z) { this.state.miningProgress = 0; this.state.miningKey = null; }
  }

  private stepMining(tick: number): void {
    const state = this.state;
    const target = state.target;
    if (!state.held.mine || target === null) { if (state.miningProgress > 0) { state.miningProgress = 0; state.miningKey = null; } return; }
    const definition = blockByKey(target.blockKey);
    if (definition === undefined || !Number.isFinite(definition.hardness)) { state.miningProgress = 0; state.miningKey = definition?.key ?? null; return; }
    if (state.miningKey !== definition.key) { state.miningKey = definition.key; state.miningProgress = 0; }
    state.miningProgress = Math.min(1, state.miningProgress + DT / definition.hardness);
    if (tick % 6 === 0) this.renderer?.emitDebris(vec3(target.x + 0.5 + target.normal.x * 0.5, target.y + 0.5 + target.normal.y * 0.5, target.z + 0.5 + target.normal.z * 0.5), definition.color, 2, tick);
    if (state.miningProgress < 1) return;
    this.world.set(target.x, target.y, target.z, AIR);
    state.stats.mined += 1;
    state.stats.minedByKey[definition.key] = (state.stats.minedByKey[definition.key] ?? 0) + 1;
    state.dirtySinceSave = true;
    if (definition.drop !== null) {
      const outcome = this.inventory.add(PLAYER_ID, definition.drop, 1);
      if (!outcome.ok) this.emit("inventory-full", definition.drop);
    }
    this.renderer?.emitDebris(vec3(target.x + 0.5, target.y + 0.5, target.z + 0.5), definition.color, 28, tick);
    this.emit("block-mined", definition.key, state.stats.mined);
    state.miningProgress = 0;
    state.miningKey = null;
    this.updateTarget();
  }

  private placeBlock(tick: number): void {
    const state = this.state;
    const target = state.target;
    if (target === null) return;
    const key = HOTBAR_ITEMS[state.selectedSlot];
    const definition = key === undefined ? undefined : blockByKey(key);
    if (definition === undefined || (this.inventoryCounts()[definition.key] ?? 0) <= 0) { this.emit("place-rejected", key ?? "empty"); return; }
    const x = target.x + target.normal.x;
    const y = target.y + target.normal.y;
    const z = target.z + target.normal.z;
    if (!VoxelWorld.inBounds(x, y, z)) return;
    const existing = this.world.get(x, y, z);
    if (existing !== AIR && existing !== WATER) return;
    const player = state.player;
    const half = TUNING.halfWidth;
    const intersectsPlayer = x + 1 > player.position.x - half && x < player.position.x + half && y + 1 > player.position.y && y < player.position.y + TUNING.height && z + 1 > player.position.z - half && z < player.position.z + half;
    if (intersectsPlayer) { this.emit("place-blocked", definition.key); return; }
    const removed = this.inventory.remove(PLAYER_ID, definition.key, 1);
    if (!removed.ok) return;
    this.world.set(x, y, z, definition.id);
    state.stats.placed += 1;
    state.dirtySinceSave = true;
    this.renderer?.emitDebris(vec3(x + 0.5, y + 0.5, z + 0.5), definition.color, 8, tick);
    this.emit("block-placed", definition.key, state.stats.placed);
    this.updateTarget();
  }

  private inventoryCounts(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const slot of this.inventory.snapshot()[PLAYER_ID] ?? []) result[slot.itemId] = (result[slot.itemId] ?? 0) + slot.count;
    return result;
  }

  private hotbar(): readonly HotbarSlot[] {
    const counts = this.inventoryCounts();
    return Object.freeze(HOTBAR_ITEMS.map((key) => {
      const definition = blockByKey(key);
      return Object.freeze({ key, name: definition?.name ?? key, count: counts[key] ?? 0, color: definition?.color ?? 0xffffff });
    }));
  }

  private objectives(): readonly ObjectiveSnapshot[] {
    return Object.freeze(OBJECTIVES.map((objective) => {
      const current = objective.key === null ? this.state.stats.placed : this.state.stats.minedByKey[objective.key] ?? 0;
      return Object.freeze({ id: objective.id, label: objective.label, current: Math.min(current, objective.target), target: objective.target, done: current >= objective.target });
    }));
  }

  private hudExtras(): Record<string, string | number | boolean> {
    const state = this.state;
    const timeOfDay = state.timeTicks / DAY_TICKS;
    const target = state.target;
    const hotbar = this.hotbar();
    const objectives = this.objectives();
    const selected = hotbar[state.selectedSlot];
    const extras: Record<string, string | number | boolean> = {
      clock: formatClock(timeOfDay),
      day: Math.floor(state.playTicks / DAY_TICKS) + 1,
      night: timeOfDay < 0.2 || timeOfDay > 0.8,
      coords: `${Math.floor(state.player.position.x)}, ${Math.floor(state.player.position.y)}, ${Math.floor(state.player.position.z)}`,
      targetName: target === null ? "" : target.blockName,
      prompt: target === null ? "" : state.held.mine ? (Number.isFinite(blockByKey(target.blockKey)?.hardness ?? Infinity) ? "MINING" : "UNBREAKABLE") : "HOLD LMB · MINE  ·  RMB · PLACE",
      mining: state.miningProgress,
      selectedSlot: state.selectedSlot,
      selectedName: selected === undefined ? "" : `${selected.name}${selected.count > 0 ? ` × ${selected.count}` : " (none)"}`,
      health: state.player.health,
      underwater: state.player.eyeInWater,
      objectivesDone: objectives.filter((objective) => objective.done).length,
      objectivesTotal: objectives.length,
      mined: state.stats.mined,
      placed: state.stats.placed,
      deaths: state.stats.deaths,
      playTime: `${Math.floor(state.playTicks * DT / 60)}:${String(Math.floor(state.playTicks * DT) % 60).padStart(2, "0")}`,
      hasSave: state.hasSave,
      saved: state.lastSaveTick !== null && state.tick - state.lastSaveTick < 120,
      respawn: Math.ceil(state.respawnTicks * DT),
      seed: this.world.seed,
      edits: this.world.editCount,
    };
    hotbar.forEach((slot, index) => { extras[`slot${index}`] = slot.count; extras[`slot${index}Key`] = slot.key; });
    objectives.forEach((objective, index) => { extras[`objective${index}`] = `${objective.label} (${objective.current}/${objective.target})`; extras[`objective${index}Done`] = objective.done; });
    return extras;
  }

  private publishFrame(): void {
    this.hud.update({ screen: this.state.phase, score: this.state.stats.mined, timerSeconds: this.state.playTicks * DT, health: this.state.player.health, maximumHealth: this.state.player.maximumHealth, extras: this.hudExtras() });
    this.renderer?.prepare(this.snapshot(), Object.freeze([...this.tickEvents]));
  }

  // --- Public API ---------------------------------------------------------------------

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

  start(): void { if (!this.isDisposed) this.actions.press("start"); }
  continueWorld(): void { if (!this.isDisposed) this.actions.press("continue"); }

  setMove(x: number, z: number): void {
    if (this.isDisposed) return;
    const cx = clampUnit(x);
    const cz = clampUnit(z);
    const magnitude = Math.hypot(cx, cz);
    const scale = magnitude > 1 ? (1 - 1e-6) / magnitude : 1;
    this.movement.setMovement(cx * scale, cz * scale);
  }

  setLook(yaw: number, pitch: number): void {
    if (this.isDisposed || !Number.isFinite(yaw) || !Number.isFinite(pitch)) return;
    this.state.player.yaw = yaw;
    this.state.player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
  }

  look(deltaYaw: number, deltaPitch: number): void {
    this.setLook(this.state.player.yaw + deltaYaw, this.state.player.pitch + deltaPitch);
  }

  setHeld(patch: Partial<HeldInput>): void {
    if (this.isDisposed) return;
    this.state.held = Object.freeze({ mine: patch.mine ?? this.state.held.mine, sprint: patch.sprint ?? this.state.held.sprint });
  }

  press(action: Action): void { if (!this.isDisposed && ACTIONS.includes(action)) this.actions.press(action); }

  setTimeOfDay(fraction: number): void {
    if (this.isDisposed || !Number.isFinite(fraction)) return;
    this.state.timeTicks = Math.round(((fraction % 1) + 1) % 1 * DAY_TICKS);
    this.emit("time-set", PLAYER_ID, fraction);
    this.publishFrame();
  }

  loadScenario(id: Scenario): void {
    if (this.isDisposed) return;
    if (this.state.phase === "title") { this.newWorld(); this.transition("playing", "qa-scenario"); }
    if (this.state.phase === "dead") this.respawn();
    if (this.state.phase === "complete") this.transition("playing", "qa-scenario");
    const player = this.state.player;
    player.velocity = vec3(0, 0, 0);
    const lookAt = (block: Vec3, standing: Vec3): void => {
      player.position = standing;
      const eye = vec3(standing.x, standing.y + TUNING.eyeHeight, standing.z);
      const dx = block.x + 0.5 - eye.x;
      const dy = block.y + 0.5 - eye.y;
      const dz = block.z + 0.5 - eye.z;
      player.yaw = Math.atan2(-dx, -dz);
      player.pitch = Math.max(-1.4, Math.min(1.4, Math.atan2(dy, Math.hypot(dx, dz))));
    };
    // Carve a two-block standing pocket on the +x side of a block (columns x+1 and x+2) and look at it.
    const standBeside = (block: Vec3, keep: number | null): void => {
      for (let dx = 1; dx <= 2; dx += 1) for (let dy = 0; dy < 2; dy += 1) {
        const id = this.world.get(block.x + dx, block.y + dy, block.z);
        if (id !== AIR && id !== keep) this.world.set(block.x + dx, block.y + dy, block.z, AIR);
      }
      for (let dx = 1; dx <= 2; dx += 1) if (!this.world.isSolid(block.x + dx, block.y - 1, block.z)) this.world.set(block.x + dx, block.y - 1, block.z, STONE);
      lookAt(block, vec3(block.x + 2.5, block.y, block.z + 0.5));
    };
    const pocketBeside = (blockId: number): void => {
      const block = this.world.findNearest(blockId, this.spawn, 60);
      if (block === null) { player.position = this.spawn; return; }
      standBeside(block, null);
    };
    switch (id) {
      case "spawn": player.position = this.spawn; player.yaw = 0; player.pitch = 0; break;
      case "tree": {
        const log = this.world.findNearest(LOG, this.spawn, 60);
        if (log === null) { player.position = this.spawn; break; }
        let bottom = log.y;
        while (bottom > 0 && this.world.get(log.x, bottom - 1, log.z) === LOG) bottom -= 1;
        standBeside(vec3(log.x, bottom, log.z), LOG);
        break;
      }
      case "stone": pocketBeside(STONE); break;
      case "iron": pocketBeside(IRON_ORE); break;
      case "diamond": pocketBeside(DIAMOND_ORE); break;
      case "cliff": player.position = vec3(this.spawn.x, this.spawn.y + 14, this.spawn.z); player.pitch = -0.6; break;
      case "water": {
        const water = this.world.findNearest(WATER, this.spawn, 60);
        player.position = water === null ? this.spawn : vec3(water.x + 0.5, WORLD.seaLevel + 3, water.z + 0.5);
        player.pitch = -0.5;
        break;
      }
    }
    this.state.miningProgress = 0;
    this.updateTarget();
    this.publishFrame();
    this.emit("scenario-loaded", id);
  }

  snapshot(): DeepfieldSnapshot {
    const state = this.state;
    const player = state.player;
    const objectives = this.objectives();
    return Object.freeze({
      tick: state.tick,
      time: state.tick * DT,
      phase: state.phase,
      seed: this.world.seed,
      spawn: this.spawn,
      player: Object.freeze({ position: player.position, velocity: player.velocity, yaw: player.yaw, pitch: player.pitch, grounded: player.grounded, inWater: player.inWater, eyeInWater: player.eyeInWater, sprinting: player.sprinting, health: player.health, maximumHealth: player.maximumHealth }),
      move: state.move,
      held: state.held,
      target: state.target,
      mining: Object.freeze({ progress: state.miningProgress, blockKey: state.miningKey }),
      selectedSlot: state.selectedSlot,
      hotbar: this.hotbar(),
      objectives,
      allObjectivesDone: objectives.every((objective) => objective.done),
      stats: Object.freeze({ mined: state.stats.mined, placed: state.stats.placed, deaths: state.stats.deaths, minedByKey: Object.freeze({ ...state.stats.minedByKey }) }),
      timeOfDay: state.timeTicks / DAY_TICKS,
      day: Math.floor(state.playTicks / DAY_TICKS) + 1,
      playTimeSeconds: state.playTicks * DT,
      editCount: this.world.editCount,
      hasSave: state.hasSave,
      lastSaveTick: state.lastSaveTick,
      respawnTicks: state.respawnTicks,
    });
  }

  events(): readonly DeepfieldEvent[] { return Object.freeze([...this.collected]); }
  errors(): readonly RuntimeErrorRecord[] { return Object.freeze([...this.errorRecords]); }
  debugSnapshot(): DebugSnapshot | null { return this.lastDebug; }
  inspectRuntime(): DeepfieldRuntimeInspection {
    const life = this.runtime.inspectLifecycle();
    return Object.freeze({ lifecycleState: life.state, installedFeatureIds: Object.freeze([...life.installedFeatureIds]), scheduleSystemIds: Object.freeze(life.scheduleReport.map(({ systemId }) => systemId)), schedulerTick: this.runtime.tick, debugProviders: this.debug.disposed ? Object.freeze([]) : this.debug.inspect().providerIds });
  }
  inspectRenderer(): DeepfieldRendererInspection | null { return this.renderer?.inspect() ?? null; }
  inspectWorld(): DeepfieldWorldInspection { return Object.freeze({ seed: this.world.seed, sizeX: WORLD.sizeX, sizeY: WORLD.sizeY, sizeZ: WORLD.sizeZ, editCount: this.world.editCount, spawn: this.spawn }); }
  inspectSave(): DeepfieldSaveInspection { return Object.freeze({ ready: this.saveReady, lastLoad: this.lastLoad, lastSave: this.lastSave, hasSave: this.state.hasSave, editCount: this.world.editCount }); }
  inspectInventory(): Readonly<Record<string, number>> { return Object.freeze(this.inventory.disposed ? {} : this.inventoryCounts()); }
  inspectLeaks(): DeepfieldLeakInspection {
    return Object.freeze({ activeListeners: this.listeners.size, activeFeatures: this.isDisposed ? 0 : this.runtime.inspectLifecycle().installedFeatureIds.length, disposed: this.isDisposed });
  }
  subscribe(listener: (event: DeepfieldEvent) => void): () => void {
    if (this.isDisposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    void this.runtime.shutdown();
    this.movement.dispose();
    this.actions.dispose();
    this.listeners.clear();
    this.pressed.clear();
  }
}

export function createDeepfieldGame(options: DeepfieldGameOptions): DeepfieldGame {
  return new Game(options);
}
