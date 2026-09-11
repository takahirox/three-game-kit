export type RelicPhase = "title" | "explore" | "guardian" | "escape" | "downed" | "results";
export type RelicAction = "attack-light" | "attack-heavy" | "dodge" | "lock-on" | "ability" | "interact" | "use-item";
export type RelicScenario = "fresh" | "melee" | "ranged" | "checkpoint" | "mechanism" | "guardian" | "player-death" | "escape";
export type EnemyKind = "husk" | "warden" | "boss";
export type UpgradeKind = "dodge" | "projectile" | "health";
export type GuidanceStage = "start" | "cells" | "mechanism" | "guardian" | "relic" | "escape" | "complete" | "downed";
export type LocomotionState = "idle" | "walk" | "run" | "dead";
export type OneShotClip = "attack-light" | "attack-light-2" | "attack-heavy" | "dodge-roll" | "hit-react" | "stagger" | "cast";
export type CombatStateKind = "idle" | "attack" | "dodge" | "hit" | "stagger" | "dead";
export type CombatPhase = "startup" | "active" | "recovery";
export type PlayerAttackId = "light-1" | "light-2" | "heavy";
export type EnemyAttackId = "husk-slash" | "warden-bolt" | "guardian-sweep" | "guardian-slam" | "guardian-volley";
export type AttackId = PlayerAttackId | EnemyAttackId;
export type EnemyBehavior = "dormant" | "approach" | "hold" | "retreat" | "engaged";

export interface Vec3 { readonly x: number; readonly y: number; readonly z: number; }
export interface SemanticInput { readonly moveX: number; readonly moveY: number; readonly cameraYaw: number; }

/** Presentation cue derived from simulation: the looping state plus the latest one-shot request. */
export interface AnimationCue {
  state: LocomotionState;
  oneShot: OneShotClip | null;
  sequence: number;
  durationTicks: number;
}

export interface CombatState {
  kind: CombatStateKind;
  attackId: AttackId | null;
  phase: CombatPhase | null;
  ticks: number;
  totalTicks: number;
  invulnerable: boolean;
  comboQueued: boolean;
  hitTargets: string[];
  dodgedBy: string[];
  poise: number;
}

export interface EnemyState {
  readonly id: string;
  readonly kind: EnemyKind;
  readonly encounterId: string;
  readonly spawn: Vec3;
  position: Vec3;
  facingYaw: number;
  health: number;
  maximumHealth: number;
  alive: boolean;
  behavior: EnemyBehavior;
  combat: CombatState;
  animation: AnimationCue;
  attackCooldownTicks: number;
  attackCounter: number;
  slamTarget: Vec3 | null;
}
export interface PickupState {
  readonly id: string;
  readonly kind: "energy-cell" | "health-pack";
  readonly position: Vec3;
  collected: boolean;
}
export interface UpgradeState {
  readonly id: string;
  readonly kind: UpgradeKind;
  readonly position: Vec3;
  selected: boolean;
}
export interface GuidanceState {
  readonly playerId: string;
  stage: GuidanceStage;
  step: number;
  objective: string;
  targetId: string | null;
  target: Vec3 | null;
  distance: number;
  bearing: number;
  prompt: string;
  onboardingVisible: boolean;
}
export type RelicEvent = Readonly<{
  readonly kind: string;
  readonly tick: number;
  readonly subject?: string;
  readonly value?: number;
}>;

export interface PlayerSnapshot {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly facingYaw: number;
  readonly health: number;
  readonly maximumHealth: number;
  readonly grounded: boolean;
  readonly dodgeCooldownTicks: number;
  readonly pulseCooldownTicks: number;
  readonly combat: Readonly<CombatState>;
  readonly animation: Readonly<AnimationCue>;
}

export interface RelicSnapshot {
  readonly tick: number;
  readonly time: number;
  readonly phase: RelicPhase;
  readonly objective: string;
  readonly player: PlayerSnapshot;
  readonly enemies: readonly Readonly<EnemyState>[];
  readonly pickups: readonly Readonly<PickupState>[];
  readonly upgrades: readonly Readonly<UpgradeState>[];
  readonly guidance: Readonly<Record<string, Readonly<GuidanceState>>>;
  readonly lockOn: Readonly<{ readonly targetId: string | null }>;
  readonly checkpoint: Readonly<{ readonly activeId: string; readonly label: string; readonly respawnTick: number | null; readonly respawnCount: number }>;
  readonly energyCells: number;
  readonly healthPacks: number;
  readonly relicOwned: boolean;
  readonly mechanismPowered: boolean;
  readonly defeatedEnemies: number;
  readonly deaths: number;
  readonly score: number;
  readonly elapsedSeconds: number;
}

export interface MutableRelicState {
  tick: number;
  phase: RelicPhase;
  input: SemanticInput;
  player: {
    position: Vec3;
    velocity: Vec3;
    facingYaw: number;
    health: number;
    maximumHealth: number;
    grounded: boolean;
    dodgeCooldownTicks: number;
    pulseCooldownTicks: number;
    dodgeDirection: Vec3;
    combat: CombatState;
    animation: AnimationCue;
  };
  enemies: EnemyState[];
  pickups: PickupState[];
  upgrades: UpgradeState[];
  guidance: Record<string, GuidanceState>;
  nearby: Set<string>;
  lockOnTargetId: string | null;
  checkpoint: { activeId: string; label: string; respawnTick: number | null; respawnCount: number };
  energyCells: number;
  healthPacks: number;
  relicOwned: boolean;
  mechanismPowered: boolean;
  defeatedEnemies: number;
  deaths: number;
  score: number;
  elapsedTicks: number;
}

export const DT = 1 / 60;
export const PLAYER_ID = "player";
export const PLAYER_SPAWN: Vec3 = Object.freeze({ x: 0, y: 0, z: 18 });
export const NEUTRAL_INPUT: SemanticInput = Object.freeze({ moveX: 0, moveY: 0, cameraYaw: 0 });
export const CONSOLE_POSITION: Vec3 = Object.freeze({ x: 0, y: 0, z: -16 });
export const RELIC_POSITION: Vec3 = Object.freeze({ x: 0, y: 0, z: -26 });
export const GATE_CHECKPOINT_POSITION: Vec3 = Object.freeze({ x: 0, y: 0, z: -12.5 });
export const CHECKPOINTS = Object.freeze([
  Object.freeze({ id: "checkpoint-camp", position: PLAYER_SPAWN, label: "BASE CAMP" }),
  Object.freeze({ id: "checkpoint-gate", position: GATE_CHECKPOINT_POSITION, label: "CHAMBER GATE" }),
]);
export const RESPAWN_DELAY_TICKS = 150;

export function vec3(x: number, y: number, z: number): Vec3 {
  return Object.freeze({ x, y, z });
}

export function distanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function yawTowards(from: Vec3, to: Vec3, fallback: number): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return dx === 0 && dz === 0 ? fallback : Math.atan2(dx, dz);
}

export function createCombatState(): CombatState {
  return { kind: "idle", attackId: null, phase: null, ticks: 0, totalTicks: 0, invulnerable: false, comboQueued: false, hitTargets: [], dodgedBy: [], poise: 0 };
}

export function createAnimationCue(): AnimationCue {
  return { state: "idle", oneShot: null, sequence: 0, durationTicks: 0 };
}

export function createGuidanceState(playerId: string): GuidanceState {
  return { playerId, stage: "start", step: 0, objective: "Begin the expedition", targetId: null, target: null, distance: 0, bearing: 0, prompt: "", onboardingVisible: false };
}

const ENEMY_ROSTER: readonly Readonly<{ id: string; kind: EnemyKind; encounterId: string; spawn: Vec3; health: number }>[] = Object.freeze([
  { id: "husk-1", kind: "husk", encounterId: "ruin-path", spawn: vec3(-2.6, 0, 2.5), health: 60 },
  { id: "husk-2", kind: "husk", encounterId: "ruin-path", spawn: vec3(2.8, 0, 0.5), health: 60 },
  { id: "warden-1", kind: "warden", encounterId: "warden-court", spawn: vec3(0.5, 0, -9.5), health: 50 },
  { id: "husk-3", kind: "husk", encounterId: "warden-court", spawn: vec3(-3.4, 0, -6.5), health: 60 },
  { id: "relic-guardian", kind: "boss", encounterId: "guardian", spawn: vec3(0, 0, -23.5), health: 240 },
]);

export function createEnemyState(definition: (typeof ENEMY_ROSTER)[number]): EnemyState {
  return {
    id: definition.id,
    kind: definition.kind,
    encounterId: definition.encounterId,
    spawn: definition.spawn,
    position: definition.spawn,
    facingYaw: Math.PI,
    health: definition.health,
    maximumHealth: definition.health,
    alive: true,
    behavior: "dormant",
    combat: createCombatState(),
    animation: createAnimationCue(),
    attackCooldownTicks: 0,
    attackCounter: 0,
    slamTarget: null,
  };
}

export function createRelicState(): MutableRelicState {
  return {
    tick: 0,
    phase: "title",
    input: NEUTRAL_INPUT,
    player: {
      position: PLAYER_SPAWN,
      velocity: vec3(0, 0, 0),
      facingYaw: Math.PI,
      health: 100,
      maximumHealth: 100,
      grounded: true,
      dodgeCooldownTicks: 0,
      pulseCooldownTicks: 0,
      dodgeDirection: vec3(0, 0, -1),
      combat: createCombatState(),
      animation: createAnimationCue(),
    },
    enemies: ENEMY_ROSTER.map(createEnemyState),
    pickups: [
      { id: "cell-garden", kind: "energy-cell", position: vec3(-13, 0, 7), collected: false },
      { id: "cell-power", kind: "energy-cell", position: vec3(12, 0, -5), collected: false },
      { id: "cell-tower", kind: "energy-cell", position: vec3(-8, 0, -13), collected: false },
      { id: "medkit-camp", kind: "health-pack", position: vec3(4, 0, 15), collected: false },
      { id: "medkit-ruin", kind: "health-pack", position: vec3(8, 0, -10), collected: false },
    ],
    upgrades: [
      { id: "upgrade-dodge", kind: "dodge", position: vec3(-6, 0, 11), selected: false },
      { id: "upgrade-projectile", kind: "projectile", position: vec3(0, 0, 9), selected: false },
      { id: "upgrade-health", kind: "health", position: vec3(6, 0, 11), selected: false },
    ],
    guidance: { [PLAYER_ID]: createGuidanceState(PLAYER_ID) },
    nearby: new Set(),
    lockOnTargetId: null,
    checkpoint: { activeId: "checkpoint-camp", label: "BASE CAMP", respawnTick: null, respawnCount: 0 },
    energyCells: 0,
    healthPacks: 0,
    relicOwned: false,
    mechanismPowered: false,
    defeatedEnemies: 0,
    deaths: 0,
    score: 0,
    elapsedTicks: 0,
  };
}

function freezeCombat(combat: CombatState): Readonly<CombatState> {
  return Object.freeze({ ...combat, hitTargets: Object.freeze([...combat.hitTargets]) as string[], dodgedBy: Object.freeze([...combat.dodgedBy]) as string[] });
}

function snapshotGuidance(state: MutableRelicState): Readonly<Record<string, Readonly<GuidanceState>>> {
  const result: Record<string, Readonly<GuidanceState>> = {};
  for (const [playerId, guidance] of Object.entries(state.guidance)) {
    result[playerId] = Object.freeze({
      ...guidance,
      target: guidance.target === null ? null : Object.freeze({ ...guidance.target }),
    });
  }
  return Object.freeze(result);
}

export function snapshotOf(state: MutableRelicState): RelicSnapshot {
  return Object.freeze({
    tick: state.tick,
    time: state.tick * DT,
    phase: state.phase,
    objective: state.guidance[PLAYER_ID]?.objective ?? "",
    player: Object.freeze({
      position: Object.freeze({ ...state.player.position }),
      velocity: Object.freeze({ ...state.player.velocity }),
      facingYaw: state.player.facingYaw,
      health: state.player.health,
      maximumHealth: state.player.maximumHealth,
      grounded: state.player.grounded,
      dodgeCooldownTicks: state.player.dodgeCooldownTicks,
      pulseCooldownTicks: state.player.pulseCooldownTicks,
      combat: freezeCombat(state.player.combat),
      animation: Object.freeze({ ...state.player.animation }),
    }),
    enemies: Object.freeze(state.enemies.map((enemy) => Object.freeze({
      ...enemy,
      position: Object.freeze({ ...enemy.position }),
      slamTarget: enemy.slamTarget === null ? null : Object.freeze({ ...enemy.slamTarget }),
      combat: freezeCombat(enemy.combat),
      animation: Object.freeze({ ...enemy.animation }),
    }))),
    pickups: Object.freeze(state.pickups.map((pickup) => Object.freeze({ ...pickup, position: Object.freeze({ ...pickup.position }) }))),
    upgrades: Object.freeze(state.upgrades.map((upgrade) => Object.freeze({ ...upgrade, position: Object.freeze({ ...upgrade.position }) }))),
    guidance: snapshotGuidance(state),
    lockOn: Object.freeze({ targetId: state.lockOnTargetId }),
    checkpoint: Object.freeze({ ...state.checkpoint }),
    energyCells: state.energyCells,
    healthPacks: state.healthPacks,
    relicOwned: state.relicOwned,
    mechanismPowered: state.mechanismPowered,
    defeatedEnemies: state.defeatedEnemies,
    deaths: state.deaths,
    score: state.score,
    elapsedSeconds: state.elapsedTicks * DT,
  });
}
