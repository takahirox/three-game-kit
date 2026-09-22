/**
 * Block registry for Craftlands. Ids are stable Uint8 values stored in chunk arrays and saves.
 * This module is authority-neutral: no DOM, no Three.js, so a server can host the same rules.
 */
export const AIR = 0;
export const STONE = 1;
export const GRASS = 2;
export const DIRT = 3;
export const COBBLESTONE = 4;
export const PLANKS = 5;
export const BEDROCK = 6;
export const WATER = 7;
export const LAVA = 8;
export const SAND = 9;
export const GRAVEL = 10;
export const GOLD_ORE = 11;
export const IRON_ORE = 12;
export const COAL_ORE = 13;
export const LOG = 14;
export const LEAVES = 15;
export const GLASS = 16;
export const DIAMOND_ORE = 17;
export const CRAFTING_TABLE = 18;
export const FURNACE = 19;
export const FURNACE_LIT = 20;
export const TORCH = 21;
export const SNOW = 22;
export const SANDSTONE = 23;
export const BRICKS = 24;
export const STONE_BRICKS = 25;
export const OBSIDIAN = 26;
export const TALL_GRASS = 27;
export const DANDELION = 28;
export const POPPY = 29;
export const WOOL = 30;
export const MOSSY_COBBLESTONE = 31;
export const CACTUS = 32;
export const DEAD_BUSH = 33;
export const BIRCH_LOG = 34;
export const BIRCH_LEAVES = 35;
export const GLOWSTONE = 36;
export const BOOKSHELF = 37;
export const ICE = 38;
export const CLAY = 39;
export const SAPLING = 40;
export const CHEST = 41;
export const BED = 42;
export const SNOW_LAYER = 43;

/** Atlas tile indices: a 16 × 16 grid of 16 px tiles (256 × 256 px), row-major. Rows 0–3 are blocks, 4–7 items, 8–11 mob skins. */
export const TILE = Object.freeze({
  stone: 0, grassTop: 1, grassSide: 2, dirt: 3, cobblestone: 4, planks: 5, bedrock: 6, water: 7, lava: 8, sand: 9, gravel: 10, goldOre: 11, ironOre: 12, coalOre: 13, logSide: 14, logTop: 15,
  leaves: 16, glass: 17, diamondOre: 18, craftingTop: 19, craftingSide: 20, craftingFront: 21, furnaceSide: 22, furnaceFront: 23, furnaceFrontLit: 24, furnaceTop: 25, torch: 26, snow: 27, grassSideSnow: 28, sandstoneTop: 29, sandstoneSide: 30, bricks: 31,
  stoneBricks: 32, obsidian: 33, tallGrass: 34, dandelion: 35, poppy: 36, wool: 37, mossyCobblestone: 38, cactusSide: 39, cactusTop: 40, deadBush: 41, birchLogSide: 42, birchLogTop: 43, birchLeaves: 44, glowstone: 45, bookshelf: 46, ice: 47,
  chestTop: 112, chestSide: 113, chestFront: 114, bedTop: 115, bedSide: 116,
  clay: 48, sapling: 49, crack0: 50, crack1: 51, crack2: 52, crack3: 53, crack4: 54, crack5: 55, crack6: 56, crack7: 57, crack8: 58, crack9: 59, sun: 60, moon: 61, cloud: 62, arm: 63,
});

export type ToolType = "pickaxe" | "axe" | "shovel" | "sword" | "none";
export type BlockShape = "cube" | "cross" | "torch" | "liquid" | "slab";
export type Tint = "none" | "grass" | "foliage";

export interface BlockDefinition {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly solid: boolean;
  readonly opaque: boolean;
  readonly liquid: boolean;
  readonly shape: BlockShape;
  /** Minecraft-style hardness; mining time derives from hardness, tool type and tier. Infinity is unbreakable. */
  readonly hardness: number;
  readonly tool: ToolType;
  /** Minimum tool tier to harvest a drop: 0 hand, 1 wood, 2 stone, 3 iron, 4 diamond. */
  readonly tier: number;
  /** Dropped item key and count; null drops nothing (leaves may still roll saplings / apples via `bonus`). */
  readonly drop: Readonly<{ readonly key: string; readonly min: number; readonly max: number }> | null;
  readonly bonus: Readonly<{ readonly key: string; readonly chance: number }> | null;
  /** Emitted light 0–15. */
  readonly light: number;
  /** How much light this block absorbs when passing through (15 = opaque). */
  readonly lightFilter: number;
  readonly tiles: Readonly<{ readonly top: number; readonly side: number; readonly bottom: number; readonly front: number }>;
  readonly tint: Tint;
  readonly color: number;
  /** Experience orbs dropped when mined with the correct tool. */
  readonly xp: Readonly<[number, number]>;
  readonly replaceable: boolean;
  /** Height of slab-shaped blocks in block units. */
  readonly slabHeight: number;
  readonly sound: "stone" | "grass" | "gravel" | "sand" | "wood" | "cloth" | "glass" | "snow" | "none";
}

interface BlockOptions {
  readonly solid?: boolean;
  readonly opaque?: boolean;
  readonly liquid?: boolean;
  readonly shape?: BlockShape;
  readonly hardness: number;
  readonly tool?: ToolType;
  readonly tier?: number;
  readonly drop?: string | null;
  readonly dropCount?: readonly [number, number];
  readonly bonus?: Readonly<{ readonly key: string; readonly chance: number }>;
  readonly light?: number;
  readonly lightFilter?: number;
  readonly top: number;
  readonly side?: number;
  readonly bottom?: number;
  readonly front?: number;
  readonly tint?: Tint;
  readonly color: number;
  readonly xp?: readonly [number, number];
  readonly replaceable?: boolean;
  readonly slabHeight?: number;
  readonly sound?: BlockDefinition["sound"];
}

function block(id: number, key: string, name: string, options: BlockOptions): BlockDefinition {
  const opaque = options.opaque ?? true;
  const dropKey = options.drop === undefined ? key : options.drop;
  const [min, max] = options.dropCount ?? [1, 1];
  const side = options.side ?? options.top;
  return Object.freeze({
    id,
    key,
    name,
    solid: options.solid ?? true,
    opaque,
    liquid: options.liquid ?? false,
    shape: options.shape ?? "cube",
    hardness: options.hardness,
    tool: options.tool ?? "none",
    tier: options.tier ?? 0,
    drop: dropKey === null ? null : Object.freeze({ key: dropKey, min, max }),
    bonus: options.bonus === undefined ? null : Object.freeze({ ...options.bonus }),
    light: options.light ?? 0,
    lightFilter: options.lightFilter ?? (opaque ? 15 : 0),
    tiles: Object.freeze({ top: options.top, side, bottom: options.bottom ?? side, front: options.front ?? side }),
    tint: options.tint ?? "none",
    color: options.color,
    xp: Object.freeze<[number, number]>([options.xp?.[0] ?? 0, options.xp?.[1] ?? 0]),
    replaceable: options.replaceable ?? false,
    slabHeight: options.slabHeight ?? 0.5,
    sound: options.sound ?? "stone",
  });
}

const DEFINITIONS: readonly BlockDefinition[] = [
  block(AIR, "air", "Air", { solid: false, opaque: false, hardness: Infinity, drop: null, top: 0, color: 0x000000, replaceable: true, sound: "none" }),
  block(STONE, "stone", "Stone", { hardness: 1.5, tool: "pickaxe", tier: 1, drop: "cobblestone", top: TILE.stone, color: 0x7d7d7d }),
  block(GRASS, "grass_block", "Grass Block", { hardness: 0.6, tool: "shovel", drop: "dirt", top: TILE.grassTop, side: TILE.grassSide, bottom: TILE.dirt, tint: "grass", color: 0x6faa3a, sound: "grass" }),
  block(DIRT, "dirt", "Dirt", { hardness: 0.5, tool: "shovel", top: TILE.dirt, color: 0x866043, sound: "gravel" }),
  block(COBBLESTONE, "cobblestone", "Cobblestone", { hardness: 2, tool: "pickaxe", tier: 1, top: TILE.cobblestone, color: 0x7a7a7a }),
  block(PLANKS, "planks", "Oak Planks", { hardness: 2, tool: "axe", top: TILE.planks, color: 0xa8845a, sound: "wood" }),
  block(BEDROCK, "bedrock", "Bedrock", { hardness: Infinity, drop: null, top: TILE.bedrock, color: 0x3a3a3a }),
  block(WATER, "water", "Water", { solid: false, opaque: false, liquid: true, shape: "liquid", hardness: Infinity, drop: null, lightFilter: 2, top: TILE.water, color: 0x3f76e4, replaceable: true, sound: "none" }),
  block(LAVA, "lava", "Lava", { solid: false, opaque: false, liquid: true, shape: "liquid", hardness: Infinity, drop: null, light: 15, lightFilter: 0, top: TILE.lava, color: 0xd96a1c, replaceable: true, sound: "none" }),
  block(SAND, "sand", "Sand", { hardness: 0.5, tool: "shovel", top: TILE.sand, color: 0xdbd3a0, sound: "sand" }),
  block(GRAVEL, "gravel", "Gravel", { hardness: 0.6, tool: "shovel", top: TILE.gravel, color: 0x837f7e, sound: "gravel" }),
  block(GOLD_ORE, "gold_ore", "Gold Ore", { hardness: 3, tool: "pickaxe", tier: 3, top: TILE.goldOre, color: 0xfcee4b }),
  block(IRON_ORE, "iron_ore", "Iron Ore", { hardness: 3, tool: "pickaxe", tier: 2, top: TILE.ironOre, color: 0xd8af93 }),
  block(COAL_ORE, "coal_ore", "Coal Ore", { hardness: 3, tool: "pickaxe", tier: 1, drop: "coal", top: TILE.coalOre, color: 0x373737, xp: [0, 2] }),
  block(LOG, "oak_log", "Oak Log", { hardness: 2, tool: "axe", top: TILE.logTop, side: TILE.logSide, color: 0x6b5030, sound: "wood" }),
  block(LEAVES, "oak_leaves", "Oak Leaves", { opaque: false, hardness: 0.2, drop: null, bonus: { key: "apple", chance: 0.08 }, lightFilter: 1, top: TILE.leaves, tint: "foliage", color: 0x48b518, sound: "grass" }),
  block(GLASS, "glass", "Glass", { opaque: false, hardness: 0.3, drop: null, top: TILE.glass, color: 0xc0f0ff, sound: "glass" }),
  block(DIAMOND_ORE, "diamond_ore", "Diamond Ore", { hardness: 3, tool: "pickaxe", tier: 3, drop: "diamond", top: TILE.diamondOre, color: 0x5decf5, xp: [3, 7] }),
  block(CRAFTING_TABLE, "crafting_table", "Crafting Table", { hardness: 2.5, tool: "axe", top: TILE.craftingTop, side: TILE.craftingSide, bottom: TILE.planks, front: TILE.craftingFront, color: 0x8b6b43, sound: "wood" }),
  block(FURNACE, "furnace", "Furnace", { hardness: 3.5, tool: "pickaxe", tier: 1, top: TILE.furnaceTop, side: TILE.furnaceSide, front: TILE.furnaceFront, color: 0x6e6e6e }),
  block(FURNACE_LIT, "furnace_lit", "Furnace", { hardness: 3.5, tool: "pickaxe", tier: 1, drop: "furnace", light: 13, top: TILE.furnaceTop, side: TILE.furnaceSide, front: TILE.furnaceFrontLit, color: 0x6e6e6e }),
  block(TORCH, "torch", "Torch", { solid: false, opaque: false, shape: "torch", hardness: 0, light: 14, top: TILE.torch, color: 0xffd86b, sound: "wood" }),
  block(SNOW, "snow_block", "Snow Block", { hardness: 0.2, tool: "shovel", drop: "snowball", dropCount: [4, 4], top: TILE.snow, color: 0xf4fbfb, sound: "snow" }),
  block(SANDSTONE, "sandstone", "Sandstone", { hardness: 0.8, tool: "pickaxe", tier: 1, top: TILE.sandstoneTop, side: TILE.sandstoneSide, bottom: TILE.sandstoneTop, color: 0xd9cfa0 }),
  block(BRICKS, "bricks", "Bricks", { hardness: 2, tool: "pickaxe", tier: 1, top: TILE.bricks, color: 0x976654 }),
  block(STONE_BRICKS, "stone_bricks", "Stone Bricks", { hardness: 1.5, tool: "pickaxe", tier: 1, top: TILE.stoneBricks, color: 0x7a7a7a }),
  block(OBSIDIAN, "obsidian", "Obsidian", { hardness: 50, tool: "pickaxe", tier: 4, top: TILE.obsidian, color: 0x14121e }),
  block(TALL_GRASS, "short_grass", "Grass", { solid: false, opaque: false, shape: "cross", hardness: 0, drop: null, top: TILE.tallGrass, tint: "grass", color: 0x6faa3a, replaceable: true, sound: "grass" }),
  block(DANDELION, "dandelion", "Dandelion", { solid: false, opaque: false, shape: "cross", hardness: 0, top: TILE.dandelion, color: 0xffec4f, sound: "grass" }),
  block(POPPY, "poppy", "Poppy", { solid: false, opaque: false, shape: "cross", hardness: 0, top: TILE.poppy, color: 0xe03030, sound: "grass" }),
  block(WOOL, "white_wool", "White Wool", { hardness: 0.8, top: TILE.wool, color: 0xe9ecec, sound: "cloth" }),
  block(MOSSY_COBBLESTONE, "mossy_cobblestone", "Mossy Cobblestone", { hardness: 2, tool: "pickaxe", tier: 1, top: TILE.mossyCobblestone, color: 0x627a5a }),
  block(CACTUS, "cactus", "Cactus", { opaque: false, hardness: 0.4, top: TILE.cactusTop, side: TILE.cactusSide, color: 0x5a8a2c, sound: "cloth" }),
  block(DEAD_BUSH, "dead_bush", "Dead Bush", { solid: false, opaque: false, shape: "cross", hardness: 0, drop: "stick", dropCount: [0, 2], top: TILE.deadBush, color: 0x8a6a3a, replaceable: true, sound: "grass" }),
  block(BIRCH_LOG, "birch_log", "Birch Log", { hardness: 2, tool: "axe", top: TILE.birchLogTop, side: TILE.birchLogSide, color: 0xd7d3c8, sound: "wood" }),
  block(BIRCH_LEAVES, "birch_leaves", "Birch Leaves", { opaque: false, hardness: 0.2, drop: null, bonus: { key: "sapling", chance: 0.05 }, lightFilter: 1, top: TILE.birchLeaves, tint: "foliage", color: 0x80a755, sound: "grass" }),
  block(GLOWSTONE, "glowstone", "Glowstone", { hardness: 0.3, light: 15, top: TILE.glowstone, color: 0xf9d17a, sound: "glass" }),
  block(BOOKSHELF, "bookshelf", "Bookshelf", { hardness: 1.5, tool: "axe", top: TILE.planks, side: TILE.bookshelf, color: 0xa8845a, sound: "wood" }),
  block(ICE, "ice", "Ice", { opaque: false, hardness: 0.5, tool: "pickaxe", drop: null, lightFilter: 2, top: TILE.ice, color: 0x9fd2ff, sound: "glass" }),
  block(CLAY, "clay", "Clay", { hardness: 0.6, tool: "shovel", drop: "clay_ball", dropCount: [4, 4], top: TILE.clay, color: 0x9ea4b0, sound: "gravel" }),
  block(SAPLING, "sapling", "Oak Sapling", { solid: false, opaque: false, shape: "cross", hardness: 0, top: TILE.sapling, color: 0x4f8a2a, sound: "grass" }),
  block(BED, "bed", "Bed", { opaque: false, shape: "slab", hardness: 0.2, top: TILE.bedTop, side: TILE.bedSide, bottom: TILE.planks, color: 0xb02e26, sound: "wood" }),
  block(SNOW_LAYER, "snow", "Snow", { solid: false, opaque: false, shape: "slab", slabHeight: 0.125, hardness: 0.1, tool: "shovel", drop: "snowball", top: TILE.snow, color: 0xf4fbfb, replaceable: true, sound: "snow" }),
  block(CHEST, "chest", "Chest", { opaque: false, hardness: 2.5, tool: "axe", top: TILE.chestTop, side: TILE.chestSide, bottom: TILE.chestTop, front: TILE.chestFront, color: 0x9a6e34, sound: "wood" }),
];

export const BLOCKS: readonly BlockDefinition[] = Object.freeze((() => {
  const table: BlockDefinition[] = [];
  for (const definition of DEFINITIONS) table[definition.id] = definition;
  for (let id = 0; id < table.length; id += 1) if (table[id] === undefined) table[id] = DEFINITIONS[0]!;
  return table;
})());

const BY_KEY: ReadonlyMap<string, BlockDefinition> = new Map(DEFINITIONS.map((definition) => [definition.key, definition]));

export function blockById(id: number): BlockDefinition {
  return BLOCKS[id] ?? BLOCKS[AIR]!;
}

export function blockByKey(key: string): BlockDefinition | undefined {
  return BY_KEY.get(key);
}

export function isOpaqueId(id: number): boolean {
  return blockById(id).opaque;
}

/** Tool speed multipliers by tier (hand, wood, stone, iron, diamond). */
export const TIER_SPEED: readonly number[] = Object.freeze([1, 2, 4, 6, 8]);

/**
 * Seconds of continuous mining for a block, following the Minecraft formula:
 * damage per tick = speed / hardness / (harvestable ? 30 : 100), 20 ticks per second.
 */
export function miningSeconds(definition: BlockDefinition, tool: ToolType, tier: number): number {
  if (!Number.isFinite(definition.hardness)) return Infinity;
  if (definition.hardness <= 0) return 0.05;
  const harvestable = definition.tool === "none" || definition.tier === 0 || (tool === definition.tool && tier >= definition.tier);
  const effective = definition.tool !== "none" && tool === definition.tool;
  const speed = effective ? TIER_SPEED[tier] ?? 1 : 1;
  const perTick = speed / definition.hardness / (harvestable ? 30 : 100);
  return Math.ceil(1 / perTick) / 20;
}

export function canHarvest(definition: BlockDefinition, tool: ToolType, tier: number): boolean {
  if (definition.drop === null) return false;
  if (definition.tool === "none" || definition.tier === 0) return true;
  return tool === definition.tool && tier >= definition.tier;
}
