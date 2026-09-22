/** Crafting and smelting recipes. Authority-neutral: pure data plus matching functions over a grid of item keys. */

export interface ItemStack { readonly key: string; readonly count: number; }
export type Grid = readonly (string | null)[];

export interface ShapedRecipe {
  readonly kind: "shaped";
  readonly pattern: readonly string[];
  readonly keys: Readonly<Record<string, readonly string[]>>;
  readonly result: ItemStack;
}

export interface ShapelessRecipe {
  readonly kind: "shapeless";
  readonly ingredients: readonly (readonly string[])[];
  readonly result: ItemStack;
}

export type Recipe = ShapedRecipe | ShapelessRecipe;

const LOGS = ["oak_log", "birch_log"] as const;
const P = ["planks"] as const;
const S = ["stick"] as const;
const C = ["cobblestone"] as const;
const I = ["iron_ingot"] as const;
const D = ["diamond"] as const;

function shaped(result: ItemStack, pattern: readonly string[], keys: Record<string, readonly string[]>): ShapedRecipe {
  return Object.freeze({ kind: "shaped", pattern: Object.freeze([...pattern]), keys: Object.freeze({ ...keys }), result: Object.freeze({ ...result }) });
}

function shapeless(result: ItemStack, ingredients: readonly (readonly string[])[]): ShapelessRecipe {
  return Object.freeze({ kind: "shapeless", ingredients: Object.freeze(ingredients.map((entry) => Object.freeze([...entry]))), result: Object.freeze({ ...result }) });
}

function toolSet(material: readonly string[], prefix: string): Recipe[] {
  return [
    shaped({ key: `${prefix}_pickaxe`, count: 1 }, ["MMM", " S ", " S "], { M: material, S }),
    shaped({ key: `${prefix}_axe`, count: 1 }, ["MM", "MS", " S"], { M: material, S }),
    shaped({ key: `${prefix}_shovel`, count: 1 }, ["M", "S", "S"], { M: material, S }),
    shaped({ key: `${prefix}_sword`, count: 1 }, ["M", "M", "S"], { M: material, S }),
  ];
}

export const RECIPES: readonly Recipe[] = Object.freeze([
  shapeless({ key: "planks", count: 4 }, [LOGS]),
  shaped({ key: "stick", count: 4 }, ["P", "P"], { P }),
  shaped({ key: "crafting_table", count: 1 }, ["PP", "PP"], { P }),
  shaped({ key: "torch", count: 4 }, ["C", "S"], { C: ["coal", "charcoal"], S }),
  shaped({ key: "furnace", count: 1 }, ["CCC", "C C", "CCC"], { C }),
  shaped({ key: "chest", count: 1 }, ["PPP", "P P", "PPP"], { P }),
  shaped({ key: "bed", count: 1 }, ["WWW", "PPP"], { W: ["white_wool"], P }),
  shaped({ key: "stone_bricks", count: 4 }, ["SS", "SS"], { S: ["stone"] }),
  shaped({ key: "sandstone", count: 1 }, ["SS", "SS"], { S: ["sand"] }),
  shaped({ key: "bricks", count: 1 }, ["BB", "BB"], { B: ["brick"] }),
  shaped({ key: "snow_block", count: 1 }, ["SS", "SS"], { S: ["snowball"] }),
  shaped({ key: "bookshelf", count: 1 }, ["PPP", "BBB", "PPP"], { P, B: ["bread"] }),
  shaped({ key: "glowstone", count: 1 }, ["GG", "GG"], { G: ["gold_ingot"] }),
  shaped({ key: "bread", count: 1 }, ["WWW"], { W: ["wheat"] }),
  shaped({ key: "white_wool", count: 1 }, ["SS", "SS"], { S: ["string"] }),
  shapeless({ key: "mossy_cobblestone", count: 1 }, [C, ["sapling"]]),
  shapeless({ key: "dirt", count: 4 }, [["gravel"], ["sand"], ["clay_ball"], ["clay_ball"]]),
  ...toolSet(P, "wooden"),
  ...toolSet(C, "stone"),
  ...toolSet(I, "iron"),
  ...toolSet(D, "diamond"),
]);

export interface SmeltingRecipe { readonly input: string; readonly output: ItemStack; readonly seconds: number; readonly xp: number; }

export const SMELTING: readonly SmeltingRecipe[] = Object.freeze([
  { input: "iron_ore", output: { key: "iron_ingot", count: 1 }, seconds: 10, xp: 0.7 },
  { input: "gold_ore", output: { key: "gold_ingot", count: 1 }, seconds: 10, xp: 1 },
  { input: "cobblestone", output: { key: "stone", count: 1 }, seconds: 10, xp: 0.1 },
  { input: "sand", output: { key: "glass", count: 1 }, seconds: 10, xp: 0.1 },
  { input: "oak_log", output: { key: "charcoal", count: 1 }, seconds: 10, xp: 0.15 },
  { input: "birch_log", output: { key: "charcoal", count: 1 }, seconds: 10, xp: 0.15 },
  { input: "clay_ball", output: { key: "brick", count: 1 }, seconds: 10, xp: 0.3 },
  { input: "porkchop", output: { key: "cooked_porkchop", count: 1 }, seconds: 10, xp: 0.35 },
  { input: "beef", output: { key: "cooked_beef", count: 1 }, seconds: 10, xp: 0.35 },
  { input: "mutton", output: { key: "cooked_mutton", count: 1 }, seconds: 10, xp: 0.35 },
  { input: "chicken", output: { key: "cooked_chicken", count: 1 }, seconds: 10, xp: 0.35 },
  { input: "cactus", output: { key: "dead_bush", count: 1 }, seconds: 10, xp: 0.2 },
].map((recipe) => Object.freeze({ ...recipe, output: Object.freeze({ ...recipe.output }) })));

const SMELT_BY_INPUT: ReadonlyMap<string, SmeltingRecipe> = new Map(SMELTING.map((recipe) => [recipe.input, recipe]));

export function smeltingFor(input: string | null): SmeltingRecipe | null {
  return input === null ? null : SMELT_BY_INPUT.get(input) ?? null;
}

interface Trimmed { readonly width: number; readonly height: number; readonly cells: readonly (string | null)[]; }

function trimGrid(grid: Grid, size: number): Trimmed | null {
  let minX = size;
  let minY = size;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    if ((grid[y * size + x] ?? null) === null) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (maxX < 0) return null;
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const cells: (string | null)[] = [];
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) cells.push(grid[y * size + x] ?? null);
  return { width, height, cells };
}

function matchesShaped(recipe: ShapedRecipe, trimmed: Trimmed, mirrored: boolean): boolean {
  const height = recipe.pattern.length;
  const width = Math.max(...recipe.pattern.map((row) => row.length));
  if (width !== trimmed.width || height !== trimmed.height) return false;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const row = recipe.pattern[y]!;
    const symbol = row[mirrored ? width - 1 - x : x] ?? " ";
    const cell = trimmed.cells[y * width + x] ?? null;
    if (symbol === " ") { if (cell !== null) return false; continue; }
    const allowed = recipe.keys[symbol];
    if (allowed === undefined || cell === null || !allowed.includes(cell)) return false;
  }
  return true;
}

function matchesShapeless(recipe: ShapelessRecipe, grid: Grid): boolean {
  const present = grid.filter((cell): cell is string => cell !== null);
  if (present.length !== recipe.ingredients.length) return false;
  const remaining = [...recipe.ingredients];
  for (const cell of present) {
    const index = remaining.findIndex((options) => options.includes(cell));
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === 0;
}

/** Finds the recipe whose inputs match a square crafting grid (2 × 2 or 3 × 3) of item keys. */
export function matchRecipe(grid: Grid, size: number): Recipe | null {
  const trimmed = trimGrid(grid, size);
  if (trimmed === null) return null;
  for (const recipe of RECIPES) {
    if (recipe.kind === "shapeless") { if (matchesShapeless(recipe, grid)) return recipe; continue; }
    if (recipe.pattern.length > size || Math.max(...recipe.pattern.map((row) => row.length)) > size) continue;
    if (matchesShaped(recipe, trimmed, false) || matchesShaped(recipe, trimmed, true)) return recipe;
  }
  return null;
}
