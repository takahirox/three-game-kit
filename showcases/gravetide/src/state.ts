export type Phase = "title" | "running" | "levelup" | "results" | "victory";
export type Action = "start" | "restart" | "choose-1" | "choose-2" | "choose-3" | "bell";
export type Scenario = "start" | "swarm" | "levelup" | "elite" | "dawn" | "shrine";
export type EnemyKind = "bat" | "ghoul" | "brute" | "wraith" | "elite";
export type WeaponId = "whip" | "wand" | "aura" | "axe" | "knife" | "lightning";
export type PassiveId = "boots" | "heart" | "clock" | "lens" | "magnet" | "armor";
export type OfferKind = "weapon" | "passive" | "heal";

export interface Vec2 { readonly x: number; readonly z: number; }

export interface EnemyDefinition {
  readonly kind: EnemyKind;
  readonly name: string;
  readonly hp: number;
  readonly speed: number;
  readonly damage: number;
  readonly xp: number;
  readonly radius: number;
  readonly color: number;
  readonly height: number;
  readonly capacity: number;
}

export interface WeaponDefinition {
  readonly id: WeaponId;
  readonly name: string;
  readonly description: string;
  readonly cooldownTicks: number;
  readonly cooldownStepTicks: number;
  readonly damage: number;
  readonly damageStep: number;
  readonly color: number;
}

export interface PassiveDefinition {
  readonly id: PassiveId;
  readonly name: string;
  readonly description: string;
  readonly color: number;
}

export interface WaveDefinition {
  readonly fromSeconds: number;
  readonly spawns: readonly Readonly<{ readonly kind: EnemyKind; readonly perSecond: number }>[];
}

export interface OfferSnapshot {
  readonly kind: OfferKind;
  readonly id: string;
  readonly level: number;
  readonly title: string;
  readonly description: string;
  readonly color: number;
}

export interface EnemySnapshot {
  readonly id: string;
  readonly kind: EnemyKind;
  readonly x: number;
  readonly z: number;
  readonly hp: number;
  readonly maximumHp: number;
}

export interface GravetideSnapshot {
  readonly tick: number;
  readonly time: number;
  readonly phase: Phase;
  readonly seed: number;
  readonly elapsedSeconds: number;
  readonly remainingSeconds: number;
  readonly hero: Readonly<{
    readonly x: number;
    readonly z: number;
    readonly facing: number;
    readonly hp: number;
    readonly maximumHp: number;
    readonly level: number;
    readonly xp: number;
    readonly xpToNext: number;
    readonly speed: number;
    readonly alive: boolean;
    readonly moving: boolean;
    readonly invulnerableTicks: number;
  }>;
  readonly weapons: readonly Readonly<{ readonly id: WeaponId; readonly level: number; readonly cooldownRatio: number }>[];
  readonly passives: readonly Readonly<{ readonly id: PassiveId; readonly level: number }>[];
  readonly offers: readonly OfferSnapshot[];
  readonly pendingLevelUps: number;
  readonly enemies: Readonly<{ readonly alive: number; readonly byKind: Readonly<Record<EnemyKind, number>>; readonly nearestDistance: number; readonly eliteAlive: boolean; readonly sample: readonly EnemySnapshot[] }>;
  readonly gems: Readonly<{ readonly count: number; readonly attracted: number }>;
  readonly projectiles: number;
  readonly axes: number;
  readonly kills: number;
  readonly damageDealt: number;
  readonly waveIndex: number;
  readonly shrines: readonly Readonly<{ readonly id: string; readonly x: number; readonly z: number; readonly readyInSeconds: number }>[];
  readonly bell: Readonly<{ readonly readyInSeconds: number; readonly casting: boolean; readonly uses: number }>;
  readonly records: Readonly<{ readonly bestSeconds: number; readonly bestLevel: number; readonly bestKills: number; readonly runs: number }>;
  readonly result: "dawn" | "fallen" | null;
}

export type GravetideEvent = Readonly<{
  readonly kind: string;
  readonly tick: number;
  readonly subject?: string;
  readonly value?: number;
}>;

export const DT = 1 / 60;
export const HERO_ID = "hero";
export const SAVE_SLOT = "gravetide-records";
export const SAVE_VERSION = 1;
export const DEFAULT_SEED = 4242;
export const RUN_SECONDS = 300;
export const ARENA_HALF = 70;
export const MAX_ALIVE = 320;
export const MAX_GEMS = 400;
export const SPAWN_RING_MIN = 26;
export const SPAWN_RING_MAX = 32;
export const MAX_WEAPONS = 4;
export const MAX_PASSIVES = 4;
export const MAX_LEVEL = 5;

export const TUNING = Object.freeze({
  heroHp: 100,
  heroSpeed: 5.2,
  heroRadius: 0.5,
  contactInvulnerabilityTicks: 24,
  levelHeal: 10,
  gemPickupRadius: 1.7,
  gemPullSpeed: 13,
  gemCollectRadius: 0.55,
  shrineHeal: 30,
  shrineCooldownTicks: 60 * 90,
  hpScalePerMinute: 0.55,
  separation: 0.9,
});

export const ENEMIES: Readonly<Record<EnemyKind, EnemyDefinition>> = Object.freeze({
  bat: { kind: "bat", name: "Bat", hp: 8, speed: 4.6, damage: 6, xp: 1, radius: 0.42, color: 0x7d5bd6, height: 1.3, capacity: 200 },
  ghoul: { kind: "ghoul", name: "Ghoul", hp: 26, speed: 2.9, damage: 10, xp: 2, radius: 0.55, color: 0x6fae6a, height: 0, capacity: 200 },
  brute: { kind: "brute", name: "Brute", hp: 95, speed: 1.9, damage: 18, xp: 6, radius: 0.85, color: 0xb0553a, height: 0, capacity: 80 },
  wraith: { kind: "wraith", name: "Wraith", hp: 42, speed: 3.7, damage: 12, xp: 4, radius: 0.5, color: 0x9fd8ff, height: 0.9, capacity: 120 },
  elite: { kind: "elite", name: "Grave Warden", hp: 1600, speed: 2.5, damage: 30, xp: 80, radius: 1.35, color: 0xff4d6d, height: 0, capacity: 2 },
});

export const WEAPONS: readonly WeaponDefinition[] = Object.freeze([
  { id: "whip", name: "Bone Whip", description: "Lashes an arc in front of you. Higher levels reach further and hit behind.", cooldownTicks: 78, cooldownStepTicks: 7, damage: 14, damageStep: 5, color: 0xf2e6c4 },
  { id: "wand", name: "Spirit Wand", description: "Fires bolts at the nearest enemy. Extra bolts at levels 3 and 5.", cooldownTicks: 66, cooldownStepTicks: 6, damage: 11, damageStep: 3, color: 0x6fe3ff },
  { id: "aura", name: "Hallowed Ground", description: "Burns everything standing near you. Grows with level.", cooldownTicks: 18, cooldownStepTicks: 1, damage: 3, damageStep: 1, color: 0xffd166 },
  { id: "axe", name: "Grave Axe", description: "Hurls spinning axes that cut through crowds. More axes at 3 and 5.", cooldownTicks: 104, cooldownStepTicks: 8, damage: 22, damageStep: 7, color: 0xc9c9d6 },
  { id: "knife", name: "Silver Knives", description: "Throws knives the way you face. Extra knives at 2 and 4.", cooldownTicks: 40, cooldownStepTicks: 4, damage: 7, damageStep: 2, color: 0xe9f5ff },
  { id: "lightning", name: "Moon Lightning", description: "Strikes random enemies from above. More bolts every level.", cooldownTicks: 150, cooldownStepTicks: 12, damage: 34, damageStep: 9, color: 0xbfe3ff },
]);

export const PASSIVES: readonly PassiveDefinition[] = Object.freeze([
  { id: "boots", name: "Wolf Boots", description: "+8% move speed per level.", color: 0xa8e063 },
  { id: "heart", name: "Ember Heart", description: "+20 max HP per level and heals 20.", color: 0xff6b81 },
  { id: "clock", name: "Sand Clock", description: "-8% weapon cooldown per level.", color: 0xffd166 },
  { id: "lens", name: "Witch Lens", description: "+12% weapon area per level.", color: 0xc59bff },
  { id: "magnet", name: "Lodestone", description: "+0.9 gem pickup radius per level.", color: 0x6fe3ff },
  { id: "armor", name: "Iron Shroud", description: "-2 contact damage per level.", color: 0xc9c9d6 },
]);

export const WAVES: readonly WaveDefinition[] = Object.freeze([
  { fromSeconds: 0, spawns: [{ kind: "bat", perSecond: 1.3 }] },
  { fromSeconds: 40, spawns: [{ kind: "bat", perSecond: 1.6 }, { kind: "ghoul", perSecond: 0.7 }] },
  { fromSeconds: 90, spawns: [{ kind: "bat", perSecond: 1.2 }, { kind: "ghoul", perSecond: 1.3 }, { kind: "brute", perSecond: 0.3 }] },
  { fromSeconds: 150, spawns: [{ kind: "ghoul", perSecond: 1.6 }, { kind: "brute", perSecond: 0.55 }, { kind: "wraith", perSecond: 0.6 }] },
  { fromSeconds: 210, spawns: [{ kind: "bat", perSecond: 1.5 }, { kind: "ghoul", perSecond: 1.8 }, { kind: "brute", perSecond: 0.8 }, { kind: "wraith", perSecond: 1.0 }] },
  { fromSeconds: 260, spawns: [{ kind: "ghoul", perSecond: 2.2 }, { kind: "brute", perSecond: 1.1 }, { kind: "wraith", perSecond: 1.4 }] },
]);
export const ELITE_SECONDS = 240;

export const SHRINES: readonly Readonly<{ readonly id: string; readonly x: number; readonly z: number }>[] = Object.freeze([
  { id: "shrine-north", x: 0, z: -34 },
  { id: "shrine-east", x: 36, z: 22 },
  { id: "shrine-west", x: -36, z: 22 },
]);

export function xpToNext(level: number): number {
  return 10 + level * 6 + Math.floor(level * level * 0.6);
}

export function weaponById(id: WeaponId): WeaponDefinition {
  return WEAPONS.find((weapon) => weapon.id === id)!;
}

export function passiveById(id: PassiveId): PassiveDefinition {
  return PASSIVES.find((passive) => passive.id === id)!;
}

export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
