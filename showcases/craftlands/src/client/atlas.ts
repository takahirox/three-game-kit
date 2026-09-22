/// <reference lib="dom" />
/**
 * Runtime-painted texture atlas: a 16 × 16 grid of 16 px tiles (256 × 256 px) covering blocks, cracks,
 * sky sprites, item icons and mob skins. Every pixel is computed from deterministic hashes; no image
 * files, data URLs or remote resources are involved.
 */
import { TILE } from "../shared/blocks.js";
import { ITEM_TILE } from "../shared/items.js";
import { MOB_TILE } from "../shared/mob-tiles.js";
import { hash2 } from "../shared/noise.js";

export const TILE_SIZE = 16;
export const TILES_PER_ROW = 16;
export const ATLAS_SIZE = TILE_SIZE * TILES_PER_ROW;

type Pixel = readonly [number, number, number, number];
type Painter = (px: number, py: number, noise: number) => Pixel;
type Palette = Readonly<Record<string, number>>;

const CLEAR: Pixel = [0, 0, 0, 0];

// --- Colour helpers -------------------------------------------------------------------------

function rgb(hex: number, shade = 1): readonly [number, number, number] {
  return [((hex >> 16) & 255) * shade, ((hex >> 8) & 255) * shade, (hex & 255) * shade];
}

function solid(hex: number, shade = 1, alpha = 255): Pixel {
  const [r, g, b] = rgb(hex, shade);
  return [r, g, b, alpha];
}

/** Base colour modulated by ±amount/2 of noise. */
function speckle(base: number, noise: number, amount: number, alpha = 255): Pixel {
  return solid(base, 1 - amount / 2 + noise * amount, alpha);
}

/** Grayscale luminance tile for biome tinting in the mesher. */
function gray(luminance: number, noise: number, amount: number, alpha = 255): Pixel {
  const value = Math.max(0, Math.min(255, luminance * (1 - amount / 2 + noise * amount) * 255));
  return [value, value, value, alpha];
}

/** Tileable Worley cells: nearest / second-nearest jittered centre distances and the winning cell id. */
function worley(px: number, py: number, seed: number, cells: number): Readonly<{ d1: number; d2: number; id: number }> {
  const size = TILE_SIZE / cells;
  const cx = Math.floor(px / size);
  const cy = Math.floor(py / size);
  let d1 = 99;
  let d2 = 99;
  let id = 0;
  for (let oy = -1; oy <= 1; oy += 1) for (let ox = -1; ox <= 1; ox += 1) {
    const gx = (cx + ox + cells) % cells;
    const gy = (cy + oy + cells) % cells;
    const centreX = (cx + ox) * size + hash2(gx, gy, seed) * size;
    const centreY = (cy + oy) * size + hash2(gx, gy, seed + 1) * size;
    const distance = Math.hypot(px + 0.5 - centreX, py + 0.5 - centreY);
    if (distance < d1) { d2 = d1; d1 = distance; id = gx * 31 + gy; } else if (distance < d2) d2 = distance;
  }
  return { d1, d2, id };
}

// --- Procedural block surfaces ------------------------------------------------------------

function stone(px: number, py: number, noise: number, base = 0x7d7d7d): Pixel {
  const crack = hash2(px, py, 901) < 0.07 ? 0.78 : 1;
  const patch = hash2(Math.floor(px / 4), Math.floor(py / 4), 902) < 0.5 ? 0.94 : 1.04;
  return speckle(base, noise * patch, 0.22 * crack + (1 - crack));
}

function cobble(px: number, py: number, noise: number, base = 0x7a7a7a, mortar = 0x4b4b4b, seed = 11): Pixel {
  const cell = worley(px, py, seed, 4);
  if (cell.d2 - cell.d1 < 0.9) return speckle(mortar, noise, 0.2);
  const shade = 0.84 + hash2(cell.id, 7, seed) * 0.28 - Math.min(0.12, cell.d1 * 0.03);
  return speckle(base, noise * shade + (1 - shade) * 0.5, 0.18);
}

function planks(px: number, py: number, noise: number, base = 0xa8845a, seam = 0x5f4527): Pixel {
  const board = Math.floor(py / 4);
  if (py % 4 === 3) return speckle(seam, noise, 0.16);
  const shift = (board * 5) % 16;
  const along = (px + shift) % 16;
  if (along === 0) return speckle(seam, noise, 0.18);
  if (along === 2 && py % 4 === 1) return speckle(0x4a3418, noise, 0.1);
  const grain = hash2(along, board, 903) < 0.12 ? 0.9 : 1;
  return speckle(base, noise, 0.14 * grain + (1 - grain));
}

function logSide(px: number, py: number, noise: number, base = 0x6b5030, line = 0x4a341c): Pixel {
  const column = hash2(px, 0, 904);
  const wobble = hash2(px, Math.floor(py / 3), 905) < 0.2;
  if (px % 4 === 0 || (px % 4 === 2 && wobble)) return speckle(line, noise, 0.2);
  return speckle(base, noise, 0.18 + column * 0.1);
}

function logTop(px: number, py: number, noise: number, light = 0xb08a55, dark = 0x8a6a3c, bark = 0x5a3e22): Pixel {
  const radius = Math.hypot(px - 7.5, py - 7.5);
  if (radius > 6.6) return speckle(bark, noise, 0.2);
  return speckle(Math.floor(radius) % 2 === 0 ? light : dark, noise, 0.14);
}

function bricks(px: number, py: number, noise: number, brick = 0x976654, mortar = 0xb9a999): Pixel {
  const row = Math.floor(py / 4);
  const shifted = (px + (row % 2) * 4) % 8;
  if (py % 4 === 3 || shifted === 7) return speckle(mortar, noise, 0.14);
  return speckle(brick, noise, 0.2);
}

function stoneBricks(px: number, py: number, noise: number): Pixel {
  if (px % 8 === 7 || py % 8 === 7) return speckle(0x4c4c4c, noise, 0.16);
  const edge = px % 8 === 0 || py % 8 === 0 ? 1.08 : 1;
  return speckle(0x7a7a7a, noise * edge, 0.16);
}

function leavesTile(px: number, py: number, noise: number, seed: number): Pixel {
  if (hash2(px, py, seed) < 0.22) return CLEAR;
  const cluster = hash2(Math.floor(px / 2), Math.floor(py / 2), seed + 1) < 0.35 ? 0.72 : 1;
  return gray(0.82 * cluster, noise, 0.36);
}

function glass(px: number, py: number): Pixel {
  if (px === 0 || py === 0 || px === 15 || py === 15) return [226, 240, 250, 255];
  const diagonal = px + py;
  if ((diagonal === 7 || diagonal === 8) && px > 2 && py > 1) return [250, 253, 255, 150];
  if (diagonal === 12 && px > 6) return [250, 253, 255, 110];
  return [205, 235, 250, 40];
}

function water(px: number, py: number, noise: number): Pixel {
  const ripple = Math.sin((px + py * 2) * 0.8) > 0.6 ? 1.16 : 1;
  return solid(0x3f76e4, (0.9 + noise * 0.2) * ripple, 170);
}

function lava(px: number, py: number, noise: number): Pixel {
  const vein = hash2(Math.floor(px / 2), Math.floor(py / 2), 906);
  if (vein > 0.62) return speckle(0xffd24a, noise, 0.16);
  if (vein > 0.5) return speckle(0xf29a2e, noise, 0.16);
  return speckle(0xd96a1c, noise, 0.26);
}

function gravel(px: number, py: number, noise: number): Pixel {
  const cell = worley(px, py, 17, 8);
  const pick = hash2(cell.id, 3, 17);
  const base = pick < 0.35 ? 0x8f8b88 : pick < 0.6 ? 0x6e6a67 : pick < 0.8 ? 0x9b8f80 : 0x7a6f66;
  if (cell.d2 - cell.d1 < 0.5) return speckle(0x555250, noise, 0.14);
  return speckle(base, noise, 0.18);
}

function glowstone(px: number, py: number, noise: number): Pixel {
  const cell = worley(px, py, 19, 4);
  const bright = hash2(cell.id, 5, 19) < 0.45;
  if (cell.d2 - cell.d1 < 0.8) return speckle(0xb98d47, noise, 0.14);
  return speckle(bright ? 0xffe9a8 : 0xf9d17a, noise, 0.14);
}

function cracks(stage: number): Painter {
  // Ten random walks from near the centre; stage s reveals walks 0..s, each a little longer than the last.
  const mask = new Uint8Array(TILE_SIZE * TILE_SIZE);
  for (let walk = 0; walk <= stage; walk += 1) {
    let x = 6 + Math.floor(hash2(walk, 0, 41) * 4);
    let y = 6 + Math.floor(hash2(walk, 1, 41) * 4);
    const length = 4 + walk * 2;
    for (let step = 0; step < length; step += 1) {
      mask[y * TILE_SIZE + x] = 1;
      const roll = hash2(walk, step + 2, 41);
      if (roll < 0.25) x += 1; else if (roll < 0.5) x -= 1; else if (roll < 0.75) y += 1; else y -= 1;
      x = Math.max(0, Math.min(15, x));
      y = Math.max(0, Math.min(15, y));
    }
  }
  return (px, py) => (mask[py * TILE_SIZE + px] === 1 ? [10, 10, 10, 200] : CLEAR);
}

// --- Sprites ------------------------------------------------------------------------------------

interface SpriteOptions { readonly outline?: boolean; readonly alpha?: number; readonly shade?: number; }

/** Rows of palette letters ("." transparent). With `outline`, edge pixels darken to form a 1 px outline. */
function sprite(rows: readonly string[], palette: Palette, options: SpriteOptions = {}): Painter {
  const pixels: Pixel[] = new Array<Pixel>(TILE_SIZE * TILE_SIZE).fill(CLEAR);
  const filled = new Uint8Array(TILE_SIZE * TILE_SIZE);
  for (let y = 0; y < TILE_SIZE; y += 1) for (let x = 0; x < TILE_SIZE; x += 1) {
    const symbol = rows[y]?.[x] ?? ".";
    if (symbol === ".") continue;
    const hex = palette[symbol];
    pixels[y * TILE_SIZE + x] = hex === undefined ? [255, 0, 255, 255] : solid(hex, 1, options.alpha ?? 255);
    filled[y * TILE_SIZE + x] = 1;
  }
  if (options.outline === true) {
    for (let y = 0; y < TILE_SIZE; y += 1) for (let x = 0; x < TILE_SIZE; x += 1) {
      const index = y * TILE_SIZE + x;
      if (filled[index] !== 1) continue;
      const edge = (x === 0 || filled[index - 1] !== 1) || (x === 15 || filled[index + 1] !== 1) || (y === 0 || filled[index - TILE_SIZE] !== 1) || (y === 15 || filled[index + TILE_SIZE] !== 1);
      if (edge) { const [r, g, b, a] = pixels[index]!; pixels[index] = [r * 0.45, g * 0.45, b * 0.45, a]; filled[index] = 2; }
    }
  }
  const shade = options.shade ?? 0.1;
  return (px, py, noise) => {
    const index = py * TILE_SIZE + px;
    const pixel = pixels[index] ?? CLEAR;
    if (pixel[3] === 0 || filled[index] === 2 || shade === 0) return pixel;
    const factor = 1 - shade / 2 + noise * shade;
    return [pixel[0] * factor, pixel[1] * factor, pixel[2] * factor, pixel[3]];
  };
}

/** Draws `top` wherever it is non-transparent, otherwise `base`. */
function overlay(base: Painter, top: Painter): Painter {
  return (px, py, noise) => {
    const pixel = top(px, py, noise);
    return pixel[3] === 0 ? base(px, py, noise) : pixel;
  };
}

function item(rows: readonly string[], palette: Palette): Painter {
  return sprite(rows, palette, { outline: true });
}

const LUMP = [
  "................",
  "................",
  ".....XXXX.......",
  "....XXXXXX......",
  "...XXLXXXXX.....",
  "...XLXXXXXXX....",
  "..XXXXXXXXXX....",
  "..XXXXXXXXXXX...",
  "...XXXXXXXXXX...",
  "...XXXXXXXXX....",
  "....XXXXXXXX....",
  ".....XXXXXX.....",
  "......XXXX......",
  "................",
];

const BALL = [
  "................",
  "................",
  "................",
  "......XXXX......",
  ".....XLXXXX.....",
  "....XLXXXXXX....",
  "....XXXXXXXX....",
  "....XXXXXXXX....",
  "....XXXXXXXX....",
  ".....XXXXXX.....",
  "......XXXX......",
  "................",
];

const INGOT = [
  "................",
  "................",
  "................",
  "................",
  ".....LLLLLLLL...",
  "....LLLLLLLLLL..",
  "...XXXXXXXXXXXX.",
  "..XXXXXXXXXXXXX.",
  "..XXXXXXXXXXXXX.",
  "..DDDDDDDDDDDDD.",
  "................",
];

const CHOP = [
  "................",
  "................",
  ".....MMMM.......",
  "....MMMMMM......",
  "...MMMMMMMM.....",
  "...MMFMMMMMM....",
  "....MMMMMMMMW...",
  ".....MMMMMWWW...",
  "......MMMWWW....",
  ".......WWWW.....",
  "........WW......",
  "................",
];

const SLAB = [
  "................",
  "................",
  "................",
  "....MMMMMMMM....",
  "...MMMMMMMMMM...",
  "...MMMFMMMMMM...",
  "...MMMMMMMFMM...",
  "...MMMMMMMMMM...",
  "....MMMMMMMM....",
  "................",
];

const DRUMSTICK = [
  "................",
  "................",
  "....MMMM........",
  "...MMMMMM.......",
  "...MMMMMMM......",
  "...MMMMMMMM.....",
  "....MMMMMMMM....",
  ".....MMMMMMW....",
  "......MMMWWW....",
  ".........WWW....",
  "..........WW....",
  "................",
];

function toolRows(type: "pickaxe" | "axe" | "shovel" | "sword"): readonly string[] {
  switch (type) {
    case "pickaxe": return [
      "................",
      "..........MMM...",
      "........MMMMMM..",
      ".......MM...MMM.",
      "......MM.....MM.",
      ".....HM.......M.",
      "....HH..........",
      "...HH...........",
      "..HH............",
      ".HH.............",
      ".H..............",
      "................",
    ];
    case "axe": return [
      "................",
      "........MMM.....",
      ".......MMMMM....",
      ".......MMMMM....",
      "......HMMMMM....",
      ".....HH.MMM.....",
      "....HH..........",
      "...HH...........",
      "..HH............",
      ".HH.............",
      ".H..............",
      "................",
    ];
    case "shovel": return [
      "..........MMM...",
      ".........MMMMM..",
      ".........MMMMM..",
      "........HMMMM...",
      ".......HH.......",
      "......HH........",
      ".....HH.........",
      "....HH..........",
      "...HH...........",
      "..HH............",
      ".HH.............",
      "................",
    ];
    case "sword": return [
      ".............MM.",
      "............MMM.",
      "...........MMM..",
      "..........MMM...",
      ".........MMM....",
      "....G...MMM.....",
      ".....G.MMM......",
      "......GGG.......",
      ".....HHGG.......",
      "....HH..G.......",
      "...HH...........",
      "..HH............",
    ];
  }
}

const HANDLE = 0x7a5a32;
const TOOL_MATERIAL = Object.freeze({ wooden: 0x9a7b4f, stone: 0x8a8a8a, iron: 0xdcdcdc, diamond: 0x4de3e3 });

function tool(type: "pickaxe" | "axe" | "shovel" | "sword", material: keyof typeof TOOL_MATERIAL): Painter {
  const M = TOOL_MATERIAL[material];
  return item(toolRows(type), { M, H: HANDLE, G: material === "wooden" ? 0x5f4527 : 0x6d6d6d });
}

// --- Block-level sprites ------------------------------------------------------------------

const TORCH = sprite([
  "................",
  "................",
  "................",
  ".......FF.......",
  ".......YY.......",
  ".......YY.......",
  ".......OO.......",
  ".......SS.......",
  ".......SS.......",
  ".......SS.......",
  ".......SS.......",
  ".......SS.......",
  ".......SS.......",
  ".......SS.......",
  ".......SS.......",
  ".......SS.......",
], { F: 0xfff1a8, Y: 0xffd83b, O: 0xf28a1c, S: 0x6b4a2b }, { shade: 0.08 });

const TALL_GRASS = sprite([
  "................",
  "................",
  "......b.........",
  "..b...b.....b...",
  "..b..bb..b..b...",
  "...b.b..bb.b....",
  "...b.b..b..b....",
  "....bb.bb..b....",
  "....bb.b..b.....",
  "....b.bb.b......",
  ".....bbb.b......",
  ".....bb.b.......",
  ".....bbbb.......",
  "......bb........",
  "......bb........",
  "......bb........",
], { b: 0xd0d0d0 }, { shade: 0.3 });

const DANDELION = sprite([
  "................",
  "................",
  "................",
  "......YY........",
  ".....YYYY.......",
  ".....YYYY.......",
  "......YY........",
  ".......G........",
  ".......G........",
  "......GG........",
  ".......G........",
  ".......G........",
  "......GG........",
  ".......G........",
  "................",
  "................",
], { Y: 0xffec4f, G: 0x4a8a2c });

const POPPY = sprite([
  "................",
  "................",
  "................",
  ".....RRR........",
  "....RRRRR.......",
  "....RRKRR.......",
  ".....RRR........",
  ".......G........",
  ".......G........",
  "......GG........",
  ".......G........",
  ".......G........",
  ".......G........",
  "......GG........",
  "................",
  "................",
], { R: 0xe03030, K: 0x1a1a1a, G: 0x4a8a2c });

const SAPLING = sprite([
  "................",
  "................",
  "......LL........",
  ".....LLLL.......",
  "....LLLLLL......",
  ".....LLLL.......",
  "......LL........",
  "....LL.S.LL.....",
  "...LLL.S..LL....",
  "......LSL.......",
  ".......S........",
  ".......S........",
  "......SS........",
  ".......S........",
  "................",
  "................",
], { L: 0x4f8a2a, S: 0x6b4a2b }, { shade: 0.2 });

const DEAD_BUSH = sprite([
  "................",
  "................",
  "..B..........B..",
  "..B...B.....B...",
  "...B..B....B....",
  "...B.B..B..B....",
  "....BB..B.B.....",
  ".....B.BBB......",
  "......BBB.......",
  ".......B........",
  ".......B........",
  ".......B........",
  ".......B........",
  "......BB........",
  "................",
  "................",
], { B: 0x8a6a3a }, { shade: 0.2 });

const CRAFTING_GRID = sprite([
  "................",
  "................",
  "................",
  "................",
  "................",
  ".....KKKKKK.....",
  ".....K..K.K.....",
  ".....K..K.K.....",
  ".....KKKKKK.....",
  ".....K..K.K.....",
  ".....K..K.K.....",
  ".....KKKKKK.....",
  "................",
  "................",
  "................",
  "................",
], { K: 0x5a4326 }, { shade: 0 });

const CRAFTING_TOOLS = sprite([
  "................",
  "................",
  "..KK............",
  "..KKK...........",
  "..K.KK....HHHH..",
  "..K..KK...HHHH..",
  "..K...KK...SS...",
  "..K....K...SS...",
  "..KKKKKK...SS...",
  "...........SS...",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
], { K: 0x4a4a4a, H: 0x8a8a8a, S: 0x5f4527 }, { shade: 0 });

const CRAFTING_RACK = sprite([
  "................",
  "................",
  "................",
  "..KKKKKKKKKKKK..",
  "..K.HH.K.HH.K...",
  "..K.HH.K.HH.K...",
  "..KKKKKKKKKKKK..",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
], { K: 0x3a2a18, H: 0x8a8a8a }, { shade: 0 });

const FURNACE_MOUTH = sprite([
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "....KKKKKKKK....",
  "....KKKKKKKK....",
  "....KKKKKKKK....",
  "....KKKKKKKK....",
  "....KKKKKKKK....",
  "....KKKKKKKK....",
  "................",
  "................",
], { K: 0x1e1e1e }, { shade: 0.14 });

const FURNACE_MOUTH_LIT = sprite([
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "....KKKKKKKK....",
  "....KKOKKOKK....",
  "....KOYOKYOK....",
  "....OYYOYYYO....",
  "....OYYYYYYO....",
  "....OOOOOOOO....",
  "................",
  "................",
], { K: 0x1e1e1e, O: 0xf28a1c, Y: 0xffd83b }, { shade: 0.1 });

const BOOKS = sprite([
  "................",
  "................",
  "..RRBBGGYYPPRR..",
  "..RRBBGGYYPPRR..",
  "..RRBBGGYYPPRR..",
  "..rrbbggyyppr...",
  "..RRBBGGYYPPRR..",
  "................",
  "................",
  "..GGRRPPBBYYGG..",
  "..GGRRPPBBYYGG..",
  "..GGRRPPBBYYGG..",
  "..ggrrppbbyygg..",
  "..GGRRPPBBYYGG..",
  "................",
  "................",
], { R: 0xb3382b, r: 0x7a2419, B: 0x2f5fb3, b: 0x1e3f7a, G: 0x3d8a3d, g: 0x255c25, Y: 0xd9b93a, y: 0x8f7a22, P: 0x7a3d9a, p: 0x4d2563 }, { shade: 0.06 });

function mobFace(base: Painter, rows: readonly string[], palette: Palette): Painter {
  return overlay(base, sprite(rows, palette, { shade: 0 }));
}

const PIG_FACE = [
  "................",
  "................",
  "................",
  "................",
  "................",
  "..WK........KW..",
  "..WK........KW..",
  "................",
  "................",
  ".....DDDDDD.....",
  ".....DNDDND.....",
  ".....DDDDDD.....",
  ".....DDDDDD.....",
  "................",
  "................",
  "................",
];

const COW_FACE = [
  "......WWWW......",
  "......WWWW......",
  "......WWWW......",
  "......WWWW......",
  "......WWWW......",
  "..WK..WWWW..KW..",
  "..WK..WWWW..KW..",
  "......WWWW......",
  "................",
  "...PPPPPPPPPP...",
  "...PPPPPPPPPP...",
  "...PPNPPPPNPP...",
  "...PPPPPPPPPP...",
  "...PPPPPPPPPP...",
  "................",
  "................",
];

const SHEEP_FACE = [
  "................",
  "................",
  "..FFFFFFFFFFFF..",
  "..FFFFFFFFFFFF..",
  "..FFFFFFFFFFFF..",
  "..FWKFFFFFFKWF..",
  "..FWKFFFFFFKWF..",
  "..FFFFFFFFFFFF..",
  "..FFFFFFFFFFFF..",
  "..FFFFFNNFFFFF..",
  "..FFFFFFFFFFFF..",
  "..FFFFFFFFFFFF..",
  "..FFFFFFFFFFFF..",
  "..FFFFFFFFFFFF..",
  "................",
  "................",
];

const ZOMBIE_FACE = [
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "....KK....KK....",
  "....KK....KK....",
  "................",
  "................",
  ".......MM.......",
  ".....MMMMMM.....",
  "................",
  "................",
  "................",
  "................",
];

const CREEPER_FACE = [
  "................",
  "................",
  "................",
  "................",
  "..KKKK....KKKK..",
  "..KKKK....KKKK..",
  "..KKKK....KKKK..",
  "..KKKK....KKKK..",
  "......KKKK......",
  "......KKKK......",
  "....KKKKKKKK....",
  "....KKKKKKKK....",
  "....KKKKKKKK....",
  "....KKKKKKKK....",
  "....KK....KK....",
  "....KK....KK....",
];

const STEVE_FACE = [
  "HHHHHHHHHHHHHHHH",
  "HHHHHHHHHHHHHHHH",
  "HHHHHHHHHHHHHHHH",
  "HHHHHHHHHHHHHHHH",
  "H..............H",
  "................",
  "................",
  "................",
  "....WB....BW....",
  "....WB....BW....",
  ".......NN.......",
  ".......NN.......",
  "................",
  ".....MMMMMM.....",
  ".....M....M.....",
  "................",
];

const CHICKEN_FACE = [
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "....K......K....",
  "................",
  "......OOOO......",
  "......OOOO......",
  "......OOOO......",
  ".......RR.......",
  ".......RR.......",
  ".......RR.......",
  "................",
];

const SKELETON_FACE = [
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "....KK....KK....",
  "....KK....KK....",
  "................",
  ".......DD.......",
  "................",
  "................",
  "....DDDDDDDD....",
  "................",
  "................",
  "................",
];

// --- Painter table ----------------------------------------------------------------------

const PAINTERS: Readonly<Record<number, Painter>> = Object.freeze({
  // Blocks
  [TILE.stone]: (px, py, noise) => stone(px, py, noise),
  [TILE.grassTop]: (px, py, noise) => gray(0.86, noise, 0.3 + (hash2(px, py, 907) < 0.1 ? 0.1 : 0)),
  [TILE.grassSide]: (px, py, noise) => {
    const edge = 3 + (hash2(px, 0, 908) < 0.5 ? 1 : 0);
    if (py < edge) return speckle(0x7fb238, noise, 0.26);
    if (py === edge && hash2(px, 1, 908) < 0.35) return speckle(0x6f9f2f, noise, 0.2);
    return speckle(0x866043, noise, 0.34);
  },
  [TILE.dirt]: (_px, _py, noise) => speckle(0x866043, noise, 0.36),
  [TILE.cobblestone]: (px, py, noise) => cobble(px, py, noise),
  [TILE.planks]: (px, py, noise) => planks(px, py, noise),
  [TILE.bedrock]: (_px, _py, noise) => speckle(noise < 0.5 ? 0x2a2a2a : 0x5a5a5a, noise, 0.5),
  [TILE.water]: water,
  [TILE.lava]: lava,
  [TILE.sand]: (_px, _py, noise) => speckle(0xdbd3a0, noise, 0.18),
  [TILE.gravel]: gravel,
  [TILE.goldOre]: (px, py, noise) => ore(px, py, noise, 0xfcee4b, 21),
  [TILE.ironOre]: (px, py, noise) => ore(px, py, noise, 0xd8af93, 22),
  [TILE.coalOre]: (px, py, noise) => ore(px, py, noise, 0x2b2b2b, 23),
  [TILE.diamondOre]: (px, py, noise) => ore(px, py, noise, 0x5decf5, 24),
  [TILE.logSide]: (px, py, noise) => logSide(px, py, noise),
  [TILE.logTop]: (px, py, noise) => logTop(px, py, noise),
  [TILE.leaves]: (px, py, noise) => leavesTile(px, py, noise, 909),
  [TILE.glass]: (px, py) => glass(px, py),
  [TILE.craftingTop]: overlay((px, py, noise) => planks(px, py, noise, 0xb08c5e), CRAFTING_GRID),
  [TILE.craftingSide]: overlay((px, py, noise) => planks(px, py, noise), CRAFTING_TOOLS),
  [TILE.craftingFront]: overlay((px, py, noise) => planks(px, py, noise), CRAFTING_RACK),
  [TILE.furnaceSide]: (px, py, noise) => cobble(px, py, noise, 0x6e6e6e, 0x424242, 12),
  [TILE.furnaceFront]: overlay((px, py, noise) => cobble(px, py, noise, 0x6e6e6e, 0x424242, 12), FURNACE_MOUTH),
  [TILE.furnaceFrontLit]: overlay((px, py, noise) => cobble(px, py, noise, 0x6e6e6e, 0x424242, 12), FURNACE_MOUTH_LIT),
  [TILE.furnaceTop]: (px, py, noise) => stone(px, py, noise, 0x707070),
  [TILE.torch]: TORCH,
  [TILE.snow]: (_px, _py, noise) => speckle(0xf4fbfb, noise, 0.08),
  [TILE.grassSideSnow]: (px, py, noise) => {
    const edge = 3 + (hash2(px, 0, 910) < 0.5 ? 1 : 0);
    if (py < edge) return speckle(0xf4fbfb, noise, 0.08);
    return speckle(0x866043, noise, 0.34);
  },
  [TILE.sandstoneTop]: (_px, _py, noise) => speckle(0xd9cfa0, noise, 0.1),
  [TILE.sandstoneSide]: (px, py, noise) => speckle(py % 5 === 2 ? 0xbfb280 : 0xd9cfa0, noise, py % 5 === 2 ? 0.12 : 0.1 + (hash2(px, py, 911) < 0.08 ? 0.12 : 0)),
  [TILE.bricks]: (px, py, noise) => bricks(px, py, noise),
  [TILE.stoneBricks]: stoneBricks,
  [TILE.obsidian]: (px, py, noise) => speckle(hash2(Math.floor(px / 3), Math.floor(py / 3), 912) < 0.3 ? 0x241a36 : 0x14121e, noise, 0.3),
  [TILE.tallGrass]: TALL_GRASS,
  [TILE.dandelion]: DANDELION,
  [TILE.poppy]: POPPY,
  [TILE.wool]: (px, py, noise) => speckle(Math.sin(px * 1.3 + py * 0.7) + Math.cos(px * 0.5 - py * 1.1) > 0.9 ? 0xd8dbdb : 0xe9ecec, noise, 0.1),
  [TILE.mossyCobblestone]: (px, py, noise) => (hash2(Math.floor(px / 2), Math.floor(py / 2), 913) < 0.3 ? speckle(0x5f8a45, noise, 0.24) : cobble(px, py, noise)),
  [TILE.cactusSide]: (px, py, noise) => {
    if (px % 4 === 0) return speckle(0x3f6a1e, noise, 0.16);
    if (hash2(px, py, 914) < 0.06) return speckle(0xd0d8b0, noise, 0.08);
    return speckle(0x5a8a2c, noise, 0.18);
  },
  [TILE.cactusTop]: (px, py, noise) => speckle(px >= 4 && px <= 11 && py >= 4 && py <= 11 ? 0x7fae4a : 0x5a8a2c, noise, 0.14),
  [TILE.deadBush]: DEAD_BUSH,
  [TILE.birchLogSide]: (px, py, noise) => (py % 3 === 1 && hash2(Math.floor(px / 3), py, 915) < 0.2 ? speckle(0x2a2a2a, noise, 0.2) : speckle(0xd7d3c8, noise, 0.14)),
  [TILE.birchLogTop]: (px, py, noise) => logTop(px, py, noise, 0xe4dcc3, 0xc9bf9d, 0xbdb7a8),
  [TILE.birchLeaves]: (px, py, noise) => leavesTile(px, py, noise, 916),
  [TILE.glowstone]: glowstone,
  [TILE.bookshelf]: overlay((px, py, noise) => planks(px, py, noise), BOOKS),
  [TILE.ice]: (px, py, noise) => (hash2(px, py, 917) < 0.05 || (px + py) % 11 === 0 ? solid(0xd6eeff, 1, 200) : speckle(0x9fd2ff, noise, 0.08, 200)),
  [TILE.clay]: (_px, _py, noise) => speckle(0x9ea4b0, noise, 0.1),
  [TILE.sapling]: SAPLING,
  [TILE.crack0]: cracks(0), [TILE.crack1]: cracks(1), [TILE.crack2]: cracks(2), [TILE.crack3]: cracks(3), [TILE.crack4]: cracks(4),
  [TILE.crack5]: cracks(5), [TILE.crack6]: cracks(6), [TILE.crack7]: cracks(7), [TILE.crack8]: cracks(8), [TILE.crack9]: cracks(9),
  [TILE.sun]: (px, py) => (px === 0 || py === 0 || px === 15 || py === 15 ? solid(0xffffe0) : solid(0xfff7c0)),
  [TILE.moon]: (px, py) => ((px === 4 && py === 5) || (px === 5 && py === 5) || (px === 10 && py === 9) || (px === 11 && py === 10) || (px === 7 && py === 12) ? solid(0xb8bec9) : solid(0xd8dde8)),
  [TILE.cloud]: () => solid(0xffffff),
  [TILE.arm]: (_px, py, noise) => (py < 4 ? speckle(0x4a8ab5, noise, 0.1) : speckle(0xf0b48c, noise, 0.1)),

  // Items
  [ITEM_TILE.stick]: item([
    "................",
    "...........HH...",
    "..........HHH...",
    ".........HHH....",
    "........HHH.....",
    ".......HHH......",
    "......HHH.......",
    ".....HHH........",
    "....HHH.........",
    "...HHH..........",
    "...HH...........",
    "................",
  ], { H: 0x8b6a3e }),
  [ITEM_TILE.coal]: item(LUMP, { X: 0x2b2b2b, L: 0x505050 }),
  [ITEM_TILE.charcoal]: item(LUMP, { X: 0x3a2d24, L: 0x5a4a3c }),
  [ITEM_TILE.ironIngot]: item(INGOT, { L: 0xf0f0f0, X: 0xd8d8d8, D: 0xa0a0a0 }),
  [ITEM_TILE.goldIngot]: item(INGOT, { L: 0xfff2a0, X: 0xf5d93a, D: 0xb59a1e }),
  [ITEM_TILE.diamond]: item([
    "................",
    "................",
    "................",
    ".....LLLLLL.....",
    "....LXXXXXXL....",
    "...LXXXXXXXXL...",
    "...XXXXXXXXXX...",
    "....XXXXXXXX....",
    ".....XXXXXX.....",
    "......XXXX......",
    ".......XX.......",
    "................",
  ], { L: 0xe6ffff, X: 0x4de3e3 }),
  [ITEM_TILE.apple]: item([
    "................",
    "................",
    ".......S........",
    ".......S.GG.....",
    "....RRRRRRRR....",
    "...RRRRRRRRRR...",
    "...RLRRRRRRRR...",
    "...RRRRRRRRRR...",
    "...RRRRRRRRRR...",
    "...RRRRRRRRRR...",
    "....RRRRRRRR....",
    ".....RRRRRR.....",
    "................",
  ], { S: 0x6b4a2b, G: 0x4a8a2c, R: 0xe23b2f, L: 0xff8a80 }),
  [ITEM_TILE.bread]: item([
    "................",
    "................",
    "................",
    "................",
    "........BBBB....",
    "......BBBBBBBB..",
    "....BBBBBLBBBBB.",
    "...BBBBBBBBBBBB.",
    "...BBBBBBBBBBB..",
    "....DDDDDDDDD...",
    "................",
  ], { B: 0xc48d3f, L: 0xe0b06a, D: 0x8a5f2a }),
  [ITEM_TILE.porkchop]: item(CHOP, { M: 0xf0a0a0, F: 0xffd0d0, W: 0xf4f0e8 }),
  [ITEM_TILE.cookedPorkchop]: item(CHOP, { M: 0xd28b5a, F: 0xe8b080, W: 0xf4f0e8 }),
  [ITEM_TILE.beef]: item(SLAB, { M: 0xc85050, F: 0xf0b0b0 }),
  [ITEM_TILE.steak]: item(SLAB, { M: 0x7a4a2a, F: 0xa87a55 }),
  [ITEM_TILE.mutton]: item(CHOP, { M: 0xe07070, F: 0xf8b0b0, W: 0xf4f0e8 }),
  [ITEM_TILE.cookedMutton]: item(CHOP, { M: 0xa06040, F: 0xc08a60, W: 0xf4f0e8 }),
  [ITEM_TILE.rottenFlesh]: item(LUMP, { X: 0x6a5a3a, L: 0x8a5a4a }),
  [ITEM_TILE.snowball]: item(BALL, { X: 0xeef7f7, L: 0xffffff }),
  [ITEM_TILE.woodenPickaxe]: tool("pickaxe", "wooden"), [ITEM_TILE.woodenAxe]: tool("axe", "wooden"), [ITEM_TILE.woodenShovel]: tool("shovel", "wooden"), [ITEM_TILE.woodenSword]: tool("sword", "wooden"),
  [ITEM_TILE.stonePickaxe]: tool("pickaxe", "stone"), [ITEM_TILE.stoneAxe]: tool("axe", "stone"), [ITEM_TILE.stoneShovel]: tool("shovel", "stone"), [ITEM_TILE.stoneSword]: tool("sword", "stone"),
  [ITEM_TILE.ironPickaxe]: tool("pickaxe", "iron"), [ITEM_TILE.ironAxe]: tool("axe", "iron"), [ITEM_TILE.ironShovel]: tool("shovel", "iron"), [ITEM_TILE.ironSword]: tool("sword", "iron"),
  [ITEM_TILE.diamondPickaxe]: tool("pickaxe", "diamond"), [ITEM_TILE.diamondAxe]: tool("axe", "diamond"), [ITEM_TILE.diamondShovel]: tool("shovel", "diamond"), [ITEM_TILE.diamondSword]: tool("sword", "diamond"),
  [ITEM_TILE.clayBall]: item(BALL, { X: 0x9ea4b0, L: 0xc0c6d0 }),
  [ITEM_TILE.brick]: item([
    "................",
    "................",
    "................",
    "................",
    "................",
    "....BBBBBBBB....",
    "....BBBBBBBB....",
    "....BBBBBBBB....",
    "....DDDDDDDD....",
    "................",
  ], { B: 0xb0603f, D: 0x7a3f28 }),
  [ITEM_TILE.wheat]: item([
    "................",
    ".......W........",
    "......WWW.......",
    ".....W.W.W......",
    "......WWW.......",
    ".....W.W.W......",
    "......WWW.......",
    ".......W........",
    ".......G........",
    ".......G........",
    ".......G........",
    "................",
  ], { W: 0xd9b93a, G: 0x8a9a3a }),
  [ITEM_TILE.seeds]: item([
    "................",
    "................",
    "................",
    "................",
    ".....SS.........",
    ".....SS...SS....",
    "..........SS....",
    ".......SS.......",
    ".......SS.......",
    "................",
  ], { S: 0x5a8a2c }),
  [ITEM_TILE.string]: item([
    "................",
    "................",
    "....WW..........",
    "...W..W.........",
    "...W...W........",
    "....W...W.......",
    ".....W...W......",
    "......W...W.....",
    ".......W...W....",
    "........W..W....",
    ".........WW.....",
    "................",
  ], { W: 0xe8e8e8 }),
  [ITEM_TILE.feather]: item([
    "................",
    "...........WW...",
    "..........WWW...",
    ".........WWWW...",
    "........WWWWW...",
    ".......WWWWW....",
    "......WWWWW.....",
    ".....WWWWW......",
    "....WWWW........",
    "...SSW..........",
    "..SS............",
    "................",
  ], { W: 0xf2f2f2, S: 0xb0b0b0 }),
  [ITEM_TILE.leather]: item([
    "................",
    "................",
    "................",
    "....LLLLL.......",
    "...LLLLLLLL.....",
    "...LLLLLLLLLL...",
    "...LLLLLLLLLL...",
    "....LLLLLLLLL...",
    "....LLLLLLLL....",
    ".....LLLLLL.....",
    "................",
  ], { L: 0xa0673e }),
  [ITEM_TILE.gunpowder]: item([
    "................",
    "................",
    "................",
    "................",
    "................",
    "......GG........",
    ".....GGGG.G.....",
    "....GGGGGGGG....",
    "...GGGGGGGGGG...",
    "...GGGGGGGGGGG..",
    "................",
  ], { G: 0x6f6f6f }),
  [ITEM_TILE.bone]: item([
    "................",
    "...........BB...",
    "..........BBBB..",
    ".........BBBBB..",
    "........BBB.....",
    ".......BBB......",
    "......BBB.......",
    ".....BBB........",
    "..BBBBB.........",
    "..BBBB..........",
    "...BB...........",
    "................",
  ], { B: 0xe7e2c8 }),
  [ITEM_TILE.egg]: item([
    "................",
    "................",
    "......XX........",
    ".....XXXX.......",
    "....XXXXXX......",
    "....XLXXXX......",
    "....XXXXXX......",
    "....XXXXXX......",
    ".....XXXX.......",
    "................",
  ], { X: 0xf0e6c8, L: 0xfffbea }),
  [ITEM_TILE.chicken]: item(DRUMSTICK, { M: 0xf0c8b8, W: 0xf4f0e8 }),
  [ITEM_TILE.cookedChicken]: item(DRUMSTICK, { M: 0xd09050, W: 0xf4f0e8 }),
  [ITEM_TILE.flint]: item([
    "................",
    "................",
    "................",
    "......FF........",
    ".....FFFF.......",
    "....FFFFFF......",
    "....FFFFFFF.....",
    ".....FFFFFF.....",
    "......FFFF......",
    ".......FF.......",
    "................",
  ], { F: 0x4a4a4a }),
  [ITEM_TILE.bucket]: item([
    "................",
    "................",
    "................",
    "....GGGGGGGG....",
    "...G........G...",
    "...GGGGGGGGGG...",
    "...GGGGGGGGGG...",
    "....GGGGGGGG....",
    "....GGGGGGGG....",
    "....GGGGGGGG....",
    ".....GGGGGG.....",
    ".....GGGGGG.....",
    "................",
  ], { G: 0xb0b0b0 }),
  [ITEM_TILE.waterBucket]: item([
    "................",
    "................",
    "................",
    "....GGGGGGGG....",
    "...G........G...",
    "...GWWWWWWWWG...",
    "...GWWWWWWWWG...",
    "....GGGGGGGG....",
    "....GGGGGGGG....",
    "....GGGGGGGG....",
    ".....GGGGGG.....",
    ".....GGGGGG.....",
    "................",
  ], { G: 0xb0b0b0, W: 0x3f76e4 }),
  [ITEM_TILE.bowl]: item([
    "................",
    "................",
    "................",
    "................",
    "................",
    "...BBBBBBBBBB...",
    "....BBBBBBBB....",
    ".....BBBBBB.....",
    "......BBBB......",
    "................",
  ], { B: 0x8b6a3e }),

  // Mob skins
  [MOB_TILE.pigFace]: mobFace((_px, _py, noise) => speckle(0xf0a5a5, noise, 0.1), PIG_FACE, { W: 0xffffff, K: 0x1a1a1a, D: 0xd97f7f, N: 0x7a3a3a }),
  [MOB_TILE.pigSkin]: (_px, _py, noise) => speckle(0xf0a5a5, noise, 0.1),
  [MOB_TILE.cowFace]: mobFace((_px, _py, noise) => speckle(0x443626, noise, 0.14), COW_FACE, { W: 0xf0ede6, K: 0x1a1a1a, P: 0xd9a8a0, N: 0x8a5a55 }),
  [MOB_TILE.cowHide]: (px, py, noise) => (hash2(Math.floor(px / 4), Math.floor(py / 4), 918) < 0.35 ? speckle(0xf0ede6, noise, 0.08) : speckle(0x443626, noise, 0.14)),
  [MOB_TILE.sheepFace]: mobFace((_px, _py, noise) => speckle(0xf4f4f4, noise, 0.14), SHEEP_FACE, { F: 0xd9b8a8, W: 0xffffff, K: 0x1a1a1a, N: 0xb08a80 }),
  [MOB_TILE.sheepWool]: (px, py, noise) => speckle(hash2(Math.floor(px / 2), Math.floor(py / 2), 919) < 0.3 ? 0xdedede : 0xf4f4f4, noise, 0.12),
  [MOB_TILE.sheepSkin]: (_px, _py, noise) => speckle(0xe8c8bc, noise, 0.08),
  [MOB_TILE.zombieFace]: mobFace((_px, _py, noise) => speckle(0x6f9a5b, noise, 0.12), ZOMBIE_FACE, { K: 0x0a0a0a, M: 0x3a4a30 }),
  [MOB_TILE.zombieSkin]: (_px, _py, noise) => speckle(0x6f9a5b, noise, 0.14),
  [MOB_TILE.zombieShirt]: (_px, _py, noise) => speckle(0x2d8a8a, noise, 0.1),
  [MOB_TILE.zombiePants]: (_px, _py, noise) => speckle(0x3b3b8a, noise, 0.1),
  [MOB_TILE.creeperFace]: mobFace((px, py, noise) => creeperSkin(px, py, noise), CREEPER_FACE, { K: 0x0a0a0a }),
  [MOB_TILE.creeperSkin]: creeperSkin,
  [MOB_TILE.steveFace]: mobFace((_px, _py, noise) => speckle(0xf0b48c, noise, 0.08), STEVE_FACE, { H: 0x3b2a1a, W: 0xffffff, B: 0x3a5fc4, N: 0xc98a68, M: 0x6b4a2b }),
  [MOB_TILE.steveSkin]: (_px, _py, noise) => speckle(0xf0b48c, noise, 0.08),
  [MOB_TILE.steveShirt]: (_px, _py, noise) => speckle(0x00afaf, noise, 0.1),
  [MOB_TILE.stevePants]: (_px, _py, noise) => speckle(0x3c3c9e, noise, 0.1),
  [MOB_TILE.steveHair]: (_px, _py, noise) => speckle(0x3b2a1a, noise, 0.12),
  [MOB_TILE.chickenFace]: mobFace((_px, _py, noise) => speckle(0xf6f6f6, noise, 0.08), CHICKEN_FACE, { K: 0x1a1a1a, O: 0xf2a03a, R: 0xd23a2a }),
  [MOB_TILE.chickenBody]: (_px, _py, noise) => speckle(0xf6f6f6, noise, 0.08),
  [MOB_TILE.skeletonFace]: mobFace((_px, _py, noise) => speckle(0xd8d8d0, noise, 0.1), SKELETON_FACE, { K: 0x0a0a0a, D: 0x6e6e66 }),
  [MOB_TILE.skeletonBone]: (px, py, noise) => speckle(py % 5 === 4 || hash2(px, py, 920) < 0.05 ? 0xb8b8b0 : 0xd8d8d0, noise, 0.08),
  [MOB_TILE.xpOrb]: (px, py) => {
    const radius = Math.hypot(px - 7.5, py - 7.5);
    if (radius > 4.6) return CLEAR;
    if (radius < 2) return [230, 255, 120, 255];
    return [150, 235, 60, radius > 3.8 ? 140 : 255];
  },
});

function ore(px: number, py: number, noise: number, nugget: number, seed: number): Pixel {
  const cell = hash2(Math.floor(px / 3), Math.floor(py / 3), seed);
  const inner = hash2(px, py, seed + 1);
  if (cell < 0.3 && inner < 0.72) return solid(nugget, 0.85 + inner * 0.3);
  return stone(px, py, noise);
}

function creeperSkin(px: number, py: number, noise: number): Pixel {
  const cell = worley(px, py, 25, 8);
  const light = hash2(cell.id, 9, 25) < 0.3;
  return speckle(light ? 0x7dc06a : 0x5aa35a, noise, 0.16);
}

/** Tiles painted in grayscale; the mesher multiplies them by the biome grass / foliage tint. */
export const TINTED_TILES: ReadonlySet<number> = new Set([TILE.grassTop, TILE.leaves, TILE.birchLeaves, TILE.tallGrass]);

function missing(px: number, py: number): Pixel {
  return ((px >> 2) + (py >> 2)) % 2 === 0 ? [255, 0, 255, 255] : [0, 0, 0, 255];
}

/** Paints the whole atlas into a canvas at runtime; no image files are involved. */
export function paintAtlas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Craftlands atlas requires a 2D canvas context");
  const image = context.createImageData(ATLAS_SIZE, ATLAS_SIZE);
  for (let tile = 0; tile < TILES_PER_ROW * TILES_PER_ROW; tile += 1) {
    const painter = PAINTERS[tile] ?? missing;
    const originX = (tile % TILES_PER_ROW) * TILE_SIZE;
    const originY = Math.floor(tile / TILES_PER_ROW) * TILE_SIZE;
    for (let py = 0; py < TILE_SIZE; py += 1) for (let px = 0; px < TILE_SIZE; px += 1) {
      const noise = hash2(px + tile * 17, py + tile * 29, 1);
      const [r, g, b, a] = painter(px, py, noise);
      const offset = ((originY + py) * ATLAS_SIZE + originX + px) * 4;
      image.data[offset] = Math.max(0, Math.min(255, Math.round(r)));
      image.data[offset + 1] = Math.max(0, Math.min(255, Math.round(g)));
      image.data[offset + 2] = Math.max(0, Math.min(255, Math.round(b)));
      image.data[offset + 3] = Math.max(0, Math.min(255, Math.round(a)));
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** UV rectangle for a tile with a half-texel inset so nearest sampling never bleeds into neighbours. */
export function tileUv(tile: number): readonly [u0: number, v0: number, u1: number, v1: number] {
  const inset = 0.5 / ATLAS_SIZE;
  const column = tile % TILES_PER_ROW;
  const row = Math.floor(tile / TILES_PER_ROW);
  const u0 = column / TILES_PER_ROW + inset;
  const u1 = (column + 1) / TILES_PER_ROW - inset;
  // Canvas rows grow downward while UV v grows upward.
  const v1 = 1 - row / TILES_PER_ROW - inset;
  const v0 = 1 - (row + 1) / TILES_PER_ROW + inset;
  return [u0, v0, u1, v1];
}

/** Pixel rectangle of a tile inside the atlas canvas, for 2D icon drawing. */
export function tileRect(tile: number): Readonly<{ x: number; y: number; size: number }> {
  return Object.freeze({ x: (tile % TILES_PER_ROW) * TILE_SIZE, y: Math.floor(tile / TILES_PER_ROW) * TILE_SIZE, size: TILE_SIZE });
}
