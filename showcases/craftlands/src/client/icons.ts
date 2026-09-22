/// <reference lib="dom" />
/** 2D icon painting for the HUD: isometric block cubes and flat item sprites from the runtime atlas, plus pixel-art status icons. */
import { blockByKey } from "../shared/blocks.js";
import { itemByKey } from "../shared/items.js";
import { tileRect } from "./atlas.js";

const GRASS_TINT = "#91bd59";
const FOLIAGE_TINT = "#77ab2f";

export interface IconPainter { readonly icon: (key: string) => string; readonly status: (kind: StatusIcon) => string; readonly dirt: () => string; }
export type StatusIcon = "heart-full" | "heart-half" | "heart-empty" | "hunger-full" | "hunger-half" | "hunger-empty" | "bubble" | "bubble-pop";

function tileCanvas(atlas: HTMLCanvasElement, tile: number, tint: string | null): HTMLCanvasElement {
  const rect = tileRect(tile);
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext("2d")!;
  context.imageSmoothingEnabled = false;
  context.drawImage(atlas, rect.x, rect.y, rect.size, rect.size, 0, 0, 16, 16);
  if (tint !== null) {
    context.globalCompositeOperation = "multiply";
    context.fillStyle = tint;
    context.fillRect(0, 0, 16, 16);
    context.globalCompositeOperation = "destination-in";
    context.drawImage(atlas, rect.x, rect.y, rect.size, rect.size, 0, 0, 16, 16);
    context.globalCompositeOperation = "source-over";
  }
  return canvas;
}

function paintCube(atlas: HTMLCanvasElement, top: number, side: number, front: number, topTint: string | null): string {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d")!;
  context.imageSmoothingEnabled = false;
  const faces: readonly (readonly [HTMLCanvasElement, readonly [number, number, number, number, number, number], number])[] = [
    [tileCanvas(atlas, top, topTint), [14 / 16, 7 / 16, -14 / 16, 7 / 16, 16, 2], 0],
    [tileCanvas(atlas, front, null), [14 / 16, 7 / 16, 0, 1, 2, 9], 0.32],
    [tileCanvas(atlas, side, null), [14 / 16, -7 / 16, 0, 1, 16, 16], 0.18],
  ];
  for (const [tile, transform, darken] of faces) {
    context.setTransform(...transform);
    context.drawImage(tile, 0, 0, 16, 16);
    if (darken > 0) {
      context.globalCompositeOperation = "source-atop";
      context.fillStyle = `rgba(0,0,0,${darken})`;
      context.fillRect(0, 0, 16, 16);
      context.globalCompositeOperation = "source-over";
    }
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  return canvas.toDataURL();
}

function paintFlat(atlas: HTMLCanvasElement, tile: number, tint: string | null): string {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d")!;
  context.imageSmoothingEnabled = false;
  context.drawImage(tileCanvas(atlas, tile, tint), 0, 0, 32, 32);
  return canvas.toDataURL();
}

const STATUS_ART: Readonly<Record<StatusIcon, readonly string[]>> = Object.freeze({
  "heart-full": [".KK.KK...", "KRRKRRK..", "KRWRRRRK.", "KRRRRRRK.", ".KRRRRK..", "..KRRK...", "...KK....", ".........", "........."],
  "heart-half": [".KK.KK...", "KRRKDDK..", "KRWRDDDK.", "KRRRDDDK.", ".KRRDDK..", "..KRDK...", "...KK....", ".........", "........."],
  "heart-empty": [".KK.KK...", "KDDKDDK..", "KDDDDDDK.", "KDDDDDDK.", ".KDDDDK..", "..KDDK...", "...KK....", ".........", "........."],
  "hunger-full": ["....KKK..", "...KBBBK.", "..KBBBBK.", ".KBBBBK..", "KBBBBK...", "KBBKK....", "KKK......", ".........", "........."],
  "hunger-half": ["....KKK..", "...KBBBK.", "..KBBBBK.", ".KBBBBK..", "KDDBBK...", "KDDKK....", "KKK......", ".........", "........."],
  "hunger-empty": ["....KKK..", "...KDDDK.", "..KDDDDK.", ".KDDDDK..", "KDDDDK...", "KDDKK....", "KKK......", ".........", "........."],
  "bubble": ["..KKKK...", ".KWWLLK..", "KWLLLLLK.", "KLLLLLLK.", "KLLLLLLK.", ".KLLLLK..", "..KKKK...", ".........", "........."],
  "bubble-pop": [".K....K..", "..K..K...", ".........", "K......K.", ".........", "..K..K...", ".K....K..", ".........", "........."],
});
const STATUS_COLORS: Readonly<Record<string, string>> = Object.freeze({ K: "#000000", R: "#ff1313", W: "#ffffff", D: "#3a3a3a", B: "#b56d2e", L: "#8fd2ff" });

function paintStatus(kind: StatusIcon): string {
  const canvas = document.createElement("canvas");
  canvas.width = 9;
  canvas.height = 9;
  const context = canvas.getContext("2d")!;
  STATUS_ART[kind].forEach((row, y) => { for (let x = 0; x < row.length; x += 1) { const color = STATUS_COLORS[row[x]!]; if (color === undefined) continue; context.fillStyle = color; context.fillRect(x, y, 1, 1); } });
  return canvas.toDataURL();
}

export function createIconPainter(atlas: HTMLCanvasElement): IconPainter {
  const cache = new Map<string, string>();
  const statusCache = new Map<StatusIcon, string>();
  return Object.freeze({
    icon(key: string): string {
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      const block = blockByKey(key);
      const item = itemByKey(key);
      let url: string;
      if (block !== undefined && (block.shape === "cube" || block.shape === "slab")) url = paintCube(atlas, block.tiles.top, block.tiles.side, block.tiles.front, block.tint === "grass" ? GRASS_TINT : block.tint === "foliage" ? FOLIAGE_TINT : null);
      else if (block !== undefined) url = paintFlat(atlas, block.tiles.top, block.tint === "grass" ? GRASS_TINT : block.tint === "foliage" ? FOLIAGE_TINT : null);
      else if (item !== undefined) url = paintFlat(atlas, item.tile, null);
      else url = "";
      cache.set(key, url);
      return url;
    },
    status(kind: StatusIcon): string {
      const cached = statusCache.get(kind);
      if (cached !== undefined) return cached;
      const url = paintStatus(kind);
      statusCache.set(kind, url);
      return url;
    },
    dirt(): string {
      const cached = cache.get("__dirt");
      if (cached !== undefined) return cached;
      const url = paintFlat(atlas, blockByKey("dirt")!.tiles.top, null);
      cache.set("__dirt", url);
      return url;
    },
  });
}
