import { BLOCKS, type BlockDefinition, type ToolType, blockByKey } from "./blocks.js";

/** Item icon tiles live in atlas rows 4–7 (tile indices 64–127). */
export const ITEM_TILE = Object.freeze({
  stick: 64, coal: 65, charcoal: 66, ironIngot: 67, goldIngot: 68, diamond: 69, apple: 70, bread: 71, porkchop: 72, cookedPorkchop: 73, beef: 74, steak: 75, mutton: 76, cookedMutton: 77, rottenFlesh: 78, snowball: 79,
  woodenPickaxe: 80, woodenAxe: 81, woodenShovel: 82, woodenSword: 83, stonePickaxe: 84, stoneAxe: 85, stoneShovel: 86, stoneSword: 87, ironPickaxe: 88, ironAxe: 89, ironShovel: 90, ironSword: 91, diamondPickaxe: 92, diamondAxe: 93, diamondShovel: 94, diamondSword: 95,
  clayBall: 96, brick: 97, wheat: 98, seeds: 99, string: 100, feather: 101, leather: 102, gunpowder: 103, bone: 104, egg: 105, chicken: 106, cookedChicken: 107, flint: 108, bucket: 109, waterBucket: 110, bowl: 111,
});

export type ItemKind = "block" | "material" | "tool" | "food";

export interface ToolStats {
  readonly type: ToolType;
  readonly tier: number;
  readonly durability: number;
  readonly attackDamage: number;
}

export interface FoodStats {
  readonly hunger: number;
  readonly saturation: number;
}

export interface ItemDefinition {
  readonly key: string;
  readonly name: string;
  readonly kind: ItemKind;
  readonly maxStack: number;
  readonly block: BlockDefinition | null;
  readonly tool: ToolStats | null;
  readonly food: FoodStats | null;
  /** Atlas tile for the flat item icon; block items render an isometric cube from their block tiles instead. */
  readonly tile: number;
  readonly color: number;
  /** Furnace fuel value in seconds of burn time (0 = not a fuel). */
  readonly fuel: number;
}

const TIER_NAME = ["", "Wooden", "Stone", "Iron", "Diamond"] as const;
const TIER_DURABILITY = [0, 59, 131, 250, 1561] as const;
const TIER_COLOR = [0, 0x9a7b4f, 0x8a8a8a, 0xdcdcdc, 0x4de3e3] as const;
const TOOL_DAMAGE: Readonly<Record<Exclude<ToolType, "none">, readonly number[]>> = Object.freeze({
  pickaxe: [0, 2, 3, 4, 5],
  axe: [0, 7, 9, 9, 9],
  shovel: [0, 2.5, 3.5, 4.5, 5.5],
  sword: [0, 4, 5, 6, 7],
});

function material(key: string, name: string, tile: number, color: number, extra: Partial<Pick<ItemDefinition, "fuel" | "maxStack">> = {}): ItemDefinition {
  return Object.freeze({ key, name, kind: "material", maxStack: extra.maxStack ?? 64, block: null, tool: null, food: null, tile, color, fuel: extra.fuel ?? 0 });
}

function food(key: string, name: string, tile: number, color: number, hunger: number, saturation: number): ItemDefinition {
  return Object.freeze({ key, name, kind: "food", maxStack: 64, block: null, tool: null, food: Object.freeze({ hunger, saturation }), tile, color, fuel: 0 });
}

function tool(type: Exclude<ToolType, "none">, tier: number, tile: number): ItemDefinition {
  const tierName = TIER_NAME[tier]!;
  const key = `${tierName.toLowerCase()}_${type}`;
  return Object.freeze({
    key,
    name: `${tierName} ${type.charAt(0).toUpperCase()}${type.slice(1)}`,
    kind: "tool",
    maxStack: 1,
    block: null,
    tool: Object.freeze({ type, tier, durability: TIER_DURABILITY[tier]!, attackDamage: TOOL_DAMAGE[type][tier]! }),
    food: null,
    tile,
    color: TIER_COLOR[tier]!,
    fuel: tier === 1 ? 10 : 0,
  });
}

const FUEL_BY_BLOCK: Readonly<Record<string, number>> = Object.freeze({ planks: 15, oak_log: 15, birch_log: 15, crafting_table: 15, bookshelf: 15, sapling: 5, dead_bush: 5, white_wool: 5 });

const BLOCK_ITEMS: readonly ItemDefinition[] = BLOCKS
  .filter((definition, index) => index > 0 && definition.id === index && definition.key !== "furnace_lit" && !definition.liquid)
  .map((definition) => Object.freeze<ItemDefinition>({ key: definition.key, name: definition.name, kind: "block", maxStack: 64, block: definition, tool: null, food: null, tile: definition.tiles.side, color: definition.color, fuel: FUEL_BY_BLOCK[definition.key] ?? 0 }));

const OTHER_ITEMS: readonly ItemDefinition[] = [
  material("stick", "Stick", ITEM_TILE.stick, 0x8b6a3e, { fuel: 5 }),
  material("coal", "Coal", ITEM_TILE.coal, 0x2b2b2b, { fuel: 80 }),
  material("charcoal", "Charcoal", ITEM_TILE.charcoal, 0x3a2d24, { fuel: 80 }),
  material("iron_ingot", "Iron Ingot", ITEM_TILE.ironIngot, 0xd8d8d8),
  material("gold_ingot", "Gold Ingot", ITEM_TILE.goldIngot, 0xf5d93a),
  material("diamond", "Diamond", ITEM_TILE.diamond, 0x4de3e3),
  material("snowball", "Snowball", ITEM_TILE.snowball, 0xeef7f7, { maxStack: 16 }),
  material("clay_ball", "Clay Ball", ITEM_TILE.clayBall, 0x9ea4b0),
  material("brick", "Brick", ITEM_TILE.brick, 0xb0603f),
  material("string", "String", ITEM_TILE.string, 0xe8e8e8),
  material("gunpowder", "Gunpowder", ITEM_TILE.gunpowder, 0x6f6f6f),
  material("leather", "Leather", ITEM_TILE.leather, 0xa0673e),
  material("bone", "Bone", ITEM_TILE.bone, 0xe7e2c8),
  material("feather", "Feather", ITEM_TILE.feather, 0xf2f2f2),
  material("flint", "Flint", ITEM_TILE.flint, 0x4a4a4a),
  food("apple", "Apple", ITEM_TILE.apple, 0xe23b2f, 4, 2.4),
  food("bread", "Bread", ITEM_TILE.bread, 0xc48d3f, 5, 6),
  food("porkchop", "Raw Porkchop", ITEM_TILE.porkchop, 0xf0a0a0, 3, 1.8),
  food("cooked_porkchop", "Cooked Porkchop", ITEM_TILE.cookedPorkchop, 0xd28b5a, 8, 12.8),
  food("beef", "Raw Beef", ITEM_TILE.beef, 0xc85050, 3, 1.8),
  food("cooked_beef", "Steak", ITEM_TILE.steak, 0x7a4a2a, 8, 12.8),
  food("mutton", "Raw Mutton", ITEM_TILE.mutton, 0xe07070, 2, 1.2),
  food("cooked_mutton", "Cooked Mutton", ITEM_TILE.cookedMutton, 0xa06040, 6, 9.6),
  food("chicken", "Raw Chicken", ITEM_TILE.chicken, 0xf0c8b8, 2, 1.2),
  food("cooked_chicken", "Cooked Chicken", ITEM_TILE.cookedChicken, 0xd09050, 6, 7.2),
  food("rotten_flesh", "Rotten Flesh", ITEM_TILE.rottenFlesh, 0x8a5a4a, 4, 0.8),
  tool("pickaxe", 1, ITEM_TILE.woodenPickaxe), tool("axe", 1, ITEM_TILE.woodenAxe), tool("shovel", 1, ITEM_TILE.woodenShovel), tool("sword", 1, ITEM_TILE.woodenSword),
  tool("pickaxe", 2, ITEM_TILE.stonePickaxe), tool("axe", 2, ITEM_TILE.stoneAxe), tool("shovel", 2, ITEM_TILE.stoneShovel), tool("sword", 2, ITEM_TILE.stoneSword),
  tool("pickaxe", 3, ITEM_TILE.ironPickaxe), tool("axe", 3, ITEM_TILE.ironAxe), tool("shovel", 3, ITEM_TILE.ironShovel), tool("sword", 3, ITEM_TILE.ironSword),
  tool("pickaxe", 4, ITEM_TILE.diamondPickaxe), tool("axe", 4, ITEM_TILE.diamondAxe), tool("shovel", 4, ITEM_TILE.diamondShovel), tool("sword", 4, ITEM_TILE.diamondSword),
];

export const ITEMS: readonly ItemDefinition[] = Object.freeze([...BLOCK_ITEMS, ...OTHER_ITEMS]);
const ITEM_BY_KEY: ReadonlyMap<string, ItemDefinition> = new Map(ITEMS.map((item) => [item.key, item]));

export function itemByKey(key: string): ItemDefinition | undefined {
  return ITEM_BY_KEY.get(key);
}

export function itemForBlock(definition: BlockDefinition): ItemDefinition | undefined {
  return ITEM_BY_KEY.get(definition.key) ?? (definition.key === "furnace_lit" ? ITEM_BY_KEY.get("furnace") : undefined);
}

/** Creative-mode palette order: every placeable block, then materials, food, and tools. */
export const CREATIVE_ITEMS: readonly string[] = Object.freeze(ITEMS.filter((item) => item.key !== "air").map((item) => item.key));

export function blockDefinitionForItem(key: string): BlockDefinition | undefined {
  return blockByKey(key);
}
