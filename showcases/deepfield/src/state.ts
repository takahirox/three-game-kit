import type { Vec3 } from "./world.js";

export type Phase = "title" | "playing" | "dead" | "complete";
export type Action =
  | "jump"
  | "mine-start"
  | "mine-end"
  | "place"
  | "sprint-start"
  | "sprint-end"
  | "select-1" | "select-2" | "select-3" | "select-4" | "select-5" | "select-6" | "select-7" | "select-8" | "select-9"
  | "next-slot"
  | "previous-slot"
  | "start"
  | "continue"
  | "respawn"
  | "save";
export type Scenario = "spawn" | "tree" | "stone" | "iron" | "diamond" | "cliff" | "water";

export interface HeldInput { readonly mine: boolean; readonly sprint: boolean; }
export interface MoveInput { readonly x: number; readonly z: number; }

export interface TargetSnapshot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly normal: Vec3;
  readonly blockKey: string;
  readonly blockName: string;
  readonly distance: number;
}

export interface HotbarSlot { readonly key: string; readonly name: string; readonly count: number; readonly color: number; }
export interface ObjectiveSnapshot { readonly id: string; readonly label: string; readonly current: number; readonly target: number; readonly done: boolean; }

export interface PlayerSnapshot {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  readonly grounded: boolean;
  readonly inWater: boolean;
  readonly eyeInWater: boolean;
  readonly sprinting: boolean;
  readonly health: number;
  readonly maximumHealth: number;
}

export interface DeepfieldSnapshot {
  readonly tick: number;
  readonly time: number;
  readonly phase: Phase;
  readonly seed: number;
  readonly spawn: Vec3;
  readonly player: PlayerSnapshot;
  readonly move: MoveInput;
  readonly held: HeldInput;
  readonly target: TargetSnapshot | null;
  readonly mining: Readonly<{ readonly progress: number; readonly blockKey: string | null }>;
  readonly selectedSlot: number;
  readonly hotbar: readonly HotbarSlot[];
  readonly objectives: readonly ObjectiveSnapshot[];
  readonly allObjectivesDone: boolean;
  readonly stats: Readonly<{ readonly mined: number; readonly placed: number; readonly deaths: number; readonly minedByKey: Readonly<Record<string, number>> }>;
  readonly timeOfDay: number;
  readonly day: number;
  readonly playTimeSeconds: number;
  readonly editCount: number;
  readonly hasSave: boolean;
  readonly lastSaveTick: number | null;
  readonly respawnTicks: number;
}

export type DeepfieldEvent = Readonly<{
  readonly kind: string;
  readonly tick: number;
  readonly subject?: string;
  readonly value?: number;
}>;

export interface MutablePlayer {
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  grounded: boolean;
  inWater: boolean;
  eyeInWater: boolean;
  sprinting: boolean;
  health: number;
  maximumHealth: number;
  lastDamageTick: number;
  regenTick: number;
}

export interface MutableState {
  tick: number;
  phase: Phase;
  player: MutablePlayer;
  move: MoveInput;
  held: HeldInput;
  target: TargetSnapshot | null;
  miningProgress: number;
  miningKey: string | null;
  selectedSlot: number;
  stats: { mined: number; placed: number; deaths: number; minedByKey: Record<string, number> };
  timeTicks: number;
  playTicks: number;
  hasSave: boolean;
  lastSaveTick: number | null;
  dirtySinceSave: boolean;
  respawnTicks: number;
  completedAnnounced: boolean;
}

export const DT = 1 / 60;
export const PLAYER_ID = "pilot";
export const SAVE_SLOT = "deepfield-world";
export const SAVE_VERSION = 1;
export const DEFAULT_SEED = 1337;
export const DAY_TICKS = 60 * 240;
export const START_TIME = 0.27;
export const RESPAWN_TICKS = 90;
export const AUTOSAVE_TICKS = 600;
export const NEUTRAL_MOVE: MoveInput = Object.freeze({ x: 0, z: 0 });
export const NEUTRAL_HELD: HeldInput = Object.freeze({ mine: false, sprint: false });

export const TUNING = Object.freeze({
  halfWidth: 0.3,
  height: 1.8,
  eyeHeight: 1.62,
  walkSpeed: 4.3,
  sprintSpeed: 6.4,
  waterSpeed: 2.2,
  airControl: 0.55,
  gravity: 28,
  waterGravity: 6,
  jumpSpeed: 8.6,
  swimSpeed: 3.6,
  terminalSpeed: 40,
  waterTerminalSpeed: 3,
  reach: 6,
  fallDamageSpeed: 15,
  fallDamageScale: 1.6,
  maximumHealth: 20,
  regenIntervalTicks: 240,
  regenDelayTicks: 300,
});

export interface ObjectiveDefinition { readonly id: string; readonly label: string; readonly key: string | null; readonly target: number; }
export const OBJECTIVES: readonly ObjectiveDefinition[] = Object.freeze([
  { id: "logs", label: "Punch a tree: gather oak logs", key: "log", target: 8 },
  { id: "stone", label: "Dig deep: mine stone", key: "stone", target: 32 },
  { id: "iron", label: "Strike iron: mine iron ore", key: "iron-ore", target: 3 },
  { id: "diamond", label: "Find a diamond", key: "diamond-ore", target: 1 },
  { id: "build", label: "Build something: place blocks", key: null, target: 16 },
]);

export function vec3(x: number, y: number, z: number): Vec3 {
  return Object.freeze({ x, y, z });
}

export function createPlayer(spawn: Vec3): MutablePlayer {
  return {
    position: spawn,
    velocity: vec3(0, 0, 0),
    yaw: 0,
    pitch: 0,
    grounded: false,
    inWater: false,
    eyeInWater: false,
    sprinting: false,
    health: TUNING.maximumHealth,
    maximumHealth: TUNING.maximumHealth,
    lastDamageTick: -10_000,
    regenTick: 0,
  };
}

export function createState(spawn: Vec3): MutableState {
  return {
    tick: 0,
    phase: "title",
    player: createPlayer(spawn),
    move: NEUTRAL_MOVE,
    held: NEUTRAL_HELD,
    target: null,
    miningProgress: 0,
    miningKey: null,
    selectedSlot: 0,
    stats: { mined: 0, placed: 0, deaths: 0, minedByKey: {} },
    timeTicks: Math.round(START_TIME * DAY_TICKS),
    playTicks: 0,
    hasSave: false,
    lastSaveTick: null,
    dirtySinceSave: false,
    respawnTicks: 0,
    completedAnnounced: false,
  };
}

export function formatClock(timeOfDay: number): string {
  const minutes = Math.floor(((timeOfDay + 0.0) % 1) * 24 * 60);
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
