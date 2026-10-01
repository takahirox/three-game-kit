import { Runtime as ClientRuntime } from "@three-game-kit/client";
import { createAnimationCharacterSet, createAnimationFeature, type AnimationCharacterSetInspection } from "@three-game-kit/client/animation";
import { createAssetManager, createAssetManagerFeature, createThreeAssetBackend, type AssetManagerInspection } from "@three-game-kit/client/asset-manager";
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
import {
  createCheckpointRuntime,
  createGameFlowRuntime,
  createHealthRuntime,
  createHudStateStore,
  createTriggerAreaRuntime,
  type CheckpointInspection,
  type HealthEvent,
} from "@three-game-kit/shared/gameplay";
import {
  createAbilityRuntime,
  createHitQueryRuntime,
  createInventoryRuntime,
  createLockOnRuntime,
  createProjectileRuntime,
  createSimpleAiRuntime,
  type HitCandidate,
  type HitQueryInspection,
  type LockOnEvent,
  type LockOnInspection,
} from "@three-game-kit/shared/genre";
import type { RelicFrontierRenderer, RelicRendererInspection } from "./renderer.js";
import {
  CHECKPOINTS,
  CONSOLE_POSITION,
  DT,
  GATE_CHECKPOINT_POSITION,
  PLAYER_ID,
  PLAYER_SPAWN,
  RELIC_POSITION,
  RESPAWN_DELAY_TICKS,
  createCombatState,
  createGuidanceState,
  createRelicState,
  distanceXZ,
  snapshotOf,
  vec3,
  yawTowards,
  type AttackId,
  type CombatState,
  type EnemyState,
  type GuidanceStage,
  type GuidanceState,
  type MutableRelicState,
  type OneShotClip,
  type PlayerAttackId,
  type RelicAction,
  type RelicEvent,
  type RelicPhase,
  type RelicScenario,
  type RelicSnapshot,
  type SemanticInput,
  type UpgradeKind,
  type Vec3,
} from "./state.js";

const MAX_STEPS = 1_200;
const ACTIONS: readonly RelicAction[] = Object.freeze(["attack-light", "attack-heavy", "dodge", "lock-on", "ability", "interact", "use-item"]);
const ACTIVE_PHASES: readonly RelicPhase[] = Object.freeze(["explore", "guardian", "escape"]);
const STAGE_LABELS: Readonly<Record<GuidanceStage, string>> = Object.freeze({
  start: "EXPEDITION BRIEFING",
  cells: "STEP 1/5 · ENERGY CELLS",
  mechanism: "STEP 2/5 · CHAMBER MECHANISM",
  guardian: "STEP 3/5 · RELIC GUARDIAN",
  relic: "STEP 4/5 · CLAIM THE RELIC",
  escape: "STEP 5/5 · ESCAPE TO BASE CAMP",
  complete: "EXPEDITION COMPLETE",
  downed: "SIGNAL LOST · REDEPLOYING",
});
const STAGE_STEPS: Readonly<Record<GuidanceStage, number>> = Object.freeze({ start: 0, cells: 1, mechanism: 2, guardian: 3, relic: 4, escape: 5, complete: 5, downed: 0 });
const STAGE_OBJECTIVES: Readonly<Record<GuidanceStage, string>> = Object.freeze({
  start: "Begin the expedition",
  cells: "Recover Energy Cells (0/3)",
  mechanism: "Power the chamber mechanism",
  guardian: "Defeat the Relic Guardian",
  relic: "Claim the Relic in the chamber",
  escape: "Return to Base Camp and escape",
  complete: "Expedition complete",
  downed: "Redeploying at the last checkpoint",
});
const CELL_OBJECTIVES: readonly string[] = Object.freeze(["Recover Energy Cells (0/3)", "Recover Energy Cells (1/3)", "Recover Energy Cells (2/3)"]);
const UPGRADE_PROMPTS: Readonly<Record<UpgradeKind, string>> = Object.freeze({ dodge: "E · CHOOSE DODGE UPGRADE", projectile: "E · CHOOSE PULSE UPGRADE", health: "E · CHOOSE HEALTH UPGRADE" });
const BEARING_ARROWS: readonly string[] = Object.freeze(["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"]);
const ENEMY_LABELS: Readonly<Record<EnemyState["kind"], string>> = Object.freeze({ husk: "RUIN HUSK", warden: "ASH WARDEN", boss: "RELIC GUARDIAN" });
const EVENT_CLIPS: Readonly<Record<string, "impact" | "pickup" | "victory" | "swing" | "hurt">> = Object.freeze({
  "attack-started": "swing",
  "melee-hit": "impact",
  "projectile-hit": "impact",
  "player-hit": "hurt",
  "player-staggered": "hurt",
  "player-died": "hurt",
  "ability-fired": "swing",
  "item-picked": "pickup",
  "relic-acquired": "pickup",
  "checkpoint-activated": "pickup",
  "player-respawned": "pickup",
  "mechanism-powered": "victory",
  "enemy-defeated": "victory",
  "expedition-complete": "victory",
});
const EMPTY = defineFeatureConfiguration<Readonly<Record<string, never>>>({
  defaultValue: () => Object.freeze({}),
  parse(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) && Reflect.ownKeys(value).length === 0
      ? { ok: true as const, value: Object.freeze({}) }
      : { ok: false as const, issues: [{ path: [], code: "empty-object-required" }] };
  },
});

type AttackVolume =
  | Readonly<{ kind: "arc"; radius: number; angle: number }>
  | Readonly<{ kind: "sphere"; radius: number }>
  | Readonly<{ kind: "projectile"; count: number; spread: number }>;

export interface AttackDefinition {
  readonly id: AttackId;
  readonly startup: number;
  readonly active: number;
  readonly recovery: number;
  readonly damage: number;
  readonly volume: AttackVolume;
  readonly knockback: number;
  readonly stagger: boolean;
  readonly clip: OneShotClip;
}

const DEGREES = Math.PI / 180;
export const ATTACKS: Readonly<Record<AttackId, AttackDefinition>> = Object.freeze({
  "light-1": { id: "light-1", startup: 8, active: 6, recovery: 12, damage: 18, volume: { kind: "arc", radius: 2.4, angle: 100 * DEGREES }, knockback: 0.5, stagger: false, clip: "attack-light" },
  "light-2": { id: "light-2", startup: 6, active: 6, recovery: 16, damage: 22, volume: { kind: "arc", radius: 2.6, angle: 120 * DEGREES }, knockback: 0.9, stagger: false, clip: "attack-light-2" },
  heavy: { id: "heavy", startup: 18, active: 8, recovery: 22, damage: 40, volume: { kind: "arc", radius: 2.8, angle: 140 * DEGREES }, knockback: 1.8, stagger: true, clip: "attack-heavy" },
  "husk-slash": { id: "husk-slash", startup: 30, active: 6, recovery: 40, damage: 12, volume: { kind: "arc", radius: 2.3, angle: 100 * DEGREES }, knockback: 0.8, stagger: false, clip: "attack-light" },
  "warden-bolt": { id: "warden-bolt", startup: 40, active: 1, recovery: 30, damage: 14, volume: { kind: "projectile", count: 1, spread: 0 }, knockback: 0.6, stagger: false, clip: "cast" },
  "guardian-sweep": { id: "guardian-sweep", startup: 40, active: 10, recovery: 45, damage: 22, volume: { kind: "arc", radius: 4.2, angle: 170 * DEGREES }, knockback: 2.2, stagger: true, clip: "attack-light-2" },
  "guardian-slam": { id: "guardian-slam", startup: 55, active: 6, recovery: 55, damage: 30, volume: { kind: "sphere", radius: 3.4 }, knockback: 2.6, stagger: true, clip: "attack-heavy" },
  "guardian-volley": { id: "guardian-volley", startup: 45, active: 1, recovery: 50, damage: 16, volume: { kind: "projectile", count: 3, spread: 0.24 }, knockback: 0.6, stagger: false, clip: "cast" },
});
const DODGE_TICKS = 30;
const DODGE_INVULNERABLE_FROM = 2;
const DODGE_INVULNERABLE_TO = 20;
const DODGE_MOVE_TICKS = 18;
const DODGE_SPEED = 9;
const HIT_TICKS = 14;
const STAGGER_TICKS: Readonly<Record<"player" | "husk" | "warden" | "boss", number>> = Object.freeze({ player: 36, husk: 45, warden: 45, boss: 60 });
const BOSS_POISE = 70;
const ENEMY_RADIUS: Readonly<Record<EnemyState["kind"], number>> = Object.freeze({ husk: 0.6, warden: 0.6, boss: 1.5 });
const ENEMY_SPEED: Readonly<Record<EnemyState["kind"], number>> = Object.freeze({ husk: 3.2, warden: 2.6, boss: 2.4 });
const ARENA = Object.freeze({ minX: -17.5, maxX: 17.5, minZ: -30, maxZ: 21 });
/** The Character Controller reports the capsule centre; gameplay volumes and AI steer on the ground plane. */
export const PLAYER_CAPSULE_CENTER = 0.9;

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
  readonly activeCharacters: number;
  readonly disposed: boolean;
}

export interface RelicCombatInspection {
  readonly attacks: Readonly<Record<AttackId, AttackDefinition>>;
  readonly lockOn: LockOnInspection;
  readonly checkpoint: CheckpointInspection;
  readonly hitQuery: HitQueryInspection;
  readonly lastRespawnTick: number;
}

export interface RelicFrontierGame {
  readonly disposed: boolean;
  advance(seconds: number): number;
  present(timestampMs: number): boolean;
  start(): void;
  dismissOnboarding(): void;
  setInput(input: Partial<SemanticInput>): void;
  press(action: RelicAction): void;
  loadScenario(id: RelicScenario): void;
  forcePlayerDeath(): void;
  setDebugCamera(enabled: boolean): void;
  snapshot(): RelicSnapshot;
  events(): readonly RelicEvent[];
  errors(): readonly RuntimeErrorRecord[];
  debugSnapshot(): DebugSnapshot | null;
  inspectAssets(): Readonly<{ ready: boolean; successful: boolean; failureCode: string | null; manager: AssetManagerInspection }>;
  inspectAnimation(): AnimationCharacterSetInspection;
  inspectCombat(): RelicCombatInspection;
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

function cooldownLabel(ticks: number): string {
  return ticks <= 0 ? "READY" : `${(ticks * DT).toFixed(1)}s`;
}

function attackPhase(definition: AttackDefinition, ticks: number): CombatState["phase"] {
  return ticks < definition.startup ? "startup" : ticks < definition.startup + definition.active ? "active" : "recovery";
}

function clampArena(position: Vec3): Vec3 {
  return vec3(Math.max(ARENA.minX, Math.min(ARENA.maxX, position.x)), position.y, Math.max(ARENA.minZ, Math.min(ARENA.maxZ, position.z)));
}

interface PendingReaction { readonly sourceId: string; readonly stagger: boolean; readonly direction: Vec3; readonly knockback: number; }

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
      { id: "explore", allowedTo: ["guardian", "downed"] },
      { id: "guardian", allowedTo: ["escape", "downed"] },
      { id: "escape", allowedTo: ["results", "downed"] },
      { id: "downed", allowedTo: ["explore", "guardian", "escape"] },
      { id: "results", allowedTo: [] },
    ],
  });
  private readonly hud = createHudStateStore({
    screen: "title",
    health: 100,
    maximumHealth: 100,
    extras: { objective: STAGE_OBJECTIVES.start, stage: STAGE_LABELS.start, cue: "", prompt: "", cells: "0/3", medkits: 0, ability: "READY", dodge: "READY", guardian: "", guardianRatio: 0, healthRatio: 1, onboarding: false, target: "", checkpoint: "BASE CAMP", respawn: "", toast: "" },
  });
  private readonly characters = createAnimationCharacterSet();
  private readonly assets = createAssetManager([
    { id: "relic-ranger", kind: "gltf", source: new URL("../assets/relic-ranger.glb", import.meta.url).href, groups: ["boot"] },
    { id: "failure-probe", kind: "gltf", source: "missing://qa-probe", groups: ["qa"] },
  ], (() => {
    const three = createThreeAssetBackend();
    return {
      load(entry: { readonly id: string; readonly kind: "gltf" | "texture" | "audio"; readonly source: string }) {
        if (entry.id === "failure-probe") return Promise.reject(new Error("Intentional deterministic asset failure probe"));
        return three.load(entry);
      },
      disposeAsset(kind: "gltf" | "texture" | "audio", value: unknown) { three.disposeAsset(kind, value); },
      dispose() { three.dispose(); },
    };
  })());
  private readonly triggers = createTriggerAreaRuntime([
    ...this.state.pickups.map((item) => ({ id: item.id, shape: "sphere" as const, center: item.position, radius: 2.2 })),
    ...this.state.upgrades.map((item) => ({ id: item.id, shape: "sphere" as const, center: item.position, radius: 2.2 })),
    { id: "power-console", shape: "sphere", center: CONSOLE_POSITION, radius: 2.8 },
    { id: "relic", shape: "sphere", center: RELIC_POSITION, radius: 2.8 },
    { id: "escape-zone", shape: "sphere", center: PLAYER_SPAWN, radius: 3.2 },
    { id: "checkpoint-camp", shape: "sphere", center: PLAYER_SPAWN, radius: 3.2 },
    { id: "checkpoint-gate", shape: "sphere", center: GATE_CHECKPOINT_POSITION, radius: 2.8 },
  ]);
  private readonly ai = createSimpleAiRuntime({
    selectBehavior: (agent) => this.state.enemies.find(({ id }) => id === agent.id)?.behavior ?? "dormant",
    selectTarget: () => PLAYER_ID,
  });
  private readonly projectiles = createProjectileRuntime(
    [{ id: "pulse", speed: 15, lifetimeTicks: 150, radius: 0.3 }, { id: "bolt", speed: 11, lifetimeTicks: 130, radius: 0.35 }],
    (projectile, next) => {
      if (projectile.sourceId === PLAYER_ID) {
        const target = this.activeEnemies().find((enemy) => distanceXZ(enemy.position, next) <= 1.2 + ENEMY_RADIUS[enemy.kind]);
        return target?.id ?? null;
      }
      return this.state.player.combat.kind !== "dead" && distanceXZ(this.state.player.position, next) <= 1.1 ? PLAYER_ID : null;
    },
  );
  private readonly hitQuery = createHitQueryRuntime();
  private readonly lockOn = createLockOnRuntime({ range: 12, releaseRange: 16 });
  private readonly checkpoints = createCheckpointRuntime({ checkpoints: CHECKPOINTS, initialCheckpointId: "checkpoint-camp", respawnDelayTicks: RESPAWN_DELAY_TICKS });
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
    configuration: { walkSpeed: 3.2, runSpeed: 6, gravity: 24, jumpSpeed: 9, maximumFallSpeed: 30 },
  });
  private readonly runtime: ClientRuntime;
  private readonly pendingEnemyReactions = new Map<string, PendingReaction>();
  private pendingPlayerReaction: PendingReaction | null = null;
  private accumulator = 0;
  private presentationStarted = false;
  private lastTimestamp = -1;
  private isDisposed = false;
  private lastDebug: DebugSnapshot | null = null;
  private assetReady = false;
  private assetSuccessful = false;
  private assetFailureCode: string | null = null;
  private lastRespawnTick = -1;
  private lockOnCycles = 0;
  private toast = "";
  private toastUntilTick = 0;
  private readonly audio: AudioRuntime;

  constructor(options: RelicFrontierGameOptions) {
    this.renderer = options.renderer ?? null;
    this.audio = options.audio;
    this.inventory.createContainer(PLAYER_ID, 7);
    this.health.register(PLAYER_ID, 100);
    for (const enemy of this.state.enemies) {
      this.health.register(enemy.id, enemy.maximumHealth);
      this.ai.register(enemy.id, enemy.position, ENEMY_SPEED[enemy.kind]);
    }
    this.debug.registerProvider("game", () => ({ phase: this.state.phase, objective: this.guidanceFor(PLAYER_ID).objective, tick: this.state.tick }));
    this.debug.registerProvider("combat", () => ({ playerHealth: this.state.player.health, playerCombat: this.state.player.combat.kind, lockOn: this.state.lockOnTargetId, aliveEnemies: this.activeEnemies().map(({ id }) => id) }));
    this.debug.registerProvider("inventory", () => this.inventory.snapshot());
    void Promise.all([this.assets.load("relic-ranger"), this.assets.load("failure-probe")]).then(([success, failure]) => {
      this.assetSuccessful = success.ok;
      this.assetFailureCode = failure.ok ? null : failure.failure.code;
      if (success.ok && !this.isDisposed && this.renderer !== null) this.renderer.attachCharacterRig(success.value, this.characters);
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
        for (const event of events) {
          if (event.kind !== "hit" || event.targetId === null || event.projectile.firedTick < this.lastRespawnTick) continue;
          if (event.projectile.sourceId === PLAYER_ID) {
            this.damageEnemy(event.targetId, 32, PLAYER_ID, false, event.projectile.velocity, 0.6);
          } else {
            this.damagePlayer(event.projectile.sourceId, event.projectile.definitionId === "bolt" && event.projectile.sourceId === "relic-guardian" ? ATTACKS["guardian-volley"].damage : ATTACKS["warden-bolt"].damage, false, event.projectile.velocity, 0.6);
          }
          this.emit("projectile-hit", event.targetId);
        }
      }),
      createAbilitySkillClientFeature(this.ability, (events) => {
        for (const event of events) if (event.kind === "started" && event.actorId === PLAYER_ID) { this.state.player.pulseCooldownTicks = 151; this.cue(this.state.player.animation, "cast", 30); }
        for (const event of events) if (event.kind === "completed") this.firePlayerPulse();
        for (const event of events) if (event.kind === "rejected") this.emit("ability-rejected", event.code ?? "unknown");
      }),
      createSimpleAiNavigationClientFeature(this.ai, (agents) => {
        for (const agent of agents) {
          const enemy = this.state.enemies.find(({ id }) => id === agent.id);
          if (enemy === undefined || !enemy.alive) continue;
          const moved = distanceXZ(enemy.position, agent.position) / DT;
          enemy.position = agent.position;
          if (enemy.combat.kind === "idle") enemy.animation.state = moved > 4 ? "run" : moved > 0.1 ? "walk" : "idle";
        }
      }),
      createInventoryClientFeature(this.inventory),
      createGameFlowClientFeature(this.flow),
      createAssetManagerFeature(this.assets),
      createAudioFeature(this.audio),
      createHudFeature({ store: this.hud, adapter: options.hudAdapter }),
      createCharacterControllerFeature({
        controller: this.controller,
        readInput: () => this.controllerInput(),
        publish: (value) => {
          this.state.player.position = value.position;
          this.state.player.velocity = value.velocity;
          this.state.player.grounded = value.grounded;
          const speed = Math.hypot(value.velocity.x, value.velocity.z);
          if (this.state.player.combat.kind !== "dead") this.state.player.animation.state = speed > 4.5 ? "run" : speed > 0.1 ? "walk" : "idle";
          if (this.state.player.combat.kind === "idle" && this.state.lockOnTargetId === null && speed > 0.1) this.state.player.facingYaw = Math.atan2(value.velocity.x, value.velocity.z);
        },
      }),
      createAnimationFeature({ characters: this.characters }),
      createDebugDevToolsClientFeature(this.debug, (value) => { this.lastDebug = value; }),
    ];
    if (this.renderer !== null) features.push(
      createCameraFeature({
        readTarget: () => this.state.player.position,
        readConfiguration: () => ({ distance: 9.5, height: 4.6, lookAtHeight: 1.6, yawRadians: -this.state.input.cameraYaw }),
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

  private groundedPlayer(): Vec3 {
    return vec3(this.state.player.position.x, 0, this.state.player.position.z);
  }

  private activeEnemies(): EnemyState[] {
    return this.state.enemies.filter((enemy) => enemy.alive && (enemy.kind !== "boss" || this.state.phase === "guardian"));
  }

  private enemyById(id: string): EnemyState | undefined {
    return this.state.enemies.find((enemy) => enemy.id === id);
  }

  private emit(kind: string, subject?: string, value?: number): void {
    const event = Object.freeze({ kind, tick: this.state.tick, ...(subject === undefined ? {} : { subject }), ...(value === undefined ? {} : { value }) });
    if (this.collected.length >= 512) this.collected.shift();
    this.collected.push(event);
    for (const listener of this.listeners) listener(event);
    const clip = EVENT_CLIPS[kind];
    if (clip !== undefined) this.audio.playEffect(clip, { volume: kind === "attack-started" ? 0.16 : 0.28 });
  }

  private burst(position: Vec3, color: number, count = 10, speed = 2.4): void {
    this.renderer?.vfx.enqueue({ kind: "burst", position: vec3(position.x, position.y + 1, position.z), count, color, speed, lifetimeMs: 650, seed: (this.state.tick * 2654435761 + count) >>> 0 });
  }

  private showToast(text: string, ticks = 150): void {
    this.toast = text;
    this.toastUntilTick = this.state.tick + ticks;
  }

  private cue(target: MutableRelicState["player"]["animation"], oneShot: OneShotClip | null, durationTicks: number): void {
    target.oneShot = oneShot;
    target.durationTicks = durationTicks;
    target.sequence += 1;
  }

  private controllerInput(): { readonly x: number; readonly z: number; readonly run: boolean; readonly jump: boolean } {
    const player = this.state.player;
    if (!ACTIVE_PHASES.includes(this.state.phase) || player.combat.kind === "attack" || player.combat.kind === "hit" || player.combat.kind === "stagger" || player.combat.kind === "dead") return { x: 0, z: 0, run: false, jump: false };
    if (player.combat.kind === "dodge") return { x: 0, z: 0, run: false, jump: false };
    const yaw = this.state.input.cameraYaw;
    const forwardX = Math.sin(yaw), forwardZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw), rightZ = Math.sin(yaw);
    const ahead = -this.state.input.moveY;
    return { x: forwardX * ahead + rightX * this.state.input.moveX, z: forwardZ * ahead + rightZ * this.state.input.moveX, run: this.state.lockOnTargetId === null, jump: false };
  }

  private moveDirection(): Vec3 | null {
    const command = this.controllerInput();
    const magnitude = Math.hypot(command.x, command.z);
    return magnitude < 0.05 ? null : vec3(command.x / magnitude, 0, command.z / magnitude);
  }

  private applyHealthEvents(events: readonly HealthEvent[]): void {
    for (const event of events) {
      if (event.entityId === PLAYER_ID) {
        this.state.player.health = event.after;
        if (event.kind === "died") { this.onPlayerDied(); continue; }
        this.emit(event.kind === "damaged" ? "player-hit" : "player-healed", PLAYER_ID, event.after);
        if (event.kind === "damaged") this.reactPlayer(event.sourceId);
        continue;
      }
      const enemy = this.enemyById(event.entityId);
      if (enemy === undefined) continue;
      enemy.health = event.after;
      if (event.kind === "died" && enemy.alive) {
        enemy.alive = false;
        enemy.behavior = "dormant";
        enemy.combat = { ...createCombatState(), kind: "dead" };
        enemy.animation.state = "dead";
        this.cue(enemy.animation, null, 0);
        this.ai.setWaypoints(enemy.id, []);
        this.pendingEnemyReactions.delete(enemy.id);
        this.state.defeatedEnemies += 1;
        this.state.score += enemy.kind === "boss" ? 1_000 : 150;
        this.burst(enemy.position, 0xffb45f, 18, 3.2);
        this.emit("enemy-defeated", enemy.id, this.state.score);
        continue;
      }
      if (event.kind === "damaged") this.reactEnemy(enemy, event.appliedAmount);
    }
  }

  private reactPlayer(sourceId: string | null): void {
    const player = this.state.player;
    const reaction = this.pendingPlayerReaction;
    this.pendingPlayerReaction = null;
    if (player.combat.kind === "dead" || player.combat.kind === "dodge") return;
    const superArmor = player.combat.kind === "attack" && player.combat.attackId === "heavy" && player.combat.phase === "active";
    const stagger = reaction?.stagger ?? false;
    if (reaction !== null && reaction.knockback > 0) {
      player.position = clampArena(vec3(player.position.x + reaction.direction.x * reaction.knockback, player.position.y, player.position.z + reaction.direction.z * reaction.knockback));
      this.controller.teleport(player.position);
    }
    this.burst(player.position, 0xff5b68, 8, 2);
    if (superArmor && !stagger) return;
    if (player.combat.kind === "attack") this.emit("attack-interrupted", player.combat.attackId ?? "unknown");
    player.combat = { ...createCombatState(), kind: stagger ? "stagger" : "hit", totalTicks: stagger ? STAGGER_TICKS.player : HIT_TICKS };
    this.cue(player.animation, stagger ? "stagger" : "hit-react", player.combat.totalTicks);
    if (stagger) this.emit("player-staggered", sourceId ?? "unknown");
  }

  private reactEnemy(enemy: EnemyState, applied: number): void {
    const reaction = this.pendingEnemyReactions.get(enemy.id);
    this.pendingEnemyReactions.delete(enemy.id);
    this.burst(enemy.position, 0x51f6d4, 8, 2.2);
    if (enemy.behavior === "dormant" || enemy.behavior === "hold") { enemy.behavior = enemy.kind === "warden" ? "engaged" : "approach"; this.emit("enemy-alerted", enemy.id); }
    if (reaction !== undefined && reaction.knockback > 0) {
      enemy.position = clampArena(vec3(enemy.position.x + reaction.direction.x * reaction.knockback, enemy.position.y, enemy.position.z + reaction.direction.z * reaction.knockback));
      this.ai.setPosition(enemy.id, enemy.position);
    }
    let stagger = reaction?.stagger ?? false;
    if (enemy.kind === "boss") {
      // The Guardian ignores light hit reactions until its poise breaks or a heavy attack lands.
      enemy.combat.poise += applied;
      if (enemy.combat.poise >= BOSS_POISE) stagger = true;
      if (!stagger) return;
      enemy.combat.poise = 0;
    }
    const swinging = enemy.combat.kind === "attack" && enemy.combat.phase === "active";
    if (swinging && !stagger) return;
    if (enemy.combat.kind === "attack") { this.emit("enemy-attack-interrupted", enemy.id); enemy.slamTarget = null; }
    const poise = enemy.combat.poise;
    enemy.combat = { ...createCombatState(), kind: stagger ? "stagger" : "hit", totalTicks: stagger ? STAGGER_TICKS[enemy.kind] : HIT_TICKS, poise };
    this.cue(enemy.animation, stagger ? "stagger" : "hit-react", enemy.combat.totalTicks);
    this.ai.setWaypoints(enemy.id, []);
    this.emit(stagger ? "enemy-staggered" : "enemy-hit", enemy.id);
  }

  private onPlayerDied(): void {
    const player = this.state.player;
    if (player.combat.kind === "dead") return;
    player.combat = { ...createCombatState(), kind: "dead" };
    player.animation.state = "dead";
    this.cue(player.animation, null, 0);
    this.state.deaths += 1;
    this.pendingPlayerReaction = null;
    this.releaseLockOn("invalid");
    this.emit("player-died", PLAYER_ID, this.state.deaths);
    this.transition("downed", "player-died");
    const outcome = this.checkpoints.requestRespawn(this.state.tick);
    if (outcome.ok && outcome.event.kind === "respawn-scheduled") {
      this.state.checkpoint.respawnTick = outcome.event.respawnTick;
      this.emit("respawn-scheduled", outcome.event.checkpointId, outcome.event.respawnTick);
    }
  }

  private respawn(checkpointId: string, position: Vec3): void {
    const player = this.state.player;
    player.position = position;
    this.controller.teleport(position);
    this.health.reset(PLAYER_ID, player.maximumHealth);
    player.health = player.maximumHealth;
    player.facingYaw = Math.PI;
    player.combat = createCombatState();
    player.animation.state = "idle";
    this.cue(player.animation, null, 0);
    player.dodgeCooldownTicks = 0;
    this.pendingPlayerReaction = null;
    // Respawn policy: living enemies return to their spawn at full health; defeated enemies, pickups,
    // inventory, upgrades, mechanism and Relic progress all survive death.
    for (const enemy of this.state.enemies) if (enemy.alive) this.resetEnemy(enemy);
    this.lastRespawnTick = this.state.tick;
    this.state.checkpoint.respawnTick = null;
    this.state.checkpoint.respawnCount += 1;
    const phase: RelicPhase = this.state.relicOwned ? "escape" : this.state.mechanismPowered ? "guardian" : "explore";
    this.transition(phase, "respawned");
    this.showToast(`REDEPLOYED · ${this.state.checkpoint.label}`, 120);
    this.burst(position, 0x6fffe1, 16, 3);
    this.emit("player-respawned", checkpointId, this.state.checkpoint.respawnCount);
  }

  private resetEnemy(enemy: EnemyState): void {
    enemy.position = enemy.spawn;
    enemy.facingYaw = Math.PI;
    enemy.alive = true;
    enemy.health = enemy.maximumHealth;
    this.health.reset(enemy.id, enemy.maximumHealth);
    enemy.behavior = "dormant";
    enemy.combat = createCombatState();
    enemy.animation.state = "idle";
    this.cue(enemy.animation, null, 0);
    enemy.attackCooldownTicks = 0;
    enemy.attackCounter = 0;
    enemy.slamTarget = null;
    this.pendingEnemyReactions.delete(enemy.id);
    this.ai.setPosition(enemy.id, enemy.spawn);
    this.ai.setWaypoints(enemy.id, []);
  }

  private transition(phase: RelicPhase, reason: string): void {
    const outcome = this.flow.transition(phase, { tick: this.state.tick, reason });
    if (!outcome.ok) return;
    this.state.phase = phase;
    this.emit("phase-changed", phase);
  }

  private releaseLockOn(reason: "manual" | "invalid" | "out-of-range"): void {
    const event = this.lockOn.release(this.state.tick, reason);
    if (event !== null) this.applyLockOnEvent(event);
  }

  private applyLockOnEvent(event: LockOnEvent): void {
    this.state.lockOnTargetId = event.kind === "released" ? null : event.targetId;
    this.emit(`lock-on-${event.kind}`, event.targetId);
  }

  private lockOnCandidates() {
    return this.activeEnemies().map((enemy) => ({ id: enemy.id, position: enemy.position }));
  }


  private toggleLockOn(): void {
    const candidates = this.lockOnCandidates();
    const origin = this.state.player.position;
    if (this.lockOn.targetId === null) {
      const acquired = this.lockOn.acquire(origin, candidates, this.state.tick);
      if (acquired !== null) { this.lockOnCycles = 0; this.applyLockOnEvent(acquired); }
      return;
    }
    // Tab cycles through every hostile in range once, then releases the lock.
    const inRange = candidates.filter((candidate) => distanceXZ(candidate.position, origin) <= this.lockOn.inspect().range).length;
    const cycled = this.lockOnCycles + 1 >= inRange ? null : this.lockOn.cycle(origin, candidates, this.state.tick);
    if (cycled !== null) { this.lockOnCycles += 1; this.applyLockOnEvent(cycled); return; }
    this.releaseLockOn("manual");
  }

  private interact(): void {
    for (const pickup of this.state.pickups) if (!pickup.collected && this.state.nearby.has(pickup.id)) {
      pickup.collected = true;
      if (pickup.kind === "energy-cell") { this.inventory.add(PLAYER_ID, "energy-cell", 1); this.state.energyCells += 1; this.state.score += 100; }
      else { this.inventory.add(PLAYER_ID, "health-pack", 1); this.state.healthPacks += 1; }
      this.burst(pickup.position, 0xffdc73, 12, 2.6);
      this.emit("item-picked", pickup.id);
      return;
    }
    for (const upgrade of this.state.upgrades) if (!upgrade.selected && this.state.nearby.has(upgrade.id)) {
      for (const item of this.state.upgrades) item.selected = item.id === upgrade.id;
      if (upgrade.kind === "health") this.health.requestHealing(PLAYER_ID, 35, "upgrade-health");
      this.burst(upgrade.position, 0xb496ff, 12, 2.6);
      this.emit("upgrade-selected", upgrade.kind);
      return;
    }
    if (this.state.nearby.has("power-console") && this.state.energyCells >= 3 && !this.state.mechanismPowered) {
      this.state.mechanismPowered = true;
      this.transition("guardian", "mechanism-powered");
      const boss = this.enemyById("relic-guardian");
      if (boss !== undefined && boss.alive) boss.behavior = "approach";
      this.burst(CONSOLE_POSITION, 0x6fffe1, 20, 3.4);
      this.emit("mechanism-powered", "power-console");
      return;
    }
    const boss = this.enemyById("relic-guardian");
    if (this.state.nearby.has("relic") && boss?.alive === false && !this.state.relicOwned) {
      this.inventory.add(PLAYER_ID, "relic", 1);
      this.state.relicOwned = true;
      this.transition("escape", "relic-acquired");
      this.burst(RELIC_POSITION, 0xffb45f, 24, 3.6);
      this.emit("relic-acquired", "relic");
      return;
    }
    if (this.state.nearby.has("escape-zone") && this.state.relicOwned && this.state.phase === "escape") {
      this.state.score += Math.max(0, 900 - Math.floor(this.state.elapsedTicks / 60) - this.state.deaths * 100);
      this.transition("results", "escaped");
      this.emit("expedition-complete", PLAYER_ID, this.state.score);
    }
  }

  private startPlayerAttack(id: PlayerAttackId): void {
    const player = this.state.player;
    const definition = ATTACKS[id];
    const target = this.state.lockOnTargetId === null ? undefined : this.enemyById(this.state.lockOnTargetId);
    const direction = this.moveDirection();
    if (target !== undefined) player.facingYaw = yawTowards(player.position, target.position, player.facingYaw);
    else if (direction !== null) player.facingYaw = Math.atan2(direction.x, direction.z);
    player.combat = { ...createCombatState(), kind: "attack", attackId: id, phase: "startup", totalTicks: definition.startup + definition.active + definition.recovery };
    this.cue(player.animation, definition.clip, player.combat.totalTicks);
    this.emit("attack-started", id);
  }

  private startDodge(): void {
    const player = this.state.player;
    const direction = this.moveDirection() ?? vec3(Math.sin(player.facingYaw), 0, Math.cos(player.facingYaw));
    player.dodgeDirection = direction;
    if (player.combat.kind === "attack") this.emit("attack-cancelled", player.combat.attackId ?? "unknown");
    player.combat = { ...createCombatState(), kind: "dodge", totalTicks: DODGE_TICKS };
    player.dodgeCooldownTicks = this.state.upgrades.some(({ kind, selected }) => kind === "dodge" && selected) ? 28 : 45;
    this.controller.setVelocity(vec3(direction.x * DODGE_SPEED, 0, direction.z * DODGE_SPEED));
    this.cue(player.animation, "dodge-roll", DODGE_TICKS);
    this.emit("dodge", PLAYER_ID);
  }

  private handlePlayerActions(tick: number): void {
    const player = this.state.player;
    const combat = player.combat;
    if (this.pressed.has("lock-on")) this.toggleLockOn();
    if (this.pressed.has("attack-light")) {
      if (combat.kind === "idle") this.startPlayerAttack("light-1");
      else if (combat.kind === "attack" && combat.attackId === "light-1" && combat.phase !== "startup" && !combat.comboQueued) { combat.comboQueued = true; this.emit("combo-queued", "light-2"); }
    }
    if (this.pressed.has("attack-heavy") && combat.kind === "idle") this.startPlayerAttack("heavy");
    if (this.pressed.has("dodge") && player.dodgeCooldownTicks === 0 && (combat.kind === "idle" || (combat.kind === "attack" && combat.phase === "recovery"))) this.startDodge();
    if (this.pressed.has("ability") && player.combat.kind === "idle") this.ability.request(PLAYER_ID, "relic-pulse", tick);
    if (this.pressed.has("interact")) this.interact();
    if (this.pressed.has("use-item") && this.state.healthPacks > 0 && player.health < player.maximumHealth) {
      const removed = this.inventory.remove(PLAYER_ID, "health-pack", 1);
      if (removed.ok) { this.state.healthPacks -= 1; this.health.requestHealing(PLAYER_ID, 40, "health-pack"); this.emit("item-used", "health-pack"); }
    }
  }

  private advancePlayerCombat(): void {
    const player = this.state.player;
    const combat = player.combat;
    if (combat.kind === "idle" || combat.kind === "dead") return;
    combat.ticks += 1;
    if (combat.kind === "dodge") {
      combat.invulnerable = combat.ticks >= DODGE_INVULNERABLE_FROM && combat.ticks <= DODGE_INVULNERABLE_TO;
      if (combat.ticks === DODGE_MOVE_TICKS) this.controller.setVelocity(vec3(0, 0, 0));
      if (combat.ticks >= combat.totalTicks) player.combat = createCombatState();
      return;
    }
    if (combat.kind === "hit" || combat.kind === "stagger") {
      if (combat.ticks >= combat.totalTicks) player.combat = createCombatState();
      return;
    }
    const definition = ATTACKS[combat.attackId ?? "light-1"];
    const phase = attackPhase(definition, combat.ticks);
    if (phase !== combat.phase) {
      combat.phase = phase;
      if (phase === "active") { combat.hitTargets = []; this.emit("attack-hit-window", definition.id); }
      if (phase === "recovery") this.emit("attack-recovery", definition.id);
    }
    if (phase === "active" && definition.volume.kind === "arc") {
      const hits = this.hitQuery.query(
        { kind: "arc", origin: this.groundedPlayer(), yaw: player.facingYaw, radius: definition.volume.radius, angle: definition.volume.angle },
        this.activeEnemies().map((enemy): HitCandidate => ({ id: enemy.id, position: enemy.position, radius: ENEMY_RADIUS[enemy.kind] })),
        { exclude: combat.hitTargets, maxTargets: 3 },
      );
      for (const hit of hits) {
        combat.hitTargets.push(hit.id);
        this.damageEnemy(hit.id, definition.damage, PLAYER_ID, definition.stagger, hit.direction, definition.knockback);
        this.emit("melee-hit", hit.id, definition.damage);
      }
    }
    if (combat.ticks >= combat.totalTicks) {
      if (combat.comboQueued && combat.attackId === "light-1") { this.startPlayerAttack("light-2"); this.emit("combo", "light-2"); }
      else player.combat = createCombatState();
    }
  }

  private damageEnemy(enemyId: string, amount: number, sourceId: string, stagger: boolean, direction: Vec3, knockback: number): void {
    const enemy = this.enemyById(enemyId);
    if (enemy === undefined || !enemy.alive) return;
    const length = Math.hypot(direction.x, direction.z);
    const unit = length === 0 ? vec3(0, 0, 1) : vec3(direction.x / length, 0, direction.z / length);
    this.pendingEnemyReactions.set(enemyId, { sourceId, stagger, direction: unit, knockback });
    this.health.requestDamage(enemyId, amount, { sourceId });
  }

  private damagePlayer(sourceId: string, amount: number, stagger: boolean, direction: Vec3, knockback: number): boolean {
    const player = this.state.player;
    if (player.combat.kind === "dead") return false;
    if (player.combat.invulnerable) {
      const enemy = this.enemyById(sourceId);
      if (enemy !== undefined && !enemy.combat.dodgedBy.includes(PLAYER_ID)) enemy.combat.dodgedBy.push(PLAYER_ID);
      if (!player.combat.dodgedBy.includes(sourceId)) { player.combat.dodgedBy.push(sourceId); this.emit("attack-dodged", sourceId); }
      return false;
    }
    const length = Math.hypot(direction.x, direction.z);
    const unit = length === 0 ? vec3(0, 0, 1) : vec3(direction.x / length, 0, direction.z / length);
    this.pendingPlayerReaction = { sourceId, stagger, direction: unit, knockback };
    this.health.requestDamage(PLAYER_ID, amount, { sourceId, invulnerabilityTicks: 10 });
    return true;
  }

  private startEnemyAttack(enemy: EnemyState, id: AttackId): void {
    const definition = ATTACKS[id];
    enemy.combat = { ...createCombatState(), kind: "attack", attackId: id, phase: "startup", totalTicks: definition.startup + definition.active + definition.recovery, poise: enemy.combat.poise };
    enemy.facingYaw = yawTowards(enemy.position, this.state.player.position, enemy.facingYaw);
    enemy.slamTarget = id === "guardian-slam" ? vec3(this.state.player.position.x, 0, this.state.player.position.z) : null;
    enemy.attackCounter += 1;
    this.ai.setWaypoints(enemy.id, []);
    this.cue(enemy.animation, definition.clip, enemy.combat.totalTicks);
    this.emit(definition.volume.kind === "projectile" ? "enemy-cast" : "enemy-attack", enemy.id, enemy.attackCounter);
    this.emit(`enemy-attack:${definition.id}`, enemy.id);
  }

  private fireEnemyProjectiles(enemy: EnemyState, definition: AttackDefinition): void {
    if (definition.volume.kind !== "projectile") return;
    const yaw = yawTowards(enemy.position, this.state.player.position, enemy.facingYaw);
    const origin = vec3(enemy.position.x, enemy.position.y + (enemy.kind === "boss" ? 2.4 : 1.3), enemy.position.z);
    const offsets = definition.volume.count === 1 ? [0] : [-definition.volume.spread, 0, definition.volume.spread];
    for (const offset of offsets) this.projectiles.fire("bolt", enemy.id, origin, vec3(Math.sin(yaw + offset), 0, Math.cos(yaw + offset)), this.state.tick);
    this.emit("projectile-fired", enemy.id, offsets.length);
  }

  private advanceEnemy(enemy: EnemyState): void {
    const player = this.state.player;
    const combat = enemy.combat;
    enemy.attackCooldownTicks = Math.max(0, enemy.attackCooldownTicks - 1);
    if (combat.kind === "dead") return;
    if (combat.kind === "hit" || combat.kind === "stagger") {
      combat.ticks += 1;
      if (combat.ticks >= combat.totalTicks) { const poise = combat.poise; enemy.combat = { ...createCombatState(), poise }; }
      return;
    }
    if (combat.kind === "attack") {
      combat.ticks += 1;
      const definition = ATTACKS[combat.attackId ?? "husk-slash"];
      const phase = attackPhase(definition, combat.ticks);
      if (phase === "startup" && definition.id !== "guardian-slam") enemy.facingYaw = yawTowards(enemy.position, player.position, enemy.facingYaw);
      if (phase !== combat.phase) {
        combat.phase = phase;
        if (phase === "active") { combat.hitTargets = []; this.emit("enemy-hit-window", enemy.id); if (definition.volume.kind === "projectile") this.fireEnemyProjectiles(enemy, definition); }
      }
      if (phase === "active" && definition.volume.kind !== "projectile" && !combat.hitTargets.includes(PLAYER_ID) && player.combat.kind !== "dead") {
        const candidates: HitCandidate[] = [{ id: PLAYER_ID, position: this.groundedPlayer(), radius: 0.5 }];
        const hits = definition.volume.kind === "arc"
          ? this.hitQuery.query({ kind: "arc", origin: enemy.position, yaw: enemy.facingYaw, radius: definition.volume.radius, angle: definition.volume.angle }, candidates)
          : this.hitQuery.query({ kind: "sphere", center: enemy.slamTarget ?? enemy.position, radius: definition.volume.radius }, candidates);
        const hit = hits[0];
        if (hit !== undefined) {
          const direction = vec3(player.position.x - enemy.position.x, 0, player.position.z - enemy.position.z);
          if (this.damagePlayer(enemy.id, definition.damage, definition.stagger, direction, definition.knockback)) combat.hitTargets.push(PLAYER_ID);
        }
      }
      if (combat.ticks >= combat.totalTicks) {
        const poise = combat.poise;
        enemy.combat = { ...createCombatState(), poise };
        enemy.slamTarget = null;
        enemy.attackCooldownTicks = enemy.kind === "boss" ? 30 : enemy.kind === "warden" ? 90 : 20;
      }
      return;
    }
    const distance = distanceXZ(enemy.position, player.position);
    const playerAlive = player.combat.kind !== "dead";
    if (enemy.kind === "husk") {
      // "dormant" husks wake on proximity; a "hold" husk guards its post until it is damaged.
      if (enemy.behavior === "dormant" && distance <= 9 && playerAlive) { enemy.behavior = "approach"; this.emit("enemy-alerted", enemy.id); }
      if (enemy.behavior !== "approach" || !playerAlive) { this.ai.setWaypoints(enemy.id, []); return; }
      enemy.facingYaw = yawTowards(enemy.position, player.position, enemy.facingYaw);
      if (distance <= 2.1 && enemy.attackCooldownTicks === 0) { this.startEnemyAttack(enemy, "husk-slash"); return; }
      this.ai.setWaypoints(enemy.id, distance > 1.6 ? [this.groundedPlayer()] : []);
      return;
    }
    if (enemy.kind === "warden") {
      if (enemy.behavior === "dormant" && distance <= 13 && playerAlive) { enemy.behavior = "engaged"; this.emit("enemy-alerted", enemy.id); }
      if (enemy.behavior === "dormant" || !playerAlive) { this.ai.setWaypoints(enemy.id, []); return; }
      enemy.facingYaw = yawTowards(enemy.position, player.position, enemy.facingYaw);
      if (distance < 4.5) {
        enemy.behavior = "retreat";
        const away = vec3(enemy.position.x - player.position.x, 0, enemy.position.z - player.position.z);
        const length = Math.hypot(away.x, away.z) || 1;
        this.ai.setWaypoints(enemy.id, [clampArena(vec3(enemy.position.x + away.x / length * 3, 0, enemy.position.z + away.z / length * 3))]);
        return;
      }
      if (distance > 11) { enemy.behavior = "approach"; this.ai.setWaypoints(enemy.id, [this.groundedPlayer()]); }
      else { enemy.behavior = "hold"; this.ai.setWaypoints(enemy.id, []); }
      if (distance <= 12 && enemy.attackCooldownTicks === 0) this.startEnemyAttack(enemy, "warden-bolt");
      return;
    }
    if (this.state.phase !== "guardian" || !playerAlive) { enemy.behavior = "dormant"; this.ai.setWaypoints(enemy.id, []); return; }
    enemy.behavior = "approach";
    enemy.facingYaw = yawTowards(enemy.position, player.position, enemy.facingYaw);
    if (enemy.attackCooldownTicks === 0) {
      if (distance > 7.5) { this.startEnemyAttack(enemy, "guardian-volley"); return; }
      if (distance <= 3.8) { this.startEnemyAttack(enemy, enemy.attackCounter % 2 === 0 ? "guardian-sweep" : "guardian-slam"); return; }
    }
    this.ai.setWaypoints(enemy.id, distance > 3 ? [this.groundedPlayer()] : []);
  }

  private firePlayerPulse(): void {
    const player = this.state.player;
    const yaw = this.state.lockOnTargetId === null ? player.facingYaw : yawTowards(player.position, this.enemyById(this.state.lockOnTargetId)?.position ?? player.position, player.facingYaw);
    const directions = this.state.upgrades.some(({ kind, selected }) => kind === "projectile" && selected) ? [-0.18, 0, 0.18] : [0];
    for (const offset of directions) this.projectiles.fire("pulse", PLAYER_ID, vec3(player.position.x, player.position.y + 1, player.position.z), vec3(Math.sin(yaw + offset), 0, Math.cos(yaw + offset)), this.state.tick);
    this.emit("ability-fired", PLAYER_ID, directions.length);
  }

  private stepCheckpoints(): void {
    for (const checkpoint of CHECKPOINTS) {
      if (!this.state.nearby.has(checkpoint.id) || this.checkpoints.activeCheckpointId === checkpoint.id || this.state.player.combat.kind === "dead") continue;
      const outcome = this.checkpoints.activate(checkpoint.id, this.state.tick);
      if (!outcome.ok) continue;
      this.state.checkpoint.activeId = checkpoint.id;
      this.state.checkpoint.label = checkpoint.label;
      this.showToast(`CHECKPOINT · ${checkpoint.label}`);
      this.burst(checkpoint.position, 0x6fffe1, 16, 3);
      this.emit("checkpoint-activated", checkpoint.id);
    }
    for (const event of this.checkpoints.step(this.state.tick)) if (event.kind === "respawned") this.respawn(event.checkpointId, vec3(event.position.x, event.position.y, event.position.z));
  }

  private stepRules(tick: number): void {
    this.state.tick = tick;
    const player = this.state.player;
    if (ACTIVE_PHASES.includes(this.state.phase)) this.state.elapsedTicks += 1;
    player.dodgeCooldownTicks = Math.max(0, player.dodgeCooldownTicks - 1);
    player.pulseCooldownTicks = Math.max(0, player.pulseCooldownTicks - 1);
    this.pendingPlayerReaction = null;
    this.pendingEnemyReactions.clear();
    const guidance = this.guidanceFor(PLAYER_ID);
    if (guidance.onboardingVisible && (this.pressed.size > 0 || this.state.input.moveX !== 0 || this.state.input.moveY !== 0)) this.dismissOnboarding();
    this.stepCheckpoints();
    if (ACTIVE_PHASES.includes(this.state.phase) && player.combat.kind !== "dead") {
      // Timers advance before new input so an attack started on tick T opens its active window on T + startup.
      this.advancePlayerCombat();
      this.handlePlayerActions(tick);
      if (this.state.lockOnTargetId !== null && player.combat.kind !== "attack" && player.combat.kind !== "dodge") {
        const target = this.enemyById(this.state.lockOnTargetId);
        if (target !== undefined) player.facingYaw = yawTowards(player.position, target.position, player.facingYaw);
      }
    }
    if (ACTIVE_PHASES.includes(this.state.phase) || this.state.phase === "downed") for (const enemy of this.activeEnemies()) this.advanceEnemy(enemy);
    for (const event of this.lockOn.step(tick, player.position, this.lockOnCandidates())) this.applyLockOnEvent(event);
    this.updateGuidance();
    if (tick >= this.toastUntilTick) this.toast = "";
    const boss = this.enemyById("relic-guardian");
    const activeBoss = boss !== undefined && boss.alive && this.state.phase === "guardian" ? boss : null;
    const bearingIndex = ((Math.round(guidance.bearing / (Math.PI / 4)) % 8) + 8) % 8;
    const target = this.state.lockOnTargetId === null ? undefined : this.enemyById(this.state.lockOnTargetId);
    this.hud.update({
      screen: this.state.phase,
      score: this.state.score,
      timerSeconds: Math.floor(this.state.elapsedTicks / 60),
      health: player.health,
      maximumHealth: player.maximumHealth,
      extras: {
        objective: guidance.objective,
        stage: STAGE_LABELS[guidance.stage],
        cue: guidance.target === null ? "" : `${BEARING_ARROWS[bearingIndex] ?? "↑"} ${Math.round(guidance.distance)} m`,
        prompt: guidance.prompt,
        cells: `${this.state.energyCells}/3`,
        medkits: this.state.healthPacks,
        ability: this.ability.inspect().casting.length > 0 ? "CAST" : cooldownLabel(player.pulseCooldownTicks),
        dodge: cooldownLabel(player.dodgeCooldownTicks),
        guardian: activeBoss === null ? "" : `${activeBoss.health}/${activeBoss.maximumHealth}`,
        guardianRatio: activeBoss === null ? 0 : activeBoss.health / activeBoss.maximumHealth,
        healthRatio: player.health / player.maximumHealth,
        onboarding: guidance.onboardingVisible,
        target: target === undefined ? "" : `${ENEMY_LABELS[target.kind]} ${target.health}/${target.maximumHealth}`,
        checkpoint: this.state.checkpoint.label,
        respawn: this.state.checkpoint.respawnTick === null ? "" : `${Math.max(0, (this.state.checkpoint.respawnTick - tick) * DT).toFixed(1)}s`,
        toast: this.toast,
      },
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
    this.guidanceFor(PLAYER_ID).onboardingVisible = true;
    this.transition("explore", "expedition-started");
    this.updateGuidance();
  }

  dismissOnboarding(): void {
    if (this.isDisposed) return;
    const guidance = this.guidanceFor(PLAYER_ID);
    if (!guidance.onboardingVisible) return;
    guidance.onboardingVisible = false;
    this.emit("onboarding-dismissed", PLAYER_ID);
  }

  setInput(input: Partial<SemanticInput>): void {
    if (this.isDisposed) return;
    const sampled = this.movement.sample();
    const x = clampAxis(input.moveX ?? sampled.x);
    const z = clampAxis(-(input.moveY ?? -sampled.z));
    // Two simultaneous orthogonal keys arrive as (±1, ±1); scale the pair back inside the unit disc
    // before the public movement command validates it, keeping the framework guard intact.
    const magnitude = Math.hypot(x, z);
    const scale = magnitude > 1 ? (1 - 1e-6) / magnitude : 1;
    this.movement.setMovement(x * scale, z * scale);
    this.state.input = Object.freeze({ ...this.state.input, cameraYaw: Number.isFinite(input.cameraYaw) ? input.cameraYaw ?? 0 : this.state.input.cameraYaw });
  }

  press(action: RelicAction): void { if (!this.isDisposed && ACTIONS.includes(action)) this.actions.press(action); }

  forcePlayerDeath(): void {
    if (this.isDisposed || this.state.player.combat.kind === "dead") return;
    // QA hazard: clear any invulnerability window first so the lethal request always applies through the Health runtime.
    this.health.reset(PLAYER_ID, Math.max(1, this.state.player.health));
    this.health.requestDamage(PLAYER_ID, 9_999, { sourceId: "qa-hazard" });
  }

  private teleportPlayer(position: Vec3, facingYaw = Math.PI): void {
    const player = this.state.player;
    player.position = position;
    player.facingYaw = facingYaw;
    player.combat = createCombatState();
    player.animation.state = "idle";
    this.cue(player.animation, null, 0);
    this.controller.teleport(position);
    this.releaseLockOn("manual");
  }

  loadScenario(id: RelicScenario): void {
    if (this.isDisposed) return;
    if (this.state.phase === "title") this.start();
    if (this.state.phase === "downed") {
      this.checkpoints.cancelRespawn(this.state.tick);
      this.state.checkpoint.respawnTick = null;
      this.health.reset(PLAYER_ID, this.state.player.maximumHealth);
      this.state.player.health = this.state.player.maximumHealth;
      this.transition(this.state.relicOwned ? "escape" : this.state.mechanismPowered ? "guardian" : "explore", "qa-load");
    }
    if (id === "fresh") { this.teleportPlayer(PLAYER_SPAWN); this.updateGuidance(); this.emit("scenario-loaded", id); return; }
    if (id === "melee" || id === "player-death") {
      // Known combat state: husk-1 is already closing in along the path axis; husk-2 guards its post until struck.
      for (const enemy of this.state.enemies) if (enemy.encounterId === "ruin-path") { this.resetEnemy(enemy); enemy.behavior = enemy.id === "husk-1" ? "approach" : "hold"; }
      const vanguard = this.enemyById("husk-1");
      if (vanguard !== undefined) { vanguard.position = vec3(0, 0, 4.6); this.ai.setPosition(vanguard.id, vanguard.position); }
      this.teleportPlayer(vec3(0, 0, 7));
      this.updateGuidance();
      this.emit("scenario-loaded", id);
      if (id === "player-death") this.forcePlayerDeath();
      return;
    }
    if (id === "ranged") {
      // Isolate the caster: living path husks guard their posts so only the Warden engages.
      for (const enemy of this.state.enemies) if (enemy.encounterId === "warden-court") this.resetEnemy(enemy);
      for (const enemy of this.state.enemies) if (enemy.encounterId === "ruin-path" && enemy.alive) { this.resetEnemy(enemy); enemy.behavior = "hold"; }
      const escort = this.enemyById("husk-3");
      if (escort !== undefined) { escort.alive = false; escort.combat = { ...createCombatState(), kind: "dead" }; escort.animation.state = "dead"; this.health.reset(escort.id, 0); }
      const warden = this.enemyById("warden-1");
      if (warden !== undefined) warden.behavior = "engaged";
      this.teleportPlayer(vec3(0, 0, -1.5));
      this.updateGuidance();
      this.emit("scenario-loaded", id);
      return;
    }
    for (const pickup of this.state.pickups) if (pickup.kind === "energy-cell" && !pickup.collected) { pickup.collected = true; this.inventory.add(PLAYER_ID, "energy-cell", 1); }
    this.state.energyCells = 3;
    if (id === "checkpoint" || id === "mechanism") {
      for (const enemy of this.state.enemies) if (enemy.encounterId === "warden-court" && enemy.alive) this.resetEnemy(enemy);
      this.teleportPlayer(id === "checkpoint" ? GATE_CHECKPOINT_POSITION : vec3(0, 0, -13.5));
      this.updateGuidance();
      this.emit("scenario-loaded", id);
      return;
    }
    this.state.mechanismPowered = true;
    if (this.state.phase === "explore") this.transition("guardian", "qa-load");
    const boss = this.enemyById("relic-guardian");
    if (id === "guardian" && boss !== undefined && boss.alive) { this.resetEnemy(boss); boss.behavior = "approach"; }
    this.teleportPlayer(vec3(0, 0, -19.5));
    if (id === "escape") {
      if (boss !== undefined) { boss.alive = false; boss.health = 0; boss.combat = { ...createCombatState(), kind: "dead" }; boss.animation.state = "dead"; this.health.reset(boss.id, 0); }
      this.state.relicOwned = true;
      this.inventory.add(PLAYER_ID, "relic", 1);
      this.transition("escape", "qa-load");
      this.teleportPlayer(PLAYER_SPAWN);
    }
    this.updateGuidance();
    this.emit("scenario-loaded", id);
  }

  private guidanceFor(playerId: string): GuidanceState {
    const existing = this.state.guidance[playerId];
    if (existing !== undefined) return existing;
    const created = createGuidanceState(playerId);
    this.state.guidance[playerId] = created;
    return created;
  }

  private updateGuidance(): void {
    const guidance = this.guidanceFor(PLAYER_ID);
    const boss = this.enemyById("relic-guardian");
    const player = this.state.player.position;
    let stage: GuidanceStage = "cells";
    let targetId: string | null = null;
    let target: Vec3 | null = null;
    if (this.state.phase === "title") stage = "start";
    else if (this.state.phase === "downed") { stage = "downed"; targetId = this.state.checkpoint.activeId; target = this.checkpoints.get(this.state.checkpoint.activeId)?.position ?? null; }
    else if (this.state.phase === "results") stage = "complete";
    else if (this.state.relicOwned) { stage = "escape"; targetId = "escape-zone"; target = PLAYER_SPAWN; }
    else if (boss !== undefined && !boss.alive) { stage = "relic"; targetId = "relic"; target = RELIC_POSITION; }
    else if (this.state.mechanismPowered) { stage = "guardian"; targetId = boss?.id ?? null; target = boss?.position ?? null; }
    else if (this.state.energyCells >= 3) { stage = "mechanism"; targetId = "power-console"; target = CONSOLE_POSITION; }
    else {
      let nearest = Number.POSITIVE_INFINITY;
      for (const pickup of this.state.pickups) {
        if (pickup.kind !== "energy-cell" || pickup.collected) continue;
        const distance = distanceXZ(pickup.position, player);
        if (distance < nearest) { nearest = distance; targetId = pickup.id; target = pickup.position; }
      }
    }
    if (stage !== guidance.stage) {
      guidance.stage = stage;
      guidance.step = STAGE_STEPS[stage];
      this.emit("objective-changed", stage, guidance.step);
    }
    guidance.objective = stage === "cells" ? CELL_OBJECTIVES[this.state.energyCells] ?? STAGE_OBJECTIVES.cells : stage === "downed" ? `Redeploying at ${this.state.checkpoint.label}` : STAGE_OBJECTIVES[stage];
    guidance.targetId = targetId;
    guidance.target = target;
    if (target === null) {
      guidance.distance = 0;
      guidance.bearing = 0;
    } else {
      const dx = target.x - player.x;
      const dz = target.z - player.z;
      guidance.distance = Math.hypot(dx, dz);
      guidance.bearing = Math.atan2(dx, -dz) + this.state.input.cameraYaw;
    }
    guidance.prompt = this.promptFor(stage, boss);
  }

  private promptFor(stage: GuidanceStage, boss: EnemyState | undefined): string {
    if (stage === "start" || stage === "complete" || stage === "downed") return "";
    const nearby = this.state.nearby;
    for (const pickup of this.state.pickups) if (!pickup.collected && nearby.has(pickup.id)) return pickup.kind === "energy-cell" ? "E · TAKE ENERGY CELL" : "E · TAKE MEDKIT";
    const chosen = this.state.upgrades.some(({ selected }) => selected);
    for (const upgrade of this.state.upgrades) if (nearby.has(upgrade.id)) return chosen ? (upgrade.selected ? "FIELD UPGRADE ACTIVE" : "ONE UPGRADE PER EXPEDITION") : UPGRADE_PROMPTS[upgrade.kind];
    if (nearby.has("power-console") && !this.state.mechanismPowered) return this.state.energyCells >= 3 ? "E · POWER THE MECHANISM" : "MECHANISM NEEDS 3 ENERGY CELLS";
    if (nearby.has("relic") && boss?.alive === false && !this.state.relicOwned) return "E · CLAIM THE RELIC";
    if (nearby.has("escape-zone") && stage === "escape") return "E · ESCAPE TO BASE CAMP";
    const hostile = this.activeEnemies().filter((enemy) => enemy.behavior !== "dormant");
    if (hostile.length > 0 && this.state.lockOnTargetId === null && hostile.some((enemy) => distanceXZ(enemy.position, this.state.player.position) <= 12)) return "TAB · LOCK ON";
    return "";
  }

  setDebugCamera(enabled: boolean): void { this.renderer?.setDebugCamera(enabled); }

  snapshot(): RelicSnapshot { return snapshotOf(this.state); }
  events(): readonly RelicEvent[] { return Object.freeze([...this.collected]); }
  errors(): readonly RuntimeErrorRecord[] { return Object.freeze([...this.errorRecords]); }
  debugSnapshot(): DebugSnapshot | null { return this.lastDebug; }
  inspectAssets() { return Object.freeze({ ready: this.assetReady, successful: this.assetSuccessful, failureCode: this.assetFailureCode, manager: this.assets.inspect() }); }
  inspectAnimation(): AnimationCharacterSetInspection { return this.characters.inspect(); }
  inspectCombat(): RelicCombatInspection {
    return Object.freeze({ attacks: ATTACKS, lockOn: this.lockOn.inspect(), checkpoint: this.checkpoints.inspect(), hitQuery: this.hitQuery.inspect(), lastRespawnTick: this.lastRespawnTick });
  }
  inspectAudio(): AudioInspection { return this.audio.inspect(); }
  inspectRuntime(): RelicRuntimeInspection {
    const life = this.runtime.inspectLifecycle();
    return Object.freeze({ lifecycleState: life.state, installedFeatureIds: Object.freeze([...life.installedFeatureIds]), scheduleSystemIds: Object.freeze(life.scheduleReport.map(({ systemId }) => systemId)), schedulerTick: this.runtime.tick, debugProviders: this.debug.disposed ? Object.freeze([]) : this.debug.inspect().providerIds });
  }
  inspectRenderer(): RelicRendererInspection | null { return this.renderer?.inspect() ?? null; }
  inspectLeaks(): RelicLeakInspection {
    return Object.freeze({ activeListeners: this.listeners.size, activeFeatures: this.isDisposed ? 0 : this.runtime.inspectLifecycle().installedFeatureIds.length, activeTimers: 0, activeCharacters: this.characters.disposed ? 0 : this.characters.inspect().characters.length, disposed: this.isDisposed });
  }
  subscribe(listener: (event: RelicEvent) => void): () => void { if (this.isDisposed) return () => undefined; this.listeners.add(listener); return () => this.listeners.delete(listener); }
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    void this.runtime.shutdown();
    this.movement.dispose();
    this.actions.dispose();
    this.listeners.clear();
    this.hitQuery.dispose();
    this.lockOn.dispose();
    this.checkpoints.dispose();
  }
}

export function createRelicFrontierGame(options: RelicFrontierGameOptions): RelicFrontierGame {
  return new Game(options);
}
