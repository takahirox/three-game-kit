export type RoundPhase =
  | "title"
  | "countdown"
  | "running"
  | "timeUp"
  | "results";
export type OneShotAction = "jump" | "dash" | "interact";
export type CoreKind = "blue" | "gold" | "red";

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Semantic (device-independent) input. Axes are clamped to [-1, 1]. */
export interface SemanticInput {
  readonly moveX: number;
  readonly moveY: number;
  readonly cameraYaw: number;
}

export interface RoundState {
  phase: RoundPhase;
  countdownTicks: number;
  roundTicks: number;
  timeUpTicks: number;
}

export interface PlayerState {
  position: Vec3;
  velocity: Vec3;
  facing: Vec3;
  grounded: boolean;
  dashTicks: number;
  dashCooldownTicks: number;
  speedMultiplier: number;
  inHazard: boolean;
  onPlatform: boolean;
}

export interface CoreState {
  readonly id: number;
  readonly kind: CoreKind;
  readonly value: number;
  readonly position: Vec3;
  collected: boolean;
}

export interface CarryState {
  coreId: number | null;
  lastDepositTick: number;
}

export interface ScoreState {
  score: number;
  deposits: number;
}

export interface ComboState {
  count: number;
  windowTicks: number;
}

export interface PlatformState {
  position: Vec3;
}

export interface CoreRunState {
  tick: number;
  input: SemanticInput;
  round: RoundState;
  player: PlayerState;
  cores: CoreState[];
  carry: CarryState;
  score: ScoreState;
  combo: ComboState;
  platform: PlatformState;
}

export type TelemetryEvent = Readonly<
  | { kind: "phaseChanged"; tick: number; from: RoundPhase; to: RoundPhase }
  | { kind: "countdown"; tick: number; value: number | "go" }
  | { kind: "jump"; tick: number }
  | { kind: "dash"; tick: number }
  | { kind: "corePickedUp"; tick: number; coreId: number; coreKind: CoreKind }
  | {
      kind: "coreDeposited";
      tick: number;
      coreId: number;
      value: number;
      combo: number;
      points: number;
      score: number;
    }
  | { kind: "comboExpired"; tick: number; combo: number }
  | { kind: "jumpPad"; tick: number }
  | { kind: "hazardEntered"; tick: number }
  | { kind: "hazardExited"; tick: number }
  | { kind: "runtimeError"; tick: number; featureId: string; message: string }
>;

export interface CoreRunSnapshot {
  readonly tick: number;
  readonly time: number;
  readonly phase: RoundPhase;
  readonly countdownValue: number | null;
  readonly remainingSeconds: number;
  readonly player: Readonly<PlayerState>;
  readonly cores: readonly Readonly<CoreState>[];
  readonly carry: Readonly<CarryState>;
  readonly score: Readonly<ScoreState>;
  readonly combo: Readonly<ComboState>;
  readonly platform: Readonly<PlatformState>;
}

export const ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
export const PLAYER_SPAWN: Vec3 = Object.freeze({ x: 0, y: 0, z: 6 });
export const NEUTRAL_INPUT: SemanticInput = Object.freeze({
  moveX: 0,
  moveY: 0,
  cameraYaw: 0,
});

export function vec3(x: number, y: number, z: number): Vec3 {
  return Object.freeze({ x, y, z });
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function distanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function createPlayerState(): PlayerState {
  return {
    position: PLAYER_SPAWN,
    velocity: ZERO,
    facing: vec3(0, 0, -1),
    grounded: true,
    dashTicks: 0,
    dashCooldownTicks: 0,
    speedMultiplier: 1,
    inHazard: false,
    onPlatform: false,
  };
}

/** A fresh state before any Feature has reset its own slice. */
export function createCoreRunState(): CoreRunState {
  return {
    tick: 0,
    input: NEUTRAL_INPUT,
    round: { phase: "title", countdownTicks: 0, roundTicks: 0, timeUpTicks: 0 },
    player: createPlayerState(),
    cores: [],
    carry: { coreId: null, lastDepositTick: -1 },
    score: { score: 0, deposits: 0 },
    combo: { count: 0, windowTicks: 0 },
    platform: { position: ZERO },
  };
}
