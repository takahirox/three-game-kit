/// <reference lib="dom" />
import { TILE } from "./blocks.js";
import { hash2 } from "./noise.js";

export const TILE_SIZE = 16;
export const TILES_PER_ROW = 4;
export const ATLAS_SIZE = TILE_SIZE * TILES_PER_ROW;

type Painter = (px: number, py: number, noise: number) => readonly [number, number, number, number];

function rgb(hex: number, shade = 1): readonly [number, number, number] {
  return [((hex >> 16) & 255) * shade, ((hex >> 8) & 255) * shade, (hex & 255) * shade];
}

function speckle(base: number, noise: number, amount: number): readonly [number, number, number, number] {
  const shade = 1 - amount / 2 + noise * amount;
  const [r, g, b] = rgb(base, shade);
  return [r, g, b, 255];
}

function ore(base: number, spots: number, noise: number, px: number, py: number, seed: number): readonly [number, number, number, number] {
  const cell = hash2(Math.floor(px / 3), Math.floor(py / 3), seed);
  const inner = hash2(px, py, seed + 1);
  if (cell < 0.34 && inner < 0.7) {
    const [r, g, b] = rgb(spots, 0.85 + inner * 0.3);
    return [r, g, b, 255];
  }
  return speckle(base, noise, 0.3);
}

const PAINTERS: Readonly<Record<number, Painter>> = Object.freeze({
  [TILE.grassTop]: (_px, _py, noise) => speckle(0x5fa53a, noise, 0.34),
  [TILE.grassSide]: (px, py, noise) => (py < 3 + (hash2(px, 0, 3) < 0.5 ? 1 : 0) ? speckle(0x5fa53a, noise, 0.3) : speckle(0x8a5a33, noise, 0.36)),
  [TILE.dirt]: (_px, _py, noise) => speckle(0x8a5a33, noise, 0.4),
  [TILE.stone]: (px, py, noise) => speckle(0x7f7f7f, noise * (hash2(Math.floor(px / 4), Math.floor(py / 4), 9) < 0.5 ? 0.8 : 1.1), 0.34),
  [TILE.sand]: (_px, _py, noise) => speckle(0xdccf93, noise, 0.22),
  [TILE.water]: (px, py, noise) => { const wave = Math.sin((px + py * 2) * 0.8) > 0.6 ? 1.18 : 1; const [r, g, b] = rgb(0x2f6fd0, (0.9 + noise * 0.2) * wave); return [r, g, b, 190]; },
  [TILE.logSide]: (px, _py, noise) => speckle(px % 4 === 0 ? 0x4e3520 : 0x6b4a2b, noise, 0.22),
  [TILE.logTop]: (px, py, noise) => { const ring = Math.round(Math.hypot(px - 7.5, py - 7.5)); return speckle(ring % 2 === 0 ? 0xb08a55 : 0x8a6a3c, noise, 0.18); },
  [TILE.leaves]: (_px, _py, noise) => speckle(noise < 0.18 ? 0x2b6b1f : 0x3f8b2e, noise, 0.4),
  [TILE.planks]: (px, py, noise) => speckle(py % 4 === 0 || (px === 7 && py % 8 < 4) || (px === 15 && py % 8 >= 4) ? 0x7d5f38 : 0xb08a55, noise, 0.16),
  [TILE.coal]: (px, py, noise) => ore(0x7f7f7f, 0x2a2a2a, noise, px, py, 21),
  [TILE.iron]: (px, py, noise) => ore(0x7f7f7f, 0xd9a878, noise, px, py, 22),
  [TILE.gold]: (px, py, noise) => ore(0x7f7f7f, 0xf3cf4c, noise, px, py, 23),
  [TILE.diamond]: (px, py, noise) => ore(0x7f7f7f, 0x6ff2ec, noise, px, py, 24),
  [TILE.bedrock]: (_px, _py, noise) => speckle(noise < 0.5 ? 0x2a2a2e : 0x4a4a52, noise, 0.5),
  [TILE.glass]: (px, py) => (px === 0 || py === 0 || px === 15 || py === 15 ? [230, 245, 255, 180] : [200, 235, 255, 60]),
});

/** Paints a deterministic 16-tile texture atlas into a canvas at runtime; no image files are involved. */
export function paintAtlas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Deepfield atlas requires a 2D canvas context");
  const image = context.createImageData(ATLAS_SIZE, ATLAS_SIZE);
  for (let tile = 0; tile < TILES_PER_ROW * TILES_PER_ROW; tile += 1) {
    const painter = PAINTERS[tile] ?? PAINTERS[TILE.stone]!;
    const originX = (tile % TILES_PER_ROW) * TILE_SIZE;
    const originY = Math.floor(tile / TILES_PER_ROW) * TILE_SIZE;
    for (let py = 0; py < TILE_SIZE; py += 1) for (let px = 0; px < TILE_SIZE; px += 1) {
      const noise = hash2(px + tile * 17, py + tile * 29, 1);
      const [r, g, b, a] = painter(px, py, noise);
      const offset = ((originY + py) * ATLAS_SIZE + originX + px) * 4;
      image.data[offset] = Math.max(0, Math.min(255, Math.round(r)));
      image.data[offset + 1] = Math.max(0, Math.min(255, Math.round(g)));
      image.data[offset + 2] = Math.max(0, Math.min(255, Math.round(b)));
      image.data[offset + 3] = a;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** UV rectangle for a tile with a half-texel inset so nearest sampling never bleeds into neighbours. */
export function tileUv(tile: number): readonly [number, number, number, number] {
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
