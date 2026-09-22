/**
 * Deterministic infinite terrain: biomes, heights, caves, ores, lakes and trees are pure functions of
 * (seed, x, z) so any runtime — browser or a future authoritative server — generates identical chunks.
 */
import {
  AIR, BEDROCK, BIRCH_LEAVES, BIRCH_LOG, CACTUS, CLAY, COAL_ORE, DANDELION, DEAD_BUSH, DIAMOND_ORE, DIRT, GOLD_ORE, GRASS, GRAVEL, IRON_ORE, LAVA, LEAVES, LOG, POPPY, SAND, SANDSTONE, SNOW, STONE, TALL_GRASS, WATER,
} from "./blocks.js";
import { fbm2, hash2, hash3, valueNoise3 } from "./noise.js";

export const CHUNK = 16;
export const HEIGHT = 128;
export const SEA_LEVEL = 62;
export const LAVA_LEVEL = 10;
export const CHUNK_VOLUME = CHUNK * HEIGHT * CHUNK;

export const BIOME = Object.freeze({ ocean: 0, beach: 1, plains: 2, forest: 3, birchForest: 4, desert: 5, snowy: 6, mountains: 7, river: 8 });
export type BiomeId = (typeof BIOME)[keyof typeof BIOME];
export const BIOME_NAMES: readonly string[] = Object.freeze(["Ocean", "Beach", "Plains", "Forest", "Birch Forest", "Desert", "Snowy Plains", "Mountains", "River"]);

/** Grass / foliage tint per biome as packed RGB, in the spirit of Minecraft's colormaps. */
export const BIOME_GRASS: readonly number[] = Object.freeze([0x8eb971, 0x91bd59, 0x91bd59, 0x79c05a, 0x88bb67, 0xbfb755, 0x80b497, 0x8ab689, 0x8eb971]);
export const BIOME_FOLIAGE: readonly number[] = Object.freeze([0x71a74d, 0x77ab2f, 0x77ab2f, 0x59ae30, 0x6ba941, 0xaea42a, 0x60a17b, 0x6da36b, 0x71a74d]);

export interface ColumnInfo { readonly height: number; readonly biome: BiomeId; }

export function chunkIndex(x: number, y: number, z: number): number {
  return (y * CHUNK + z) * CHUNK + x;
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export class TerrainGenerator {
  private readonly columns = new Map<string, ColumnInfo>();

  constructor(readonly seed: number) {}

  /** Height and biome for a world column; cached because tree stamping reads columns of neighbouring chunks. */
  column(x: number, z: number): ColumnInfo {
    const key = `${x},${z}`;
    const cached = this.columns.get(key);
    if (cached !== undefined) return cached;
    if (this.columns.size > 200_000) this.columns.clear();
    const seed = this.seed;
    const continental = fbm2(x * 0.0035 + 1000, z * 0.0035 + 1000, seed, 4);          // 0 ocean … 1 inland
    const erosion = fbm2(x * 0.006 + 500, z * 0.006 - 500, seed + 11, 3);              // flat … rugged
    const ridges = fbm2(x * 0.02, z * 0.02, seed + 23, 4);
    const temperature = fbm2(x * 0.0025 - 800, z * 0.0025 + 300, seed + 37, 3);
    const humidity = fbm2(x * 0.003 + 200, z * 0.003 - 900, seed + 41, 3);
    const river = Math.abs(fbm2(x * 0.004 + 42, z * 0.004 - 42, seed + 53, 3) - 0.5);

    const land = Math.max(0, Math.min(1, (continental - 0.42) * 4));
    const base = SEA_LEVEL - 16 + land * 24;
    const hills = (ridges - 0.5) * 2 * (6 + erosion * 34) * Math.min(1, land * 1.6);
    let height = base + hills + (ridges * ridges) * 14 * erosion;
    let biome: BiomeId = BIOME.plains;
    if (river < 0.018 && land > 0.35) { height = Math.min(height, SEA_LEVEL - 2 - (0.018 - river) * 120); biome = BIOME.river; }
    height = Math.round(Math.max(8, Math.min(HEIGHT - 10, height)));
    if (biome !== BIOME.river) {
      if (height < SEA_LEVEL - 1) biome = BIOME.ocean;
      else if (height <= SEA_LEVEL + 1) biome = BIOME.beach;
      else if (height > SEA_LEVEL + 34 || (erosion > 0.62 && height > SEA_LEVEL + 20)) biome = BIOME.mountains;
      else if (temperature < 0.35) biome = BIOME.snowy;
      else if (temperature > 0.66 && humidity < 0.45) biome = BIOME.desert;
      else if (humidity > 0.58) biome = temperature > 0.5 ? BIOME.forest : BIOME.birchForest;
      else biome = BIOME.plains;
    }
    const info = Object.freeze({ height, biome });
    this.columns.set(key, info);
    return info;
  }

  /** Fills a 16 × 128 × 16 chunk with generated blocks and returns the per-column biome map. */
  generate(cx: number, cz: number, blocks: Uint8Array, biomes: Uint8Array): void {
    const seed = this.seed;
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;
    for (let lz = 0; lz < CHUNK; lz += 1) for (let lx = 0; lx < CHUNK; lx += 1) {
      const x = x0 + lx;
      const z = z0 + lz;
      const { height, biome } = this.column(x, z);
      biomes[lz * CHUNK + lx] = biome;
      const sandy = biome === BIOME.desert || biome === BIOME.beach || (biome === BIOME.ocean && height > SEA_LEVEL - 6) || (biome === BIOME.river && height >= SEA_LEVEL - 3);
      const rocky = biome === BIOME.mountains && height > SEA_LEVEL + 26;
      const surfaceDepth = 3 + Math.floor(hash2(x, z, seed + 3) * 2);
      for (let y = 0; y <= height; y += 1) {
        let id = STONE;
        if (y <= 1 + Math.floor(hash3(x, y, z, seed + 1) * 3) && y < 5) id = BEDROCK;
        else if (y === height) id = rocky ? STONE : sandy ? SAND : biome === BIOME.snowy ? GRASS : biome === BIOME.ocean ? (hash2(x, z, seed + 5) < 0.3 ? GRAVEL : hash2(x, z, seed + 6) < 0.15 ? CLAY : DIRT) : GRASS;
        else if (y >= height - surfaceDepth) id = rocky ? STONE : sandy ? (y < height - 2 ? SANDSTONE : SAND) : DIRT;
        else {
          const n = hash3(x, y, z, seed + 31);
          if (n < 0.004 && y < 48) id = GRAVEL;
          else if (n > 0.996 && y < 64) id = DIRT;
        }
        // Caves: two crossing noise ribbons form tunnels; a blob field forms caverns. Bedrock never carves.
        if (id !== BEDROCK && y > 2 && y < height - 1) {
          const ribbonA = valueNoise3(x * 0.045, y * 0.07, z * 0.045, seed + 71);
          const ribbonB = valueNoise3(x * 0.045 + 100, y * 0.07, z * 0.045 + 100, seed + 73);
          const tunnel = Math.abs(ribbonA - 0.5) < 0.055 && Math.abs(ribbonB - 0.5) < 0.055;
          const cavern = y < height - 8 && valueNoise3(x * 0.09, y * 0.12, z * 0.09, seed + 79) > 0.74;
          if (tunnel || cavern) id = y <= LAVA_LEVEL ? LAVA : AIR;
        }
        blocks[chunkIndex(lx, y, lz)] = id;
      }
      for (let y = height + 1; y <= SEA_LEVEL; y += 1) blocks[chunkIndex(lx, y, lz)] = biome === BIOME.snowy && y === SEA_LEVEL ? WATER : WATER;
      if (biome === BIOME.snowy && height > SEA_LEVEL && height + 1 < HEIGHT && blocks[chunkIndex(lx, height + 1, lz)] === AIR) blocks[chunkIndex(lx, height + 1, lz)] = SNOW;
    }
    this.placeOres(cx, cz, blocks);
    this.decorate(cx, cz, blocks);
  }

  private placeOres(cx: number, cz: number, blocks: Uint8Array): void {
    const veins: readonly (readonly [id: number, attempts: number, minY: number, maxY: number, size: number, salt: number])[] = [
      [COAL_ORE, 18, 6, 110, 10, 101], [IRON_ORE, 14, 4, 60, 6, 103], [GOLD_ORE, 3, 4, 30, 5, 107], [DIAMOND_ORE, 2, 3, 15, 4, 109],
    ];
    for (const [id, attempts, minY, maxY, size, salt] of veins) for (let attempt = 0; attempt < attempts; attempt += 1) {
      const rx = Math.floor(hash3(cx, attempt, cz, this.seed + salt) * CHUNK);
      const ry = minY + Math.floor(hash3(cx, attempt, cz, this.seed + salt + 1) * (maxY - minY));
      const rz = Math.floor(hash3(cx, attempt, cz, this.seed + salt + 2) * CHUNK);
      const count = 2 + Math.floor(hash3(cx, attempt, cz, this.seed + salt + 3) * size);
      let x = rx;
      let y = ry;
      let z = rz;
      for (let step = 0; step < count; step += 1) {
        if (x >= 0 && x < CHUNK && z >= 0 && z < CHUNK && y > 1 && y < HEIGHT) {
          const index = chunkIndex(x, y, z);
          if (blocks[index] === STONE) blocks[index] = id;
        }
        const roll = hash3(x, y + step * 7, z, this.seed + salt + 4);
        if (roll < 0.33) x += roll < 0.16 ? 1 : -1; else if (roll < 0.66) z += roll < 0.5 ? 1 : -1; else y += roll < 0.83 ? 1 : -1;
      }
    }
  }

  private treeAt(x: number, z: number): Readonly<{ kind: "oak" | "birch"; trunk: number }> | null {
    const { height, biome } = this.column(x, z);
    if (height <= SEA_LEVEL + 1 || height + 9 >= HEIGHT) return null;
    const density = biome === BIOME.forest ? 0.055 : biome === BIOME.birchForest ? 0.05 : biome === BIOME.plains ? 0.004 : biome === BIOME.snowy ? 0.006 : biome === BIOME.mountains ? 0.008 : 0;
    if (density === 0 || hash2(x, z, this.seed + 7) >= density) return null;
    // Keep canopies from overlapping: the lexicographically first tree within two blocks wins.
    for (let dx = -2; dx <= 2; dx += 1) for (let dz = -2; dz <= 2; dz += 1) {
      if (dx === 0 && dz === 0) continue;
      if (dz < 0 || (dz === 0 && dx < 0)) {
        const other = this.column(x + dx, z + dz);
        const otherDensity = other.biome === BIOME.forest ? 0.055 : other.biome === BIOME.birchForest ? 0.05 : other.biome === BIOME.plains ? 0.004 : other.biome === BIOME.snowy ? 0.006 : other.biome === BIOME.mountains ? 0.008 : 0;
        if (other.height > SEA_LEVEL + 1 && otherDensity > 0 && hash2(x + dx, z + dz, this.seed + 7) < otherDensity) return null;
      }
    }
    const birch = biome === BIOME.birchForest ? hash2(x, z, this.seed + 8) < 0.85 : hash2(x, z, this.seed + 8) < 0.1;
    return { kind: birch ? "birch" : "oak", trunk: 4 + Math.floor(hash2(x, z, this.seed + 9) * 3) };
  }

  private decorate(cx: number, cz: number, blocks: Uint8Array): void {
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;
    const put = (x: number, y: number, z: number, id: number, onlyAir: boolean): void => {
      const lx = x - x0;
      const lz = z - z0;
      if (lx < 0 || lz < 0 || lx >= CHUNK || lz >= CHUNK || y < 0 || y >= HEIGHT) return;
      const index = chunkIndex(lx, y, lz);
      if (onlyAir && blocks[index] !== AIR) return;
      blocks[index] = id;
    };
    // Trees whose canopy may overlap this chunk: scan two blocks beyond the border.
    for (let z = z0 - 3; z < z0 + CHUNK + 3; z += 1) for (let x = x0 - 3; x < x0 + CHUNK + 3; x += 1) {
      const tree = this.treeAt(x, z);
      if (tree === null) continue;
      const { height } = this.column(x, z);
      const log = tree.kind === "birch" ? BIRCH_LOG : LOG;
      const leaves = tree.kind === "birch" ? BIRCH_LEAVES : LEAVES;
      for (let y = 1; y <= tree.trunk; y += 1) put(x, height + y, z, log, false);
      for (let dy = tree.trunk - 2; dy <= tree.trunk + 1; dy += 1) {
        const radius = dy >= tree.trunk ? 1 : 2;
        for (let dx = -radius; dx <= radius; dx += 1) for (let dz = -radius; dz <= radius; dz += 1) {
          if (Math.abs(dx) === radius && Math.abs(dz) === radius && (radius === 1 || hash3(x + dx, dy, z + dz, this.seed + 12) < 0.6)) continue;
          if (dx === 0 && dz === 0 && dy <= tree.trunk) continue;
          put(x + dx, height + dy, z + dz, leaves, true);
        }
      }
      put(x, height + tree.trunk + 1, z, leaves, true);
    }
    // Ground cover inside this chunk only.
    for (let lz = 0; lz < CHUNK; lz += 1) for (let lx = 0; lx < CHUNK; lx += 1) {
      const x = x0 + lx;
      const z = z0 + lz;
      const { height, biome } = this.column(x, z);
      if (height + 1 >= HEIGHT) continue;
      const top = blocks[chunkIndex(lx, height, lz)];
      const above = chunkIndex(lx, height + 1, lz);
      if (blocks[above] !== AIR) continue;
      const roll = hash2(x, z, this.seed + 13);
      if (top === GRASS) {
        const grassy = biome === BIOME.plains ? 0.3 : biome === BIOME.forest ? 0.22 : biome === BIOME.birchForest ? 0.2 : biome === BIOME.snowy ? 0 : 0.08;
        if (roll < grassy) blocks[above] = TALL_GRASS;
        else if (roll < grassy + 0.012) blocks[above] = hash2(x, z, this.seed + 14) < 0.5 ? DANDELION : POPPY;
      } else if (top === SAND && biome === BIOME.desert) {
        if (roll < 0.012 && blocks[chunkIndex(lx, height + 2, lz)] === AIR) { const tall = 1 + Math.floor(hash2(x, z, this.seed + 15) * 3); for (let y = 1; y <= tall && height + y < HEIGHT; y += 1) blocks[chunkIndex(lx, height + y, lz)] = CACTUS; }
        else if (roll < 0.03) blocks[above] = DEAD_BUSH;
      }
    }
  }
}
