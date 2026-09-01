export type RelicPhase = "title" | "explore" | "guardian" | "escape" | "results" | "defeated";
export type RelicAction = "jump" | "dash" | "attack" | "ability" | "interact" | "use-item";
export type RelicScenario = "fresh" | "mechanism" | "guardian" | "escape";
export type EnemyKind = "drone" | "shooter" | "sentinel" | "boss";
export type UpgradeKind = "dash" | "projectile" | "health";
export type GuidanceStage = "start" | "cells" | "mechanism" | "guardian" | "relic" | "escape" | "complete" | "failed";

export interface Vec3 { readonly x: number; readonly y: number; readonly z: number; }
export interface SemanticInput { readonly moveX: number; readonly moveY: number; readonly cameraYaw: number; }
export interface EnemyState {
  readonly id: string;
  readonly kind: EnemyKind;
  position: Vec3;
  health: number;
  maximumHealth: number;
  alive: boolean;
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
export interface RelicSnapshot {
  readonly tick: number;
  readonly time: number;
  readonly phase: RelicPhase;
  readonly objective: string;
  readonly player: Readonly<{
    readonly position: Vec3;
    readonly velocity: Vec3;
    readonly health: number;
    readonly maximumHealth: number;
    readonly grounded: boolean;
    readonly dashCooldownTicks: number;
    readonly pulseCooldownTicks: number;
    readonly animation: "idle" | "run" | "jump" | "dash" | "attack";
  }>;
  readonly enemies: readonly Readonly<EnemyState>[];
  readonly pickups: readonly Readonly<PickupState>[];
  readonly upgrades: readonly Readonly<UpgradeState>[];
  readonly guidance: Readonly<Record<string, Readonly<GuidanceState>>>;
  readonly energyCells: number;
  readonly healthPacks: number;
  readonly relicOwned: boolean;
  readonly mechanismPowered: boolean;
  readonly defeatedEnemies: number;
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
    health: number;
    maximumHealth: number;
    grounded: boolean;
    dashTicks: number;
    dashCooldownTicks: number;
    pulseCooldownTicks: number;
    animation: "idle" | "run" | "jump" | "dash" | "attack";
  };
  enemies: EnemyState[];
  pickups: PickupState[];
  upgrades: UpgradeState[];
  guidance: Record<string, GuidanceState>;
  nearby: Set<string>;
  energyCells: number;
  healthPacks: number;
  relicOwned: boolean;
  mechanismPowered: boolean;
  defeatedEnemies: number;
  score: number;
  elapsedTicks: number;
}

export const DT = 1 / 60;
export const PLAYER_ID = "player";
export const PLAYER_SPAWN: Vec3 = Object.freeze({ x: 0, y: 0, z: 18 });
export const NEUTRAL_INPUT: SemanticInput = Object.freeze({ moveX: 0, moveY: 0, cameraYaw: 0 });
export const CONSOLE_POSITION: Vec3 = Object.freeze({ x: 0, y: 0, z: -16 });
export const RELIC_POSITION: Vec3 = Object.freeze({ x: 0, y: 0, z: -26 });

export function vec3(x: number, y: number, z: number): Vec3 {
  return Object.freeze({ x, y, z });
}

export function distanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function createGuidanceState(playerId: string): GuidanceState {
  return { playerId, stage: "start", step: 0, objective: "Begin the expedition", targetId: null, target: null, distance: 0, bearing: 0, prompt: "", onboardingVisible: false };
}

export function createRelicState(): MutableRelicState {
  return {
    tick: 0,
    phase: "title",
    input: NEUTRAL_INPUT,
    player: {
      position: PLAYER_SPAWN,
      velocity: vec3(0, 0, 0),
      health: 100,
      maximumHealth: 100,
      grounded: true,
      dashTicks: 0,
      dashCooldownTicks: 0,
      pulseCooldownTicks: 0,
      animation: "idle",
    },
    enemies: [
      { id: "drone-1", kind: "drone", position: vec3(-10, 2, 5), health: 45, maximumHealth: 45, alive: true },
      { id: "shooter-1", kind: "shooter", position: vec3(11, 0, 1), health: 55, maximumHealth: 55, alive: true },
      { id: "sentinel-1", kind: "sentinel", position: vec3(-2, 0, -9), health: 80, maximumHealth: 80, alive: true },
      { id: "relic-guardian", kind: "boss", position: vec3(0, 0, -22), health: 180, maximumHealth: 180, alive: true },
    ],
    pickups: [
      { id: "cell-garden", kind: "energy-cell", position: vec3(-13, 0, 7), collected: false },
      { id: "cell-power", kind: "energy-cell", position: vec3(12, 0, -5), collected: false },
      { id: "cell-tower", kind: "energy-cell", position: vec3(-7, 2.5, -13), collected: false },
      { id: "medkit-camp", kind: "health-pack", position: vec3(4, 0, 15), collected: false },
      { id: "medkit-ruin", kind: "health-pack", position: vec3(8, 0, -10), collected: false },
    ],
    upgrades: [
      { id: "upgrade-dash", kind: "dash", position: vec3(-6, 0, 11), selected: false },
      { id: "upgrade-projectile", kind: "projectile", position: vec3(0, 0, 9), selected: false },
      { id: "upgrade-health", kind: "health", position: vec3(6, 0, 11), selected: false },
    ],
    guidance: { [PLAYER_ID]: createGuidanceState(PLAYER_ID) },
    nearby: new Set(),
    energyCells: 0,
    healthPacks: 0,
    relicOwned: false,
    mechanismPowered: false,
    defeatedEnemies: 0,
    score: 0,
    elapsedTicks: 0,
  };
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
    player: Object.freeze({ ...state.player, position: Object.freeze({ ...state.player.position }), velocity: Object.freeze({ ...state.player.velocity }) }),
    enemies: Object.freeze(state.enemies.map((enemy) => Object.freeze({ ...enemy, position: Object.freeze({ ...enemy.position }) }))),
    pickups: Object.freeze(state.pickups.map((pickup) => Object.freeze({ ...pickup, position: Object.freeze({ ...pickup.position }) }))),
    upgrades: Object.freeze(state.upgrades.map((upgrade) => Object.freeze({ ...upgrade, position: Object.freeze({ ...upgrade.position }) }))),
    guidance: snapshotGuidance(state),
    energyCells: state.energyCells,
    healthPacks: state.healthPacks,
    relicOwned: state.relicOwned,
    mechanismPowered: state.mechanismPowered,
    defeatedEnemies: state.defeatedEnemies,
    score: state.score,
    elapsedSeconds: state.elapsedTicks * DT,
  });
}
