import { Runtime as ClientRuntime } from "@three-game-kit/client";
import { createDebugDevToolsClientFeature } from "@three-game-kit/client/advanced";
import { createCameraFeature } from "@three-game-kit/client/camera";
import { createGameFlowClientFeature, createHealthClientFeature, createHudFeature, createSpawnPrefabClientFeature, createTriggerAreaClientFeature, type HudAdapter } from "@three-game-kit/client/gameplay";
import { createAbilitySkillClientFeature, createProjectileClientFeature, createSaveLoadClientFeature, createSimpleAiNavigationClientFeature } from "@three-game-kit/client/genre";
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
import { createGameFlowRuntime, createHealthRuntime, createHudStateStore, createSpawnPrefabRuntime, createTriggerAreaRuntime, type PrefabInstance } from "@three-game-kit/shared/gameplay";
import { createAbilityRuntime, createProjectileRuntime, createSaveLoadRuntime, createSimpleAiRuntime, type ProjectileState, type SaveAdapter, type SaveValue } from "@three-game-kit/shared/genre";
import type { GravetideRenderer, GravetideRendererInspection } from "./renderer.js";
import { createRng, type Rng } from "./rng.js";
import {
  ARENA_HALF,
  DEFAULT_SEED,
  DT,
  ELITE_SECONDS,
  ENEMIES,
  HERO_ID,
  MAX_ALIVE,
  MAX_GEMS,
  MAX_LEVEL,
  MAX_PASSIVES,
  MAX_WEAPONS,
  PASSIVES,
  RUN_SECONDS,
  SAVE_SLOT,
  SAVE_VERSION,
  SHRINES,
  SPAWN_RING_MAX,
  SPAWN_RING_MIN,
  TUNING,
  WAVES,
  WEAPONS,
  formatTime,
  passiveById,
  weaponById,
  xpToNext,
  type Action,
  type EnemyKind,
  type EnemySnapshot,
  type GravetideEvent,
  type GravetideSnapshot,
  type OfferSnapshot,
  type PassiveId,
  type Phase,
  type Scenario,
  type WeaponId,
} from "./state.js";

const MAX_STEPS = 1_200;
const ACTIONS: readonly Action[] = Object.freeze(["start", "restart", "choose-1", "choose-2", "choose-3", "bell"]);
const ENEMY_KINDS: readonly EnemyKind[] = Object.freeze(["bat", "ghoul", "brute", "wraith", "elite"]);
const GRID_CELL = 2;
const GRID_SIZE = Math.ceil((ARENA_HALF * 2 + 8) / GRID_CELL);
const BELL_COOLDOWN_TICKS = 60 * 14;
const BELL_CAST_TICKS = 18;
const BELL_RADIUS = 6.5;
const EMPTY = defineFeatureConfiguration<Readonly<Record<string, never>>>({
  defaultValue: () => Object.freeze({}),
  parse(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) && Reflect.ownKeys(value).length === 0
      ? { ok: true as const, value: Object.freeze({}) }
      : { ok: false as const, issues: [{ path: [], code: "empty-object-required" }] };
  },
});

export interface EnemySlot {
  readonly index: number;
  readonly healthId: string;
  instanceId: string | null;
  kind: EnemyKind;
  x: number;
  z: number;
  vx: number;
  vz: number;
  hp: number;
  maximumHp: number;
  alive: boolean;
  flash: number;
  bob: number;
}

export interface Gem { x: number; z: number; value: number; attracted: boolean; }
export interface Axe { x: number; z: number; vx: number; vz: number; ticks: number; spin: number; damage: number; readonly hit: Set<number>; }
export interface Strike { x: number; z: number; ticks: number; }
export interface WhipFlash { x: number; z: number; facing: number; ticks: number; length: number; width: number; behind: boolean; }

/** Mutable per-frame view for the renderer: typed arrays are reused, so the renderer must not retain them. */
export interface RenderFrame {
  readonly enemies: readonly EnemySlot[];
  readonly gems: readonly Gem[];
  readonly projectiles: readonly ProjectileState[];
  readonly axes: readonly Axe[];
  readonly strikes: readonly Strike[];
  readonly whips: readonly WhipFlash[];
  readonly auraRadius: number;
  readonly auraLevel: number;
  readonly bellRing: number;
}

export interface GravetideRuntimeInspection {
  readonly lifecycleState: string;
  readonly installedFeatureIds: readonly string[];
  readonly scheduleSystemIds: readonly string[];
  readonly schedulerTick: number;
  readonly debugProviders: readonly string[];
  readonly prefab: Readonly<{ readonly active: number; readonly pooled: Readonly<Record<string, number>> }>;
  readonly health: Readonly<{ readonly entities: number; readonly ignoredRequests: number }>;
  readonly ai: Readonly<{ readonly agents: number; readonly eliteBehavior: string | null }>;
}

export interface GravetideSaveInspection {
  readonly ready: boolean;
  readonly lastLoad: string | null;
  readonly lastSave: string | null;
}

export interface GravetideLeakInspection {
  readonly activeListeners: number;
  readonly activeFeatures: number;
  readonly disposed: boolean;
}

export interface GravetideGame {
  readonly disposed: boolean;
  advance(seconds: number): number;
  present(timestampMs: number): boolean;
  start(): void;
  restart(): void;
  setMove(x: number, z: number): void;
  press(action: Action): void;
  loadScenario(id: Scenario): void;
  grantXp(amount: number): void;
  snapshot(): GravetideSnapshot;
  events(): readonly GravetideEvent[];
  errors(): readonly RuntimeErrorRecord[];
  debugSnapshot(): DebugSnapshot | null;
  inspectRuntime(): GravetideRuntimeInspection;
  inspectRenderer(): GravetideRendererInspection | null;
  inspectSave(): GravetideSaveInspection;
  inspectLeaks(): GravetideLeakInspection;
  subscribe(listener: (event: GravetideEvent) => void): () => void;
  dispose(): void;
}

export interface GravetideGameOptions {
  readonly renderer?: GravetideRenderer;
  readonly hudAdapter: HudAdapter;
  readonly saveAdapter: SaveAdapter;
  readonly seed?: number;
}

function rulesFeature(run: (tick: number) => void): ClientFeatureDescriptor<Readonly<Record<string, never>>> {
  let active = false;
  const contribution = Object.freeze({ kind: "system" as const, id: "gravetide.rules.step", domain: "client-simulation" as const, phase: "shared-predict" as const, priority: 50, run({ tick }: { readonly tick: number }): void { if (active) run(tick); } });
  return Object.freeze({
    id: "gravetide.rules",
    description: "Advances the deterministic survivor-run rules",
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

type Records = { bestSeconds: number; bestLevel: number; bestKills: number; runs: number };

function isRecords(data: SaveValue): data is Readonly<Records> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const record = data as Readonly<Record<string, SaveValue>>;
  return ["bestSeconds", "bestLevel", "bestKills", "runs"].every((key) => typeof record[key] === "number" && Number.isFinite(record[key] as number));
}

interface WeaponState { id: WeaponId; level: number; nextTick: number; cooldown: number; }
interface PassiveState { id: PassiveId; level: number; }

class Game implements GravetideGame {
  private readonly renderer: GravetideRenderer | null;
  private readonly seed: number;
  private rng: Rng;
  private readonly movement = createMovementInput();
  private readonly actions = createSemanticActionInput(ACTIONS);
  private readonly pressed = new Set<Action>();
  private readonly listeners = new Set<(event: GravetideEvent) => void>();
  private readonly collected: GravetideEvent[] = [];
  private tickEvents: GravetideEvent[] = [];
  private readonly errorRecords: RuntimeErrorRecord[] = [];
  private readonly telemetry = createTelemetryStore({ runtime: "client", observeRuntimeError: (record) => { if (this.errorRecords.length >= 64) this.errorRecords.shift(); this.errorRecords.push(record); } });
  private readonly frames = createDeterministicPresentationFrameSource();
  private readonly health = createHealthRuntime();
  private readonly flow = createGameFlowRuntime({
    initialState: "title",
    states: [
      { id: "title", allowedTo: ["running"] },
      { id: "running", allowedTo: ["levelup", "results", "victory"] },
      { id: "levelup", allowedTo: ["running", "results"] },
      { id: "results", allowedTo: ["running"] },
      { id: "victory", allowedTo: ["running"] },
    ],
  });
  private readonly hud = createHudStateStore({ screen: "title", health: TUNING.heroHp, maximumHealth: TUNING.heroHp, extras: {} });
  private readonly debug = createDebugDevToolsRuntime();
  private readonly ability = createAbilityRuntime([{ id: "grave-bell", cooldownTicks: BELL_COOLDOWN_TICKS, castTicks: BELL_CAST_TICKS }]);
  private readonly ai = createSimpleAiRuntime({ selectBehavior: (agent) => (agent.waypointCount > 0 ? "hunt" : "idle"), selectTarget: () => HERO_ID });
  private readonly triggers = createTriggerAreaRuntime(SHRINES.map((shrine) => ({ id: shrine.id, shape: "sphere" as const, center: { x: shrine.x, y: 0, z: shrine.z }, radius: 2.4 })));
  private readonly projectiles = createProjectileRuntime(
    [{ id: "bolt", speed: 17, lifetimeTicks: 90, radius: 0.3 }, { id: "knife", speed: 23, lifetimeTicks: 60, radius: 0.28 }],
    (projectile, next) => this.projectileHit(projectile, next),
  );
  private readonly prefabs;
  private readonly saveLoad: ReturnType<typeof createSaveLoadRuntime>;
  private readonly runtime: ClientRuntime;
  private readonly slots: EnemySlot[] = [];
  private readonly freeSlots: number[] = [];
  private readonly grid: number[][] = [];
  private readonly gems: Gem[] = [];
  private readonly axes: Axe[] = [];
  private readonly strikes: Strike[] = [];
  private readonly whips: WhipFlash[] = [];
  private readonly spawnCredits = new Map<EnemyKind, number>();
  private readonly shrineReadyTick = new Map<string, number>();
  private readonly nearby = new Set<string>();
  private readonly weapons: WeaponState[] = [];
  private readonly passives: PassiveState[] = [];
  private offers: OfferSnapshot[] = [];
  private pendingLevelUps = 0;
  private records: Records = { bestSeconds: 0, bestLevel: 0, bestKills: 0, runs: 0 };
  private phase: Phase = "title";
  private tick = 0;
  private elapsedTicks = 0;
  private hero: { x: number; z: number; facing: number; hp: number; maximumHp: number; level: number; xp: number; alive: boolean; moving: boolean; invulnerableUntil: number } = { x: 0, z: 0, facing: 0, hp: TUNING.heroHp, maximumHp: TUNING.heroHp, level: 1, xp: 0, alive: true, moving: false, invulnerableUntil: 0 };
  private move = { x: 0, z: 0 };
  private kills = 0;
  private damageDealt = 0;
  private waveIndex = 0;
  private eliteSpawned = false;
  private eliteRegistered = false;
  private result: "dawn" | "fallen" | null = null;
  private bellUses = 0;
  private bellRing = 0;
  private bellReadyTick = 0;
  private accumulator = 0;
  private presentationStarted = false;
  private lastTimestamp = -1;
  private isDisposed = false;
  private lastDebug: DebugSnapshot | null = null;
  private saveReady = false;
  private lastLoad: string | null = null;
  private lastSave: string | null = null;

  constructor(options: GravetideGameOptions) {
    this.renderer = options.renderer ?? null;
    this.seed = options.seed ?? DEFAULT_SEED;
    this.rng = createRng(this.seed);
    for (let index = 0; index < GRID_SIZE * GRID_SIZE; index += 1) this.grid.push([]);
    for (const kind of ENEMY_KINDS) this.spawnCredits.set(kind, 0);
    for (const shrine of SHRINES) this.shrineReadyTick.set(shrine.id, 0);
    this.health.register(HERO_ID, 1000, TUNING.heroHp);
    this.prefabs = createSpawnPrefabRuntime(
      ENEMY_KINDS.map((kind) => ({ id: kind, pooling: true, components: { hp: ENEMIES[kind].hp, speed: ENEMIES[kind].speed, damage: ENEMIES[kind].damage, xp: ENEMIES[kind].xp } })),
      {
        create: (instance) => this.allocateSlot(instance),
        reuse: (handle, instance) => this.initializeSlot(handle as number, instance),
        release: (handle, mode) => { const slot = this.slots[handle as number]; if (slot !== undefined) { slot.alive = false; slot.instanceId = null; if (mode === "destroy") this.freeSlots.push(slot.index); } },
      },
    );
    this.debug.registerProvider("run", () => ({ phase: this.phase, elapsed: this.elapsedTicks * DT, level: this.hero.level, kills: this.kills, alive: this.aliveCount() }));
    this.debug.registerProvider("hero", () => ({ x: this.hero.x, z: this.hero.z, hp: this.hero.hp, weapons: this.weapons.map((weapon) => `${weapon.id}:${weapon.level}`) }));
    this.saveLoad = createSaveLoadRuntime({
      currentVersion: SAVE_VERSION,
      adapter: options.saveAdapter,
      capture: () => ({ ...this.records }),
      validate: (data) => isRecords(data),
      restore: (data) => { if (!isRecords(data)) throw new TypeError("Gravetide records are invalid"); this.records = { bestSeconds: data.bestSeconds, bestLevel: data.bestLevel, bestKills: data.bestKills, runs: data.runs }; },
    });
    void this.saveLoad.load(SAVE_SLOT).then((outcome) => { this.lastLoad = outcome.ok ? "loaded" : outcome.code; this.saveReady = true; this.publishFrame(); });

    const features: ClientFeatureDescriptor<unknown>[] = [
      createInputFeature({
        input: this.movement,
        publish: (command) => { this.move = { x: command.x, z: command.z }; },
        actions: this.actions,
        publishAction: (action) => this.pressed.add(action as Action),
      }),
      rulesFeature((tick) => this.stepRules(tick)),
      createTriggerAreaClientFeature({
        runtime: this.triggers,
        readActors: () => [{ id: HERO_ID, position: { x: this.hero.x, y: 0, z: this.hero.z } }],
        publish: (events) => { for (const event of events) if (event.kind === "exit") this.nearby.delete(event.areaId); else this.nearby.add(event.areaId); },
      }),
      createHealthClientFeature({ runtime: this.health, publish: (events) => this.applyHealthEvents(events) }),
      createProjectileClientFeature(this.projectiles, (events) => {
        for (const event of events) if (event.kind === "hit" && event.targetId !== null) {
          const damage = Number(event.projectile.sourceId.split(":")[1] ?? 0);
          this.damageEnemyById(event.targetId, damage, event.projectile.definitionId === "bolt" ? 0x6fe3ff : 0xe9f5ff);
        }
      }),
      createAbilitySkillClientFeature(this.ability, (events) => {
        for (const event of events) {
          if (event.abilityId !== "grave-bell") continue;
          if (event.kind === "completed") this.ringBell();
          if (event.kind === "rejected") this.emit("bell-rejected", event.code ?? "unknown");
        }
      }),
      createSimpleAiNavigationClientFeature(this.ai, (agents) => {
        for (const agent of agents) {
          const slot = this.slots.find((candidate) => candidate.alive && candidate.kind === "elite");
          if (agent.id === "elite" && slot !== undefined) { slot.x = agent.position.x; slot.z = agent.position.z; }
        }
      }),
      createSpawnPrefabClientFeature(this.prefabs),
      createGameFlowClientFeature(this.flow),
      createSaveLoadClientFeature(this.saveLoad),
      createHudFeature({ store: this.hud, adapter: options.hudAdapter }),
      createDebugDevToolsClientFeature(this.debug, (value) => { this.lastDebug = value; }),
    ];
    if (this.renderer !== null) {
      const renderer = this.renderer;
      features.push(
        createCameraFeature({
          readTarget: () => ({ x: this.hero.x, y: 0, z: this.hero.z }),
          configuration: { distance: 11, height: 21, lookAtHeight: 0.4, yawRadians: 0 },
          publish: (transform) => renderer.setCameraTransform(transform),
        }),
        createParticleFeature({ emitters: renderer.emitters }),
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

  // --- Events -----------------------------------------------------------------------

  private emit(kind: string, subject?: string, value?: number): void {
    const event: GravetideEvent = Object.freeze({ kind, tick: this.tick, ...(subject === undefined ? {} : { subject }), ...(value === undefined ? {} : { value }) });
    if (this.collected.length >= 512) this.collected.shift();
    this.collected.push(event);
    this.tickEvents.push(event);
    for (const listener of this.listeners) listener(event);
  }

  private transition(phase: Phase, reason: string): boolean {
    const outcome = this.flow.transition(phase, { tick: this.tick, reason });
    if (!outcome.ok) return false;
    this.phase = phase;
    this.emit("phase-changed", phase);
    return true;
  }

  // --- Enemy pool -------------------------------------------------------------------

  private allocateSlot(instance: PrefabInstance): number {
    const index = this.freeSlots.pop() ?? this.slots.length;
    if (index === this.slots.length) this.slots.push({ index, healthId: `enemy-${index}`, instanceId: null, kind: "bat", x: 0, z: 0, vx: 0, vz: 0, hp: 0, maximumHp: 0, alive: false, flash: 0, bob: 0 });
    this.initializeSlot(index, instance);
    return index;
  }

  private initializeSlot(index: number, instance: PrefabInstance): void {
    const slot = this.slots[index]!;
    const kind = instance.prefabId as EnemyKind;
    const definition = ENEMIES[kind];
    const scale = 1 + (this.elapsedTicks * DT / 60) * TUNING.hpScalePerMinute;
    slot.instanceId = instance.id;
    slot.kind = kind;
    slot.hp = Math.round(definition.hp * (kind === "elite" ? 1 : scale));
    slot.maximumHp = slot.hp;
    slot.alive = true;
    slot.flash = 0;
    slot.vx = 0;
    slot.vz = 0;
    slot.bob = (index * 0.37) % (Math.PI * 2);
    if (this.health.get(slot.healthId) === undefined) this.health.register(slot.healthId, 1_000_000, slot.hp);
    else this.health.reset(slot.healthId, slot.hp);
  }

  private aliveCount(): number {
    let count = 0;
    for (const slot of this.slots) if (slot.alive) count += 1;
    return count;
  }

  private spawnEnemy(kind: EnemyKind, x: number, z: number): EnemySlot | null {
    if (this.aliveCount() >= MAX_ALIVE + (kind === "elite" ? 2 : 0)) return null;
    const instance = this.prefabs.spawn(kind);
    const slot = this.slots.find((candidate) => candidate.instanceId === instance.id);
    if (slot === undefined) return null;
    slot.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, x));
    slot.z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, z));
    if (kind === "elite") {
      if (!this.eliteRegistered) { this.ai.register("elite", { x: slot.x, y: 0, z: slot.z }, ENEMIES.elite.speed); this.eliteRegistered = true; }
      this.ai.setWaypoints("elite", [{ x: this.hero.x, y: 0, z: this.hero.z }]);
      this.emit("elite-spawned", instance.id);
    }
    return slot;
  }

  private killEnemy(slot: EnemySlot, cause: string): void {
    if (!slot.alive) return;
    const definition = ENEMIES[slot.kind];
    slot.alive = false;
    this.kills += 1;
    this.dropGem(slot.x, slot.z, definition.xp);
    this.renderer?.death(slot.x, slot.z, definition.color, slot.kind === "elite" ? 3 : slot.kind === "brute" ? 1.6 : 1);
    if (slot.instanceId !== null) this.prefabs.despawn(slot.instanceId);
    if (slot.kind === "elite") { this.ai.setWaypoints("elite", []); this.emit("elite-defeated", cause, this.kills); }
    this.emit("enemy-killed", slot.kind, this.kills);
  }

  // --- Spatial grid -----------------------------------------------------------------

  private cellIndex(x: number, z: number): number {
    const cx = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((x + ARENA_HALF + 4) / GRID_CELL)));
    const cz = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((z + ARENA_HALF + 4) / GRID_CELL)));
    return cz * GRID_SIZE + cx;
  }

  private rebuildGrid(): void {
    for (const cell of this.grid) cell.length = 0;
    for (const slot of this.slots) if (slot.alive) this.grid[this.cellIndex(slot.x, slot.z)]!.push(slot.index);
  }

  private forEachNear(x: number, z: number, radius: number, visit: (slot: EnemySlot) => void): void {
    const reach = Math.ceil(radius / GRID_CELL);
    const cx = Math.floor((x + ARENA_HALF + 4) / GRID_CELL);
    const cz = Math.floor((z + ARENA_HALF + 4) / GRID_CELL);
    for (let dz = -reach; dz <= reach; dz += 1) for (let dx = -reach; dx <= reach; dx += 1) {
      const gx = cx + dx;
      const gz = cz + dz;
      if (gx < 0 || gz < 0 || gx >= GRID_SIZE || gz >= GRID_SIZE) continue;
      for (const index of this.grid[gz * GRID_SIZE + gx]!) {
        const slot = this.slots[index]!;
        if (slot.alive && Math.hypot(slot.x - x, slot.z - z) <= radius + ENEMIES[slot.kind].radius) visit(slot);
      }
    }
  }

  private nearestEnemy(x: number, z: number, maximum: number): EnemySlot | null {
    let best: EnemySlot | null = null;
    let bestDistance = maximum;
    for (const slot of this.slots) {
      if (!slot.alive) continue;
      const distance = Math.hypot(slot.x - x, slot.z - z);
      if (distance < bestDistance) { bestDistance = distance; best = slot; }
    }
    return best;
  }

  // --- Damage -----------------------------------------------------------------------

  private damageEnemy(slot: EnemySlot, amount: number, color: number): void {
    if (!slot.alive || amount <= 0) return;
    this.health.requestDamage(slot.healthId, amount, { sourceId: HERO_ID });
    slot.flash = 1;
    this.damageDealt += amount;
    this.renderer?.hit(slot.x, slot.z, color);
  }

  private damageEnemyById(healthId: string, amount: number, color: number): void {
    const index = Number(healthId.slice("enemy-".length));
    const slot = this.slots[index];
    if (slot !== undefined) this.damageEnemy(slot, amount, color);
  }

  private projectileHit(_projectile: ProjectileState, next: { readonly x: number; readonly y: number; readonly z: number }): string | null {
    const found: { slot: EnemySlot | null; distance: number } = { slot: null, distance: Number.POSITIVE_INFINITY };
    this.forEachNear(next.x, next.z, 0.35, (slot) => {
      const distance = Math.hypot(slot.x - next.x, slot.z - next.z);
      if (distance < found.distance) { found.slot = slot; found.distance = distance; }
    });
    return found.slot === null ? null : found.slot.healthId;
  }

  private applyHealthEvents(events: readonly { readonly kind: string; readonly entityId: string; readonly after: number; readonly appliedAmount: number; readonly sourceId: string | null }[]): void {
    for (const event of events) {
      if (event.entityId === HERO_ID) {
        this.hero.hp = Math.min(this.hero.maximumHp, event.after);
        if (event.kind === "damaged") { this.emit("hero-damaged", event.sourceId ?? "contact", event.appliedAmount); this.renderer?.heroHit(this.hero.x, this.hero.z); }
        if (event.kind === "died" && this.phase === "running") this.fall();
        continue;
      }
      if (!event.entityId.startsWith("enemy-")) continue;
      const slot = this.slots[Number(event.entityId.slice("enemy-".length))];
      if (slot === undefined || !slot.alive) continue;
      slot.hp = event.after;
      if (event.kind === "died") this.killEnemy(slot, event.sourceId ?? "unknown");
    }
  }

  // --- Run lifecycle ----------------------------------------------------------------

  private resetRun(): void {
    for (const slot of this.slots) if (slot.alive && slot.instanceId !== null) { slot.alive = false; this.prefabs.despawn(slot.instanceId); }
    this.gems.length = 0;
    this.axes.length = 0;
    this.strikes.length = 0;
    this.whips.length = 0;
    this.nearby.clear();
    this.weapons.length = 0;
    this.passives.length = 0;
    this.offers = [];
    this.pendingLevelUps = 0;
    this.rng = createRng(this.seed);
    this.hero = { x: 0, z: 0, facing: 0, hp: TUNING.heroHp, maximumHp: TUNING.heroHp, level: 1, xp: 0, alive: true, moving: false, invulnerableUntil: 0 };
    this.health.reset(HERO_ID, TUNING.heroHp);
    this.elapsedTicks = 0;
    this.kills = 0;
    this.damageDealt = 0;
    this.waveIndex = 0;
    this.eliteSpawned = false;
    this.result = null;
    this.bellUses = 0;
    this.bellRing = 0;
    this.bellReadyTick = 0;
    for (const kind of ENEMY_KINDS) this.spawnCredits.set(kind, 0);
    for (const shrine of SHRINES) this.shrineReadyTick.set(shrine.id, 0);
    if (this.eliteRegistered) this.ai.setWaypoints("elite", []);
    this.addWeapon("whip");
    this.emit("run-started", HERO_ID, this.seed);
  }

  private beginRun(reason: string): void {
    if (!(this.phase === "title" || this.phase === "results" || this.phase === "victory")) return;
    this.resetRun();
    this.transition("running", reason);
  }

  private fall(): void {
    this.hero.alive = false;
    this.result = "fallen";
    this.recordRun();
    this.renderer?.death(this.hero.x, this.hero.z, 0xff6b81, 2.5);
    this.transition("results", "hero-fallen");
    this.emit("hero-fallen", HERO_ID, this.elapsedTicks * DT);
  }

  private dawn(): void {
    this.result = "dawn";
    this.recordRun();
    this.transition("victory", "dawn");
    this.emit("dawn", HERO_ID, this.kills);
  }

  private recordRun(): void {
    const seconds = Math.floor(this.elapsedTicks * DT);
    this.records = {
      bestSeconds: Math.max(this.records.bestSeconds, seconds),
      bestLevel: Math.max(this.records.bestLevel, this.hero.level),
      bestKills: Math.max(this.records.bestKills, this.kills),
      runs: this.records.runs + 1,
    };
    void this.saveLoad.save(SAVE_SLOT).then((outcome) => { this.lastSave = outcome.ok ? "saved" : outcome.code; this.emit(outcome.ok ? "records-saved" : "records-save-failed", SAVE_SLOT, this.records.runs); });
  }

  // --- Weapons and passives ---------------------------------------------------------

  private passiveLevel(id: PassiveId): number {
    return this.passives.find((passive) => passive.id === id)?.level ?? 0;
  }

  private areaScale(): number { return 1 + this.passiveLevel("lens") * 0.12; }
  private cooldownScale(): number { return Math.max(0.4, 1 - this.passiveLevel("clock") * 0.08); }
  private heroSpeed(): number { return TUNING.heroSpeed * (1 + this.passiveLevel("boots") * 0.08); }
  private pickupRadius(): number { return TUNING.gemPickupRadius + this.passiveLevel("magnet") * 0.9; }

  private weaponCooldown(weapon: WeaponState): number {
    const definition = weaponById(weapon.id);
    return Math.max(6, Math.round((definition.cooldownTicks - definition.cooldownStepTicks * (weapon.level - 1)) * this.cooldownScale()));
  }

  private weaponDamage(weapon: WeaponState): number {
    const definition = weaponById(weapon.id);
    return definition.damage + definition.damageStep * (weapon.level - 1);
  }

  private addWeapon(id: WeaponId): void {
    const existing = this.weapons.find((weapon) => weapon.id === id);
    if (existing !== undefined) { existing.level = Math.min(MAX_LEVEL, existing.level + 1); existing.cooldown = this.weaponCooldown(existing); this.emit("weapon-upgraded", id, existing.level); return; }
    const weapon: WeaponState = { id, level: 1, nextTick: this.tick + 20, cooldown: 0 };
    weapon.cooldown = this.weaponCooldown(weapon);
    this.weapons.push(weapon);
    this.emit("weapon-added", id, 1);
  }

  private addPassive(id: PassiveId): void {
    const existing = this.passives.find((passive) => passive.id === id);
    if (existing !== undefined) existing.level = Math.min(MAX_LEVEL, existing.level + 1); else this.passives.push({ id, level: 1 });
    if (id === "heart") { this.hero.maximumHp += 20; this.heal(20); }
    for (const weapon of this.weapons) weapon.cooldown = this.weaponCooldown(weapon);
    this.emit("passive-added", id, this.passiveLevel(id));
  }

  private heal(amount: number): void {
    const missing = this.hero.maximumHp - this.hero.hp;
    if (missing <= 0 || amount <= 0) return;
    this.health.requestHealing(HERO_ID, Math.min(missing, amount), "heal");
  }

  private rollOffers(): OfferSnapshot[] {
    const pool: OfferSnapshot[] = [];
    for (const definition of WEAPONS) {
      const owned = this.weapons.find((weapon) => weapon.id === definition.id);
      if (owned !== undefined && owned.level < MAX_LEVEL) pool.push({ kind: "weapon", id: definition.id, level: owned.level + 1, title: definition.name, description: definition.description, color: definition.color });
      else if (owned === undefined && this.weapons.length < MAX_WEAPONS) pool.push({ kind: "weapon", id: definition.id, level: 1, title: definition.name, description: definition.description, color: definition.color });
    }
    for (const definition of PASSIVES) {
      const owned = this.passives.find((passive) => passive.id === definition.id);
      if (owned !== undefined && owned.level < MAX_LEVEL) pool.push({ kind: "passive", id: definition.id, level: owned.level + 1, title: definition.name, description: definition.description, color: definition.color });
      else if (owned === undefined && this.passives.length < MAX_PASSIVES) pool.push({ kind: "passive", id: definition.id, level: 1, title: definition.name, description: definition.description, color: definition.color });
    }
    const chosen: OfferSnapshot[] = [];
    while (chosen.length < 3 && pool.length > 0) chosen.push(Object.freeze(pool.splice(this.rng.int(pool.length), 1)[0]!));
    if (chosen.length === 0) chosen.push(Object.freeze({ kind: "heal", id: "heal", level: 0, title: "Grave Bread", description: "Nothing left to learn. Restore 40 HP.", color: 0xffd166 }));
    return chosen;
  }

  private applyOffer(offer: OfferSnapshot): void {
    if (offer.kind === "weapon") this.addWeapon(offer.id as WeaponId);
    else if (offer.kind === "passive") this.addPassive(offer.id as PassiveId);
    else this.heal(40);
    this.emit("offer-chosen", `${offer.kind}:${offer.id}`, offer.level);
  }

  private gainXp(amount: number): void {
    this.hero.xp += amount;
    while (this.hero.xp >= xpToNext(this.hero.level)) {
      this.hero.xp -= xpToNext(this.hero.level);
      this.hero.level += 1;
      this.pendingLevelUps += 1;
      this.heal(TUNING.levelHeal);
      this.renderer?.levelUp(this.hero.x, this.hero.z);
      this.emit("level-up", HERO_ID, this.hero.level);
    }
  }

  private dropGem(x: number, z: number, value: number): void {
    if (this.gems.length >= MAX_GEMS) { const gem = this.gems[this.rng.int(this.gems.length)]!; gem.value += value; return; }
    this.gems.push({ x: x + this.rng.range(-0.3, 0.3), z: z + this.rng.range(-0.3, 0.3), value, attracted: false });
  }

  private ringBell(): void {
    this.bellRing = 1;
    this.bellUses += 1;
    let hits = 0;
    this.forEachNear(this.hero.x, this.hero.z, BELL_RADIUS, (slot) => {
      hits += 1;
      const dx = slot.x - this.hero.x;
      const dz = slot.z - this.hero.z;
      const length = Math.hypot(dx, dz) || 1;
      slot.vx += (dx / length) * 18;
      slot.vz += (dz / length) * 18;
      this.damageEnemy(slot, 20 + this.hero.level * 2, 0xffd166);
    });
    this.renderer?.bell(this.hero.x, this.hero.z);
    this.emit("bell-rung", HERO_ID, hits);
  }

  // --- Simulation -------------------------------------------------------------------

  private stepRules(tick: number): void {
    this.tick = tick;
    this.tickEvents = [];
    if (this.phase === "title" && this.pressed.has("start")) this.beginRun("start");
    else if ((this.phase === "results" || this.phase === "victory") && (this.pressed.has("restart") || this.pressed.has("start"))) this.beginRun("restart");
    else if (this.phase === "levelup") {
      const choice = this.pressed.has("choose-1") ? 0 : this.pressed.has("choose-2") ? 1 : this.pressed.has("choose-3") ? 2 : -1;
      const offer = this.offers[choice];
      if (offer !== undefined) {
        this.applyOffer(offer);
        this.pendingLevelUps -= 1;
        if (this.pendingLevelUps > 0) this.offers = this.rollOffers();
        else { this.offers = []; this.transition("running", "offer-chosen"); }
      }
    }
    if (this.phase === "running") this.stepRun(tick);
    this.pressed.clear();
    this.bellRing = Math.max(0, this.bellRing - 0.06);
    this.publishFrame();
  }

  private stepRun(tick: number): void {
    this.elapsedTicks += 1;
    const seconds = this.elapsedTicks * DT;
    const hero = this.hero;

    // Hero movement and facing.
    const magnitude = Math.hypot(this.move.x, this.move.z);
    hero.moving = magnitude > 0.05;
    if (hero.moving) {
      const speed = this.heroSpeed();
      hero.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, hero.x + this.move.x * speed * DT));
      hero.z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, hero.z + this.move.z * speed * DT));
      hero.facing = Math.atan2(this.move.x, this.move.z);
    }
    hero.invulnerableUntil = this.health.get(HERO_ID)?.invulnerableUntilTick ?? 0;
    if (this.pressed.has("bell") && tick >= this.bellReadyTick) { this.ability.request(HERO_ID, "grave-bell", tick); this.bellReadyTick = tick + BELL_COOLDOWN_TICKS; this.emit("bell-requested", HERO_ID); }

    // Waves and spawning.
    while (this.waveIndex + 1 < WAVES.length && seconds >= WAVES[this.waveIndex + 1]!.fromSeconds) { this.waveIndex += 1; this.emit("wave-started", `wave-${this.waveIndex + 1}`, this.waveIndex); }
    const wave = WAVES[this.waveIndex]!;
    const pressure = 1 + seconds / 240;
    for (const spawn of wave.spawns) {
      const credit = (this.spawnCredits.get(spawn.kind) ?? 0) + spawn.perSecond * pressure * DT;
      let remaining = credit;
      while (remaining >= 1) {
        remaining -= 1;
        const angle = this.rng.range(0, Math.PI * 2);
        const distance = this.rng.range(SPAWN_RING_MIN, SPAWN_RING_MAX);
        if (this.spawnEnemy(spawn.kind, hero.x + Math.cos(angle) * distance, hero.z + Math.sin(angle) * distance) === null) break;
      }
      this.spawnCredits.set(spawn.kind, remaining);
    }
    if (!this.eliteSpawned && seconds >= ELITE_SECONDS) { this.eliteSpawned = true; const angle = this.rng.range(0, Math.PI * 2); this.spawnEnemy("elite", hero.x + Math.cos(angle) * 24, hero.z + Math.sin(angle) * 24); }

    // Enemy steering with separation.
    this.rebuildGrid();
    let contactDamage = 0;
    let nearest = Number.POSITIVE_INFINITY;
    for (const slot of this.slots) {
      if (!slot.alive) continue;
      const definition = ENEMIES[slot.kind];
      const dx = hero.x - slot.x;
      const dz = hero.z - slot.z;
      const distance = Math.hypot(dx, dz) || 1e-6;
      nearest = Math.min(nearest, distance);
      if (slot.kind === "elite") {
        if (tick % 10 === 0) this.ai.setWaypoints("elite", [{ x: hero.x, y: 0, z: hero.z }]);
      } else {
        let sx = (dx / distance) * definition.speed;
        let sz = (dz / distance) * definition.speed;
        this.forEachNear(slot.x, slot.z, 0.2, (other) => {
          if (other === slot) return;
          const ox = slot.x - other.x;
          const oz = slot.z - other.z;
          const separation = Math.hypot(ox, oz) || 1e-6;
          const minimum = definition.radius + ENEMIES[other.kind].radius;
          if (separation < minimum) { sx += (ox / separation) * TUNING.separation * definition.speed * (1 - separation / minimum); sz += (oz / separation) * TUNING.separation * definition.speed * (1 - separation / minimum); }
        });
        slot.vx = slot.vx * 0.82 + sx * 0.18;
        slot.vz = slot.vz * 0.82 + sz * 0.18;
        slot.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, slot.x + slot.vx * DT));
        slot.z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, slot.z + slot.vz * DT));
      }
      slot.flash = Math.max(0, slot.flash - 0.12);
      slot.bob += DT * (slot.kind === "bat" ? 9 : 3);
      if (distance <= definition.radius + TUNING.heroRadius) contactDamage = Math.max(contactDamage, definition.damage);
    }
    if (contactDamage > 0 && tick >= hero.invulnerableUntil) {
      const damage = Math.max(1, contactDamage - this.passiveLevel("armor") * 2);
      this.health.requestDamage(HERO_ID, damage, { sourceId: "contact", invulnerabilityTicks: TUNING.contactInvulnerabilityTicks });
    }

    // Weapons.
    for (const weapon of this.weapons) {
      if (tick < weapon.nextTick) continue;
      weapon.nextTick = tick + weapon.cooldown;
      this.fireWeapon(weapon, tick);
    }
    this.stepAxes();
    for (const strike of this.strikes) strike.ticks -= 1;
    while (this.strikes.length > 0 && this.strikes[0]!.ticks <= 0) this.strikes.shift();
    for (const whip of this.whips) whip.ticks -= 1;
    while (this.whips.length > 0 && this.whips[0]!.ticks <= 0) this.whips.shift();

    // Gems.
    const pickup = this.pickupRadius();
    for (let index = this.gems.length - 1; index >= 0; index -= 1) {
      const gem = this.gems[index]!;
      const dx = hero.x - gem.x;
      const dz = hero.z - gem.z;
      const distance = Math.hypot(dx, dz) || 1e-6;
      if (!gem.attracted && distance <= pickup) gem.attracted = true;
      if (gem.attracted) {
        const step = Math.min(distance, TUNING.gemPullSpeed * DT * (1 + (pickup - Math.min(pickup, distance)) * 0.4));
        gem.x += (dx / distance) * step;
        gem.z += (dz / distance) * step;
        if (distance <= TUNING.gemCollectRadius) {
          this.gems.splice(index, 1);
          this.renderer?.pickup(hero.x, hero.z);
          this.gainXp(gem.value);
          this.emit("gem-collected", HERO_ID, gem.value);
        }
      }
    }

    // Shrines.
    for (const shrine of SHRINES) {
      if (!this.nearby.has(shrine.id) || tick < (this.shrineReadyTick.get(shrine.id) ?? 0) || hero.hp >= hero.maximumHp) continue;
      this.shrineReadyTick.set(shrine.id, tick + TUNING.shrineCooldownTicks);
      this.heal(TUNING.shrineHeal);
      this.renderer?.levelUp(shrine.x, shrine.z);
      this.emit("shrine-used", shrine.id, TUNING.shrineHeal);
    }

    // Level-up interrupt and dawn.
    if (this.pendingLevelUps > 0 && this.phase === "running") {
      this.offers = this.rollOffers();
      this.transition("levelup", "level-up");
    }
    if (seconds >= RUN_SECONDS && this.phase === "running") this.dawn();
  }

  private fireWeapon(weapon: WeaponState, tick: number): void {
    const hero = this.hero;
    const damage = this.weaponDamage(weapon);
    const area = this.areaScale();
    const facingX = Math.sin(hero.facing);
    const facingZ = Math.cos(hero.facing);
    switch (weapon.id) {
      case "whip": {
        const length = (4.2 + weapon.level * 0.4) * area;
        const width = (2.4 + weapon.level * 0.2) * area;
        const behind = weapon.level >= 4;
        for (const sign of behind ? [1, -1] : [1]) {
          let hits = 0;
          this.forEachNear(hero.x + facingX * sign * length * 0.5, hero.z + facingZ * sign * length * 0.5, Math.max(length, width) * 0.6, (slot) => {
            const rx = slot.x - hero.x;
            const rz = slot.z - hero.z;
            const along = (rx * facingX + rz * facingZ) * sign;
            const across = Math.abs(rx * facingZ - rz * facingX);
            if (along > -0.4 && along <= length && across <= width / 2) { this.damageEnemy(slot, damage, weaponById("whip").color); hits += 1; }
          });
          this.whips.push({ x: hero.x, z: hero.z, facing: sign === 1 ? hero.facing : hero.facing + Math.PI, ticks: 9, length, width, behind: sign === -1 });
          if (hits > 0) this.emit("whip-hit", HERO_ID, hits);
        }
        return;
      }
      case "wand": {
        const bolts = weapon.level >= 5 ? 3 : weapon.level >= 3 ? 2 : 1;
        for (let bolt = 0; bolt < bolts; bolt += 1) {
          const target = this.nearestEnemy(hero.x, hero.z, 18 + bolt * 4);
          const direction = target === null ? { x: facingX, y: 0, z: facingZ } : { x: target.x - hero.x, y: 0, z: target.z - hero.z };
          const spread = (bolt - (bolts - 1) / 2) * 0.18;
          const cos = Math.cos(spread);
          const sin = Math.sin(spread);
          this.projectiles.fire("bolt", `${HERO_ID}:${damage}`, { x: hero.x, y: 0.9, z: hero.z }, { x: direction.x * cos - direction.z * sin, y: 0, z: direction.x * sin + direction.z * cos }, tick);
        }
        return;
      }
      case "knife": {
        const knives = weapon.level >= 4 ? 3 : weapon.level >= 2 ? 2 : 1;
        for (let knife = 0; knife < knives; knife += 1) {
          const offset = (knife - (knives - 1) / 2) * 0.45;
          this.projectiles.fire("knife", `${HERO_ID}:${damage}`, { x: hero.x + facingZ * offset, y: 0.8, z: hero.z - facingX * offset }, { x: facingX, y: 0, z: facingZ }, tick);
        }
        return;
      }
      case "axe": {
        const count = weapon.level >= 5 ? 3 : weapon.level >= 3 ? 2 : 1;
        for (let axe = 0; axe < count; axe += 1) {
          const angle = hero.facing + (axe - (count - 1) / 2) * 0.55 + this.rng.range(-0.15, 0.15);
          this.axes.push({ x: hero.x, z: hero.z, vx: Math.sin(angle) * 10, vz: Math.cos(angle) * 10, ticks: 95, spin: 0, damage, hit: new Set() });
        }
        return;
      }
      case "aura": {
        const radius = (2.1 + weapon.level * 0.35) * area;
        let hits = 0;
        this.forEachNear(hero.x, hero.z, radius, (slot) => { this.damageEnemy(slot, damage, weaponById("aura").color); hits += 1; });
        if (hits > 0) this.emit("aura-hit", HERO_ID, hits);
        return;
      }
      case "lightning": {
        const bolts = weapon.level;
        const candidates = this.slots.filter((slot) => slot.alive && Math.hypot(slot.x - hero.x, slot.z - hero.z) <= 14 * area);
        for (let bolt = 0; bolt < bolts && candidates.length > 0; bolt += 1) {
          const target = candidates.splice(this.rng.int(candidates.length), 1)[0]!;
          this.strikes.push({ x: target.x, z: target.z, ticks: 12 });
          this.forEachNear(target.x, target.z, 1.5 * area, (slot) => this.damageEnemy(slot, damage, weaponById("lightning").color));
          this.renderer?.strike(target.x, target.z);
        }
        if (candidates.length >= 0 && bolts > 0) this.emit("lightning", HERO_ID, Math.min(bolts, this.strikes.length));
        return;
      }
    }
  }

  private stepAxes(): void {
    for (let index = this.axes.length - 1; index >= 0; index -= 1) {
      const axe = this.axes[index]!;
      axe.ticks -= 1;
      axe.x += axe.vx * DT;
      axe.z += axe.vz * DT;
      axe.spin += 0.35;
      this.forEachNear(axe.x, axe.z, 0.7 * this.areaScale(), (slot) => {
        if (axe.hit.has(slot.index)) return;
        axe.hit.add(slot.index);
        this.damageEnemy(slot, axe.damage, weaponById("axe").color);
      });
      if (axe.ticks <= 0 || Math.abs(axe.x) > ARENA_HALF + 2 || Math.abs(axe.z) > ARENA_HALF + 2) this.axes.splice(index, 1);
    }
  }

  // --- HUD ---------------------------------------------------------------------------

  private hudExtras(): Record<string, string | number | boolean> {
    const hero = this.hero;
    const seconds = this.elapsedTicks * DT;
    const elite = this.slots.find((slot) => slot.alive && slot.kind === "elite");
    const extras: Record<string, string | number | boolean> = {
      time: formatTime(RUN_SECONDS - seconds),
      elapsed: formatTime(seconds),
      level: hero.level,
      xpRatio: hero.xp / xpToNext(hero.level),
      hpRatio: hero.hp / hero.maximumHp,
      hpLabel: `${Math.max(0, Math.round(hero.hp))} / ${hero.maximumHp}`,
      kills: this.kills,
      wave: `WAVE ${this.waveIndex + 1}`,
      alive: this.aliveCount(),
      weapons: this.weapons.map((weapon) => `${weaponById(weapon.id).name} ${"I".repeat(Math.min(3, weapon.level))}${weapon.level > 3 ? `+${weapon.level - 3}` : ""}`).join(" · "),
      passives: this.passives.map((passive) => `${passiveById(passive.id).name} ${passive.level}`).join(" · "),
      elite: elite === undefined ? "" : ENEMIES.elite.name,
      eliteRatio: elite === undefined ? 0 : elite.hp / elite.maximumHp,
      bell: this.tick >= this.bellReadyTick ? "READY" : `${Math.ceil((this.bellReadyTick - this.tick) * DT)}s`,
      bellReady: this.tick >= this.bellReadyTick,
      result: this.result === "dawn" ? "YOU SAW THE DAWN" : this.result === "fallen" ? "THE GRAVE TOOK YOU" : "",
      resultTime: formatTime(seconds),
      resultLevel: hero.level,
      resultKills: this.kills,
      resultDamage: Math.round(this.damageDealt),
      bestTime: formatTime(this.records.bestSeconds),
      bestLevel: this.records.bestLevel,
      bestKills: this.records.bestKills,
      runs: this.records.runs,
      shrine: SHRINES.some((shrine) => this.nearby.has(shrine.id) && this.tick >= (this.shrineReadyTick.get(shrine.id) ?? 0)) ? (hero.hp >= hero.maximumHp ? "SHRINE · FULL HEALTH" : "SHRINE · HEALING") : "",
      seed: this.seed,
    };
    for (let index = 0; index < 3; index += 1) {
      const offer = this.offers[index];
      extras[`card${index}Title`] = offer?.title ?? "";
      extras[`card${index}Level`] = offer === undefined ? "" : offer.kind === "heal" ? "" : offer.level === 1 ? "NEW" : `LEVEL ${offer.level}`;
      extras[`card${index}Kind`] = offer?.kind ?? "";
      extras[`card${index}Description`] = offer?.description ?? "";
      extras[`card${index}Color`] = offer === undefined ? 0 : offer.color;
    }
    return extras;
  }

  private renderFrame(): RenderFrame {
    const aura = this.weapons.find((weapon) => weapon.id === "aura");
    return {
      enemies: this.slots,
      gems: this.gems,
      projectiles: this.projectiles.disposed ? [] : this.projectiles.inspect().projectiles,
      axes: this.axes,
      strikes: this.strikes,
      whips: this.whips,
      auraRadius: aura === undefined ? 0 : (2.1 + aura.level * 0.35) * this.areaScale(),
      auraLevel: aura?.level ?? 0,
      bellRing: this.bellRing,
    };
  }

  private publishFrame(): void {
    this.hud.update({ screen: this.phase, score: this.kills, timerSeconds: this.elapsedTicks * DT, health: Math.max(0, this.hero.hp), maximumHealth: this.hero.maximumHp, extras: this.hudExtras() });
    this.renderer?.prepare(this.snapshot(), this.renderFrame(), Object.freeze([...this.tickEvents]));
  }

  // --- Public API --------------------------------------------------------------------

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
  restart(): void { if (!this.isDisposed) this.actions.press("restart"); }

  setMove(x: number, z: number): void {
    if (this.isDisposed) return;
    const cx = clampUnit(x);
    const cz = clampUnit(z);
    const magnitude = Math.hypot(cx, cz);
    const scale = magnitude > 1 ? (1 - 1e-6) / magnitude : 1;
    this.movement.setMovement(cx * scale, cz * scale);
  }

  press(action: Action): void { if (!this.isDisposed && ACTIONS.includes(action)) this.actions.press(action); }

  grantXp(amount: number): void {
    if (this.isDisposed || !Number.isFinite(amount) || amount <= 0 || this.phase !== "running") return;
    this.gainXp(Math.floor(amount));
    this.emit("xp-granted", HERO_ID, amount);
  }

  loadScenario(id: Scenario): void {
    if (this.isDisposed) return;
    if (this.phase === "title" || this.phase === "results" || this.phase === "victory") this.beginRun("qa-scenario");
    if (this.phase === "levelup") { this.offers = []; this.pendingLevelUps = 0; this.transition("running", "qa-scenario"); }
    switch (id) {
      case "start": break;
      case "swarm": {
        for (let index = 0; index < 40; index += 1) {
          const angle = (index / 40) * Math.PI * 2;
          this.spawnEnemy(index % 5 === 0 ? "ghoul" : "bat", this.hero.x + Math.cos(angle) * (5 + (index % 3)), this.hero.z + Math.sin(angle) * (5 + (index % 3)));
        }
        break;
      }
      case "levelup": this.gainXp(xpToNext(this.hero.level)); break;
      case "elite": this.eliteSpawned = true; this.spawnEnemy("elite", this.hero.x + 9, this.hero.z); break;
      case "dawn": this.elapsedTicks = (RUN_SECONDS - 2) * 60; break;
      case "shrine": { const shrine = SHRINES[0]!; this.hero.x = shrine.x; this.hero.z = shrine.z; break; }
    }
    this.publishFrame();
    this.emit("scenario-loaded", id);
  }

  snapshot(): GravetideSnapshot {
    const hero = this.hero;
    const byKind: Record<EnemyKind, number> = { bat: 0, ghoul: 0, brute: 0, wraith: 0, elite: 0 };
    let alive = 0;
    let nearest = Number.POSITIVE_INFINITY;
    const sample: EnemySnapshot[] = [];
    for (const slot of this.slots) {
      if (!slot.alive) continue;
      alive += 1;
      byKind[slot.kind] += 1;
      nearest = Math.min(nearest, Math.hypot(slot.x - hero.x, slot.z - hero.z));
      if (sample.length < 8) sample.push(Object.freeze({ id: slot.instanceId ?? slot.healthId, kind: slot.kind, x: slot.x, z: slot.z, hp: slot.hp, maximumHp: slot.maximumHp }));
    }
    return Object.freeze({
      tick: this.tick,
      time: this.tick * DT,
      phase: this.phase,
      seed: this.seed,
      elapsedSeconds: this.elapsedTicks * DT,
      remainingSeconds: Math.max(0, RUN_SECONDS - this.elapsedTicks * DT),
      hero: Object.freeze({ x: hero.x, z: hero.z, facing: hero.facing, hp: hero.hp, maximumHp: hero.maximumHp, level: hero.level, xp: hero.xp, xpToNext: xpToNext(hero.level), speed: this.heroSpeed(), alive: hero.alive, moving: hero.moving, invulnerableTicks: Math.max(0, hero.invulnerableUntil - this.tick) }),
      weapons: Object.freeze(this.weapons.map((weapon) => Object.freeze({ id: weapon.id, level: weapon.level, cooldownRatio: Math.max(0, Math.min(1, 1 - (weapon.nextTick - this.tick) / Math.max(1, weapon.cooldown))) }))),
      passives: Object.freeze(this.passives.map((passive) => Object.freeze({ id: passive.id, level: passive.level }))),
      offers: Object.freeze([...this.offers]),
      pendingLevelUps: this.pendingLevelUps,
      enemies: Object.freeze({ alive, byKind: Object.freeze(byKind), nearestDistance: alive === 0 ? Number.POSITIVE_INFINITY : nearest, eliteAlive: byKind.elite > 0, sample: Object.freeze(sample) }),
      gems: Object.freeze({ count: this.gems.length, attracted: this.gems.filter((gem) => gem.attracted).length }),
      projectiles: this.projectiles.disposed ? 0 : this.projectiles.inspect().projectiles.length,
      axes: this.axes.length,
      kills: this.kills,
      damageDealt: Math.round(this.damageDealt),
      waveIndex: this.waveIndex,
      shrines: Object.freeze(SHRINES.map((shrine) => Object.freeze({ id: shrine.id, x: shrine.x, z: shrine.z, readyInSeconds: Math.max(0, ((this.shrineReadyTick.get(shrine.id) ?? 0) - this.tick) * DT) }))),
      bell: Object.freeze({ readyInSeconds: Math.max(0, (this.bellReadyTick - this.tick) * DT), casting: !this.ability.disposed && this.ability.inspect().casting.length > 0, uses: this.bellUses }),
      records: Object.freeze({ ...this.records }),
      result: this.result,
    });
  }

  events(): readonly GravetideEvent[] { return Object.freeze([...this.collected]); }
  errors(): readonly RuntimeErrorRecord[] { return Object.freeze([...this.errorRecords]); }
  debugSnapshot(): DebugSnapshot | null { return this.lastDebug; }
  inspectRuntime(): GravetideRuntimeInspection {
    const life = this.runtime.inspectLifecycle();
    const prefab = this.prefabs.disposed ? { activeInstances: [], pooledCounts: {} } : this.prefabs.inspect();
    const health = this.health.disposed ? { entities: [], ignoredRequestCount: 0 } : this.health.inspect();
    const ai = this.ai.disposed ? { agents: [] } : this.ai.inspect();
    return Object.freeze({
      lifecycleState: life.state,
      installedFeatureIds: Object.freeze([...life.installedFeatureIds]),
      scheduleSystemIds: Object.freeze(life.scheduleReport.map(({ systemId }) => systemId)),
      schedulerTick: this.runtime.tick,
      debugProviders: this.debug.disposed ? Object.freeze([]) : this.debug.inspect().providerIds,
      prefab: Object.freeze({ active: prefab.activeInstances.length, pooled: Object.freeze({ ...prefab.pooledCounts }) }),
      health: Object.freeze({ entities: health.entities.length, ignoredRequests: health.ignoredRequestCount }),
      ai: Object.freeze({ agents: ai.agents.length, eliteBehavior: ai.agents.find((agent) => agent.id === "elite")?.behavior ?? null }),
    });
  }
  inspectRenderer(): GravetideRendererInspection | null { return this.renderer?.inspect() ?? null; }
  inspectSave(): GravetideSaveInspection { return Object.freeze({ ready: this.saveReady, lastLoad: this.lastLoad, lastSave: this.lastSave }); }
  inspectLeaks(): GravetideLeakInspection {
    return Object.freeze({ activeListeners: this.listeners.size, activeFeatures: this.isDisposed ? 0 : this.runtime.inspectLifecycle().installedFeatureIds.length, disposed: this.isDisposed });
  }
  subscribe(listener: (event: GravetideEvent) => void): () => void {
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

export function createGravetideGame(options: GravetideGameOptions): GravetideGame {
  return new Game(options);
}
