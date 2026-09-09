/** Block registry for Deepfield. Ids are stable Uint8 values stored in the voxel array. */
export const AIR = 0;
export const GRASS = 1;
export const DIRT = 2;
export const STONE = 3;
export const SAND = 4;
export const WATER = 5;
export const LOG = 6;
export const LEAVES = 7;
export const PLANKS = 8;
export const COAL_ORE = 9;
export const IRON_ORE = 10;
export const GOLD_ORE = 11;
export const DIAMOND_ORE = 12;
export const BEDROCK = 13;
export const GLASS = 14;

/** Atlas tile indices (4x4 grid, 16 px tiles, row-major). */
export const TILE = Object.freeze({
  grassTop: 0, grassSide: 1, dirt: 2, stone: 3, sand: 4, water: 5, logSide: 6, logTop: 7,
  leaves: 8, planks: 9, coal: 10, iron: 11, gold: 12, diamond: 13, bedrock: 14, glass: 15,
});

export interface BlockDefinition {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly solid: boolean;
  readonly opaque: boolean;
  readonly liquid: boolean;
  /** Seconds of continuous mining; Infinity is unbreakable. */
  readonly hardness: number;
  readonly drop: string | null;
  readonly tiles: Readonly<{ readonly top: number; readonly side: number; readonly bottom: number }>;
  /** Representative sRGB colour for HUD icons and debris particles. */
  readonly color: number;
}

function block(id: number, key: string, name: string, options: Readonly<{ solid?: boolean; opaque?: boolean; liquid?: boolean; hardness: number; drop?: string | null; top: number; side?: number; bottom?: number; color: number }>): BlockDefinition {
  return Object.freeze({
    id,
    key,
    name,
    solid: options.solid ?? true,
    opaque: options.opaque ?? true,
    liquid: options.liquid ?? false,
    hardness: options.hardness,
    drop: options.drop === undefined ? key : options.drop,
    tiles: Object.freeze({ top: options.top, side: options.side ?? options.top, bottom: options.bottom ?? options.side ?? options.top }),
    color: options.color,
  });
}

export const BLOCKS: readonly BlockDefinition[] = Object.freeze([
  block(AIR, "air", "Air", { solid: false, opaque: false, hardness: Infinity, drop: null, top: 0, color: 0x000000 }),
  block(GRASS, "grass", "Grass", { hardness: 0.45, drop: "dirt", top: TILE.grassTop, side: TILE.grassSide, bottom: TILE.dirt, color: 0x5fa53a }),
  block(DIRT, "dirt", "Dirt", { hardness: 0.4, top: TILE.dirt, color: 0x8a5a33 }),
  block(STONE, "stone", "Stone", { hardness: 1.2, top: TILE.stone, color: 0x7f7f7f }),
  block(SAND, "sand", "Sand", { hardness: 0.35, top: TILE.sand, color: 0xdccf93 }),
  block(WATER, "water", "Water", { solid: false, opaque: false, liquid: true, hardness: Infinity, drop: null, top: TILE.water, color: 0x2f6fd0 }),
  block(LOG, "log", "Oak Log", { hardness: 0.8, top: TILE.logTop, side: TILE.logSide, color: 0x6b4a2b }),
  block(LEAVES, "leaves", "Leaves", { hardness: 0.2, drop: null, top: TILE.leaves, color: 0x3f8b2e }),
  block(PLANKS, "planks", "Planks", { hardness: 0.6, top: TILE.planks, color: 0xb08a55 }),
  block(COAL_ORE, "coal-ore", "Coal Ore", { hardness: 1.6, top: TILE.coal, color: 0x3a3a3a }),
  block(IRON_ORE, "iron-ore", "Iron Ore", { hardness: 2.0, top: TILE.iron, color: 0xc9a27a }),
  block(GOLD_ORE, "gold-ore", "Gold Ore", { hardness: 2.2, top: TILE.gold, color: 0xf0c94a }),
  block(DIAMOND_ORE, "diamond-ore", "Diamond Ore", { hardness: 2.6, top: TILE.diamond, color: 0x5ee6e0 }),
  block(BEDROCK, "bedrock", "Bedrock", { hardness: Infinity, drop: null, top: TILE.bedrock, color: 0x2a2a2e }),
  block(GLASS, "glass", "Glass", { opaque: false, hardness: 0.3, drop: null, top: TILE.glass, color: 0xbfe9ff }),
]);

const BY_KEY: ReadonlyMap<string, BlockDefinition> = new Map(BLOCKS.map((definition) => [definition.key, definition]));

export function blockById(id: number): BlockDefinition {
  return BLOCKS[id] ?? BLOCKS[AIR]!;
}

export function blockByKey(key: string): BlockDefinition | undefined {
  return BY_KEY.get(key);
}

/** Item keys shown in the nine hotbar slots, in order. */
export const HOTBAR_ITEMS: readonly string[] = Object.freeze(["dirt", "stone", "planks", "sand", "log", "coal-ore", "iron-ore", "gold-ore", "diamond-ore"]);

/** Every item the inventory can hold: all droppable blocks plus placeable extras. */
export const ITEM_KEYS: readonly string[] = Object.freeze([...new Set(BLOCKS.filter((definition) => definition.drop !== null).map((definition) => definition.drop as string))]);
