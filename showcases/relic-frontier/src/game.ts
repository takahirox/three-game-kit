import { Runtime as ClientRuntime } from "@three-game-kit/client";
import { createAssetManager, createAssetManagerFeature, type AssetManagerInspection } from "@three-game-kit/client/asset-manager";
import { createAudioFeature, type AudioInspection, type AudioRuntime } from "@three-game-kit/client/audio";
import { createCameraFeature } from "@three-game-kit/client/camera";
import { createCharacterController, createCharacterControllerFeature } from "@three-game-kit/client/character-controller";
import { createRapierCollisionAdapter } from "@three-game-kit/client/collision";
import {
  createGameFlowClientFeature,
  createHealthClientFeature,
  createHudFeature,
  createTriggerAreaClientFeature,
  type HudAdapter,
} from "@three-game-kit/client/gameplay";
import {
  createAbilitySkillClientFeature,
  createInventoryClientFeature,
  createProjectileClientFeature,
  createSimpleAiNavigationClientFeature,
} from "@three-game-kit/client/genre";
import { createInputFeature, createMovementInput, createSemanticActionInput } from "@three-game-kit/client/input";
import { createRenderingFeature } from "@three-game-kit/client/rendering";
import { createVfxFeature } from "@three-game-kit/client/vfx";
import { createDebugDevToolsClientFeature } from "@three-game-kit/client/advanced";
import {
  createDeterministicPresentationFrameSource,
  createTelemetryStore,
  defineFeatureConfiguration,
  type ClientFeatureDescriptor,
  type ClientFeatureSetupContext,
  type RuntimeErrorRecord,
} from "@three-game-kit/core";
import { createDebugDevToolsRuntime, type DebugSnapshot } from "@three-game-kit/shared/advanced";
import { createGameFlowRuntime, createHealthRuntime, createHudStateStore, createTriggerAreaRuntime } from "@three-game-kit/shared/gameplay";
import { createAbilityRuntime, createInventoryRuntime, createProjectileRuntime, createSimpleAiRuntime } from "@three-game-kit/shared/genre";
import type { RelicFrontierRenderer, RelicRendererInspection } from "./renderer.js";
import {
  DT,
  PLAYER_ID,
  PLAYER_SPAWN,
  createRelicState,
  distanceXZ,
  snapshotOf,
  vec3,
  type MutableRelicState,
  type RelicAction,
  type RelicEvent,
  type RelicSnapshot,
  type SemanticInput,
} from "./state.js";

const MAX_STEPS = 1_200;
const ACTIONS: readonly RelicAction[] = Object.freeze(["jump", "dash", "attack", "ability", "interact", "use-item"]);
const EMPTY = defineFeatureConfiguration<Readonly<Record<string, never>>>({
  defaultValue: () => Object.freeze({}),
  parse(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) && Reflect.ownKeys(value).length === 0
      ? { ok: true as const, value: Object.freeze({}) }
      : { ok: false as const, issues: [{ path: [], code: "empty-object-required" }] };
  },
});

export interface RelicRuntimeInspection {
  readonly lifecycleState: string;
  readonly installedFeatureIds: readonly string[];
  readonly scheduleSystemIds: readonly string[];
  readonly schedulerTick: number;
  readonly debugProviders: readonly string[];
}

export interface RelicLeakInspection {
  readonly activeListeners: number;
  readonly activeFeatures: number;
  readonly activeTimers: number;
  readonly disposed: boolean;
}

export interface RelicFrontierGame {
  readonly disposed: boolean;
  advance(seconds: number): number;
  present(timestampMs: number): boolean;
  start(): void;
  setInput(input: Partial<SemanticInput>): void;
  press(action: RelicAction): void;
  loadScenario(id: "fresh" | "guardian" | "escape"): void;
  setDebugCamera(enabled: boolean): void;
  snapshot(): RelicSnapshot;
  events(): readonly RelicEvent[];
  errors(): readonly RuntimeErrorRecord[];
  debugSnapshot(): DebugSnapshot | null;
  inspectAssets(): Readonly<{ ready: boolean; successful: boolean; failureCode: string | null; manager: AssetManagerInspection }>;
  inspectAudio(): AudioInspection;
  inspectRuntime(): RelicRuntimeInspection;
  inspectRenderer(): RelicRendererInspection | null;
  inspectLeaks(): RelicLeakInspection;
  subscribe(listener: (event: RelicEvent) => void): () => void;
  dispose(): void;
}

export interface RelicFrontierGameOptions {
  readonly renderer?: RelicFrontierRenderer;
  readonly hudAdapter: HudAdapter;
  readonly audio: AudioRuntime;
}

function gameFeature(id: string, priority: number, run: (tick: number) => void): ClientFeatureDescriptor<Readonly<Record<string, never>>> {
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
    description: `Relic Frontier game-specific rule: ${id}`,
    runtimeContributions: Object.freeze([contribution]),
    requires: Object.freeze([]),
    conflicts: Object.freeze([]),
    configuration: EMPTY,
    setup({ ledger }: ClientFeatureSetupContext<Readonly<Record<string, never>>>): void { active = true; ledger.activateSystem(contribution.id); },
    dispose(): void { active = false; },
  });
}

function clampAxis(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

class Game implements RelicFrontierGame {
  private state: MutableRelicState = createRelicState();
  private readonly renderer: RelicFrontierRenderer | null;
  private readonly movement = createMovementInput();
  private readonly actions = createSemanticActionInput(ACTIONS);
  private readonly pressed = new Set<RelicAction>();
  private readonly listeners = new Set<(event: RelicEvent) => void>();
  private readonly collected: RelicEvent[] = [];
  private readonly errorRecords: RuntimeErrorRecord[] = [];
  private readonly telemetry = createTelemetryStore({
    runtime: "client",
    observeRuntimeError: (record) => {
      if (this.errorRecords.length >= 64) this.errorRecords.shift();
      this.errorRecords.push(record);
    },
  });
  private readonly frames = createDeterministicPresentationFrameSource();
  private readonly health = createHealthRuntime();
  private readonly inventory = createInventoryRuntime([
    { id: "energy-cell", maximumStack: 3 },
    { id: "health-pack", maximumStack: 3 },
    { id: "relic", maximumStack: 1 },
  ]);
  private readonly ability = createAbilityRuntime([{ id: "relic-pulse", cooldownTicks: 150, castTicks: 12 }]);
  private readonly flow = createGameFlowRuntime({
    initialState: "title",
    states: [
      { id: "title", allowedTo: ["explore"] },
      { id: "explore", allowedTo: ["guardian", "defeated"] },
      { id: "guardian", allowedTo: ["escape", "defeated"] },
      { id: "escape", allowedTo: ["results", "defeated"] },
      { id: "defeated", allowedTo: [] },
      { id: "results", allowedTo: [] },
    ],
  });
  private readonly hud = createHudStateStore({ screen: "title", health: 100, maximumHealth: 100 });
  private readonly assets = createAssetManager([
    { id: "procedural-ruins", kind: "gltf", source: "procedural://relic-frontier", groups: ["boot"] },
    { id: "failure-probe", kind: "gltf", source: "missing://qa-probe", groups: ["qa"] },
  ], {
    async load(entry) { if (entry.id === "failure-probe") throw new Error("Intentional deterministic asset failure probe"); return Object.freeze({ id: entry.id, procedural: true }); },
    disposeAsset() {},
    dispose() {},
  });
  private readonly triggers = createTriggerAreaRuntime([
    ...this.state.pickups.map((item) => ({ id: item.id, shape: "sphere" as const, center: item.position, radius: 2.2 })),
    ...this.state.upgrades.map((item) => ({ id: item.id, shape: "sphere" as const, center: item.position, radius: 2.2 })),
    { id: "power-console", shape: "sphere", center: vec3(0, 0, -16), radius: 2.8 },
    { id: "relic", shape: "sphere", center: vec3(0, 0, -26), radius: 2.8 },
    { id: "escape-zone", shape: "sphere", center: PLAYER_SPAWN, radius: 3.2 },
  ]);
  private readonly ai = createSimpleAiRuntime({
    selectBehavior: (agent) => agent.id === "relic-guardian" ? "guardian" : agent.id.startsWith("shooter") ? "keep-range" : "patrol",
    selectTarget: () => PLAYER_ID,
  });
  private readonly projectiles = createProjectileRuntime(
    [{ id: "pulse", speed: 15, lifetimeTicks: 150, radius: 0.3 }],
    (projectile, next) => {
      if (projectile.sourceId === PLAYER_ID) {
        const target = this.activeEnemies().find((enemy) => distanceXZ(enemy.position, next) <= 1.4);
        return target?.id ?? null;
      }
      return distanceXZ(this.state.player.position, next) <= 1.2 ? PLAYER_ID : null;
    },
  );
  private readonly debug = createDebugDevToolsRuntime();
  private readonly collision = createRapierCollisionAdapter({
    capsuleRadius: 0.45,
    capsuleHalfHeight: 0.45,
    controllerOffset: 0.01,
    boxes: [{ id: "ruins-floor", center: { x: 0, y: -0.5, z: -4 }, halfExtents: { x: 19, y: 0.5, z: 28 } }],
  });
  private readonly controller = createCharacterController({
    collision: this.collision,
    initialPosition: PLAYER_SPAWN,
    configuration: { walkSpeed: 6, runSpeed: 15, gravity: 24, jumpSpeed: 9, maximumFallSpeed: 30 },
  });
  private readonly runtime: ClientRuntime;
  private accumulator = 0;
  private presentationStarted = false;
  private lastTimestamp = -1;
  private isDisposed = false;
  private lastDebug: DebugSnapshot | null = null;
  private assetReady = false;
  private assetSuccessful = false;
  private assetFailureCode: string | null = null;
  private readonly audio: AudioRuntime;

  constructor(options: RelicFrontierGameOptions) {
    this.renderer = options.renderer ?? null;
    this.audio = options.audio;
    this.inventory.createContainer(PLAYER_ID, 7);
    this.health.register(PLAYER_ID, 100);
    for (const enemy of this.state.enemies) this.health.register(enemy.id, enemy.maximumHealth);
    for (const enemy of this.state.enemies) {
      this.ai.register(enemy.id, enemy.position, enemy.kind === "drone" ? 2.3 : enemy.kind === "boss" ? 0.8 : 1.3);
      if (enemy.kind !== "boss") this.ai.setWaypoints(enemy.id, [enemy.position, vec3(-enemy.position.x, enemy.position.y, enemy.position.z - 2), enemy.position]);
    }
    this.debug.registerProvider("game", () => ({ phase: this.state.phase, objective: this.state.objective, tick: this.state.tick }));
    this.debug.registerProvider("combat", () => ({ playerHealth: this.state.player.health, aliveEnemies: this.activeEnemies().map(({ id }) => id) }));
    this.debug.registerProvider("inventory", () => this.inventory.snapshot());
    void Promise.all([this.assets.load("procedural-ruins"), this.assets.load("failure-probe")]).then(([success, failure]) => {
      this.assetSuccessful = success.ok;
      this.assetFailureCode = failure.ok ? null : failure.failure.code;
      this.assetReady = true;
    });

    const inputFeature = createInputFeature({
      input: this.movement,
      publish: (command) => { this.state.input = Object.freeze({ moveX: command.x, moveY: -command.z, cameraYaw: this.state.input.cameraYaw }); },
      actions: this.actions,
      publishAction: (action) => this.pressed.add(action as RelicAction),
    });
    const features: ClientFeatureDescriptor<unknown>[] = [
      inputFeature,
      gameFeature("relic-frontier.rules", 50, (tick) => this.stepRules(tick)),
      createTriggerAreaClientFeature({
        runtime: this.triggers,
        readActors: () => [{ id: PLAYER_ID, position: this.state.player.position }],
        publish: (events) => { for (const event of events) event.kind === "exit" ? this.state.nearby.delete(event.areaId) : this.state.nearby.add(event.areaId); },
      }),
      createHealthClientFeature({ runtime: this.health, publish: (events) => this.applyHealthEvents(events) }),
      createProjectileClientFeature(this.projectiles, (events) => {
        for (const event of events) if (event.kind === "hit" && event.targetId !== null) {
          this.health.requestDamage(event.targetId, event.projectile.sourceId === PLAYER_ID ? 32 : 12, { sourceId: event.projectile.sourceId, invulnerabilityTicks: 8 });
          this.emit("projectile-hit", event.targetId);
        }
      }),
      createAbilitySkillClientFeature(this.ability, (events) => {
        for (const event of events) if (event.kind === "completed") this.firePlayerPulse();
        for (const event of events) if (event.kind === "rejected") this.emit("ability-rejected", event.code ?? "unknown");
      }),
      createSimpleAiNavigationClientFeature(this.ai, (agents) => {
        for (const agent of agents) {
          const enemy = this.state.enemies.find(({ id }) => id === agent.id);
          if (enemy !== undefined) enemy.position = agent.position;
          if (agent.waypointCount === 0 && enemy?.kind !== "boss") this.ai.setWaypoints(agent.id, [vec3(-agent.position.x, agent.position.y, agent.position.z), enemy?.position ?? agent.position]);
        }
      }),
      createInventoryClientFeature(this.inventory),
      createGameFlowClientFeature(this.flow),
      createAssetManagerFeature(this.assets),
      createAudioFeature(this.audio),
      createHudFeature({ store: this.hud, adapter: options.hudAdapter }),
      createCharacterControllerFeature({
        controller: this.controller,
        readInput: () => ({
          x: this.state.input.moveX,
          z: this.state.input.moveY,
          run: this.state.player.dashTicks > 0,
          jump: this.pressed.has("jump"),
        }),
        publish: (value) => {
          this.state.player.position = value.position;
          this.state.player.velocity = value.velocity;
          this.state.player.grounded = value.grounded;
          this.state.player.animation = !value.grounded ? "jump" : this.state.player.dashTicks > 0 ? "dash" : Math.hypot(value.velocity.x, value.velocity.z) > 0.1 ? "run" : "idle";
        },
      }),
      createDebugDevToolsClientFeature(this.debug, (value) => { this.lastDebug = value; }),
    ];
    if (this.renderer !== null) features.push(
      createCameraFeature({
        readTarget: () => this.state.player.position,
        readConfiguration: () => ({ distance: 13, height: 8, lookAtHeight: 1.4, yawRadians: -this.state.input.cameraYaw }),
        publish: (transform) => this.renderer?.setCameraTransform(transform),
      }),
      createVfxFeature({ runtime: this.renderer.vfx }),
      createRenderingFeature({ renderer: this.renderer }),
    );
    this.runtime = new ClientRuntime({ features, driver: "exact", telemetryStore: this.telemetry, frameSource: this.frames });
    void this.runtime.start().then((started) => {
      if (started.state !== "running" || this.isDisposed || this.renderer === null) return;
      const presentation = this.runtime.startPresentation();
      if (presentation.ok) this.presentationStarted = presentation.value;
      if (this.presentationStarted) this.present(0);
    });
  }

  get disposed(): boolean { return this.isDisposed; }

  private activeEnemies() {
    return this.state.enemies.filter((enemy) => enemy.alive && (enemy.kind !== "boss" || this.state.phase === "guardian"));
  }

  private emit(kind: string, subject?: string, value?: number): void {
    const event = Object.freeze({ kind, tick: this.state.tick, ...(subject === undefined ? {} : { subject }), ...(value === undefined ? {} : { value }) });
    if (this.collected.length >= 512) this.collected.shift();
    this.collected.push(event);
    for (const listener of this.listeners) listener(event);
    if (["basic-attack", "ability-fired", "item-picked", "relic-acquired", "enemy-defeated"].includes(kind)) this.audio.playEffect(kind === "item-picked" || kind === "relic-acquired" ? "pickup" : kind === "enemy-defeated" ? "victory" : "impact", { volume: 0.28 });
    const position = subject === PLAYER_ID ? this.state.player.position : this.state.enemies.find(({ id }) => id === subject)?.position ?? this.state.player.position;
    this.renderer?.vfx.enqueue({ kind: "burst", position, count: 10, color: kind.includes("damage") ? 0xff5b68 : 0x51f6d4, speed: 2.4, lifetimeMs: 650, seed: (this.state.tick * 2654435761) >>> 0 });
  }

  private applyHealthEvents(events: readonly { readonly kind: string; readonly entityId: string; readonly after: number }[]): void {
    for (const event of events) {
      if (event.entityId === PLAYER_ID) {
        this.state.player.health = event.after;
        this.emit(event.kind === "died" ? "player-died" : "player-health", PLAYER_ID, event.after);
        if (event.kind === "died" && this.state.phase !== "defeated") this.transition("defeated", "player-defeated");
        continue;
      }
      const enemy = this.state.enemies.find(({ id }) => id === event.entityId);
      if (enemy === undefined) continue;
      enemy.health = event.after;
      if (event.kind === "died" && enemy.alive) {
        enemy.alive = false;
        this.state.defeatedEnemies += 1;
        this.state.score += enemy.kind === "boss" ? 1_000 : 150;
        this.emit("enemy-defeated", enemy.id, this.state.score);
        if (enemy.kind === "boss") this.state.objective = "Claim the Relic in the chamber";
      }
    }
  }

  private transition(phase: MutableRelicState["phase"], reason: string): void {
    const outcome = this.flow.transition(phase, { tick: this.state.tick, reason });
    if (!outcome.ok) return;
    this.state.phase = phase;
    this.emit("phase-changed", phase);
  }

  private interact(): void {
    for (const pickup of this.state.pickups) if (!pickup.collected && this.state.nearby.has(pickup.id)) {
      pickup.collected = true;
      if (pickup.kind === "energy-cell") { this.inventory.add(PLAYER_ID, "energy-cell", 1); this.state.energyCells += 1; this.state.score += 100; }
      else { this.inventory.add(PLAYER_ID, "health-pack", 1); this.state.healthPacks += 1; }
      this.emit("item-picked", pickup.id);
      this.state.objective = this.state.energyCells < 3 ? `Recover Energy Cells (${this.state.energyCells}/3)` : "Power the chamber gate";
      return;
    }
    for (const upgrade of this.state.upgrades) if (!upgrade.selected && this.state.nearby.has(upgrade.id)) {
      for (const item of this.state.upgrades) item.selected = item.id === upgrade.id;
      if (upgrade.kind === "health") this.health.requestHealing(PLAYER_ID, 35, "upgrade-health");
      this.emit("upgrade-selected", upgrade.kind);
      return;
    }
    if (this.state.nearby.has("power-console") && this.state.energyCells >= 3 && !this.state.mechanismPowered) {
      this.state.mechanismPowered = true;
      this.state.objective = "Defeat the Relic Guardian";
      this.transition("guardian", "mechanism-powered");
      this.emit("mechanism-powered", "power-console");
      return;
    }
    const boss = this.state.enemies.find(({ kind }) => kind === "boss");
    if (this.state.nearby.has("relic") && boss?.alive === false && !this.state.relicOwned) {
      this.inventory.add(PLAYER_ID, "relic", 1);
      this.state.relicOwned = true;
      this.state.objective = "Return to Base Camp and escape";
      this.transition("escape", "relic-acquired");
      this.emit("relic-acquired", "relic");
      return;
    }
    if (this.state.nearby.has("escape-zone") && this.state.relicOwned && this.state.phase === "escape") {
      this.state.score += Math.max(0, 900 - Math.floor(this.state.elapsedTicks / 60));
      this.state.objective = "Expedition complete";
      this.transition("results", "escaped");
    }
  }

  private attack(): void {
    const target = this.activeEnemies().sort((a, b) => distanceXZ(a.position, this.state.player.position) - distanceXZ(b.position, this.state.player.position))[0];
    if (target === undefined || distanceXZ(target.position, this.state.player.position) > 3.4) return;
    this.health.requestDamage(target.id, 22, { sourceId: PLAYER_ID, invulnerabilityTicks: 5 });
    this.state.player.animation = "attack";
    this.emit("basic-attack", target.id);
  }

  private firePlayerPulse(): void {
    const yaw = this.state.input.cameraYaw;
    const directions = this.state.upgrades.some(({ kind, selected }) => kind === "projectile" && selected) ? [-0.18, 0, 0.18] : [0];
    for (const offset of directions) this.projectiles.fire("pulse", PLAYER_ID, vec3(this.state.player.position.x, this.state.player.position.y + 1, this.state.player.position.z), vec3(Math.sin(yaw + offset), 0, -Math.cos(yaw + offset)), this.state.tick);
    this.emit("ability-fired", PLAYER_ID, directions.length);
  }

  private stepRules(tick: number): void {
    this.state.tick = tick;
    if (["explore", "guardian", "escape"].includes(this.state.phase)) this.state.elapsedTicks += 1;
    this.state.player.dashTicks = Math.max(0, this.state.player.dashTicks - 1);
    this.state.player.dashCooldownTicks = Math.max(0, this.state.player.dashCooldownTicks - 1);
    if (this.pressed.has("dash") && this.state.player.dashCooldownTicks === 0) {
      this.state.player.dashTicks = 18;
      this.state.player.dashCooldownTicks = this.state.upgrades.some(({ kind, selected }) => kind === "dash" && selected) ? 70 : 110;
      this.emit("dash", PLAYER_ID);
    }
    if (this.pressed.has("attack")) this.attack();
    if (this.pressed.has("ability")) this.ability.request(PLAYER_ID, "relic-pulse", tick);
    if (this.pressed.has("interact")) this.interact();
    if (this.pressed.has("use-item") && this.state.healthPacks > 0 && this.state.player.health < this.state.player.maximumHealth) {
      const removed = this.inventory.remove(PLAYER_ID, "health-pack", 1);
      if (removed.ok) { this.state.healthPacks -= 1; this.health.requestHealing(PLAYER_ID, 40, "health-pack"); this.emit("item-used", "health-pack"); }
    }
    if (["explore", "guardian", "escape"].includes(this.state.phase)) for (const enemy of this.activeEnemies()) {
      const range = enemy.kind === "shooter" ? 11 : enemy.kind === "boss" ? 5 : 3;
      const period = enemy.kind === "boss" ? 70 : enemy.kind === "shooter" ? 100 : 120;
      if (distanceXZ(enemy.position, this.state.player.position) <= range && tick % period === 0) {
        if (enemy.kind === "shooter") {
          const dx = this.state.player.position.x - enemy.position.x;
          const dz = this.state.player.position.z - enemy.position.z;
          this.projectiles.fire("pulse", enemy.id, enemy.position, vec3(dx, 0, dz), tick);
        } else this.health.requestDamage(PLAYER_ID, enemy.kind === "boss" ? 18 : 9, { sourceId: enemy.id, invulnerabilityTicks: 20 });
        this.emit("enemy-attack", enemy.id);
      }
    }
    this.hud.update({
      screen: this.state.phase,
      score: this.state.score,
      timerSeconds: Math.floor(this.state.elapsedTicks / 60),
      health: this.state.player.health,
      maximumHealth: this.state.player.maximumHealth,
      extras: { objective: this.state.objective, cells: `${this.state.energyCells}/3`, medkits: this.state.healthPacks, ability: this.ability.inspect().casting.length > 0 ? "CAST" : "READY" },
    });
    this.renderer?.prepare(snapshotOf(this.state), this.collected.slice(-24));
  }

  advance(seconds: number): number {
    if (this.isDisposed || !Number.isFinite(seconds) || seconds < 0) return 0;
    this.accumulator += seconds;
    let steps = 0;
    while (this.accumulator >= DT - 1e-9 && steps < MAX_STEPS) {
      this.accumulator -= DT;
      const result = this.runtime.stepExact(1);
      this.pressed.clear();
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

  start(): void {
    if (this.state.phase !== "title" || this.isDisposed) return;
    void this.audio.unlock();
    this.state.objective = "Recover Energy Cells (0/3)";
    this.transition("explore", "expedition-started");
  }

  setInput(input: Partial<SemanticInput>): void {
    if (this.isDisposed) return;
    const sampled = this.movement.sample();
    this.movement.setMovement(clampAxis(input.moveX ?? sampled.x), clampAxis(-(input.moveY ?? -sampled.z)));
    this.state.input = Object.freeze({ ...this.state.input, cameraYaw: Number.isFinite(input.cameraYaw) ? input.cameraYaw ?? 0 : this.state.input.cameraYaw });
  }

  press(action: RelicAction): void { if (!this.isDisposed && ACTIONS.includes(action)) this.actions.press(action); }

  loadScenario(id: "fresh" | "guardian" | "escape"): void {
    if (this.isDisposed) return;
    if (id === "fresh") { if (this.state.phase === "title") this.start(); this.controller.teleport(PLAYER_SPAWN); return; }
    if (this.state.phase === "title") this.start();
    for (const pickup of this.state.pickups) if (pickup.kind === "energy-cell" && !pickup.collected) { pickup.collected = true; this.inventory.add(PLAYER_ID, "energy-cell", 1); }
    this.state.energyCells = 3;
    this.state.mechanismPowered = true;
    if (this.state.phase === "explore") this.transition("guardian", "qa-load");
    this.state.objective = "Defeat the Relic Guardian";
    this.controller.teleport(vec3(0, 0, -19.5));
    if (id === "escape") {
      const boss = this.state.enemies.find(({ kind }) => kind === "boss");
      if (boss !== undefined) { boss.alive = false; boss.health = 0; this.health.reset(boss.id, 0); }
      this.state.relicOwned = true;
      this.inventory.add(PLAYER_ID, "relic", 1);
      this.transition("escape", "qa-load");
      this.state.objective = "Return to Base Camp and escape";
      this.controller.teleport(PLAYER_SPAWN);
    }
    this.emit("scenario-loaded", id);
  }

  setDebugCamera(enabled: boolean): void { this.renderer?.setDebugCamera(enabled); }

  snapshot(): RelicSnapshot { return snapshotOf(this.state); }
  events(): readonly RelicEvent[] { return Object.freeze([...this.collected]); }
  errors(): readonly RuntimeErrorRecord[] { return Object.freeze([...this.errorRecords]); }
  debugSnapshot(): DebugSnapshot | null { return this.lastDebug; }
  inspectAssets() { return Object.freeze({ ready: this.assetReady, successful: this.assetSuccessful, failureCode: this.assetFailureCode, manager: this.assets.inspect() }); }
  inspectAudio(): AudioInspection { return this.audio.inspect(); }
  inspectRuntime(): RelicRuntimeInspection {
    const life = this.runtime.inspectLifecycle();
    return Object.freeze({ lifecycleState: life.state, installedFeatureIds: Object.freeze([...life.installedFeatureIds]), scheduleSystemIds: Object.freeze(life.scheduleReport.map(({ systemId }) => systemId)), schedulerTick: this.runtime.tick, debugProviders: this.debug.disposed ? Object.freeze([]) : this.debug.inspect().providerIds });
  }
  inspectRenderer(): RelicRendererInspection | null { return this.renderer?.inspect() ?? null; }
  inspectLeaks(): RelicLeakInspection {
    return Object.freeze({ activeListeners: this.listeners.size, activeFeatures: this.isDisposed ? 0 : this.runtime.inspectLifecycle().installedFeatureIds.length, activeTimers: 0, disposed: this.isDisposed });
  }
  subscribe(listener: (event: RelicEvent) => void): () => void { if (this.isDisposed) return () => undefined; this.listeners.add(listener); return () => this.listeners.delete(listener); }
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    void this.runtime.shutdown();
    this.movement.dispose();
    this.actions.dispose();
    this.listeners.clear();
  }
}

export function createRelicFrontierGame(options: RelicFrontierGameOptions): RelicFrontierGame {
  return new Game(options);
}
