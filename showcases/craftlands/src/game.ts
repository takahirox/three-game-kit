import { Runtime as ClientRuntime } from "@three-game-kit/client";
import { createDebugDevToolsClientFeature } from "@three-game-kit/client/advanced";
import { createAudioFeature, type AudioRuntime } from "@three-game-kit/client/audio";
import { createGameFlowClientFeature, createHealthClientFeature, createHudFeature, type HudAdapter } from "@three-game-kit/client/gameplay";
import { createSaveLoadClientFeature } from "@three-game-kit/client/genre";
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
import { createSaveLoadRuntime, type SaveAdapter, type SaveValue } from "@three-game-kit/shared/genre";
import type { CraftlandsRenderer, CraftlandsRendererInspection } from "./client/renderer.js";
import { AIR, BED, BEDROCK, CACTUS, CHEST, COBBLESTONE, CRAFTING_TABLE, DIAMOND_ORE, FURNACE, FURNACE_LIT, IRON_ORE, LAVA, LOG, OBSIDIAN, STONE, TORCH, WATER, blockById, blockByKey, canHarvest, miningSeconds, type BlockDefinition, type ToolType } from "./shared/blocks.js";
import { Container, clickSlot, sameItem, stack, transferStack, wearTool, type SlotValue } from "./shared/inventory.js";
import { CREATIVE_ITEMS, itemByKey } from "./shared/items.js";
import { MOB_DEFINITIONS, createMob, createMobRng, damageMob, deserializeMobs, serializeMobs, spawnMobs, stepMobs, type Mob, type MobKind } from "./shared/mobs.js";
import { hash3 } from "./shared/noise.js";
import { bodyInLiquid, boxIntersectsBlock, moveWithCollision, overlapsSolid, vec3 } from "./shared/physics.js";
import { matchRecipe, smeltingFor } from "./shared/recipes.js";
import {
  AUTOSAVE_TICKS, DAY_TICKS, DEFAULT_SEED, DT, NEUTRAL_HELD, NEUTRAL_MOVE, PLAYER_ID, SAVE_SLOT, SAVE_VERSION, START_TIME, TUNING, formatClock, xpForLevel,
  type Action, type CraftlandsEvent, type CraftlandsSnapshot, type FurnaceSnapshot, type GameMode, type HeldInput, type ItemEntitySnapshot, type MobSnapshot, type MoveInput, type Phase, type Scenario, type Screen, type TargetSnapshot,
} from "./shared/state.js";
import { BIOME_NAMES, CHUNK, HEIGHT, SEA_LEVEL } from "./shared/terrain.js";
import { World, isChestState, type ChestState, type FurnaceState, type Vec3 } from "./shared/world.js";

const MAX_STEPS = 1_200;
const ACTIONS: readonly Action[] = Object.freeze([
  "jump", "attack-start", "attack-end", "use-start", "use-end", "sprint-start", "sprint-end", "sneak-start", "sneak-end",
  "select-1", "select-2", "select-3", "select-4", "select-5", "select-6", "select-7", "select-8", "select-9",
  "next-slot", "previous-slot", "drop", "inventory", "escape", "start", "continue", "respawn", "save", "quit", "toggle-perspective", "toggle-debug", "toggle-hud", "chat", "fly-toggle",
]);
const EMPTY = defineFeatureConfiguration<Readonly<Record<string, never>>>({
  defaultValue: () => Object.freeze({}),
  parse(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) && Reflect.ownKeys(value).length === 0
      ? { ok: true as const, value: Object.freeze({}) }
      : { ok: false as const, issues: [{ path: [], code: "empty-object-required" }] };
  },
});
const HOTBAR = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8]);
/** Minecraft-style advancements: id, title, description, and the item that unlocks it when first obtained. */
export const ADVANCEMENTS: readonly Readonly<{ id: string; title: string; description: string; item: string }>[] = Object.freeze([
  { id: "wood", title: "Getting Wood", description: "Punch a tree until a block of wood pops out", item: "oak_log" },
  { id: "planks", title: "Benchmarking", description: "Craft planks and a crafting table", item: "crafting_table" },
  { id: "pickaxe", title: "Time to Mine!", description: "Use planks and sticks to make a pickaxe", item: "wooden_pickaxe" },
  { id: "furnace", title: "Hot Topic", description: "Construct a furnace out of cobblestone", item: "furnace" },
  { id: "iron", title: "Acquire Hardware", description: "Smelt an iron ingot", item: "iron_ingot" },
  { id: "iron-pickaxe", title: "Isn't It Iron Pick", description: "Upgrade your pickaxe", item: "iron_pickaxe" },
  { id: "diamond", title: "Diamonds!", description: "Acquire diamonds", item: "diamond" },
  { id: "torch", title: "Let There Be Light", description: "Craft a torch", item: "torch" },
  { id: "food", title: "Husbandry", description: "Eat something", item: "*ate" },
  { id: "monster", title: "Monster Hunter", description: "Kill a hostile monster", item: "*kill" },
]);
const MAIN = Object.freeze(Array.from({ length: 27 }, (_, index) => 9 + index));

export interface CraftlandsRuntimeInspection { readonly lifecycleState: string; readonly installedFeatureIds: readonly string[]; readonly scheduleSystemIds: readonly string[]; readonly schedulerTick: number; readonly debugProviders: readonly string[]; }
export interface CraftlandsWorldInspection { readonly seed: number; readonly loadedChunks: number; readonly editCount: number; readonly spawn: Vec3; readonly blockEntities: number; readonly simulationDistance: number; }
export interface CraftlandsSaveInspection { readonly ready: boolean; readonly lastLoad: string | null; readonly lastSave: string | null; readonly hasSave: boolean; readonly editCount: number; }
export interface CraftlandsLeakInspection { readonly activeListeners: number; readonly activeFeatures: number; readonly disposed: boolean; }
export type SlotContainer = "inventory" | "craft" | "furnace-input" | "furnace-fuel" | "furnace-output" | "craft-result" | "creative" | "chest";

export interface CraftlandsGame {
  readonly disposed: boolean;
  readonly world: World;
  advance(seconds: number): number;
  present(timestampMs: number): boolean;
  start(): void;
  continueWorld(): void;
  setMove(x: number, z: number): void;
  setLook(yaw: number, pitch: number): void;
  look(deltaYaw: number, deltaPitch: number): void;
  setHeld(patch: Partial<HeldInput>): void;
  press(action: Action): void;
  clickSlot(container: SlotContainer, index: number, button: "left" | "right", shift: boolean): void;
  command(text: string): void;
  give(key: string, count: number): void;
  setMode(mode: GameMode): void;
  setSimulationDistance(chunks: number): void;
  loadScenario(id: Scenario): void;
  setTimeOfDay(fraction: number): void;
  snapshot(): CraftlandsSnapshot;
  events(): readonly CraftlandsEvent[];
  ruleFailures(): readonly Readonly<{ tick: number; message: string }>[];
  errors(): readonly RuntimeErrorRecord[];
  debugSnapshot(): DebugSnapshot | null;
  inspectRuntime(): CraftlandsRuntimeInspection;
  inspectRenderer(): CraftlandsRendererInspection | null;
  inspectWorld(): CraftlandsWorldInspection;
  inspectSave(): CraftlandsSaveInspection;
  inspectInventory(): Readonly<Record<string, number>>;
  inspectLeaks(): CraftlandsLeakInspection;
  subscribe(listener: (event: CraftlandsEvent) => void): () => void;
  dispose(): void;
}

export interface CraftlandsGameOptions {
  readonly renderer?: CraftlandsRenderer;
  readonly hudAdapter: HudAdapter;
  readonly saveAdapter: SaveAdapter;
  readonly seed?: number;
  readonly simulationDistance?: number;
  readonly testMode?: boolean;
  /** Optional public Audio Feature runtime; the host maps rule events to synthesised clips. */
  readonly audio?: AudioRuntime;
}

type Contribution = ClientFeatureDescriptor<Readonly<Record<string, never>>>["runtimeContributions"][number];

function feature(id: string, description: string, contribution: Contribution): ClientFeatureDescriptor<Readonly<Record<string, never>>> {
  return Object.freeze({
    id,
    description,
    runtimeContributions: Object.freeze([contribution]),
    requires: Object.freeze([]),
    conflicts: Object.freeze([]),
    configuration: EMPTY,
    setup({ ledger }: ClientFeatureSetupContext<Readonly<Record<string, never>>>): void { ledger.activateSystem(contribution.id); },
    dispose(): void { /* nothing to release */ },
  });
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

interface ItemEntity { id: number; key: string; count: number; damage: number; position: Vec3; velocity: Vec3; age: number; pickupDelay: number; }
interface Arrow { id: number; position: Vec3; velocity: Vec3; age: number; stuck: boolean; }
interface XpOrb { id: number; position: Vec3; velocity: Vec3; value: number; age: number; }

interface Player {
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  grounded: boolean;
  inWater: boolean;
  eyeInWater: boolean;
  inLava: boolean;
  sprinting: boolean;
  sneaking: boolean;
  flying: boolean;
  health: number;
  hunger: number;
  saturation: number;
  exhaustion: number;
  air: number;
  xp: number;
  level: number;
  hurtTicks: number;
  fallStart: number;
  lastDamageTick: number;
  regenTick: number;
  starveTick: number;
  walkPhase: number;
  lastJumpTick: number;
  lastSpaceTick: number;
}

type SaveShape = Readonly<{
  readonly seed: number;
  readonly edits: readonly (readonly number[])[];
  readonly blockEntities: SaveValue;
  readonly player: Readonly<Record<string, number | boolean>>;
  readonly inventory: readonly (readonly [number, string, number, number])[];
  readonly mobs: SaveValue;
  readonly stats: Readonly<{ mined: number; placed: number; crafted: number; kills: number; deaths: number; eaten?: number; minedByKey: Readonly<Record<string, number>> }>;
  readonly unlocked?: SaveValue;
  readonly timeTicks: number;
  readonly playTicks: number;
  readonly selectedSlot: number;
  readonly mode: GameMode;
  readonly spawn: Readonly<{ x: number; y: number; z: number }>;
}>;

function isSaveShape(data: SaveValue): data is SaveShape {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const record = data as Readonly<Record<string, SaveValue>>;
  return typeof record["seed"] === "number" && Array.isArray(record["edits"]) && typeof record["player"] === "object" && record["player"] !== null
    && Array.isArray(record["inventory"]) && typeof record["stats"] === "object" && record["stats"] !== null && typeof record["timeTicks"] === "number" && typeof record["playTicks"] === "number"
    && typeof record["selectedSlot"] === "number" && (record["mode"] === "survival" || record["mode"] === "creative") && typeof record["spawn"] === "object" && record["spawn"] !== null;
}

class Game implements CraftlandsGame {
  readonly world: World;
  private spawn: Vec3;
  private readonly renderer: CraftlandsRenderer | null;
  private readonly testMode: boolean;
  private simulationDistance: number;
  private readonly movement = createMovementInput();
  private readonly actions = createSemanticActionInput(ACTIONS);
  private readonly pressed = new Set<Action>();
  private readonly listeners = new Set<(event: CraftlandsEvent) => void>();
  private readonly collected: CraftlandsEvent[] = [];
  private tickEvents: CraftlandsEvent[] = [];
  private readonly errorRecords: RuntimeErrorRecord[] = [];
  private readonly telemetry = createTelemetryStore({ runtime: "client", observeRuntimeError: (record) => { if (this.errorRecords.length >= 64) this.errorRecords.shift(); this.errorRecords.push(record); } });
  private readonly frames = createDeterministicPresentationFrameSource();
  private readonly health = createHealthRuntime();
  private readonly flow = createGameFlowRuntime({ initialState: "title", states: [{ id: "title", allowedTo: ["playing"] }, { id: "playing", allowedTo: ["dead", "paused", "title"] }, { id: "paused", allowedTo: ["playing", "title"] }, { id: "dead", allowedTo: ["playing", "title"] }] });
  private readonly hud = createHudStateStore({ screen: "title", health: TUNING.maximumHealth, maximumHealth: TUNING.maximumHealth, extras: {} });
  private readonly debug = createDebugDevToolsRuntime();
  private readonly saveLoad: ReturnType<typeof createSaveLoadRuntime>;
  private readonly runtime: ClientRuntime;
  private readonly mobRng: (tick: number, salt: number) => number;

  // --- Mutable game state ---
  private tick = 0;
  private phase: Phase = "title";
  private screen: Screen = "none";
  private mode: GameMode = "survival";
  private player: Player;
  private move: MoveInput = NEUTRAL_MOVE;
  private held: HeldInput = NEUTRAL_HELD;
  private target: TargetSnapshot | null = null;
  private miningProgress = 0;
  private miningKey: string | null = null;
  private selectedSlot = 0;
  private readonly inventory = new Container(36);
  private cursor: SlotValue = null;
  private readonly craft = new Container(9);
  private craftSize = 2;
  private craftResult: SlotValue = null;
  private furnacePos: Vec3 | null = null;
  private items: ItemEntity[] = [];
  private arrows: Arrow[] = [];
  private orbs: XpOrb[] = [];
  private mobs: Mob[] = [];
  private nextEntityId = 1;
  private eating = 0;
  private attackCooldown = 0;
  private swing = 0;
  private thirdPerson = false;
  private debugOverlay = false;
  private hudHidden = false;
  private timeTicks = Math.round(START_TIME * DAY_TICKS);
  private playTicks = 0;
  private stats = { mined: 0, placed: 0, crafted: 0, kills: 0, deaths: 0, eaten: 0, minedByKey: {} as Record<string, number> };
  private chatLog: string[] = [];
  private explosions: Vec3[] = [];
  private readonly unlocked = new Set<string>();
  private toast: Readonly<{ title: string; description: string; item: string; until: number }> | null = null;
  private hasSave = false;
  private lastSaveTick: number | null = null;
  private dirtySinceSave = false;
  private accumulator = 0;
  private presentationStarted = false;
  private lastTimestamp = -1;
  private isDisposed = false;
  private lastDebug: DebugSnapshot | null = null;
  private saveReady = false;
  private lastLoad: string | null = null;
  private lastSave: string | null = null;
  private saving = false;
  private pendingCommands: string[] = [];
  private stepDistance = 0;
  private readonly fusing = new Set<number>();
  /** Positions whose neighbours need a block update (gravity blocks, plant support) on the next tick. */
  private blockUpdates: number[] = [];

  constructor(options: CraftlandsGameOptions) {
    this.world = new World(options.seed ?? DEFAULT_SEED);
    this.testMode = options.testMode ?? false;
    this.simulationDistance = options.simulationDistance ?? (this.testMode ? 2 : 6);
    this.mobRng = createMobRng(this.world.seed);
    this.spawn = this.world.findSpawn();
    this.player = this.createPlayer(this.spawn);
    this.renderer = options.renderer ?? null;
    this.renderer?.attachWorld(this.world);
    this.renderer?.setRenderDistance(this.simulationDistance);
    this.world.subscribe((x, y, z) => { if (this.blockUpdates.length < 4_096) this.blockUpdates.push(x, y, z); });
    this.health.register(PLAYER_ID, TUNING.maximumHealth);
    this.debug.registerProvider("player", () => ({ x: this.player.position.x, y: this.player.position.y, z: this.player.position.z, health: this.player.health, hunger: this.player.hunger, phase: this.phase, mode: this.mode }));
    this.debug.registerProvider("world", () => ({ seed: this.world.seed, chunks: this.world.loadedChunkCount, edits: this.world.editCount, mobs: this.mobs.length, items: this.items.length }));
    this.saveLoad = createSaveLoadRuntime({ currentVersion: SAVE_VERSION, adapter: options.saveAdapter, capture: () => this.captureSave(), validate: (data) => isSaveShape(data), restore: (data) => this.restoreSave(data) });
    void this.saveLoad.load(SAVE_SLOT).then((outcome) => {
      this.lastLoad = outcome.ok ? "loaded" : outcome.code;
      this.saveReady = true;
      this.hasSave = outcome.ok;
      if (outcome.ok) this.emit("world-loaded", SAVE_SLOT, this.world.editCount);
      this.publishFrame();
    });
    const features: ClientFeatureDescriptor<unknown>[] = [
      createInputFeature({ input: this.movement, publish: (command) => { this.move = Object.freeze({ x: command.x, z: command.z }); }, actions: this.actions, publishAction: (action) => this.handleAction(action as Action) }),
      feature("craftlands.rules", "Advances the deterministic survival sandbox rules", { kind: "system", id: "craftlands.rules.step", domain: "client-simulation", phase: "shared-predict", priority: 50, run: ({ tick }: { readonly tick: number }) => this.stepRules(tick) }),
      createHealthClientFeature({ runtime: this.health, publish: (events) => this.applyHealthEvents(events) }),
      createGameFlowClientFeature(this.flow),
      createSaveLoadClientFeature(this.saveLoad),
      createHudFeature({ store: this.hud, adapter: options.hudAdapter }),
      createDebugDevToolsClientFeature(this.debug, (value) => { this.lastDebug = value; }),
    ];
    if (options.audio !== undefined) features.push(createAudioFeature(options.audio));
    if (this.renderer !== null) {
      const renderer = this.renderer;
      features.push(
        feature("craftlands.camera", "Publishes the first-person eye transform each presentation frame", { kind: "system", id: "craftlands.camera.view", domain: "client-presentation", phase: "camera-view", priority: 0, run: () => renderer.setCamera(this.eyePosition(), this.player.yaw, this.player.pitch) }),
        createParticleFeature({ emitters: [renderer.debris, renderer.flames] }),
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
    this.loadChunksAround(this.spawn, this.simulationDistance, Number.POSITIVE_INFINITY);
    this.publishFrame();
  }

  get disposed(): boolean { return this.isDisposed; }

  private createPlayer(spawn: Vec3): Player {
    return { position: spawn, velocity: vec3(0, 0, 0), yaw: 0, pitch: 0, grounded: false, inWater: false, eyeInWater: false, inLava: false, sprinting: false, sneaking: false, flying: false, health: TUNING.maximumHealth, hunger: TUNING.maximumHunger, saturation: 5, exhaustion: 0, air: TUNING.maximumAir, xp: 0, level: 0, hurtTicks: 0, fallStart: spawn.y, lastDamageTick: -10_000, regenTick: 0, starveTick: 0, walkPhase: 0, lastJumpTick: -100, lastSpaceTick: -100 };
  }

  // --- Events ---------------------------------------------------------------------

  private emit(kind: string, subject?: string, value?: number): void {
    const event: CraftlandsEvent = Object.freeze({ kind, tick: this.tick, ...(subject === undefined ? {} : { subject }), ...(value === undefined ? {} : { value }) });
    if (subject !== undefined && (kind === "crafted" || kind === "item-collected" || kind === "gave" || kind === "smelted")) this.pendingObtained.add(subject);
    if (this.collected.length >= 768) this.collected.shift();
    this.collected.push(event);
    this.tickEvents.push(event);
    for (const listener of this.listeners) listener(event);
  }

  private chat(line: string): void {
    this.chatLog.push(line);
    if (this.chatLog.length > 8) this.chatLog.shift();
    this.emit("chat", line);
  }

  private transition(phase: Phase, reason: string): boolean {
    const outcome = this.flow.transition(phase, { tick: this.tick, reason });
    if (!outcome.ok) return false;
    this.phase = phase;
    this.emit("phase-changed", phase);
    return true;
  }

  private handleAction(action: Action): void {
    switch (action) {
      case "attack-start": this.held = Object.freeze({ ...this.held, attack: true }); return;
      case "attack-end": this.held = Object.freeze({ ...this.held, attack: false }); return;
      case "use-start": this.held = Object.freeze({ ...this.held, use: true }); return;
      case "use-end": this.held = Object.freeze({ ...this.held, use: false }); return;
      case "sprint-start": this.held = Object.freeze({ ...this.held, sprint: true }); return;
      case "sprint-end": this.held = Object.freeze({ ...this.held, sprint: false }); return;
      case "sneak-start": this.held = Object.freeze({ ...this.held, sneak: true }); return;
      case "sneak-end": this.held = Object.freeze({ ...this.held, sneak: false }); return;
      default: this.pressed.add(action);
    }
  }

  // --- Save / load ------------------------------------------------------------------

  private captureSave(): SaveValue {
    const player = this.player;
    return {
      seed: this.world.seed,
      edits: this.world.serializeEdits(),
      blockEntities: this.world.serializeBlockEntities().map(([key, state]) => [key, state as unknown as SaveValue]) as unknown as SaveValue,
      player: { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.yaw, pitch: player.pitch, health: player.health, hunger: player.hunger, saturation: player.saturation, air: player.air, xp: player.xp, level: player.level, flying: player.flying },
      inventory: this.inventory.serialize().map((entry) => [...entry]),
      mobs: serializeMobs(this.mobs) as SaveValue,
      stats: { mined: this.stats.mined, placed: this.stats.placed, crafted: this.stats.crafted, kills: this.stats.kills, deaths: this.stats.deaths, eaten: this.stats.eaten, minedByKey: { ...this.stats.minedByKey } },
      unlocked: [...this.unlocked],
      timeTicks: this.timeTicks,
      playTicks: this.playTicks,
      selectedSlot: this.selectedSlot,
      mode: this.mode,
      spawn: { x: this.spawn.x, y: this.spawn.y, z: this.spawn.z },
    } as SaveValue;
  }

  private restoreSave(data: SaveValue): void {
    if (!isSaveShape(data)) throw new TypeError("Craftlands save data is invalid");
    if (data.seed !== this.world.seed) throw new TypeError("Craftlands save belongs to a different world seed");
    this.world.reset();
    this.world.applyEdits(data.edits);
    if (Array.isArray(data.blockEntities)) for (const entry of data.blockEntities as readonly SaveValue[]) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || typeof entry[1] !== "object" || entry[1] === null) continue;
      const raw = entry[1] as Record<string, unknown>;
      if (raw["kind"] === "chest") {
        const slots = Array.isArray(raw["slots"]) ? (raw["slots"] as unknown[]).slice(0, 27).map((value) => (typeof value === "object" && value !== null && typeof (value as { key?: unknown }).key === "string" && typeof (value as { count?: unknown }).count === "number" && itemByKey((value as { key: string }).key) !== undefined ? { key: (value as { key: string }).key, count: (value as { count: number }).count, damage: typeof (value as { damage?: unknown }).damage === "number" ? (value as { damage: number }).damage : 0 } : null)) : [];
        while (slots.length < 27) slots.push(null);
        this.world.blockEntities.set(entry[0], { kind: "chest", slots });
        continue;
      }
      const slot = (value: unknown): FurnaceState["input"] => (typeof value === "object" && value !== null && typeof (value as { key?: unknown }).key === "string" && typeof (value as { count?: unknown }).count === "number") ? { key: (value as { key: string }).key, count: (value as { count: number }).count, damage: typeof (value as { damage?: unknown }).damage === "number" ? (value as { damage: number }).damage : 0 } : null;
      this.world.blockEntities.set(entry[0], { input: slot(raw["input"]), fuel: slot(raw["fuel"]), output: slot(raw["output"]), burn: typeof raw["burn"] === "number" ? raw["burn"] : 0, burnTotal: typeof raw["burnTotal"] === "number" ? raw["burnTotal"] : 0, progress: typeof raw["progress"] === "number" ? raw["progress"] : 0 });
    }
    this.spawn = vec3(Number(data.spawn.x), Number(data.spawn.y), Number(data.spawn.z));
    const p = data.player;
    const player = this.createPlayer(vec3(Number(p["x"]), Number(p["y"]), Number(p["z"])));
    player.yaw = Number(p["yaw"] ?? 0);
    player.pitch = Number(p["pitch"] ?? 0);
    player.health = Math.max(1, Math.min(TUNING.maximumHealth, Number(p["health"] ?? TUNING.maximumHealth)));
    player.hunger = Math.max(0, Math.min(TUNING.maximumHunger, Number(p["hunger"] ?? TUNING.maximumHunger)));
    player.saturation = Math.max(0, Number(p["saturation"] ?? 0));
    player.air = Math.max(0, Math.min(TUNING.maximumAir, Number(p["air"] ?? TUNING.maximumAir)));
    player.xp = Math.max(0, Number(p["xp"] ?? 0));
    player.level = Math.max(0, Math.floor(Number(p["level"] ?? 0)));
    player.flying = p["flying"] === true;
    this.player = player;
    this.health.reset(PLAYER_ID);
    if (player.health < TUNING.maximumHealth) this.health.requestDamage(PLAYER_ID, TUNING.maximumHealth - player.health, { sourceId: "restore" });
    this.inventory.restore(data.inventory);
    this.mobs = deserializeMobs(data.mobs);
    this.nextEntityId = this.mobs.reduce((max, mob) => Math.max(max, mob.id + 1), 1);
    this.items = [];
    this.stats = { mined: data.stats.mined, placed: data.stats.placed, crafted: data.stats.crafted ?? 0, kills: data.stats.kills ?? 0, deaths: data.stats.deaths, eaten: data.stats.eaten ?? 0, minedByKey: { ...data.stats.minedByKey } };
    this.unlocked.clear();
    if (Array.isArray(data.unlocked)) for (const id of data.unlocked) if (typeof id === "string") this.unlocked.add(id);
    this.timeTicks = data.timeTicks;
    this.playTicks = data.playTicks;
    this.selectedSlot = Math.max(0, Math.min(8, Math.floor(data.selectedSlot)));
    this.mode = data.mode;
    this.dirtySinceSave = false;
    this.loadChunksAround(player.position, Math.min(this.testMode ? this.simulationDistance : 3, this.simulationDistance), Number.POSITIVE_INFINITY);
  }

  private requestSave(reason: string): void {
    if (this.saving || this.isDisposed) return;
    this.saving = true;
    void this.saveLoad.save(SAVE_SLOT).then((outcome) => {
      this.saving = false;
      this.lastSave = outcome.ok ? "saved" : outcome.code;
      if (outcome.ok) { this.hasSave = true; this.lastSaveTick = this.tick; this.dirtySinceSave = false; }
      this.emit(outcome.ok ? "world-saved" : "world-save-failed", reason, this.world.editCount);
    });
  }

  // --- Lifecycle -------------------------------------------------------------------

  private newWorld(): void {
    this.world.reset();
    this.spawn = this.world.findSpawn();
    this.player = this.createPlayer(this.spawn);
    this.health.reset(PLAYER_ID);
    this.inventory.clear();
    this.craft.clear();
    this.cursor = null;
    this.items = [];
    this.arrows = [];
    this.orbs = [];
    this.mobs = [];
    this.nextEntityId = 1;
    this.stats = { mined: 0, placed: 0, crafted: 0, kills: 0, deaths: 0, eaten: 0, minedByKey: {} };
    this.unlocked.clear();
    this.toast = null;
    this.timeTicks = Math.round(START_TIME * DAY_TICKS);
    this.playTicks = 0;
    this.selectedSlot = 0;
    this.mode = "survival";
    this.dirtySinceSave = true;
    this.miningProgress = 0;
    this.miningKey = null;
    this.held = NEUTRAL_HELD;
    this.screen = "none";
    this.chatLog = [];
    // Load the immediate surroundings synchronously; the streaming step fills the rest over the next seconds.
    this.loadChunksAround(this.spawn, Math.min(this.testMode ? this.simulationDistance : 3, this.simulationDistance), Number.POSITIVE_INFINITY);
    this.seedPassiveMobs();
  }

  private seedPassiveMobs(): void {
    const kinds: MobKind[] = ["pig", "cow", "sheep", "chicken"];
    let placed = 0;
    for (let attempt = 0; attempt < 40 && placed < 6; attempt += 1) {
      const angle = hash3(attempt, 1, 0, this.world.seed) * Math.PI * 2;
      const radius = 6 + hash3(attempt, 2, 0, this.world.seed) * 14;
      const x = Math.floor(this.spawn.x + Math.cos(angle) * radius);
      const z = Math.floor(this.spawn.z + Math.sin(angle) * radius);
      if (!this.world.isLoaded(x, z)) continue;
      const top = this.world.topSolid(x, z);
      if (top <= SEA_LEVEL || this.world.get(x, top, z) !== blockByKey("grass_block")!.id) continue;
      const kind = kinds[Math.floor(hash3(attempt, 3, 0, this.world.seed) * kinds.length)]!;
      this.mobs.push(createMob(this.nextEntityId++, kind, vec3(x + 0.5, top + 1, z + 0.5)));
      placed += 1;
    }
  }

  private beginPlay(reason: string): void {
    if (this.phase !== "title") return;
    this.transition("playing", reason);
    this.emit("play-started", reason);
  }

  private die(cause: string): void {
    this.stats.deaths += 1;
    this.held = NEUTRAL_HELD;
    this.miningProgress = 0;
    this.screen = "none";
    // Survival death scatters the inventory as item entities, like Minecraft without keepInventory.
    if (this.mode === "survival") {
      this.inventory.slots.forEach((slot, index) => { if (slot !== null) { this.spawnItem(slot.key, slot.count, slot.damage, vec3(this.player.position.x, this.player.position.y + 0.8, this.player.position.z), hash3(index, this.tick, 1, 3) * Math.PI * 2, 2.5); } });
      this.inventory.clear();
      this.player.xp = 0;
      this.player.level = 0;
    }
    this.renderer?.emitDebris(this.player.position, 0xff5b68, 40, this.tick);
    this.transition("dead", cause);
    this.emit("player-died", cause, this.stats.deaths);
  }

  private respawn(): void {
    this.loadChunksAround(this.spawn, this.simulationDistance, Number.POSITIVE_INFINITY);
    const top = this.world.topSolid(Math.floor(this.spawn.x), Math.floor(this.spawn.z));
    const spawn = vec3(this.spawn.x, Math.max(this.spawn.y, top + 1), this.spawn.z);
    const previous = this.player;
    this.player = this.createPlayer(spawn);
    this.player.xp = this.mode === "creative" ? previous.xp : 0;
    this.player.level = this.mode === "creative" ? previous.level : 0;
    this.player.flying = this.mode === "creative" && previous.flying;
    this.health.reset(PLAYER_ID);
    this.transition("playing", "respawn");
    this.emit("respawned", PLAYER_ID);
  }

  private applyHealthEvents(events: readonly { readonly kind: string; readonly entityId: string; readonly after: number; readonly appliedAmount: number }[]): void {
    for (const event of events) {
      if (event.entityId !== PLAYER_ID) continue;
      this.player.health = event.after;
      if (event.kind === "damaged") { this.player.lastDamageTick = this.tick; this.player.hurtTicks = 10; this.emit("player-damaged", PLAYER_ID, event.appliedAmount); }
      if (event.kind === "healed") this.emit("player-healed", PLAYER_ID, event.appliedAmount);
      if (event.kind === "died" && this.phase === "playing") this.die("damage");
    }
  }

  private hurt(amount: number, source: string, invulnerabilityTicks = 30): void {
    if (this.mode === "creative" || amount <= 0) return;
    this.health.requestDamage(PLAYER_ID, amount, { sourceId: source, invulnerabilityTicks });
  }

  // --- Chunk streaming ---------------------------------------------------------------

  private loadChunksAround(position: Vec3, radius: number, budget: number): number {
    const cx = Math.floor(position.x / CHUNK);
    const cz = Math.floor(position.z / CHUNK);
    let loaded = 0;
    for (let ring = 0; ring <= radius && loaded < budget; ring += 1) {
      for (let dx = -ring; dx <= ring && loaded < budget; dx += 1) for (let dz = -ring; dz <= ring && loaded < budget; dz += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        if (this.world.hasChunk(cx + dx, cz + dz)) continue;
        this.world.ensureChunk(cx + dx, cz + dz);
        loaded += 1;
      }
    }
    return loaded;
  }

  // --- Simulation ------------------------------------------------------------------

  private stepRules(tick: number): void {
    try { this.stepRulesInner(tick); }
    catch (cause) { const message = cause instanceof Error ? `${cause.message}\n${cause.stack ?? ""}` : String(cause); if (this.ruleFailureList.length >= 16) this.ruleFailureList.shift(); this.ruleFailureList.push(Object.freeze({ tick, message })); throw cause; }
  }

  private readonly ruleFailureList: Array<Readonly<{ tick: number; message: string }>> = [];

  private stepRulesInner(tick: number): void {
    this.tick = tick;
    this.tickEvents = [];
    this.explosions = [];
    for (const text of this.pendingCommands.splice(0)) this.runCommand(text);
    if (this.phase === "title") {
      if (this.pressed.has("start")) { this.newWorld(); this.beginPlay("new-world"); }
      else if (this.pressed.has("continue") && this.hasSave) this.beginPlay("continue");
    } else if (this.phase === "dead") {
      if (this.pressed.has("respawn")) this.respawn();
      else if (this.pressed.has("quit")) this.quitToTitle();
    } else if (this.phase === "paused") {
      if (this.pressed.has("escape") || this.pressed.has("continue")) this.transition("playing", "resume");
      else if (this.pressed.has("quit")) { this.requestSave("quit"); this.quitToTitle(); }
    }
    if (this.phase === "playing") this.stepPlay(tick);
    if (this.pressed.has("save") && this.phase !== "title") this.requestSave("manual");
    this.pressed.clear();
    this.publishFrame();
  }

  private quitToTitle(): void {
    this.screen = "none";
    this.held = NEUTRAL_HELD;
    this.transition("title", "quit");
  }

  private stepPlay(tick: number): void {
    const player = this.player;
    this.playTicks += 1;
    this.timeTicks = (this.timeTicks + 1) % DAY_TICKS;
    if (this.pressed.has("escape")) {
      if (this.screen !== "none") { this.closeScreen(); }
      else { this.held = NEUTRAL_HELD; this.transition("paused", "menu"); return; }
    }
    if (this.pressed.has("inventory")) { if (this.screen === "none") this.openScreen("inventory"); else this.closeScreen(); }
    if (this.pressed.has("chat") && this.screen === "none") this.openScreen("chat");
    if (this.pressed.has("toggle-perspective")) { this.thirdPerson = !this.thirdPerson; this.emit("perspective", this.thirdPerson ? "third" : "first"); }
    if (this.pressed.has("toggle-debug")) this.debugOverlay = !this.debugOverlay;
    if (this.pressed.has("toggle-hud")) this.hudHidden = !this.hudHidden;
    if (this.pressed.has("fly-toggle") && this.mode === "creative") { player.flying = !player.flying; player.velocity = vec3(player.velocity.x, 0, player.velocity.z); }
    this.handleHotbar();
    if (this.pressed.has("drop")) this.dropHeld();
    const uiOpen = this.screen !== "none";
    if (uiOpen) { this.held = Object.freeze({ ...this.held, attack: false, use: false }); }

    // Streaming: a few chunks per tick near the player, unload far ones.
    this.loadChunksAround(player.position, this.simulationDistance, this.testMode ? 64 : 3);
    if (tick % 120 === 0) this.world.unloadBeyond(Math.floor(player.position.x / CHUNK), Math.floor(player.position.z / CHUNK), this.simulationDistance + 2);

    this.stepMovement(tick);
    this.stepSurvival(tick);
    this.updateTarget();
    if (!uiOpen) {
      this.stepMining(tick);
      if (this.pressed.has("use-start")) { /* handled through held */ }
      this.stepUse(tick);
    } else { this.miningProgress = 0; this.eating = 0; }
    this.stepItems(tick);
    this.stepMobs(tick);
    this.stepArrows(tick);
    this.stepOrbs();
    this.stepFurnaces();
    this.stepBlocks(tick);
    this.stepAdvancements(tick);
    if (this.attackCooldown > 0) this.attackCooldown -= 1;
    if (this.swing > 0) this.swing -= 0.1;
    if (player.hurtTicks > 0) player.hurtTicks -= 1;
    if (this.dirtySinceSave && this.playTicks % AUTOSAVE_TICKS === 0) this.requestSave("autosave");
  }

  private openScreen(screen: Screen, furnace: Vec3 | null = null): void {
    this.screen = screen;
    this.craftSize = screen === "crafting" ? 3 : 2;
    this.furnacePos = furnace;
    this.held = NEUTRAL_HELD;
    this.miningProgress = 0;
    this.eating = 0;
    this.updateCraftResult();
    this.emit("screen-opened", screen);
  }

  private closeScreen(): void {
    // Anything left on the crafting grid or the cursor returns to the inventory (or drops).
    for (let index = 0; index < 9; index += 1) { const slot = this.craft.get(index); if (slot !== null) { const leftover = this.inventory.add(slot.key, slot.count, HOTBAR, slot.damage); if (leftover > 0) this.spawnItem(slot.key, leftover, slot.damage, this.eyePosition(), this.player.yaw, 3); this.craft.set(index, null); } }
    if (this.cursor !== null) { const leftover = this.inventory.add(this.cursor.key, this.cursor.count, HOTBAR, this.cursor.damage); if (leftover > 0) this.spawnItem(this.cursor.key, leftover, this.cursor.damage, this.eyePosition(), this.player.yaw, 3); this.cursor = null; }
    this.craftResult = null;
    this.emit("screen-closed", this.screen);
    this.screen = "none";
    this.furnacePos = null;
  }

  private handleHotbar(): void {
    for (let slot = 1; slot <= 9; slot += 1) if (this.pressed.has(`select-${slot}` as Action)) { this.selectedSlot = slot - 1; this.emit("slot-selected", this.inventory.get(slot - 1)?.key ?? "", slot - 1); }
    if (this.pressed.has("next-slot")) { this.selectedSlot = (this.selectedSlot + 1) % 9; this.emit("slot-selected", this.inventory.get(this.selectedSlot)?.key ?? "", this.selectedSlot); }
    if (this.pressed.has("previous-slot")) { this.selectedSlot = (this.selectedSlot + 8) % 9; this.emit("slot-selected", this.inventory.get(this.selectedSlot)?.key ?? "", this.selectedSlot); }
  }

  private heldStack(): SlotValue { return this.inventory.get(this.selectedSlot); }

  private heldTool(): { type: ToolType; tier: number } {
    const tool = itemByKey(this.heldStack()?.key ?? "")?.tool;
    return tool === null || tool === undefined ? { type: "none", tier: 0 } : { type: tool.type, tier: tool.tier };
  }

  private dropHeld(): void {
    const slot = this.heldStack();
    if (slot === null) return;
    this.inventory.take(this.selectedSlot, 1);
    this.spawnItem(slot.key, 1, slot.damage, this.eyePosition(), this.player.yaw, 5, TUNING.dropPickupDelayTicks);
    this.emit("item-dropped", slot.key, 1);
  }

  // --- Movement ---------------------------------------------------------------------

  private stepMovement(tick: number): void {
    const player = this.player;
    const uiOpen = this.screen !== "none";
    const move = uiOpen ? NEUTRAL_MOVE : this.move;
    const inWater = bodyInLiquid(this.world, player.position, TUNING.height);
    const feet = this.world.definition(Math.floor(player.position.x), Math.floor(player.position.y + 0.3), Math.floor(player.position.z));
    player.inWater = inWater;
    player.inLava = feet.key === "lava";
    player.eyeInWater = this.world.isLiquid(Math.floor(player.position.x), Math.floor(player.position.y + this.eyeHeight()), Math.floor(player.position.z));
    const sneaking = this.held.sneak && !player.flying && !uiOpen;
    player.sneaking = sneaking;
    if (this.mode !== "creative") player.flying = false;
    const wantsSprint = (this.held.sprint || player.sprinting) && move.z < -0.1 && !sneaking && !uiOpen && (this.mode === "creative" || player.hunger > 6);
    player.sprinting = wantsSprint && !inWater;
    const speed = player.flying ? TUNING.flySpeed * (player.sprinting ? 2 : 1) : inWater ? TUNING.waterSpeed : sneaking ? TUNING.sneakSpeed : player.sprinting ? TUNING.sprintSpeed : TUNING.walkSpeed;
    const forwardX = -Math.sin(player.yaw);
    const forwardZ = -Math.cos(player.yaw);
    const rightX = Math.cos(player.yaw);
    const rightZ = -Math.sin(player.yaw);
    const wishX = (forwardX * -move.z + rightX * move.x) * speed;
    const wishZ = (forwardZ * -move.z + rightZ * move.x) * speed;
    let vx = player.velocity.x;
    let vy = player.velocity.y;
    let vz = player.velocity.z;
    const control = player.grounded || inWater || player.flying ? 1 : TUNING.airControl;
    vx += (wishX - vx) * Math.min(1, control * 0.5);
    vz += (wishZ - vz) * Math.min(1, control * 0.5);
    const jump = this.pressed.has("jump") && !uiOpen;
    if (jump && this.mode === "creative" && tick - player.lastSpaceTick < 18 && tick - player.lastSpaceTick > 2) { player.flying = !player.flying; vy = 0; }
    if (jump) player.lastSpaceTick = tick;
    if (player.flying) {
      const up = (this.held.attack && false ? 0 : 0) + (jump || (this.held.sprint && false) ? 0 : 0);
      void up;
      const rise = (this.pressed.has("jump") || this.flyUp) ? 1 : 0;
      const sink = this.held.sneak ? 1 : 0;
      vy = (rise - sink) * TUNING.flySpeed * 0.8;
    } else {
      if (jump) {
        if (inWater || player.inLava) vy = TUNING.swimSpeed;
        else if (player.grounded) { vy = TUNING.jumpSpeed; player.grounded = false; player.lastJumpTick = tick; this.addExhaustion(player.sprinting ? 0.2 : 0.05); this.emit("jumped", PLAYER_ID); }
      }
      if (player.inLava) { vy -= 12 * DT; if (vy < -1.5) vy = -1.5; vx *= 0.5; vz *= 0.5; }
      else vy -= (inWater ? TUNING.waterGravity : TUNING.gravity) * DT;
      const terminal = inWater ? TUNING.waterTerminalSpeed : TUNING.terminalSpeed;
      if (vy < -terminal) vy = -terminal;
      if (inWater && vy > TUNING.swimSpeed) vy = TUNING.swimSpeed;
    }
    const height = sneaking ? TUNING.sneakHeight : TUNING.height;
    const resolved = moveWithCollision(this.world, player.position, TUNING.halfWidth, height, vx * DT, vy * DT, vz * DT, sneaking && player.grounded);
    const moved = Math.hypot(resolved.position.x - player.position.x, resolved.position.z - player.position.z);
    player.walkPhase += moved * 4;
    if (player.grounded && !inWater && !player.flying) {
      this.stepDistance += moved;
      if (this.stepDistance >= (sneaking ? 2.4 : 1.7)) { this.stepDistance = 0; const sound = this.groundSound(); if (sound !== "none") this.emit("step", sound); }
    }
    if (inWater && !this.wasInWater && player.velocity.y < -2.5) this.emit("splash", PLAYER_ID, -player.velocity.y);
    this.wasInWater = inWater;
    if (player.sprinting && moved > 0) this.addExhaustion(0.1 * moved);
    player.position = resolved.position;
    if (resolved.hitX) vx = 0;
    if (resolved.hitZ) vz = 0;
    if (resolved.hitY) {
      if (vy < 0) {
        if (!player.grounded) {
          const fall = player.fallStart - player.position.y;
          if (!inWater && !player.flying && fall > 3) { const damage = Math.max(0, Math.round(fall - 3)); if (damage > 0) { this.hurt(damage, "fall", 10); this.renderer?.emitDebris(player.position, 0x8a5a33, 14, tick); this.emit("hard-landing", PLAYER_ID, fall); } }
          else if (fall > 1) { const sound = this.groundSound(); this.emit("landed", sound === "none" ? "stone" : sound, fall); }
        }
        player.grounded = true;
        player.fallStart = player.position.y;
      }
      vy = 0;
    } else {
      // Standing still on a flat floor never hits Y (dy is tiny), so probe just under the feet before declaring free fall.
      const onFloor = vy <= 0 && !player.flying && overlapsSolid(this.world, player.position.x - TUNING.halfWidth, player.position.y - 0.06, player.position.z - TUNING.halfWidth, player.position.x + TUNING.halfWidth, player.position.y, player.position.z + TUNING.halfWidth);
      player.grounded = onFloor;
      if (onFloor) vy = 0;
      if (vy > 0 || inWater || player.flying) player.fallStart = player.position.y;
    }
    if (player.grounded) player.fallStart = player.position.y;
    player.velocity = vec3(vx, vy, vz);
    if (player.position.y < -12) this.hurt(100, "void", 0);
    // Cactus contact.
    const hx = Math.floor(player.position.x);
    const hz = Math.floor(player.position.z);
    for (let y = Math.floor(player.position.y); y <= Math.floor(player.position.y + 1.5); y += 1) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (this.world.get(hx + dx, y, hz + dz) === CACTUS && boxIntersectsBlock(player.position, TUNING.halfWidth + 0.02, height, hx + dx, y, hz + dz)) { this.hurt(1, "cactus", 20); break; }
    }
    if (player.inLava) { this.hurt(4, "lava", 30); }
  }

  private flyUp = false;
  private wasInWater = false;

  /** Sound family of the block under any corner of the player's footprint (edges count as the block still under a foot). */
  private groundSound(): BlockDefinition["sound"] {
    const p = this.player.position;
    const y = Math.floor(p.y - 0.05);
    for (const [dx, dz] of [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const definition = this.world.definition(Math.floor(p.x + dx * (TUNING.halfWidth - 0.02)), y, Math.floor(p.z + dz * (TUNING.halfWidth - 0.02)));
      if (definition.solid && definition.sound !== "none") return definition.sound;
    }
    return "none";
  }

  private addExhaustion(amount: number): void {
    if (this.mode === "creative") return;
    const player = this.player;
    player.exhaustion += amount;
    while (player.exhaustion >= 4) {
      player.exhaustion -= 4;
      if (player.saturation > 0) player.saturation = Math.max(0, player.saturation - 1);
      else if (player.hunger > 0) { player.hunger -= 1; this.emit("hunger", PLAYER_ID, player.hunger); }
    }
  }

  private stepSurvival(tick: number): void {
    const player = this.player;
    if (this.mode === "creative") { player.air = TUNING.maximumAir; return; }
    if (player.eyeInWater) {
      player.air -= 1;
      if (player.air <= 0) { player.air = 0; if (tick % 20 === 0) this.hurt(2, "drowning", 0); }
    } else player.air = Math.min(TUNING.maximumAir, player.air + 4);
    if (player.hunger >= 18 && player.health < TUNING.maximumHealth && tick - player.lastDamageTick > 60 && tick - player.regenTick >= (player.hunger >= 20 && player.saturation > 0 ? 30 : TUNING.regenIntervalTicks)) {
      player.regenTick = tick;
      this.health.requestHealing(PLAYER_ID, 1, "regeneration");
      this.addExhaustion(6);
    }
    if (player.hunger <= 0 && tick - player.starveTick >= TUNING.starveIntervalTicks) { player.starveTick = tick; if (player.health > 1) this.hurt(1, "starvation", 0); }
    if (this.eating > 0) {
      this.eating -= 1;
      if (!this.held.use) this.eating = 0;
      else if (this.eating === 0) this.finishEating();
    }
  }

  private finishEating(): void {
    const slot = this.heldStack();
    const item = itemByKey(slot?.key ?? "");
    if (slot === null || item === undefined || item.food === null) return;
    this.inventory.take(this.selectedSlot, 1);
    this.player.hunger = Math.min(TUNING.maximumHunger, this.player.hunger + item.food.hunger);
    this.player.saturation = Math.min(this.player.hunger, this.player.saturation + item.food.saturation);
    this.stats.eaten += 1;
    this.emit("ate", item.key, item.food.hunger);
    this.renderer?.emitDebris(vec3(this.player.position.x, this.player.position.y + 1.3, this.player.position.z), item.color, 10, this.tick);
  }

  // --- Targeting, mining, using ---------------------------------------------------------

  private eyeHeight(): number { return this.player.sneaking ? TUNING.sneakEyeHeight : TUNING.eyeHeight; }
  private eyePosition(): Vec3 { const p = this.player; return vec3(p.position.x, p.position.y + this.eyeHeight(), p.position.z); }
  private viewDirection(): Vec3 { const p = this.player; const c = Math.cos(p.pitch); return vec3(-Math.sin(p.yaw) * c, Math.sin(p.pitch), -Math.cos(p.yaw) * c); }

  private updateTarget(): void {
    const reach = this.mode === "creative" ? TUNING.creativeReach : TUNING.reach;
    const hit = this.world.raycast(this.eyePosition(), this.viewDirection(), reach);
    if (hit === null) { if (this.target !== null) { this.miningProgress = 0; this.miningKey = null; } this.target = null; return; }
    const definition = blockById(hit.id);
    const previous = this.target;
    this.target = Object.freeze({ x: hit.x, y: hit.y, z: hit.z, normal: hit.normal, blockKey: definition.key, blockName: definition.name, distance: hit.distance });
    if (previous === null || previous.x !== hit.x || previous.y !== hit.y || previous.z !== hit.z) { this.miningProgress = 0; this.miningKey = null; }
  }

  /** Nearest mob whose bounding box intersects the view ray within reach. */
  private mobUnderCrosshair(reach: number): Mob | null {
    const eye = this.eyePosition();
    const dir = this.viewDirection();
    let best: Mob | null = null;
    let bestDistance = reach;
    for (const mob of this.mobs) {
      if (mob.deadTicks > 0) continue;
      const definition = MOB_DEFINITIONS[mob.kind];
      const minX = mob.position.x - definition.halfWidth; const maxX = mob.position.x + definition.halfWidth;
      const minY = mob.position.y; const maxY = mob.position.y + definition.height;
      const minZ = mob.position.z - definition.halfWidth; const maxZ = mob.position.z + definition.halfWidth;
      let tMin = 0; let tMax = bestDistance;
      let ok = true;
      for (const [o, d, lo, hi] of [[eye.x, dir.x, minX, maxX], [eye.y, dir.y, minY, maxY], [eye.z, dir.z, minZ, maxZ]] as const) {
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { ok = false; break; } continue; }
        let t1 = (lo - o) / d; let t2 = (hi - o) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tMin = Math.max(tMin, t1); tMax = Math.min(tMax, t2);
        if (tMin > tMax) { ok = false; break; }
      }
      if (!ok) continue;
      if (this.target !== null && this.target.distance < tMin) continue;
      bestDistance = tMin;
      best = mob;
    }
    return best;
  }

  private stepMining(tick: number): void {
    if (this.pressed.has("attack-start") || (this.held.attack && this.attackCooldown === 0 && this.pressed.size >= 0)) {
      // Attack a mob under the crosshair on press (and while holding, on cooldown).
      const mob = this.attackCooldown === 0 ? this.mobUnderCrosshair(this.mode === "creative" ? TUNING.creativeReach : 3) : null;
      if (mob !== null && this.held.attack) {
        const tool = itemByKey(this.heldStack()?.key ?? "")?.tool;
        const damage = tool === null || tool === undefined ? 1 : tool.attackDamage;
        const killed = damageMob(mob, damage, this.player.position.x, this.player.position.z, this.player.sprinting ? 0.8 : 0.4);
        this.attackCooldown = TUNING.attackCooldownTicks;
        this.swing = 1;
        this.addExhaustion(0.1);
        if (tool !== null && tool !== undefined && this.mode === "survival") this.inventory.set(this.selectedSlot, wearTool(this.heldStack()));
        this.renderer?.emitDebris(vec3(mob.position.x, mob.position.y + MOB_DEFINITIONS[mob.kind].height * 0.6, mob.position.z), 0xc0392b, 6, tick);
        this.emit("attack", mob.kind, damage);
        this.emit("mob-hurt", mob.kind, mob.id);
        if (killed) { /* death handled in stepMobs via deadTicks */ }
        this.miningProgress = 0;
        return;
      }
    }
    const target = this.target;
    if (!this.held.attack || target === null) { if (this.miningProgress > 0) { this.miningProgress = 0; this.miningKey = null; } return; }
    const definition = blockByKey(target.blockKey);
    if (definition === undefined || definition.liquid) { this.miningProgress = 0; return; }
    if (!Number.isFinite(definition.hardness) && this.mode !== "creative") { this.miningProgress = 0; this.miningKey = definition.key; return; }
    if (this.miningKey !== definition.key) { this.miningKey = definition.key; this.miningProgress = 0; }
    const tool = this.heldTool();
    const seconds = this.mode === "creative" ? 0 : miningSeconds(definition, tool.type, tool.tier);
    this.miningProgress = seconds <= 0 ? 1 : Math.min(1, this.miningProgress + DT / seconds);
    if (tick % 15 === 7 && this.mode !== "creative" && this.miningProgress < 1) this.emit("mining-hit", definition.sound);
    if (tick % 8 === 0 && this.mode !== "creative") this.renderer?.emitDebris(vec3(target.x + 0.5 + target.normal.x * 0.5, target.y + 0.5 + target.normal.y * 0.5, target.z + 0.5 + target.normal.z * 0.5), definition.color, 2, tick);
    if (this.miningProgress < 1) return;
    this.breakBlock(target.x, target.y, target.z, definition, tool, tick);
    this.miningProgress = 0;
    this.miningKey = null;
    if (this.mode === "creative") this.held = Object.freeze({ ...this.held, attack: this.held.attack });
    this.updateTarget();
    if (this.mode === "creative") this.attackCooldown = 8;
  }

  private breakBlock(x: number, y: number, z: number, definition: BlockDefinition, tool: { type: ToolType; tier: number }, tick: number): void {
    const entity = this.world.blockEntities.get(`${x},${y},${z}`);
    if (entity !== undefined) {
      const contents = isChestState(entity) ? entity.slots : [entity.input, entity.fuel, entity.output];
      contents.forEach((slot, index) => { if (slot !== null) this.spawnItem(slot.key, slot.count, slot.damage, vec3(x + 0.5, y + 0.5, z + 0.5), hash3(index, tick, 3, 4) * Math.PI * 2, 0.6); });
    }
    this.world.set(x, y, z, AIR);
    this.stats.mined += 1;
    this.stats.minedByKey[definition.key] = (this.stats.minedByKey[definition.key] ?? 0) + 1;
    this.dirtySinceSave = true;
    if (this.mode === "survival") {
      this.addExhaustion(0.005);
      if (canHarvest(definition, tool.type, tool.tier) && definition.drop !== null) {
        const count = definition.drop.min + Math.floor(hash3(x, y, z, this.tick) * (definition.drop.max - definition.drop.min + 1));
        if (count > 0) this.spawnItem(definition.drop.key, count, 0, vec3(x + 0.5, y + 0.3, z + 0.5), hash3(x, y, z, 7) * Math.PI * 2, 0.8);
        const xp = definition.xp[0] + Math.floor(hash3(x, y, z, 11) * (definition.xp[1] - definition.xp[0] + 1));
        if (xp > 0) this.spawnOrbs(xp, vec3(x + 0.5, y + 0.5, z + 0.5), tick);
      }
      if (definition.bonus !== null && hash3(x, y, z, 13) < definition.bonus.chance) this.spawnItem(definition.bonus.key, 1, 0, vec3(x + 0.5, y + 0.3, z + 0.5), 0, 0.5);
      if (tool.type !== "none" && (definition.tool === tool.type || definition.hardness > 0)) this.inventory.set(this.selectedSlot, wearTool(this.heldStack()));
    }
    // Torches and plants above lose their support.
    const above = blockById(this.world.get(x, y + 1, z));
    if (above.shape === "cross" || above.shape === "torch") { this.world.set(x, y + 1, z, AIR); if (above.drop !== null && this.mode === "survival") this.spawnItem(above.drop.key, 1, 0, vec3(x + 0.5, y + 1.2, z + 0.5), 0, 0.3); }
    this.renderer?.emitDebris(vec3(x + 0.5, y + 0.5, z + 0.5), definition.color, 24, tick);
    this.emit("block-mined", definition.key, this.stats.mined);
  }

  private stepUse(tick: number): void {
    const pressedUse = this.pressed.has("use-start");
    const slot = this.heldStack();
    const item = itemByKey(slot?.key ?? "");
    if (this.held.use && item?.food !== null && item !== undefined && this.eating === 0 && this.player.hunger < TUNING.maximumHunger && pressedUse) { this.eating = TUNING.eatTicks; this.emit("eating", item.key); return; }
    if (!pressedUse) return;
    const target = this.target;
    if (target !== null) {
      const blockId = blockByKey(target.blockKey)?.id;
      if (!this.player.sneaking) {
        if (blockId === CRAFTING_TABLE) { this.openScreen("crafting"); this.emit("use", "crafting_table"); return; }
        if (blockId === BED) { this.trySleep(target); return; }
        if (blockId === CHEST) { const key = `${target.x},${target.y},${target.z}`; if (!isChestState(this.world.blockEntities.get(key))) this.world.blockEntities.set(key, { kind: "chest", slots: new Array<null>(27).fill(null) }); this.openScreen("chest", vec3(target.x, target.y, target.z)); this.emit("use", "chest"); return; }
        if (blockId === FURNACE || blockId === FURNACE_LIT) { const key = `${target.x},${target.y},${target.z}`; if (!this.world.blockEntities.has(key)) this.world.blockEntities.set(key, { input: null, fuel: null, output: null, burn: 0, burnTotal: 0, progress: 0 }); this.openScreen("furnace", vec3(target.x, target.y, target.z)); this.emit("use", "furnace"); return; }
      }
      if (item?.block !== null && item !== undefined) this.placeBlock(target, item.block, tick);
    }
  }

  private trySleep(target: TargetSnapshot): void {
    const timeOfDay = this.timeTicks / DAY_TICKS;
    const night = timeOfDay > 0.72 || timeOfDay < 0.22;
    this.spawn = vec3(target.x + 0.5, target.y + 1, target.z + 0.5);
    this.dirtySinceSave = true;
    if (!night) { this.chat("You can only sleep at night"); this.emit("bed", "respawn-set"); return; }
    const hostileNear = this.mobs.some((mob) => MOB_DEFINITIONS[mob.kind].hostile && mob.deadTicks === 0 && Math.hypot(mob.position.x - this.player.position.x, mob.position.z - this.player.position.z) < 8);
    if (hostileNear) { this.chat("You may not rest now; there are monsters nearby"); this.emit("bed", "monsters"); return; }
    this.timeTicks = Math.round(0.3 * DAY_TICKS);
    this.mobs = this.mobs.filter((mob) => !MOB_DEFINITIONS[mob.kind].hostile);
    this.chat("You slept through the night");
    this.emit("slept", PLAYER_ID, this.day());
  }

  private day(): number { return Math.floor(this.playTicks / DAY_TICKS) + 1; }

  private placeBlock(target: TargetSnapshot, definition: BlockDefinition, tick: number): void {
    const targetDefinition = blockByKey(target.blockKey);
    let x = target.x + target.normal.x;
    let y = target.y + target.normal.y;
    let z = target.z + target.normal.z;
    if (targetDefinition?.replaceable) { x = target.x; y = target.y; z = target.z; }
    if (y < 0 || y >= HEIGHT || !this.world.isLoaded(x, z)) return;
    const existing = blockById(this.world.get(x, y, z));
    if (!existing.replaceable) return;
    if (definition.shape === "torch" || definition.shape === "cross") {
      const below = blockById(this.world.get(x, y - 1, z));
      if (!below.solid && definition.shape === "cross") { this.emit("place-blocked", definition.key); return; }
      if (definition.shape === "torch" && !below.solid && !(target.normal.y === 0 && blockById(this.world.get(target.x, target.y, target.z)).solid)) { this.emit("place-blocked", definition.key); return; }
    }
    if (definition.solid) {
      const player = this.player;
      if (boxIntersectsBlock(player.position, TUNING.halfWidth, TUNING.height, x, y, z)) { this.emit("place-blocked", definition.key); return; }
      for (const mob of this.mobs) if (boxIntersectsBlock(mob.position, MOB_DEFINITIONS[mob.kind].halfWidth, MOB_DEFINITIONS[mob.kind].height, x, y, z)) { this.emit("place-blocked", definition.key); return; }
    }
    if (this.mode === "survival" && this.inventory.take(this.selectedSlot, 1 as number) <= 0) { this.emit("place-rejected", definition.key); return; }
    this.world.set(x, y, z, definition.id);
    this.stats.placed += 1;
    this.dirtySinceSave = true;
    this.swing = 1;
    this.renderer?.emitDebris(vec3(x + 0.5, y + 0.5, z + 0.5), definition.color, 6, tick);
    this.emit("block-placed", definition.key, this.stats.placed);
    this.updateTarget();
  }

  // --- Items on the ground ------------------------------------------------------------

  private spawnItem(key: string, count: number, damage: number, origin: Vec3, yaw: number, speed: number, pickupDelay: number = TUNING.itemPickupDelayTicks): void {
    if (itemByKey(key) === undefined || count <= 0) return;
    const spread = hash3(this.nextEntityId, this.tick, 5, 9) - 0.5;
    this.items.push({ id: this.nextEntityId++, key, count, damage, position: origin, velocity: vec3(-Math.sin(yaw) * speed + spread, 2.5 + spread, -Math.cos(yaw) * speed - spread), age: 0, pickupDelay });
    if (this.items.length > 200) this.items.shift();
  }

  private stepItems(tick: number): void {
    const player = this.player;
    const survivors: ItemEntity[] = [];
    for (const item of this.items) {
      item.age += 1;
      if (item.pickupDelay > 0) item.pickupDelay -= 1;
      const inWater = this.world.isLiquid(Math.floor(item.position.x), Math.floor(item.position.y), Math.floor(item.position.z));
      let vy = item.velocity.y - (inWater ? -2 : 24) * DT;
      if (inWater) vy = Math.min(vy, 1);
      const resolved = moveWithCollision(this.world, item.position, 0.125, 0.25, item.velocity.x * DT, vy * DT, item.velocity.z * DT);
      item.position = resolved.position;
      const damping = resolved.hitY ? 0.6 : 0.98;
      item.velocity = vec3(resolved.hitX ? 0 : item.velocity.x * damping, resolved.hitY ? 0 : vy, resolved.hitZ ? 0 : item.velocity.z * damping);
      if (item.age > 60 * 60 * 5 || item.position.y < -8) continue;
      if (this.world.get(Math.floor(item.position.x), Math.floor(item.position.y), Math.floor(item.position.z)) === LAVA) { this.emit("item-burned", item.key); continue; }
      const dx = item.position.x - player.position.x;
      const dy = item.position.y - (player.position.y + 0.8);
      const dz = item.position.z - player.position.z;
      if (item.pickupDelay === 0 && this.phase === "playing" && dx * dx + dy * dy + dz * dz < TUNING.pickupRadius * TUNING.pickupRadius) {
        const leftover = this.inventory.add(item.key, item.count, HOTBAR, item.damage);
        if (leftover < item.count) { this.emit("item-collected", item.key, item.count - leftover); this.dirtySinceSave = true; }
        if (leftover <= 0) continue;
        item.count = leftover;
        item.pickupDelay = 30;
      }
      survivors.push(item);
    }
    this.items = survivors;
    void tick;
  }

  // --- Mobs -----------------------------------------------------------------------------

  private stepMobs(tick: number): void {
    const daylight = this.daylight();
    const context = { world: this.world, tick, dt: DT, daylight, player: { position: this.player.position, eye: this.eyePosition(), alive: this.phase === "playing", creative: this.mode === "creative" }, rng: (salt: number) => this.mobRng(tick, salt) };
    const events = [...stepMobs(this.mobs, context), ...spawnMobs(this.mobs, context, () => this.nextEntityId++)];
    for (const mob of this.mobs) {
      if (mob.fuse > 0 && !this.fusing.has(mob.id)) { this.fusing.add(mob.id); this.emit("creeper-fuse", mob.kind, mob.id); }
      else if (mob.fuse === 0 && this.fusing.has(mob.id)) this.fusing.delete(mob.id);
      if (tick % 60 === mob.id % 60 && mob.deadTicks === 0 && Math.hypot(mob.position.x - this.player.position.x, mob.position.z - this.player.position.z) < 20 && this.mobRng(tick, mob.id * 977 + 5) < (MOB_DEFINITIONS[mob.kind].hostile ? 0.05 : 0.09)) this.emit("mob-say", mob.kind, mob.id);
    }
    for (const event of events) {
      if (event.kind === "attack-player") {
        this.hurt(event.damage, `mob:${event.mobId}`, 20);
        this.player.velocity = vec3(this.player.velocity.x + event.knockbackX * 6, Math.max(this.player.velocity.y, 4), this.player.velocity.z + event.knockbackZ * 6);
        this.player.grounded = false;
        this.emit("mob-attack", String(event.mobId), event.damage);
      } else if (event.kind === "mob-died") {
        this.stats.kills += 1;
        for (const drop of event.drops) this.spawnItem(drop.key, drop.count, 0, vec3(event.x, event.y + 0.5, event.z), hash3(event.mobId, tick, 1, 2) * Math.PI * 2, 1);
        if (event.xp > 0) this.spawnOrbs(event.xp, vec3(event.x, event.y + 0.5, event.z), tick);
        this.renderer?.emitDebris(vec3(event.x, event.y + 0.5, event.z), 0xdddddd, 16, tick);
        this.emit("mob-killed", event.mobKind, this.stats.kills);
      } else if (event.kind === "explosion") {
        this.explode(event.x, event.y, event.z, event.radius, tick);
      } else if (event.kind === "shoot") {
        this.arrows.push({ id: this.nextEntityId++, position: vec3(event.x, event.y, event.z), velocity: vec3(event.vx, event.vy, event.vz), age: 0, stuck: false });
        if (this.arrows.length > 64) this.arrows.shift();
        this.emit("arrow-shot", String(event.mobId));
      } else if (event.kind === "mob-spawned") {
        this.emit("mob-spawned", event.mobKind, event.mobId);
      }
    }
  }

  private stepArrows(tick: number): void {
    const player = this.player;
    const survivors: Arrow[] = [];
    for (const arrow of this.arrows) {
      arrow.age += 1;
      if (arrow.age > 60 * 20) continue;
      if (arrow.stuck) { survivors.push(arrow); continue; }
      const vy = arrow.velocity.y - TUNING.gravity * 0.6 * DT;
      const next = vec3(arrow.position.x + arrow.velocity.x * DT, arrow.position.y + vy * DT, arrow.position.z + arrow.velocity.z * DT);
      if (this.world.isSolid(Math.floor(next.x), Math.floor(next.y), Math.floor(next.z))) { arrow.stuck = true; arrow.velocity = vec3(0, 0, 0); this.emit("arrow-hit", "block"); survivors.push(arrow); continue; }
      const hitsPlayer = this.phase === "playing" && this.mode !== "creative" && next.x > player.position.x - TUNING.halfWidth && next.x < player.position.x + TUNING.halfWidth && next.y > player.position.y && next.y < player.position.y + TUNING.height && next.z > player.position.z - TUNING.halfWidth && next.z < player.position.z + TUNING.halfWidth;
      if (hitsPlayer) {
        this.hurt(2, "arrow", 20);
        const push = Math.max(0.1, Math.hypot(arrow.velocity.x, arrow.velocity.z));
        player.velocity = vec3(player.velocity.x + arrow.velocity.x / push * 4, Math.max(player.velocity.y, 3), player.velocity.z + arrow.velocity.z / push * 4);
        this.emit("arrow-hit", PLAYER_ID, 2);
        continue;
      }
      arrow.position = next;
      arrow.velocity = vec3(arrow.velocity.x * 0.995, vy, arrow.velocity.z * 0.995);
      survivors.push(arrow);
    }
    this.arrows = survivors;
    void tick;
  }

  private explode(x: number, y: number, z: number, radius: number, tick: number): void {
    const r = Math.ceil(radius);
    for (let dx = -r; dx <= r; dx += 1) for (let dy = -r; dy <= r; dy += 1) for (let dz = -r; dz <= r; dz += 1) {
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance > radius - hash3(dx, dy, dz, tick) * 0.6) continue;
      const bx = Math.floor(x) + dx; const by = Math.floor(y) + dy; const bz = Math.floor(z) + dz;
      const id = this.world.get(bx, by, bz);
      if (id === AIR || id === BEDROCK || id === OBSIDIAN || id === WATER || id === LAVA) continue;
      const definition = blockById(id);
      this.world.set(bx, by, bz, AIR);
      if (definition.drop !== null && hash3(bx, by, bz, tick + 1) < 0.3) this.spawnItem(definition.drop.key, 1, 0, vec3(bx + 0.5, by + 0.5, bz + 0.5), 0, 0.5);
    }
    const dx = this.player.position.x - x; const dy = this.player.position.y + 0.9 - y; const dz = this.player.position.z - z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance < radius * 2) { const damage = Math.round((1 - distance / (radius * 2)) * 24); this.hurt(damage, "explosion", 10); const push = 10 * (1 - distance / (radius * 2)); this.player.velocity = vec3(this.player.velocity.x + dx / Math.max(0.1, distance) * push, this.player.velocity.y + 5, this.player.velocity.z + dz / Math.max(0.1, distance) * push); }
    for (const mob of this.mobs) { const mdx = mob.position.x - x; const mdz = mob.position.z - z; if (Math.hypot(mdx, mob.position.y - y, mdz) < radius * 2) damageMob(mob, 12, x, z, 1); }
    this.explosions.push(vec3(x, y, z));
    this.renderer?.emitDebris(vec3(x, y, z), 0x777777, 80, tick);
    this.dirtySinceSave = true;
    this.emit("explosion", `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`, radius);
  }

  /** Splits experience into Minecraft-style orbs that drift toward the player and are collected on contact. */
  private spawnOrbs(amount: number, origin: Vec3, tick: number): void {
    let remaining = amount;
    let index = 0;
    while (remaining > 0 && index < 8) {
      const value = remaining >= 7 ? 7 : remaining >= 3 ? 3 : 1;
      remaining -= value;
      const angle = hash3(tick, index, 21, this.world.seed) * Math.PI * 2;
      this.orbs.push({ id: this.nextEntityId++, position: origin, velocity: vec3(Math.cos(angle) * 1.5, 3, Math.sin(angle) * 1.5), value, age: 0 });
      index += 1;
    }
    if (this.orbs.length > 96) this.orbs.splice(0, this.orbs.length - 96);
  }

  private stepOrbs(): void {
    const player = this.player;
    const survivors: XpOrb[] = [];
    for (const orb of this.orbs) {
      orb.age += 1;
      if (orb.age > 60 * 60 * 5) continue;
      const dx = player.position.x - orb.position.x;
      const dy = player.position.y + 0.9 - orb.position.y;
      const dz = player.position.z - orb.position.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance < 1 && orb.age > 10 && this.phase === "playing") { this.addXp(orb.value); continue; }
      let vx = orb.velocity.x * 0.9;
      let vy = orb.velocity.y - 12 * DT;
      let vz = orb.velocity.z * 0.9;
      if (distance < 8) { const pull = (1 - distance / 8) * 40 * DT; vx += dx / distance * pull * 6; vy += dy / distance * pull * 6; vz += dz / distance * pull * 6; }
      const resolved = moveWithCollision(this.world, orb.position, 0.12, 0.25, vx * DT, vy * DT, vz * DT);
      orb.position = resolved.position;
      orb.velocity = vec3(resolved.hitX ? 0 : vx, resolved.hitY ? 0 : vy, resolved.hitZ ? 0 : vz);
      survivors.push(orb);
    }
    this.orbs = survivors;
  }

  private addXp(amount: number): void {
    const player = this.player;
    player.xp += amount;
    while (player.xp >= xpForLevel(player.level)) { player.xp -= xpForLevel(player.level); player.level += 1; this.emit("level-up", PLAYER_ID, player.level); }
    this.emit("xp", PLAYER_ID, amount);
  }

  private daylight(): number {
    const theta = (this.timeTicks / DAY_TICKS - 0.25) * Math.PI * 2;
    const sunHeight = Math.sin(theta);
    const t = Math.max(0, Math.min(1, (sunHeight + 0.14) / 0.38));
    return t * t * (3 - 2 * t);
  }

  // --- Furnaces --------------------------------------------------------------------------

  // --- Advancements --------------------------------------------------------------------------

  private readonly toastQueue: Array<Readonly<{ title: string; description: string; item: string }>> = [];
  /** Item keys obtained since the last advancement check; UI clicks emit between ticks, so events alone are not enough. */
  private readonly pendingObtained = new Set<string>();

  private stepAdvancements(tick: number): void {
    if (this.toast !== null && tick >= this.toast.until) this.toast = null;
    if (this.toast === null && this.toastQueue.length > 0) { const next = this.toastQueue.shift()!; this.toast = Object.freeze({ ...next, until: tick + 60 * 5 }); }
    // Obtaining events award immediately; the periodic inventory scan catches anything else (loaded saves, drops).
    const obtained = new Set(this.pendingObtained);
    this.pendingObtained.clear();
    const scan = tick % 20 === 0;
    for (const advancement of ADVANCEMENTS) {
      if (this.unlocked.has(advancement.id)) continue;
      const done = advancement.item === "*ate" ? this.stats.eaten > 0
        : advancement.item === "*kill" ? this.stats.kills > 0
        : obtained.has(advancement.item) || (scan && this.inventory.count(advancement.item) > 0);
      if (!done) continue;
      this.unlocked.add(advancement.id);
      this.toastQueue.push(Object.freeze({ title: advancement.title, description: advancement.description, item: advancement.item === "*ate" ? "apple" : advancement.item === "*kill" ? "iron_sword" : advancement.item }));
      this.emit("advancement", advancement.id);
    }
  }

  // --- Block updates: gravity blocks, unsupported plants, random ticks for saplings ----------------

  private stepBlocks(tick: number): void {
    const queue = this.blockUpdates;
    this.blockUpdates = [];
    const visited = new Set<string>();
    for (let cursor = 0; cursor + 2 < queue.length; cursor += 3) {
      const ox = queue[cursor]!; const oy = queue[cursor + 1]!; const oz = queue[cursor + 2]!;
      for (const [dx, dy, dz] of [[0, 0, 0], [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] as const) {
        const x = ox + dx; const y = oy + dy; const z = oz + dz;
        const key = `${x},${y},${z}`;
        if (visited.has(key)) continue;
        visited.add(key);
        this.updateBlock(x, y, z);
      }
    }
    // Random ticks: a few loaded columns near the player each tick, like Minecraft's random block ticks.
    for (let sample = 0; sample < 3; sample += 1) {
      const rx = Math.floor(this.player.position.x) + Math.floor((hash3(tick, sample, 1, this.world.seed) - 0.5) * 48);
      const rz = Math.floor(this.player.position.z) + Math.floor((hash3(tick, sample, 2, this.world.seed) - 0.5) * 48);
      if (!this.world.isLoaded(rx, rz)) continue;
      const ry = this.world.heightAt(rx, rz);
      if (ry < 0) continue;
      const id = this.world.get(rx, ry, rz);
      if (id === blockByKey("sapling")!.id && hash3(tick, rx, rz, this.world.seed + 9) < 0.35) this.growTree(rx, ry, rz, tick);
      else if (id === blockByKey("dirt")!.id && this.world.get(rx, ry + 1, rz) === AIR && this.world.skyLight(rx, ry + 1, rz) >= 9 && hash3(tick, rx, rz, this.world.seed + 10) < 0.2) {
        // Dirt next to grass grows grass, as in Minecraft.
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (this.world.get(rx + dx, ry, rz + dz) === blockByKey("grass_block")!.id || this.world.get(rx + dx, ry + 1, rz + dz) === blockByKey("grass_block")!.id || this.world.get(rx + dx, ry - 1, rz + dz) === blockByKey("grass_block")!.id) { this.world.set(rx, ry, rz, blockByKey("grass_block")!.id); break; }
      }
    }
  }

  private updateBlock(x: number, y: number, z: number): void {
    const id = this.world.get(x, y, z);
    if (id === AIR) return;
    const definition = blockById(id);
    if (definition.key === "sand" || definition.key === "gravel") {
      const below = blockById(this.world.get(x, y - 1, z));
      if (y > 0 && (!below.solid || below.replaceable) && !below.solid) {
        // Gravity: the column slides down one block per tick until it lands, re-queuing itself.
        this.world.set(x, y, z, AIR);
        if (below.liquid || below.replaceable || this.world.get(x, y - 1, z) === AIR) this.world.set(x, y - 1, z, id);
        this.blockUpdates.push(x, y - 1, z);
        this.emit("block-fell", definition.key, y - 1);
      }
      return;
    }
    if (definition.shape === "cross" || definition.shape === "torch") {
      const below = blockById(this.world.get(x, y - 1, z));
      const wallSupported = definition.shape === "torch" && (this.world.isSolid(x + 1, y, z) || this.world.isSolid(x - 1, y, z) || this.world.isSolid(x, y, z + 1) || this.world.isSolid(x, y, z - 1));
      if (!below.solid && !wallSupported) {
        this.world.set(x, y, z, AIR);
        if (definition.drop !== null && this.mode === "survival") this.spawnItem(definition.drop.key, 1, 0, vec3(x + 0.5, y + 0.2, z + 0.5), 0, 0.3);
      }
      return;
    }
    if (definition.key === "grass_block" && blockById(this.world.get(x, y + 1, z)).opaque) this.world.set(x, y, z, blockByKey("dirt")!.id);
  }

  private growTree(x: number, y: number, z: number, tick: number): void {
    const trunk = 4 + Math.floor(hash3(x, y, z, tick) * 3);
    if (y + trunk + 2 >= HEIGHT) return;
    for (let dy = 1; dy <= trunk; dy += 1) if (this.world.get(x, y + dy, z) !== AIR) return;
    this.world.set(x, y, z, LOG);
    for (let dy = 1; dy <= trunk; dy += 1) this.world.set(x, y + dy, z, LOG);
    const leaves = blockByKey("oak_leaves")!.id;
    for (let dy = trunk - 2; dy <= trunk + 1; dy += 1) {
      const radius = dy >= trunk ? 1 : 2;
      for (let dx = -radius; dx <= radius; dx += 1) for (let dz = -radius; dz <= radius; dz += 1) {
        if (Math.abs(dx) === radius && Math.abs(dz) === radius && (radius === 1 || hash3(x + dx, dy, z + dz, tick) < 0.6)) continue;
        if (dx === 0 && dz === 0 && dy <= trunk) continue;
        if (this.world.get(x + dx, y + dy, z + dz) === AIR) this.world.set(x + dx, y + dy, z + dz, leaves);
      }
    }
    if (this.world.get(x, y + trunk + 1, z) === AIR) this.world.set(x, y + trunk + 1, z, leaves);
    this.dirtySinceSave = true;
    this.emit("tree-grown", "oak", trunk);
  }

  private stepFurnaces(): void {
    for (const [key, state] of this.world.blockEntities) {
      if (isChestState(state)) continue;
      const [x, y, z] = key.split(",").map(Number) as [number, number, number];
      const blockId = this.world.get(x, y, z);
      if (blockId !== FURNACE && blockId !== FURNACE_LIT) { this.world.blockEntities.delete(key); continue; }
      const recipe = smeltingFor(state.input?.key ?? null);
      const canOutput = recipe !== null && (state.output === null || (state.output.key === recipe.output.key && state.output.count + recipe.output.count <= 64));
      if (state.burn > 0) state.burn -= 1;
      if (state.burn === 0 && canOutput && state.fuel !== null) {
        const fuel = itemByKey(state.fuel.key)?.fuel ?? 0;
        if (fuel > 0) { state.burn = Math.round(fuel * 60); state.burnTotal = state.burn; state.fuel = state.fuel.count <= 1 ? null : { ...state.fuel, count: state.fuel.count - 1 }; this.dirtySinceSave = true; }
      }
      if (state.burn > 0 && canOutput && recipe !== null) {
        state.progress += 1;
        if (state.progress >= recipe.seconds * 60) {
          state.progress = 0;
          state.output = state.output === null ? { key: recipe.output.key, count: recipe.output.count, damage: 0 } : { ...state.output, count: state.output.count + recipe.output.count };
          state.input = state.input === null || state.input.count <= 1 ? null : { ...state.input, count: state.input.count - 1 };
          this.dirtySinceSave = true;
          this.emit("smelted", recipe.output.key);
        }
      } else if (state.progress > 0) state.progress = Math.max(0, state.progress - 2);
      const lit = state.burn > 0;
      if (lit && blockId === FURNACE) { this.world.set(x, y, z, FURNACE_LIT); this.world.blockEntities.set(key, state); }
      else if (!lit && blockId === FURNACE_LIT) { this.world.set(x, y, z, FURNACE); this.world.blockEntities.set(key, state); }
    }
  }

  private currentFurnace(): FurnaceState | null {
    if (this.furnacePos === null || this.screen !== "furnace") return null;
    const state = this.world.blockEntities.get(`${this.furnacePos.x},${this.furnacePos.y},${this.furnacePos.z}`);
    return state === undefined || isChestState(state) ? null : state;
  }

  private currentChest(): ChestState | null {
    if (this.furnacePos === null || this.screen !== "chest") return null;
    const state = this.world.blockEntities.get(`${this.furnacePos.x},${this.furnacePos.y},${this.furnacePos.z}`);
    return isChestState(state) ? state : null;
  }

  // --- Crafting & slot clicks -------------------------------------------------------------

  private updateCraftResult(): void {
    const size = this.craftSize;
    const grid: (string | null)[] = [];
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) grid.push(this.craft.get(y * 3 + x)?.key ?? null);
    const recipe = matchRecipe(grid, size);
    this.craftResult = recipe === null ? null : stack(recipe.result.key, recipe.result.count);
  }

  private consumeCraftGrid(): void {
    for (let index = 0; index < 9; index += 1) if (this.craft.get(index) !== null) this.craft.take(index, 1);
  }

  clickSlot(container: SlotContainer, index: number, button: "left" | "right", shift: boolean): void {
    if (this.isDisposed || this.phase !== "playing" || this.screen === "none" || this.screen === "chat") return;
    const furnace = this.currentFurnace();
    const furnaceContainer = (name: "input" | "fuel" | "output"): Container => { const c = new Container(1); if (furnace !== null && furnace[name] !== null) c.set(0, stack(furnace[name]!.key, furnace[name]!.count, furnace[name]!.damage)); return c; };
    const writeFurnace = (name: "input" | "fuel" | "output", c: Container): void => { if (furnace === null) return; const slot = c.get(0); furnace[name] = slot === null ? null : { key: slot.key, count: slot.count, damage: slot.damage }; this.dirtySinceSave = true; };
    if (container === "creative") {
      // Creative palette: pick a full stack, or destroy whatever is on the cursor.
      if (this.mode !== "creative") return;
      const key = CREATIVE_ITEMS[index];
      if (this.cursor !== null) this.cursor = null;
      else if (key !== undefined) { if (shift) this.inventory.add(key, itemByKey(key)?.maxStack ?? 64, HOTBAR); else this.cursor = stack(key, itemByKey(key)?.maxStack ?? 64); }
      this.publishFrame();
      return;
    }
    if (container === "craft-result") {
      if (this.craftResult === null) return;
      const craftOnce = (): boolean => {
        if (this.craftResult === null) return false;
        if (shift) { const leftover = this.inventory.add(this.craftResult.key, this.craftResult.count, HOTBAR); if (leftover > 0) return false; }
        else if (this.cursor === null) this.cursor = this.craftResult;
        else if (sameItem(this.cursor, this.craftResult) && this.cursor.count + this.craftResult.count <= (itemByKey(this.cursor.key)?.maxStack ?? 64)) this.cursor = stack(this.cursor.key, this.cursor.count + this.craftResult.count);
        else return false;
        this.consumeCraftGrid();
        this.stats.crafted += 1;
        this.emit("crafted", this.craftResult.key, this.craftResult.count);
        this.updateCraftResult();
        return true;
      };
      let guard = 0;
      do { if (!craftOnce()) break; guard += 1; } while (shift && guard < 64);
      this.dirtySinceSave = true;
      this.publishFrame();
      return;
    }
    const chest = this.currentChest();
    const chestContainer = (): Container => { const c = new Container(27); chest?.slots.forEach((slot, i) => { if (slot !== null) c.set(i, stack(slot.key, slot.count, slot.damage)); }); return c; };
    const writeChest = (c: Container): void => { if (chest === null) return; chest.slots = c.slots.map((slot) => (slot === null ? null : { key: slot.key, count: slot.count, damage: slot.damage })); this.dirtySinceSave = true; };
    if (container === "chest") {
      if (chest === null) return;
      const c = chestContainer();
      if (shift) transferStack(c, index, this.inventory, HOTBAR); else this.cursor = clickSlot(c, index, this.cursor, button);
      writeChest(c);
      this.publishFrame();
      return;
    }
    if (container === "inventory") {
      if (shift) {
        const slot = this.inventory.get(index);
        if (slot !== null && chest !== null) { const c = chestContainer(); transferStack(this.inventory, index, c); writeChest(c); this.publishFrame(); return; }
        if (slot !== null) {
          if (this.screen === "furnace" && furnace !== null) {
            const fuelValue = itemByKey(slot.key)?.fuel ?? 0;
            const targetName: "input" | "fuel" | null = smeltingFor(slot.key) !== null ? "input" : fuelValue > 0 ? "fuel" : null;
            if (targetName !== null) { const c = furnaceContainer(targetName); transferStack(this.inventory, index, c); writeFurnace(targetName, c); this.publishFrame(); return; }
          }
          transferStack(this.inventory, index, this.inventory, index < 9 ? MAIN : HOTBAR);
        }
      } else this.cursor = clickSlot(this.inventory, index, this.cursor, button);
    } else if (container === "craft") {
      const size = this.craftSize;
      const gx = index % 3; const gy = Math.floor(index / 3);
      if (gx >= size || gy >= size) return;
      if (shift) transferStack(this.craft, index, this.inventory, HOTBAR);
      else this.cursor = clickSlot(this.craft, index, this.cursor, button);
      this.updateCraftResult();
    } else if (furnace !== null) {
      const name: "input" | "fuel" | "output" = container === "furnace-input" ? "input" : container === "furnace-fuel" ? "fuel" : "output";
      const c = furnaceContainer(name);
      if (shift) transferStack(c, 0, this.inventory, HOTBAR);
      else this.cursor = clickSlot(c, 0, this.cursor, button, name !== "output");
      writeFurnace(name, c);
    }
    this.dirtySinceSave = true;
    this.publishFrame();
  }

  // --- Commands -------------------------------------------------------------------------

  command(text: string): void {
    if (this.isDisposed) return;
    this.pendingCommands.push(text);
  }

  private runCommand(raw: string): void {
    const text = raw.trim();
    if (text.length === 0) { if (this.screen === "chat") this.closeScreen(); return; }
    if (!text.startsWith("/")) { this.chat(`<${PLAYER_ID}> ${text}`); if (this.screen === "chat") this.closeScreen(); return; }
    const [name, ...args] = text.slice(1).split(/\s+/);
    switch (name) {
      case "time": {
        const value = args[0] === "set" ? args[1] : args[0];
        const fraction = value === "day" ? 0.28 : value === "noon" ? 0.5 : value === "night" ? 0.85 : value === "midnight" ? 0 : Number(value) / 24_000;
        if (Number.isFinite(fraction)) { this.setTimeOfDay(fraction); this.chat(`Set the time to ${formatClock(this.timeTicks / DAY_TICKS)}`); } else this.chat("Usage: /time set <day|noon|night|midnight|0-24000>");
        break;
      }
      case "gamemode": { const mode = args[0] === "creative" || args[0] === "1" || args[0] === "c" ? "creative" : "survival"; this.setMode(mode); this.chat(`Set own game mode to ${mode}`); break; }
      case "give": { const key = args[0] ?? ""; const count = Math.max(1, Math.min(64, Number(args[1] ?? 1) || 1)); if (itemByKey(key) === undefined) { this.chat(`Unknown item: ${key}`); break; } this.give(key, count); this.chat(`Gave ${count} [${itemByKey(key)!.name}] to ${PLAYER_ID}`); break; }
      case "tp": { const x = Number(args[0]); const y = Number(args[1]); const z = Number(args[2]); if ([x, y, z].every(Number.isFinite)) { this.player.position = vec3(x, y, z); this.player.velocity = vec3(0, 0, 0); this.loadChunksAround(this.player.position, this.simulationDistance, Number.POSITIVE_INFINITY); this.chat(`Teleported to ${x}, ${y}, ${z}`); } else this.chat("Usage: /tp <x> <y> <z>"); break; }
      case "seed": this.chat(`Seed: [${this.world.seed}]`); break;
      case "kill": this.hurt(1000, "command", 0); break;
      case "spawn": { const kind = args[0] as MobKind; if (MOB_DEFINITIONS[kind] === undefined) { this.chat("Usage: /spawn <pig|cow|sheep|chicken|zombie|creeper|skeleton>"); break; } const d = this.viewDirection(); const p = this.player.position; const spot = vec3(Math.floor(p.x + d.x * 4) + 0.5, this.world.topSolid(Math.floor(p.x + d.x * 4), Math.floor(p.z + d.z * 4)) + 1, Math.floor(p.z + d.z * 4) + 0.5); this.mobs.push(createMob(this.nextEntityId++, kind, spot)); this.chat(`Summoned ${MOB_DEFINITIONS[kind].name}`); break; }
      case "help": this.chat("/time set <day|night>, /gamemode <survival|creative>, /give <item> [n], /tp x y z, /spawn <mob>, /seed, /kill"); break;
      default: this.chat(`Unknown command: /${name}`);
    }
    if (this.screen === "chat") this.closeScreen();
  }

  give(key: string, count: number): void {
    if (this.isDisposed || itemByKey(key) === undefined) return;
    const leftover = this.inventory.add(key, count, HOTBAR);
    if (leftover > 0) this.spawnItem(key, leftover, 0, this.eyePosition(), this.player.yaw, 1);
    this.dirtySinceSave = true;
    this.emit("gave", key, count - leftover);
  }

  setSimulationDistance(chunks: number): void {
    if (this.isDisposed || !Number.isFinite(chunks)) return;
    this.simulationDistance = Math.max(2, Math.min(16, Math.round(chunks)));
    this.renderer?.setRenderDistance(this.simulationDistance);
    this.world.unloadBeyond(Math.floor(this.player.position.x / CHUNK), Math.floor(this.player.position.z / CHUNK), this.simulationDistance + 2);
    this.emit("render-distance", PLAYER_ID, this.simulationDistance);
  }

  setMode(mode: GameMode): void {
    if (this.isDisposed) return;
    this.mode = mode;
    if (mode === "survival") this.player.flying = false;
    this.emit("mode", mode);
  }

  // --- HUD & snapshot --------------------------------------------------------------------

  private hudExtras(): Record<string, string | number | boolean> {
    const player = this.player;
    const target = this.target;
    const held = this.heldStack();
    const heldItem = itemByKey(held?.key ?? "");
    const timeOfDay = this.timeTicks / DAY_TICKS;
    const extras: Record<string, string | number | boolean> = {
      screen: this.screen,
      mode: this.mode,
      clock: formatClock(timeOfDay),
      day: Math.floor(this.playTicks / DAY_TICKS) + 1,
      coords: `${player.position.x.toFixed(3)} / ${player.position.y.toFixed(5)} / ${player.position.z.toFixed(3)}`,
      block: `${Math.floor(player.position.x)} ${Math.floor(player.position.y)} ${Math.floor(player.position.z)}`,
      chunk: `${Math.floor(player.position.x) & 15} ${Math.floor(player.position.y) & 15} ${Math.floor(player.position.z) & 15} in ${Math.floor(player.position.x / CHUNK)} ${Math.floor(player.position.y / CHUNK)} ${Math.floor(player.position.z / CHUNK)}`,
      facing: this.facing(),
      biome: BIOME_NAMES[this.world.biomeAt(Math.floor(player.position.x), Math.floor(player.position.z))] ?? "Plains",
      light: `${this.world.blockLight(Math.floor(player.position.x), Math.floor(player.position.y), Math.floor(player.position.z))} block, ${this.world.skyLight(Math.floor(player.position.x), Math.floor(player.position.y), Math.floor(player.position.z))} sky`,
      chunks: this.world.loadedChunkCount,
      entities: this.mobs.length + this.items.length,
      targetName: target === null ? "" : target.blockName,
      targetPos: target === null ? "" : `${target.x}, ${target.y}, ${target.z}`,
      mining: this.miningProgress,
      selectedSlot: this.selectedSlot,
      selectedName: heldItem?.name ?? "",
      health: player.health,
      hunger: player.hunger,
      saturation: player.saturation,
      air: player.air,
      airVisible: player.eyeInWater || player.air < TUNING.maximumAir,
      xpLevel: player.level,
      xpProgress: player.xp / xpForLevel(player.level),
      underwater: player.eyeInWater,
      night: this.daylight() < 0.4,
      hasSave: this.hasSave,
      saved: this.lastSaveTick !== null && this.tick - this.lastSaveTick < 120,
      seed: this.world.seed,
      edits: this.world.editCount,
      deaths: this.stats.deaths,
      score: this.player.level * 10 + this.stats.mined + this.stats.kills * 5,
      craftSize: this.craftSize,
      debug: this.debugOverlay,
      hudHidden: this.hudHidden,
      hurt: player.hurtTicks > 0,
      eating: this.eating > 0,
      playTime: `${Math.floor(this.playTicks * DT / 60)}:${String(Math.floor(this.playTicks * DT) % 60).padStart(2, "0")}`,
      chat: this.chatLog.join("\n"),
      toastTitle: this.toast?.title ?? "",
      toastDescription: this.toast?.description ?? "",
      toastItem: this.toast?.item ?? "",
      advancements: this.unlocked.size,
      version: "Craftlands 0.1 (three-game-kit)",
    };
    return extras;
  }

  private facing(): string {
    const yaw = ((this.player.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const octant = Math.round(yaw / (Math.PI / 2)) % 4;
    return ["north (Towards negative Z)", "west (Towards negative X)", "south (Towards positive Z)", "east (Towards positive X)"][octant] ?? "north";
  }

  private publishFrame(): void {
    this.hud.update({ screen: this.phase, score: this.stats.mined, timerSeconds: this.playTicks * DT, health: this.player.health, maximumHealth: TUNING.maximumHealth, extras: this.hudExtras() });
    this.renderer?.prepare(this.snapshot(), Object.freeze([...this.tickEvents]));
  }

  snapshot(): CraftlandsSnapshot {
    const player = this.player;
    const furnace = this.currentFurnace();
    const furnaceSnapshot: FurnaceSnapshot | null = furnace === null || this.furnacePos === null ? null : Object.freeze({
      x: this.furnacePos.x, y: this.furnacePos.y, z: this.furnacePos.z,
      input: furnace.input === null ? null : stack(furnace.input.key, furnace.input.count, furnace.input.damage),
      fuel: furnace.fuel === null ? null : stack(furnace.fuel.key, furnace.fuel.count, furnace.fuel.damage),
      output: furnace.output === null ? null : stack(furnace.output.key, furnace.output.count, furnace.output.damage),
      burnFraction: furnace.burnTotal > 0 ? furnace.burn / furnace.burnTotal : 0,
      progressFraction: furnace.input === null ? 0 : furnace.progress / ((smeltingFor(furnace.input.key)?.seconds ?? 10) * 60),
    });
    const items: ItemEntitySnapshot[] = this.items.map((item) => Object.freeze({ id: item.id, key: item.key, count: item.count, position: item.position, age: item.age }));
    const mobs: MobSnapshot[] = this.mobs.map((mob) => Object.freeze({ id: mob.id, kind: mob.kind, position: mob.position, yaw: mob.yaw, headYaw: mob.headYaw, walkPhase: mob.walkPhase, hurtTicks: mob.hurtTicks, deadTicks: mob.deadTicks, fuse: mob.fuse, burning: mob.burning, health: mob.health }));
    const inventory = this.inventory.snapshot();
    return Object.freeze({
      tick: this.tick,
      time: this.tick * DT,
      phase: this.phase,
      screen: this.screen,
      mode: this.mode,
      seed: this.world.seed,
      spawn: this.spawn,
      player: Object.freeze({ position: player.position, velocity: player.velocity, yaw: player.yaw, pitch: player.pitch, grounded: player.grounded, inWater: player.inWater, eyeInWater: player.eyeInWater, sprinting: player.sprinting, sneaking: player.sneaking, flying: player.flying, health: player.health, maximumHealth: TUNING.maximumHealth, hunger: player.hunger, saturation: player.saturation, air: player.air, xp: player.xp, level: player.level, xpProgress: player.xp / xpForLevel(player.level), hurtTicks: player.hurtTicks, eyeHeight: this.eyeHeight(), walkPhase: player.walkPhase }),
      move: this.move,
      held: this.held,
      target: this.target,
      mining: Object.freeze({ progress: this.miningProgress, blockKey: this.miningKey }),
      selectedSlot: this.selectedSlot,
      hotbar: Object.freeze(inventory.slice(0, 9)),
      inventory,
      cursor: this.cursor,
      craftGrid: this.craft.snapshot(),
      craftResult: this.craftResult,
      furnace: furnaceSnapshot,
      chest: (() => { const state = this.currentChest(); return state === null ? null : Object.freeze(state.slots.map((slot) => (slot === null ? null : stack(slot.key, slot.count, slot.damage)))); })(),
      heldItem: this.heldStack(),
      items: Object.freeze(items),
      orbs: Object.freeze(this.orbs.map((orb) => Object.freeze({ id: orb.id, position: orb.position, value: orb.value }))),
      arrows: Object.freeze(this.arrows.map((arrow) => Object.freeze({ id: arrow.id, position: arrow.position, velocity: arrow.velocity, stuck: arrow.stuck }))),
      mobs: Object.freeze(mobs),
      eating: this.eating,
      swing: this.swing,
      thirdPerson: this.thirdPerson,
      debug: this.debugOverlay,
      hudHidden: this.hudHidden,
      timeOfDay: this.timeTicks / DAY_TICKS,
      daylight: this.daylight(),
      day: Math.floor(this.playTicks / DAY_TICKS) + 1,
      playTimeSeconds: this.playTicks * DT,
      editCount: this.world.editCount,
      loadedChunks: this.world.loadedChunkCount,
      hasSave: this.hasSave,
      lastSaveTick: this.lastSaveTick,
      deaths: this.stats.deaths,
      stats: Object.freeze({ mined: this.stats.mined, placed: this.stats.placed, crafted: this.stats.crafted, kills: this.stats.kills, minedByKey: Object.freeze({ ...this.stats.minedByKey }) }),
      chatLog: Object.freeze([...this.chatLog]),
      biome: BIOME_NAMES[this.world.biomeAt(Math.floor(player.position.x), Math.floor(player.position.z))] ?? "Plains",
      explosions: Object.freeze([...this.explosions]),
      advancements: Object.freeze([...this.unlocked]),
      toast: this.toast === null ? null : Object.freeze({ title: this.toast.title, description: this.toast.description, item: this.toast.item }),
    });
  }

  // --- Public API -------------------------------------------------------------------------

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
    this.player.yaw = yaw;
    this.player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
  }

  look(deltaYaw: number, deltaPitch: number): void {
    if (this.screen !== "none" || this.phase !== "playing") return;
    this.setLook(this.player.yaw + deltaYaw, this.player.pitch + deltaPitch);
  }

  setHeld(patch: Partial<HeldInput>): void {
    if (this.isDisposed) return;
    const next = Object.freeze({ attack: patch.attack ?? this.held.attack, use: patch.use ?? this.held.use, sprint: patch.sprint ?? this.held.sprint, sneak: patch.sneak ?? this.held.sneak });
    if (patch.attack === true && !this.held.attack) this.pressed.add("attack-start");
    if (patch.use === true && !this.held.use) this.pressed.add("use-start");
    this.held = next;
    if (patch.sprint === true) this.flyUp = false;
  }

  press(action: Action): void {
    if (this.isDisposed || !ACTIONS.includes(action)) return;
    if (action === "attack-start") { this.pressed.add("attack-start"); }
    if (action === "use-start") { this.pressed.add("use-start"); }
    this.actions.press(action);
  }

  setTimeOfDay(fraction: number): void {
    if (this.isDisposed || !Number.isFinite(fraction)) return;
    this.timeTicks = Math.round(((fraction % 1) + 1) % 1 * DAY_TICKS);
    this.emit("time-set", PLAYER_ID, fraction);
    this.publishFrame();
  }

  loadScenario(id: Scenario): void {
    if (this.isDisposed) return;
    if (this.phase === "title") { this.newWorld(); this.transition("playing", "qa-scenario"); }
    if (this.phase === "dead") this.respawn();
    if (this.phase === "paused") this.transition("playing", "qa-scenario");
    if (this.screen !== "none") this.closeScreen();
    const player = this.player;
    player.velocity = vec3(0, 0, 0);
    const lookAt = (block: Vec3, standing: Vec3): void => {
      player.position = standing;
      const eye = vec3(standing.x, standing.y + TUNING.eyeHeight, standing.z);
      const dx = block.x + 0.5 - eye.x; const dy = block.y + 0.5 - eye.y; const dz = block.z + 0.5 - eye.z;
      player.yaw = Math.atan2(-dx, -dz);
      player.pitch = Math.max(-1.4, Math.min(1.4, Math.atan2(dy, Math.hypot(dx, dz))));
    };
    const standBeside = (block: Vec3, keep: number | null): void => {
      for (let dx = 1; dx <= 2; dx += 1) for (let dy = 0; dy < 2; dy += 1) { const id = this.world.get(block.x + dx, block.y + dy, block.z); if (id !== AIR && id !== keep) this.world.set(block.x + dx, block.y + dy, block.z, AIR); }
      for (let dx = 1; dx <= 2; dx += 1) if (!this.world.isSolid(block.x + dx, block.y - 1, block.z)) this.world.set(block.x + dx, block.y - 1, block.z, STONE);
      lookAt(block, vec3(block.x + 2.5, block.y, block.z + 0.5));
    };
    const pocketBeside = (blockId: number): void => { const block = this.world.findNearest(blockId, this.spawn, 40); if (block === null) { player.position = this.spawn; return; } standBeside(block, null); };
    const placeInFront = (id: number): Vec3 => {
      const x = Math.floor(this.spawn.x);
      const z = Math.floor(this.spawn.z) - 2;
      const ground = this.world.topSolid(Math.floor(this.spawn.x), Math.floor(this.spawn.z));
      for (let dz = 0; dz >= -3; dz -= 1) for (let dy = 1; dy <= 3; dy += 1) if (this.world.get(x, ground + dy, Math.floor(this.spawn.z) + dz) !== AIR) this.world.set(x, ground + dy, Math.floor(this.spawn.z) + dz, AIR);
      for (let dz = 0; dz >= -3; dz -= 1) if (!this.world.isSolid(x, ground, Math.floor(this.spawn.z) + dz)) this.world.set(x, ground, Math.floor(this.spawn.z) + dz, STONE);
      const y = ground + 1;
      this.world.set(x, y, z, id);
      lookAt(vec3(x, y, z), vec3(this.spawn.x, ground + 1, this.spawn.z));
      return vec3(x, y, z);
    };
    switch (id) {
      case "spawn": player.position = this.spawn; player.yaw = 0; player.pitch = 0; break;
      case "tree": { const log = this.world.findNearest(LOG, this.spawn, 48); if (log === null) { player.position = this.spawn; break; } let bottom = log.y; while (bottom > 0 && this.world.get(log.x, bottom - 1, log.z) === LOG) bottom -= 1; standBeside(vec3(log.x, bottom, log.z), LOG); break; }
      case "stone": pocketBeside(STONE); break;
      case "iron": pocketBeside(IRON_ORE); break;
      case "diamond": { let block = this.world.findNearest(DIAMOND_ORE, this.spawn, 40); if (block === null) { const x = Math.floor(this.spawn.x); const z = Math.floor(this.spawn.z); this.world.set(x, 8, z, DIAMOND_ORE); block = vec3(x, 8, z); } standBeside(block, null); break; }
      case "cliff": player.position = vec3(this.spawn.x, this.spawn.y + 14, this.spawn.z); player.pitch = -0.6; player.fallStart = player.position.y; break;
      case "water": { const water = this.world.findNearest(WATER, this.spawn, 48); player.position = water === null ? this.spawn : vec3(water.x + 0.5, SEA_LEVEL + 3, water.z + 0.5); player.pitch = -0.5; break; }
      case "cave": { const x = Math.floor(this.spawn.x); const z = Math.floor(this.spawn.z); for (let y = 20; y <= 23; y += 1) for (let dx = -2; dx <= 2; dx += 1) for (let dz = -2; dz <= 2; dz += 1) this.world.set(x + dx, y, z + dz, AIR); for (let dx = -2; dx <= 2; dx += 1) for (let dz = -2; dz <= 2; dz += 1) if (!this.world.isSolid(x + dx, 19, z + dz)) this.world.set(x + dx, 19, z + dz, STONE); player.position = vec3(x + 0.5, 20, z + 0.5); player.yaw = 0; player.pitch = 0; break; }
      case "night": player.position = this.spawn; this.setTimeOfDay(0.85); break;
      case "crafting": { placeInFront(CRAFTING_TABLE); this.give("oak_log", 8); this.give("cobblestone", 16); this.give("coal", 4); break; }
      case "furnace": { placeInFront(FURNACE); this.give("iron_ore", 4); this.give("coal", 4); this.give("cobblestone", 8); break; }
      case "chest": { placeInFront(CHEST); this.give("cobblestone", 8); break; }
      case "mobs": { player.position = this.spawn; player.yaw = 0; player.pitch = 0; const x = Math.floor(this.spawn.x); const z = Math.floor(this.spawn.z) - 4; this.mobs.push(createMob(this.nextEntityId++, "pig", vec3(x + 0.5, this.world.topSolid(x, z) + 1, z + 0.5))); this.mobs.push(createMob(this.nextEntityId++, "zombie", vec3(x + 2.5, this.world.topSolid(x + 2, z) + 1, z + 0.5))); break; }
    }
    this.miningProgress = 0;
    this.loadChunksAround(player.position, this.simulationDistance, Number.POSITIVE_INFINITY);
    this.updateTarget();
    this.publishFrame();
    this.emit("scenario-loaded", id);
    void COBBLESTONE; void TORCH;
  }

  events(): readonly CraftlandsEvent[] { return Object.freeze([...this.collected]); }
  ruleFailures(): readonly Readonly<{ tick: number; message: string }>[] { return Object.freeze([...this.ruleFailureList]); }
  errors(): readonly RuntimeErrorRecord[] { return Object.freeze([...this.errorRecords]); }
  debugSnapshot(): DebugSnapshot | null { return this.lastDebug; }
  inspectRuntime(): CraftlandsRuntimeInspection {
    const life = this.runtime.inspectLifecycle();
    return Object.freeze({ lifecycleState: life.state, installedFeatureIds: Object.freeze([...life.installedFeatureIds]), scheduleSystemIds: Object.freeze(life.scheduleReport.map(({ systemId }) => systemId)), schedulerTick: this.runtime.tick, debugProviders: this.debug.disposed ? Object.freeze([]) : this.debug.inspect().providerIds });
  }
  inspectRenderer(): CraftlandsRendererInspection | null { return this.renderer?.inspect() ?? null; }
  inspectWorld(): CraftlandsWorldInspection { return Object.freeze({ seed: this.world.seed, loadedChunks: this.world.loadedChunkCount, editCount: this.world.editCount, spawn: this.spawn, blockEntities: this.world.blockEntities.size, simulationDistance: this.simulationDistance }); }
  inspectSave(): CraftlandsSaveInspection { return Object.freeze({ ready: this.saveReady, lastLoad: this.lastLoad, lastSave: this.lastSave, hasSave: this.hasSave, editCount: this.world.editCount }); }
  inspectInventory(): Readonly<Record<string, number>> { const result: Record<string, number> = {}; for (const slot of this.inventory.slots) if (slot !== null) result[slot.key] = (result[slot.key] ?? 0) + slot.count; return Object.freeze(result); }
  inspectLeaks(): CraftlandsLeakInspection { return Object.freeze({ activeListeners: this.listeners.size, activeFeatures: this.isDisposed ? 0 : this.runtime.inspectLifecycle().installedFeatureIds.length, disposed: this.isDisposed }); }
  subscribe(listener: (event: CraftlandsEvent) => void): () => void { if (this.isDisposed) return () => undefined; this.listeners.add(listener); return () => this.listeners.delete(listener); }
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

export function createCraftlandsGame(options: CraftlandsGameOptions): CraftlandsGame {
  return new Game(options);
}
