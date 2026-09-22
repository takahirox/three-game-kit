/**
 * Mob definitions, deterministic AI, spawning and persistence. Authority-neutral: no DOM, no Three.js,
 * no Math.random — every roll comes from the context's seeded rng so a server would step identically.
 */
import { AIR, GRASS, blockById } from "./blocks.js";
import { hash3 } from "./noise.js";
import { bodyInLiquid, moveWithCollision, vec3 } from "./physics.js";
import { HEIGHT } from "./terrain.js";
import type { Vec3, World } from "./world.js";

export type MobKind = "pig" | "cow" | "sheep" | "chicken" | "zombie" | "creeper" | "skeleton";

export interface MobDrop { readonly key: string; readonly min: number; readonly max: number; }

export interface MobDefinition {
  readonly kind: MobKind;
  readonly name: string;
  readonly halfWidth: number;
  readonly height: number;
  readonly eyeHeight: number;
  readonly maxHealth: number;
  /** Walking speed in metres per second. */
  readonly speed: number;
  readonly hostile: boolean;
  readonly drops: readonly MobDrop[];
  readonly xp: number;
  readonly attackDamage: number;
  readonly attackReach: number;
}

function define(kind: MobKind, name: string, options: Omit<MobDefinition, "kind" | "name" | "drops"> & { readonly drops: readonly MobDrop[] }): MobDefinition {
  return Object.freeze({ kind, name, ...options, drops: Object.freeze(options.drops.map((drop) => Object.freeze({ ...drop }))) });
}

export const MOB_DEFINITIONS: Readonly<Record<MobKind, MobDefinition>> = Object.freeze({
  pig: define("pig", "Pig", { halfWidth: 0.45, height: 0.9, eyeHeight: 0.7, maxHealth: 10, speed: 1.6, hostile: false, drops: [{ key: "porkchop", min: 1, max: 3 }], xp: 2, attackDamage: 0, attackReach: 0 }),
  cow: define("cow", "Cow", { halfWidth: 0.45, height: 1.4, eyeHeight: 1.2, maxHealth: 10, speed: 1.6, hostile: false, drops: [{ key: "beef", min: 1, max: 3 }, { key: "leather", min: 0, max: 2 }], xp: 2, attackDamage: 0, attackReach: 0 }),
  sheep: define("sheep", "Sheep", { halfWidth: 0.45, height: 1.3, eyeHeight: 1.1, maxHealth: 8, speed: 1.6, hostile: false, drops: [{ key: "mutton", min: 1, max: 2 }, { key: "white_wool", min: 1, max: 1 }], xp: 2, attackDamage: 0, attackReach: 0 }),
  chicken: define("chicken", "Chicken", { halfWidth: 0.2, height: 0.7, eyeHeight: 0.6, maxHealth: 4, speed: 1.4, hostile: false, drops: [{ key: "chicken", min: 1, max: 1 }, { key: "feather", min: 0, max: 2 }], xp: 2, attackDamage: 0, attackReach: 0 }),
  zombie: define("zombie", "Zombie", { halfWidth: 0.3, height: 1.95, eyeHeight: 1.74, maxHealth: 20, speed: 2.3, hostile: true, drops: [{ key: "rotten_flesh", min: 0, max: 2 }], xp: 5, attackDamage: 3, attackReach: 1.6 }),
  creeper: define("creeper", "Creeper", { halfWidth: 0.3, height: 1.7, eyeHeight: 1.5, maxHealth: 20, speed: 2.6, hostile: true, drops: [{ key: "gunpowder", min: 0, max: 2 }], xp: 5, attackDamage: 0, attackReach: 3 }),
  skeleton: define("skeleton", "Skeleton", { halfWidth: 0.3, height: 1.99, eyeHeight: 1.74, maxHealth: 20, speed: 2.4, hostile: true, drops: [{ key: "bone", min: 0, max: 2 }], xp: 5, attackDamage: 2, attackReach: 1.6 }),
});

export const MOB_KINDS: readonly MobKind[] = Object.freeze(Object.keys(MOB_DEFINITIONS) as MobKind[]);

export interface Mob {
  readonly id: number;
  readonly kind: MobKind;
  /** Feet centre. */
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  headYaw: number;
  headPitch: number;
  health: number;
  grounded: boolean;
  inWater: boolean;
  hurtTicks: number;
  /** 0 while alive; counts up after death so the renderer can play the fall-over before removal. */
  deadTicks: number;
  wanderTicks: number;
  wanderYaw: number;
  moving: boolean;
  attackCooldown: number;
  /** Creeper fuse in 60 Hz ticks; explodes at 90. */
  fuse: number;
  burning: boolean;
  burnTicks: number;
  walkPhase: number;
  fallStart: number;
}

export type MobEvent = Readonly<
  | { readonly kind: "attack-player"; readonly mobId: number; readonly damage: number; readonly knockbackX: number; readonly knockbackZ: number }
  | { readonly kind: "mob-died"; readonly mobId: number; readonly mobKind: MobKind; readonly x: number; readonly y: number; readonly z: number; readonly drops: readonly Readonly<{ readonly key: string; readonly count: number }>[]; readonly xp: number }
  | { readonly kind: "explosion"; readonly mobId: number; readonly x: number; readonly y: number; readonly z: number; readonly radius: number }
  | { readonly kind: "mob-spawned"; readonly mobId: number; readonly mobKind: MobKind }
  | { readonly kind: "mob-despawned"; readonly mobId: number }
>;

export interface PlayerView {
  readonly position: Vec3;
  readonly eye: Vec3;
  readonly alive: boolean;
  readonly creative: boolean;
}

export interface MobWorldContext {
  readonly world: World;
  readonly tick: number;
  readonly dt: number;
  /** 0 at midnight … 1 at noon. */
  readonly daylight: number;
  readonly player: PlayerView;
  /** Deterministic 0–1 roll for this tick and salt. */
  rng(salt: number): number;
}

export type MobRng = (tick: number, salt: number) => number;

/** Seeded per-tick roll: `rng(tick, salt)` is identical on every runtime for the same seed. */
export function createMobRng(seed: number): MobRng {
  return (tick, salt) => hash3(tick | 0, salt | 0, (salt / 4294967296) | 0, seed + 977);
}

const GRAVITY = 32;
const CHICKEN_GRAVITY = 8;
const TERMINAL = 78;
const JUMP_SPEED = 8.9;
const DEATH_TICKS = 20;
const CREEPER_FUSE_TICKS = 90;
const CHASE_RANGE = 20;
const PASSIVE_CAP = 12;
const HOSTILE_CAP = 10;

export function createMob(id: number, kind: MobKind, position: Vec3): Mob {
  const definition = MOB_DEFINITIONS[kind];
  return {
    id,
    kind,
    position: vec3(position.x, position.y, position.z),
    velocity: vec3(0, 0, 0),
    yaw: 0,
    headYaw: 0,
    headPitch: 0,
    health: definition.maxHealth,
    grounded: false,
    inWater: false,
    hurtTicks: 0,
    deadTicks: 0,
    wanderTicks: 0,
    wanderYaw: 0,
    moving: false,
    attackCooldown: 0,
    fuse: 0,
    burning: false,
    burnTicks: 0,
    walkPhase: 0,
    fallStart: position.y,
  };
}

function hurt(mob: Mob, amount: number): void {
  if (mob.deadTicks > 0) return;
  mob.health -= amount;
  mob.hurtTicks = 10;
}

/** Applies damage with knockback away from (sourceX, sourceZ). Returns true when the hit was lethal. Ignored during invulnerability frames. */
export function damageMob(mob: Mob, amount: number, sourceX: number, sourceZ: number, knockback = 0.4): boolean {
  if (mob.hurtTicks > 0 || mob.deadTicks > 0) return false;
  mob.health -= amount;
  mob.hurtTicks = 10;
  let dx = mob.position.x - sourceX;
  let dz = mob.position.z - sourceZ;
  const length = Math.hypot(dx, dz);
  if (length < 1e-4) { dx = -Math.sin(mob.yaw); dz = -Math.cos(mob.yaw); } else { dx /= length; dz /= length; }
  mob.velocity = vec3(mob.velocity.x + dx * knockback * 8, 4, mob.velocity.z + dz * knockback * 8);
  mob.fuse = mob.kind === "creeper" ? mob.fuse : 0;
  return mob.health <= 0;
}

function rollDrops(definition: MobDefinition, roll: (salt: number) => number): readonly Readonly<{ readonly key: string; readonly count: number }>[] {
  const drops: Readonly<{ readonly key: string; readonly count: number }>[] = [];
  definition.drops.forEach((drop, index) => {
    const count = drop.min + Math.floor(roll(500 + index) * (drop.max - drop.min + 1));
    if (count > 0) drops.push(Object.freeze({ key: drop.key, count }));
  });
  return Object.freeze(drops);
}

/** True when a wandering mob should refuse to step onto the block ahead (liquid or a drop deeper than three blocks). */
function unsafeAhead(world: World, mob: Mob, yaw: number): boolean {
  const ax = Math.floor(mob.position.x - Math.sin(yaw) * 0.9);
  const az = Math.floor(mob.position.z - Math.cos(yaw) * 0.9);
  const feet = Math.floor(mob.position.y);
  if (world.isLiquid(ax, feet, az) || world.isLiquid(ax, feet - 1, az)) return true;
  for (let dy = 1; dy <= 4; dy += 1) if (world.isSolid(ax, feet - dy, az)) return false;
  return true;
}

/** Steps every mob in place: AI, physics, burning, death. Returns the events raised during this tick. */
export function stepMobs(mobs: Mob[], context: MobWorldContext): MobEvent[] {
  const events: MobEvent[] = [];
  const { world, dt, daylight, player } = context;
  for (let index = mobs.length - 1; index >= 0; index -= 1) {
    const mob = mobs[index]!;
    const definition = MOB_DEFINITIONS[mob.kind];
    const roll = (salt: number): number => context.rng(mob.id * 131 + salt);

    if (mob.deadTicks > 0) {
      mob.deadTicks += 1;
      if (mob.deadTicks > DEATH_TICKS) { mobs.splice(index, 1); continue; }
      let vy = mob.velocity.y - GRAVITY * dt;
      if (vy < -TERMINAL) vy = -TERMINAL;
      const resolved = moveWithCollision(world, mob.position, definition.halfWidth, definition.height, 0, vy * dt, 0);
      mob.position = resolved.position;
      mob.velocity = vec3(0, resolved.hitY ? 0 : vy, 0);
      mob.grounded = resolved.hitY && vy < 0;
      continue;
    }

    if (mob.hurtTicks > 0) mob.hurtTicks -= 1;
    if (mob.attackCooldown > 0) mob.attackCooldown -= 1;

    const dx = player.position.x - mob.position.x;
    const dy = player.position.y - mob.position.y;
    const dz = player.position.z - mob.position.z;
    const horizontal = Math.hypot(dx, dz);
    const distance = Math.hypot(horizontal, dy);
    if (distance > 96) { mobs.splice(index, 1); events.push(Object.freeze({ kind: "mob-despawned" as const, mobId: mob.id })); continue; }

    mob.inWater = bodyInLiquid(world, mob.position, definition.height);
    const headInWater = world.isLiquid(Math.floor(mob.position.x), Math.floor(mob.position.y + definition.eyeHeight), Math.floor(mob.position.z));

    let wishX = 0;
    let wishZ = 0;
    let exploded = false;
    const chasing = definition.hostile && player.alive && !player.creative && distance <= CHASE_RANGE;
    if (chasing) {
      mob.yaw = Math.atan2(-dx, -dz);
      mob.headYaw = mob.yaw;
      mob.headPitch = Math.max(-0.8, Math.min(0.8, Math.atan2(player.eye.y - (mob.position.y + definition.eyeHeight), Math.max(0.01, horizontal))));
      mob.moving = true;
      if (mob.kind === "creeper") {
        if (distance <= 3) {
          mob.moving = false;
          mob.fuse += 1;
          if (mob.fuse >= CREEPER_FUSE_TICKS) {
            events.push(Object.freeze({ kind: "explosion" as const, mobId: mob.id, x: mob.position.x, y: mob.position.y + definition.height * 0.5, z: mob.position.z, radius: 3 }));
            exploded = true;
          }
        } else if (distance > 6) {
          mob.fuse = Math.max(0, mob.fuse - 1);
        }
      } else if (horizontal <= definition.attackReach && Math.abs(dy) < 2 && mob.attackCooldown === 0) {
        const length = Math.max(1e-4, horizontal);
        events.push(Object.freeze({ kind: "attack-player" as const, mobId: mob.id, damage: definition.attackDamage, knockbackX: dx / length, knockbackZ: dz / length }));
        mob.attackCooldown = 60;
      }
      if (mob.moving) { wishX = -Math.sin(mob.yaw) * definition.speed; wishZ = -Math.cos(mob.yaw) * definition.speed; }
    } else {
      if (mob.kind === "creeper") mob.fuse = Math.max(0, mob.fuse - 1);
      // Hostiles far from a target thin out: two percent per second beyond 32 blocks.
      if (definition.hostile && distance > 32 && context.tick % 60 === 0 && roll(9) < 0.02) {
        mobs.splice(index, 1);
        events.push(Object.freeze({ kind: "mob-despawned" as const, mobId: mob.id }));
        continue;
      }
      mob.wanderTicks -= 1;
      if (mob.wanderTicks <= 0) {
        mob.wanderTicks = 120 + Math.floor(roll(1) * 240);
        mob.moving = roll(2) < 0.5;
        mob.wanderYaw = roll(3) * Math.PI * 2;
      }
      if (mob.moving && mob.grounded && !mob.inWater && unsafeAhead(world, mob, mob.wanderYaw)) {
        mob.moving = false;
        mob.wanderTicks = Math.min(mob.wanderTicks, 30);
      }
      if (mob.moving) {
        mob.yaw = mob.wanderYaw;
        wishX = -Math.sin(mob.yaw) * definition.speed;
        wishZ = -Math.cos(mob.yaw) * definition.speed;
      }
      if (distance < 6) {
        mob.headYaw = Math.atan2(-dx, -dz);
        mob.headPitch = Math.max(-0.8, Math.min(0.8, Math.atan2(player.eye.y - (mob.position.y + definition.eyeHeight), Math.max(0.01, horizontal))));
      } else {
        mob.headYaw = mob.yaw;
        mob.headPitch = 0;
      }
    }
    if (exploded) { mobs.splice(index, 1); continue; }

    // --- Physics ---
    let vx = mob.velocity.x;
    let vy = mob.velocity.y;
    let vz = mob.velocity.z;
    const control = mob.grounded || mob.inWater ? 0.45 : 0.15;
    vx += (wishX - vx) * control;
    vz += (wishZ - vz) * control;
    if (mob.inWater) {
      const target = headInWater ? 1.5 : -0.3;
      vy += (target - vy) * 0.15;
    } else {
      const gravity = mob.kind === "chicken" && vy < 0 ? CHICKEN_GRAVITY : GRAVITY;
      vy -= gravity * dt;
      if (vy < -TERMINAL) vy = -TERMINAL;
    }
    const resolved = moveWithCollision(world, mob.position, definition.halfWidth, definition.height, vx * dt, vy * dt, vz * dt);
    mob.position = resolved.position;
    if (resolved.hitX) vx = 0;
    if (resolved.hitZ) vz = 0;
    if (resolved.hitY) {
      if (vy < 0) {
        mob.grounded = true;
        const fall = mob.fallStart - mob.position.y - 3;
        if (fall > 0 && !mob.inWater && mob.kind !== "chicken") hurt(mob, Math.floor(fall));
      }
      vy = 0;
    } else {
      mob.grounded = false;
    }
    if (mob.grounded || mob.inWater) mob.fallStart = mob.position.y;
    else mob.fallStart = Math.max(mob.fallStart, mob.position.y);
    if ((resolved.hitX || resolved.hitZ) && (mob.grounded || mob.inWater) && (mob.moving || chasing)) {
      vy = mob.inWater ? 3 : JUMP_SPEED;
      mob.grounded = false;
    }
    mob.velocity = vec3(vx, vy, vz);
    mob.walkPhase += Math.hypot(vx, vz) * dt * 6;
    if (mob.position.y < -8) hurt(mob, 100);

    // --- Burning in daylight ---
    if ((mob.kind === "zombie" || mob.kind === "skeleton") && daylight > 0.6 && !mob.inWater
      && world.skyLight(Math.floor(mob.position.x), Math.floor(mob.position.y + definition.eyeHeight), Math.floor(mob.position.z)) === 15) {
      mob.burning = true;
      mob.burnTicks += 1;
      if (mob.burnTicks % 30 === 0) hurt(mob, 1);
    } else {
      mob.burning = false;
      mob.burnTicks = 0;
    }

    // --- Death ---
    if (mob.health <= 0) {
      mob.deadTicks = 1;
      mob.moving = false;
      mob.fuse = 0;
      events.push(Object.freeze({
        kind: "mob-died" as const,
        mobId: mob.id,
        mobKind: mob.kind,
        x: mob.position.x,
        y: mob.position.y,
        z: mob.position.z,
        drops: rollDrops(definition, roll),
        xp: definition.xp,
      }));
    }
  }
  return events;
}

function standable(world: World, x: number, y: number, z: number): boolean {
  if (y < 1 || y + 1 >= HEIGHT) return false;
  const below = world.isSolid(x, y - 1, z);
  const feet = blockById(world.get(x, y, z));
  const head = blockById(world.get(x, y + 1, z));
  return below && !feet.solid && !feet.liquid && !head.solid && !head.liquid;
}

function passiveKind(roll: number): MobKind {
  return roll < 0.35 ? "pig" : roll < 0.6 ? "cow" : roll < 0.85 ? "sheep" : "chicken";
}

function hostileKind(roll: number): MobKind {
  return roll < 0.45 ? "zombie" : roll < 0.7 ? "skeleton" : "creeper";
}

/** Attempts natural spawns once per second: passive herds on lit grass, hostiles in darkness. Never spawns in creative mode. */
export function spawnMobs(mobs: Mob[], context: MobWorldContext, nextId: () => number): MobEvent[] {
  const events: MobEvent[] = [];
  if (context.tick % 60 !== 0) return events;
  const { world, player, daylight } = context;
  let passive = 0;
  let hostile = 0;
  for (const mob of mobs) if (mob.deadTicks === 0) { if (MOB_DEFINITIONS[mob.kind].hostile) hostile += 1; else passive += 1; }
  const px = player.position.x;
  const pz = player.position.z;
  const spawn = (kind: MobKind, x: number, y: number, z: number, yaw: number): void => {
    const mob = createMob(nextId(), kind, vec3(x + 0.5, y, z + 0.5));
    mob.yaw = yaw;
    mob.wanderYaw = yaw;
    mob.headYaw = yaw;
    mobs.push(mob);
    events.push(Object.freeze({ kind: "mob-spawned" as const, mobId: mob.id, mobKind: kind }));
  };

  for (let attempt = 0; attempt < 3 && passive < PASSIVE_CAP; attempt += 1) {
    const salt = 1000 + attempt * 10;
    const angle = context.rng(salt) * Math.PI * 2;
    const radius = 24 + context.rng(salt + 1) * 24;
    const x = Math.floor(px + Math.cos(angle) * radius);
    const z = Math.floor(pz + Math.sin(angle) * radius);
    if (!world.isLoaded(x, z)) continue;
    const top = world.heightAt(x, z);
    if (top < 0 || world.get(x, top, z) !== GRASS || world.skyLight(x, top + 1, z) < 9 || !standable(world, x, top + 1, z)) continue;
    const kind = passiveKind(context.rng(salt + 2));
    const herd = 2 + Math.floor(context.rng(salt + 3) * 3);
    for (let member = 0; member < herd && passive < PASSIVE_CAP; member += 1) {
      const ox = x + Math.floor(context.rng(salt + 4 + member * 2) * 7) - 3;
      const oz = z + Math.floor(context.rng(salt + 5 + member * 2) * 7) - 3;
      if (!world.isLoaded(ox, oz)) continue;
      const oy = world.heightAt(ox, oz) + 1;
      if (world.get(ox, oy - 1, oz) === AIR || !standable(world, ox, oy, oz)) continue;
      spawn(kind, ox, oy, oz, context.rng(salt + 6 + member) * Math.PI * 2);
      passive += 1;
    }
  }

  if (player.creative) return events;
  for (let attempt = 0; attempt < 4 && hostile < HOSTILE_CAP; attempt += 1) {
    const salt = 2000 + attempt * 10;
    const angle = context.rng(salt) * Math.PI * 2;
    const radius = 24 + context.rng(salt + 1) * 24;
    const x = Math.floor(px + Math.cos(angle) * radius);
    const z = Math.floor(pz + Math.sin(angle) * radius);
    if (!world.isLoaded(x, z)) continue;
    const surface = world.heightAt(x, z);
    if (surface < 2) continue;
    const y = context.rng(salt + 2) < 0.5 ? surface + 1 : 4 + Math.floor(context.rng(salt + 3) * Math.max(1, surface - 4));
    if (!standable(world, x, y, z)) continue;
    const dark = Math.max(world.skyLight(x, y, z) * daylight, world.blockLight(x, y, z)) <= 7;
    if (!dark) continue;
    spawn(hostileKind(context.rng(salt + 4)), x, y, z, context.rng(salt + 5) * Math.PI * 2);
    hostile += 1;
  }
  return events;
}

export type SerializedMob = Readonly<{ readonly id: number; readonly kind: string; readonly x: number; readonly y: number; readonly z: number; readonly yaw: number; readonly health: number }>;

export function serializeMobs(mobs: readonly Mob[]): readonly SerializedMob[] {
  return mobs.filter((mob) => mob.deadTicks === 0).map((mob) => Object.freeze({ id: mob.id, kind: mob.kind, x: mob.position.x, y: mob.position.y, z: mob.position.z, yaw: mob.yaw, health: mob.health }));
}

function isMobKind(value: unknown): value is MobKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(MOB_DEFINITIONS, value);
}

/** Restores mobs from a save; entries with an unknown kind or non-finite numbers are dropped. */
export function deserializeMobs(data: unknown): Mob[] {
  if (!Array.isArray(data)) return [];
  const result: Mob[] = [];
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const { id, kind, x, y, z, yaw, health } = record;
    if (!Number.isSafeInteger(id) || !isMobKind(kind)) continue;
    if (![x, y, z, yaw, health].every((value) => typeof value === "number" && Number.isFinite(value))) continue;
    const mob = createMob(id as number, kind, vec3(x as number, y as number, z as number));
    mob.yaw = yaw as number;
    mob.wanderYaw = yaw as number;
    mob.headYaw = yaw as number;
    mob.health = Math.max(1, Math.min(MOB_DEFINITIONS[kind].maxHealth, health as number));
    result.push(mob);
  }
  return result;
}
