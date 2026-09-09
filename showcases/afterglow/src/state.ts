export type Phase = "title" | "countdown" | "running" | "results";
export type Action =
  | "jump"
  | "boost-start"
  | "boost-end"
  | "throttle-start"
  | "throttle-end"
  | "brake-start"
  | "brake-end"
  | "start"
  | "restart";
export type DeathCause = "laser" | "fall" | "crash" | "overheat";
export type Scenario = "start" | "gap" | "laser" | "boost" | "slalom" | "finish";
export type Medal = "gold" | "silver" | "bronze" | "none";
export type HazardKind = "gap" | "gate" | "boost" | "pillar" | "checkpoint" | "finish";
export type GateKind = "low" | "left" | "right" | "center";

export interface Vec3 { readonly x: number; readonly y: number; readonly z: number; }

export interface HeldInput {
  readonly throttle: boolean;
  readonly brake: boolean;
  readonly boost: boolean;
}

export interface GhostSample { readonly s: number; readonly x: number; readonly h: number; }

export interface CarSnapshot {
  readonly s: number;
  readonly x: number;
  readonly h: number;
  readonly verticalSpeed: number;
  readonly speed: number;
  readonly steering: number;
  readonly heading: number;
  readonly position: Vec3;
  readonly heat: number;
  readonly boosting: boolean;
  readonly grounded: boolean;
  readonly alive: boolean;
  readonly deathCause: DeathCause | null;
  readonly respawnTicks: number;
}

export interface CueSnapshot {
  readonly kind: HazardKind | null;
  readonly label: string;
  readonly distance: number;
}

export interface AfterglowSnapshot {
  readonly tick: number;
  readonly time: number;
  readonly phase: Phase;
  readonly countdownSeconds: number;
  readonly elapsedSeconds: number;
  readonly car: CarSnapshot;
  readonly steer: number;
  readonly held: HeldInput;
  readonly checkpointsPassed: number;
  readonly checkpointCount: number;
  readonly deaths: number;
  readonly bestTimeSeconds: number | null;
  readonly ghost: GhostSample | null;
  readonly ghostSampleCount: number;
  readonly cue: CueSnapshot;
  readonly medal: Medal;
  readonly newRecord: boolean;
  readonly finishTimeSeconds: number | null;
  readonly trackLength: number;
}

export type AfterglowEvent = Readonly<{
  readonly kind: string;
  readonly tick: number;
  readonly subject?: string;
  readonly value?: number;
}>;

export interface MutableCar {
  s: number;
  x: number;
  h: number;
  verticalSpeed: number;
  speed: number;
  steering: number;
  heading: number;
  position: Vec3;
  heat: number;
  boosting: boolean;
  grounded: boolean;
  alive: boolean;
  deathCause: DeathCause | null;
  respawnTicks: number;
}

export interface MutableState {
  tick: number;
  phase: Phase;
  countdownTicks: number;
  elapsedTicks: number;
  car: MutableCar;
  steer: number;
  held: HeldInput;
  checkpointsPassed: number;
  checkpointIndex: number;
  deaths: number;
  bestTimeMs: number | null;
  bestGhost: readonly GhostSample[];
  runGhost: GhostSample[];
  cue: CueSnapshot;
  medal: Medal;
  newRecord: boolean;
  finishTimeMs: number | null;
  triggered: Set<string>;
  passed: Set<string>;
}

export const DT = 1 / 60;
export const PLAYER_ID = "pilot";
export const CAR_ID = "afterglow-car";
export const DRIVER_SEAT = "cockpit";
export const SAVE_SLOT = "meridian-descent";
export const SAVE_VERSION = 1;
export const GHOST_INTERVAL_TICKS = 3;
export const COUNTDOWN_TICKS = 90;
export const RESPAWN_TICKS = 48;
export const NEUTRAL_HELD: HeldInput = Object.freeze({ throttle: false, brake: false, boost: false });
export const NO_CUE: CueSnapshot = Object.freeze({ kind: null, label: "", distance: 0 });

export const TUNING = Object.freeze({
  maxSpeed: 46,
  boostSpeed: 64,
  acceleration: 22,
  boostAcceleration: 30,
  braking: 34,
  drag: 0.32,
  lateralSpeed: 13,
  steeringResponse: 9,
  jumpSpeed: 9.6,
  gravity: 22,
  heatRise: 0.5,
  heatFall: 0.42,
  boostPadGain: 14,
  respawnSpeed: 22,
  wallScrape: 0.008,
  carHalfWidth: 1.05,
  lowBarClearance: 1.15,
  pillarHalfWidth: 0.85,
  pillarHeight: 4,
});

export const MEDAL_SECONDS = Object.freeze({ gold: 44, silver: 55, bronze: 75 });

export function vec3(x: number, y: number, z: number): Vec3 {
  return Object.freeze({ x, y, z });
}

export function createCar(): MutableCar {
  return {
    s: 0,
    x: 0,
    h: 0,
    verticalSpeed: 0,
    speed: 0,
    steering: 0,
    heading: 0,
    position: vec3(0, 0, 0),
    heat: 0,
    boosting: false,
    grounded: true,
    alive: true,
    deathCause: null,
    respawnTicks: 0,
  };
}

export function createState(): MutableState {
  return {
    tick: 0,
    phase: "title",
    countdownTicks: 0,
    elapsedTicks: 0,
    car: createCar(),
    steer: 0,
    held: NEUTRAL_HELD,
    checkpointsPassed: 0,
    checkpointIndex: 0,
    deaths: 0,
    bestTimeMs: null,
    bestGhost: Object.freeze([]),
    runGhost: [],
    cue: NO_CUE,
    medal: "none",
    newRecord: false,
    finishTimeMs: null,
    triggered: new Set(),
    passed: new Set(),
  };
}

export function medalFor(seconds: number): Medal {
  if (seconds <= MEDAL_SECONDS.gold) return "gold";
  if (seconds <= MEDAL_SECONDS.silver) return "silver";
  if (seconds <= MEDAL_SECONDS.bronze) return "bronze";
  return "none";
}

export function formatTime(seconds: number): string {
  const whole = Math.max(0, seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
}

export function ghostAt(samples: readonly GhostSample[], elapsedTicks: number): GhostSample | null {
  if (samples.length === 0) return null;
  const exact = elapsedTicks / GHOST_INTERVAL_TICKS;
  const index = Math.floor(exact);
  const first = samples[Math.min(index, samples.length - 1)];
  const second = samples[Math.min(index + 1, samples.length - 1)];
  if (first === undefined || second === undefined) return null;
  const amount = Math.min(1, Math.max(0, exact - index));
  return Object.freeze({
    s: first.s + (second.s - first.s) * amount,
    x: first.x + (second.x - first.x) * amount,
    h: first.h + (second.h - first.h) * amount,
  });
}

export function snapshotOf(state: MutableState, checkpointCount: number, trackLength: number): AfterglowSnapshot {
  const car = state.car;
  return Object.freeze({
    tick: state.tick,
    time: state.tick * DT,
    phase: state.phase,
    countdownSeconds: state.countdownTicks * DT,
    elapsedSeconds: state.elapsedTicks * DT,
    car: Object.freeze({ ...car, position: Object.freeze({ ...car.position }) }),
    steer: state.steer,
    held: state.held,
    checkpointsPassed: state.checkpointsPassed,
    checkpointCount,
    deaths: state.deaths,
    bestTimeSeconds: state.bestTimeMs === null ? null : state.bestTimeMs / 1000,
    ghost: state.phase === "running" ? ghostAt(state.bestGhost, state.elapsedTicks) : null,
    ghostSampleCount: state.bestGhost.length,
    cue: state.cue,
    medal: state.medal,
    newRecord: state.newRecord,
    finishTimeSeconds: state.finishTimeMs === null ? null : state.finishTimeMs / 1000,
    trackLength,
  });
}
