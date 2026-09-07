export type StrikePhase = "title" | "countdown" | "running" | "results" | "defeated";
export type StrikeAction = "fire" | "reload";
export type StrikeScenario = "fresh" | "duel" | "last-enemy" | "defeat";

export interface StrikeInput {
  readonly moveX: number;
  readonly moveY: number;
  readonly yaw: number;
  readonly pitch: number;
}

export interface StrikeVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface StrikeEnemy {
  readonly id: string;
  position: StrikeVector;
  health: number;
  alive: boolean;
  shotCooldownTicks: number;
}

export interface StrikeEvent {
  readonly kind: "shot" | "hit" | "enemy-defeated" | "reload-started" | "reload-complete" | "player-hit" | "phase-changed";
  readonly tick: number;
  readonly subject?: string;
  readonly from?: StrikeVector;
  readonly to?: StrikeVector;
  readonly value?: number;
}

export interface StrikeSnapshot {
  readonly tick: number;
  readonly time: number;
  readonly phase: StrikePhase;
  readonly countdown: number;
  readonly remainingSeconds: number;
  readonly player: Readonly<{
    readonly position: StrikeVector;
    readonly health: number;
    readonly maximumHealth: number;
    readonly yaw: number;
    readonly pitch: number;
  }>;
  readonly enemies: readonly Readonly<StrikeEnemy>[];
  readonly ammo: number;
  readonly magazineSize: number;
  readonly reserveAmmo: number;
  readonly reloadSeconds: number;
  readonly fireCooldownSeconds: number;
  readonly kills: number;
  readonly targetKills: number;
  readonly shots: number;
  readonly hits: number;
  readonly score: number;
  readonly result: "" | "arena-clear" | "time" | "defeated";
}

export interface MutableStrikeState {
  tick: number;
  phase: StrikePhase;
  countdownTicks: number;
  remainingTicks: number;
  input: StrikeInput;
  player: {
    position: StrikeVector;
    health: number;
    maximumHealth: number;
    yaw: number;
    pitch: number;
  };
  enemies: StrikeEnemy[];
  ammo: number;
  reserveAmmo: number;
  reloadTicks: number;
  fireCooldownTicks: number;
  kills: number;
  shots: number;
  hits: number;
  score: number;
  result: "" | "arena-clear" | "time" | "defeated";
}

export const STRIKE_DT = 1 / 60;
export const MATCH_TICKS = 60 * 60;
export const COUNTDOWN_TICKS = 3 * 60;
export const MAGAZINE_SIZE = 12;
export const RELOAD_TICKS = 66;
export const FIRE_COOLDOWN_TICKS = 7;
export const TARGET_KILLS = 5;

export function strikeVector(x: number, y: number, z: number): StrikeVector {
  return Object.freeze({ x, y, z });
}

const ENEMY_PLACEMENTS = Object.freeze([
  strikeVector(0, 0, -9),
  strikeVector(-9, 0, -13),
  strikeVector(10, 0, -15),
  strikeVector(-13, 0, 3),
  strikeVector(13, 0, 5),
]);

export function createStrikeState(): MutableStrikeState {
  return {
    tick: 0,
    phase: "title",
    countdownTicks: COUNTDOWN_TICKS,
    remainingTicks: MATCH_TICKS,
    input: Object.freeze({ moveX: 0, moveY: 0, yaw: 0, pitch: 0 }),
    player: { position: strikeVector(0, 0, 12), health: 100, maximumHealth: 100, yaw: 0, pitch: 0 },
    enemies: ENEMY_PLACEMENTS.map((position, index) => ({ id: `bot-${index + 1}`, position, health: 100, alive: true, shotCooldownTicks: 50 + index * 13 })),
    ammo: MAGAZINE_SIZE,
    reserveAmmo: 48,
    reloadTicks: 0,
    fireCooldownTicks: 0,
    kills: 0,
    shots: 0,
    hits: 0,
    score: 0,
    result: "",
  };
}

export function snapshotStrike(state: MutableStrikeState): StrikeSnapshot {
  const countdown = state.phase === "countdown" ? Math.max(1, Math.ceil(state.countdownTicks / 60)) : 0;
  return Object.freeze({
    tick: state.tick,
    time: state.tick * STRIKE_DT,
    phase: state.phase,
    countdown,
    remainingSeconds: Math.max(0, state.remainingTicks * STRIKE_DT),
    player: Object.freeze({ ...state.player, position: Object.freeze({ ...state.player.position }) }),
    enemies: Object.freeze(state.enemies.map((enemy) => Object.freeze({ ...enemy, position: Object.freeze({ ...enemy.position }) }))),
    ammo: state.ammo,
    magazineSize: MAGAZINE_SIZE,
    reserveAmmo: state.reserveAmmo,
    reloadSeconds: state.reloadTicks * STRIKE_DT,
    fireCooldownSeconds: state.fireCooldownTicks * STRIKE_DT,
    kills: state.kills,
    targetKills: TARGET_KILLS,
    shots: state.shots,
    hits: state.hits,
    score: state.score,
    result: state.result,
  });
}
