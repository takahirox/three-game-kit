/** Snapshot and input types shared by the rules, renderer, HUD and tests. Authority-neutral. */
import type { SlotValue } from "./inventory.js";
import type { MobKind } from "./mobs.js";
import type { Vec3 } from "./world.js";

export type Phase = "title" | "playing" | "paused" | "dead";
export type Screen = "none" | "inventory" | "crafting" | "furnace" | "chest" | "chat";
export type GameMode = "survival" | "creative";
export type Action =
  | "jump" | "attack-start" | "attack-end" | "use-start" | "use-end" | "sprint-start" | "sprint-end" | "sneak-start" | "sneak-end"
  | "select-1" | "select-2" | "select-3" | "select-4" | "select-5" | "select-6" | "select-7" | "select-8" | "select-9"
  | "next-slot" | "previous-slot" | "drop" | "inventory" | "escape" | "start" | "continue" | "respawn" | "save" | "quit" | "toggle-perspective" | "toggle-debug" | "toggle-hud" | "chat" | "fly-toggle";
export type Scenario = "spawn" | "tree" | "stone" | "iron" | "diamond" | "cliff" | "water" | "cave" | "night" | "crafting" | "furnace" | "chest" | "mobs";

export interface HeldInput { readonly attack: boolean; readonly use: boolean; readonly sprint: boolean; readonly sneak: boolean; }
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

export interface PlayerSnapshot {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  readonly grounded: boolean;
  readonly inWater: boolean;
  readonly eyeInWater: boolean;
  readonly inLava: boolean;
  readonly sprinting: boolean;
  readonly sneaking: boolean;
  readonly flying: boolean;
  readonly health: number;
  readonly maximumHealth: number;
  readonly hunger: number;
  readonly saturation: number;
  readonly air: number;
  readonly xp: number;
  readonly level: number;
  readonly xpProgress: number;
  readonly hurtTicks: number;
  readonly eyeHeight: number;
  readonly walkPhase: number;
}

export interface ItemEntitySnapshot { readonly id: number; readonly key: string; readonly count: number; readonly position: Vec3; readonly age: number; }

export interface MobSnapshot {
  readonly id: number;
  readonly kind: MobKind;
  readonly position: Vec3;
  readonly yaw: number;
  readonly headYaw: number;
  readonly walkPhase: number;
  readonly hurtTicks: number;
  readonly deadTicks: number;
  readonly fuse: number;
  readonly burning: boolean;
  readonly health: number;
}

export interface FurnaceSnapshot { readonly x: number; readonly y: number; readonly z: number; readonly input: SlotValue; readonly fuel: SlotValue; readonly output: SlotValue; readonly burnFraction: number; readonly progressFraction: number; }

export interface CraftlandsSnapshot {
  readonly tick: number;
  readonly time: number;
  readonly phase: Phase;
  readonly screen: Screen;
  readonly mode: GameMode;
  readonly seed: number;
  readonly spawn: Vec3;
  readonly player: PlayerSnapshot;
  readonly move: MoveInput;
  readonly held: HeldInput;
  readonly target: TargetSnapshot | null;
  readonly mining: Readonly<{ readonly progress: number; readonly blockKey: string | null }>;
  readonly selectedSlot: number;
  readonly hotbar: readonly SlotValue[];
  readonly inventory: readonly SlotValue[];
  readonly cursor: SlotValue;
  readonly craftGrid: readonly SlotValue[];
  readonly craftResult: SlotValue;
  readonly furnace: FurnaceSnapshot | null;
  readonly chest: readonly SlotValue[] | null;
  readonly heldItem: SlotValue;
  readonly items: readonly ItemEntitySnapshot[];
  readonly orbs: readonly Readonly<{ readonly id: number; readonly position: Vec3; readonly value: number }>[];
  readonly arrows: readonly Readonly<{ readonly id: number; readonly position: Vec3; readonly velocity: Vec3; readonly stuck: boolean }>[];
  readonly mobs: readonly MobSnapshot[];
  readonly eating: number;
  readonly swing: number;
  readonly thirdPerson: boolean;
  readonly perspective: number;
  readonly debug: boolean;
  readonly hudHidden: boolean;
  readonly timeOfDay: number;
  readonly daylight: number;
  readonly day: number;
  readonly playTimeSeconds: number;
  readonly editCount: number;
  readonly loadedChunks: number;
  readonly hasSave: boolean;
  readonly lastSaveTick: number | null;
  readonly deaths: number;
  readonly stats: Readonly<{ readonly mined: number; readonly placed: number; readonly crafted: number; readonly kills: number; readonly minedByKey: Readonly<Record<string, number>> }>;
  readonly chatLog: readonly string[];
  readonly biome: string;
  readonly explosions: readonly Vec3[];
  readonly advancements: readonly string[];
  readonly toast: Readonly<{ readonly title: string; readonly description: string; readonly item: string }> | null;
}

export type CraftlandsEvent = Readonly<{ readonly kind: string; readonly tick: number; readonly subject?: string; readonly value?: number }>;

export const DT = 1 / 60;
export const PLAYER_ID = "steve";
export const SAVE_SLOT = "craftlands-world";
export const SAVE_VERSION = 1;
export const DEFAULT_SEED = 8_675_309;
/** A Minecraft day is 20 real minutes; ticks at 60 Hz. */
export const DAY_TICKS = 60 * 60 * 20;
export const START_TIME = 0.3;
export const AUTOSAVE_TICKS = 60 * 30;
export const NEUTRAL_MOVE: MoveInput = Object.freeze({ x: 0, z: 0 });
export const NEUTRAL_HELD: HeldInput = Object.freeze({ attack: false, use: false, sprint: false, sneak: false });

export const TUNING = Object.freeze({
  halfWidth: 0.3,
  height: 1.8,
  sneakHeight: 1.5,
  eyeHeight: 1.62,
  sneakEyeHeight: 1.27,
  walkSpeed: 4.317,
  sprintSpeed: 5.612,
  sneakSpeed: 1.31,
  flySpeed: 10.9,
  waterSpeed: 2.2,
  airControl: 0.35,
  gravity: 32,
  waterGravity: 6,
  jumpSpeed: 8.9,
  swimSpeed: 3.6,
  terminalSpeed: 78,
  waterTerminalSpeed: 3,
  reach: 4.5,
  creativeReach: 5.5,
  maximumHealth: 20,
  maximumHunger: 20,
  maximumAir: 300,
  regenIntervalTicks: 60 * 4,
  starveIntervalTicks: 60 * 4,
  pickupRadius: 1.5,
  itemPickupDelayTicks: 20,
  dropPickupDelayTicks: 60 * 2,
  eatTicks: 96,
  attackCooldownTicks: 30,
});

export function formatClock(timeOfDay: number): string {
  // Sunrise is at 0.25, noon at 0.5, sunset at 0.75, so the fraction maps straight onto a 24-hour clock.
  const minutes = Math.floor((((timeOfDay % 1) + 1) % 1) * 24 * 60);
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Experience needed to go from `level` to `level + 1`, following Minecraft's curve. */
export function xpForLevel(level: number): number {
  if (level >= 30) return 112 + (level - 30) * 9;
  if (level >= 15) return 37 + (level - 15) * 5;
  return 7 + level * 2;
}
