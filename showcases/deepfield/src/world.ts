import { AIR, BEDROCK, COAL_ORE, DIAMOND_ORE, DIRT, GOLD_ORE, GRASS, IRON_ORE, LEAVES, LOG, SAND, STONE, WATER, blockById } from "./blocks.js";
import { fbm2, hash2, hash3, valueNoise3 } from "./noise.js";

export const WORLD = Object.freeze({ sizeX: 96, sizeY: 64, sizeZ: 96, chunk: 16, seaLevel: 22 });
export const CHUNKS_X = WORLD.sizeX / WORLD.chunk;
export const CHUNKS_Z = WORLD.sizeZ / WORLD.chunk;

export interface Vec3 { readonly x: number; readonly y: number; readonly z: number; }
export interface BlockHit {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly id: number;
  readonly normal: Vec3;
  readonly distance: number;
}

export type WorldListener = (x: number, y: number, z: number) => void;

/**
 * A bounded voxel volume: seeded generation, a sparse edit journal on top of the
 * generated base, solidity queries, and a grid ray walk for targeting.
 */
export class VoxelWorld {
  readonly voxels: Uint8Array;
  private readonly base: Uint8Array;
  private readonly editJournal = new Map<number, number>();
  private readonly listeners = new Set<WorldListener>();
  private heights: Int16Array;

  constructor(readonly seed: number) {
    this.voxels = new Uint8Array(WORLD.sizeX * WORLD.sizeY * WORLD.sizeZ);
    this.base = new Uint8Array(this.voxels.length);
    this.heights = new Int16Array(WORLD.sizeX * WORLD.sizeZ);
    this.generate();
  }

  static index(x: number, y: number, z: number): number {
    return (y * WORLD.sizeZ + z) * WORLD.sizeX + x;
  }

  static inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < WORLD.sizeX && y < WORLD.sizeY && z < WORLD.sizeZ;
  }

  get editCount(): number { return this.editJournal.size; }

  get(x: number, y: number, z: number): number {
    if (!VoxelWorld.inBounds(x, y, z)) return y < 0 ? BEDROCK : AIR;
    return this.voxels[VoxelWorld.index(x, y, z)] ?? AIR;
  }

  isSolid(x: number, y: number, z: number): boolean {
    return blockById(this.get(x, y, z)).solid;
  }

  isLiquid(x: number, y: number, z: number): boolean {
    return blockById(this.get(x, y, z)).liquid;
  }

  surfaceHeight(x: number, z: number): number {
    return this.heights[z * WORLD.sizeX + x] ?? 0;
  }

  /** Sets a block, records the change against the generated base, and notifies listeners. */
  set(x: number, y: number, z: number, id: number): boolean {
    if (!VoxelWorld.inBounds(x, y, z)) return false;
    const index = VoxelWorld.index(x, y, z);
    if (this.voxels[index] === id) return false;
    this.voxels[index] = id;
    if (this.base[index] === id) this.editJournal.delete(index); else this.editJournal.set(index, id);
    for (const listener of this.listeners) listener(x, y, z);
    return true;
  }

  subscribe(listener: WorldListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Flattened [index, id, index, id, ...] pairs for persistence. */
  serializeEdits(): number[] {
    const result: number[] = [];
    for (const [index, id] of [...this.editJournal].sort((a, b) => a[0] - b[0])) result.push(index, id);
    return result;
  }

  applyEdits(pairs: readonly number[]): number {
    let applied = 0;
    for (let cursor = 0; cursor + 1 < pairs.length; cursor += 2) {
      const index = pairs[cursor]!;
      const id = pairs[cursor + 1]!;
      if (!Number.isSafeInteger(index) || index < 0 || index >= this.voxels.length || !Number.isSafeInteger(id) || id < 0 || id > 255) continue;
      const x = index % WORLD.sizeX;
      const z = Math.floor(index / WORLD.sizeX) % WORLD.sizeZ;
      const y = Math.floor(index / (WORLD.sizeX * WORLD.sizeZ));
      if (this.set(x, y, z, id)) applied += 1;
    }
    return applied;
  }

  /** Restores the generated terrain and clears the journal. */
  resetEdits(): void {
    const changed: number[] = [];
    for (const index of this.editJournal.keys()) changed.push(index);
    this.editJournal.clear();
    for (const index of changed) {
      this.voxels[index] = this.base[index] ?? AIR;
      const x = index % WORLD.sizeX;
      const z = Math.floor(index / WORLD.sizeX) % WORLD.sizeZ;
      const y = Math.floor(index / (WORLD.sizeX * WORLD.sizeZ));
      for (const listener of this.listeners) listener(x, y, z);
    }
  }

  /** The highest solid, non-liquid block under (x, z), or -1. */
  topSolid(x: number, z: number): number {
    for (let y = WORLD.sizeY - 1; y >= 0; y -= 1) {
      const id = this.get(x, y, z);
      if (blockById(id).solid) return y;
    }
    return -1;
  }

  findSpawn(): Vec3 {
    const cx = WORLD.sizeX / 2;
    const cz = WORLD.sizeZ / 2;
    let best: Vec3 | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let radius = 0; radius < 40 && best === null; radius += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) for (let dz = -radius; dz <= radius; dz += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const x = cx + dx;
        const z = cz + dz;
        const top = this.topSolid(x, z);
        if (top < WORLD.seaLevel || this.get(x, top, z) !== GRASS || this.get(x, top + 1, z) !== AIR || this.get(x, top + 2, z) !== AIR) continue;
        let flat = true;
        for (let nx = -2; nx <= 2 && flat; nx += 1) for (let nz = -2; nz <= 2; nz += 1) {
          const neighbor = this.topSolid(x + nx, z + nz);
          if (Math.abs(neighbor - top) > 1 || this.get(x + nx, neighbor, z + nz) === LOG) { flat = false; break; }
        }
        if (!flat) continue;
        const score = dx * dx + dz * dz;
        if (score < bestScore) { bestScore = score; best = { x: x + 0.5, y: top + 1, z: z + 0.5 }; }
      }
    }
    return best ?? { x: cx + 0.5, y: WORLD.sizeY - 4, z: cz + 0.5 };
  }

  /** Nearest block of the given id to a point (Manhattan scan in expanding shells, bounded). */
  findNearest(id: number, origin: Vec3, maximumRadius = 48): Vec3 | null {
    const ox = Math.floor(origin.x);
    const oy = Math.floor(origin.y);
    const oz = Math.floor(origin.z);
    let best: Vec3 | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let radius = 0; radius <= maximumRadius; radius += 1) {
      for (let x = ox - radius; x <= ox + radius; x += 1) for (let z = oz - radius; z <= oz + radius; z += 1) {
        if (Math.max(Math.abs(x - ox), Math.abs(z - oz)) !== radius) continue;
        for (let y = 0; y < WORLD.sizeY; y += 1) {
          if (this.get(x, y, z) !== id) continue;
          const distance = Math.abs(x - ox) + Math.abs(z - oz) + Math.abs(y - oy) * 0.5;
          if (distance < bestDistance) { bestDistance = distance; best = { x, y, z }; }
        }
      }
      if (best !== null && radius >= Math.min(maximumRadius, Math.ceil(bestDistance))) break;
    }
    return best;
  }

  /** Amanatides–Woo grid traversal from origin along a unit direction. Liquids are transparent to the ray. */
  raycast(origin: Vec3, direction: Vec3, maximumDistance: number): BlockHit | null {
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);
    const stepX = direction.x > 0 ? 1 : direction.x < 0 ? -1 : 0;
    const stepY = direction.y > 0 ? 1 : direction.y < 0 ? -1 : 0;
    const stepZ = direction.z > 0 ? 1 : direction.z < 0 ? -1 : 0;
    const deltaX = stepX === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / direction.x);
    const deltaY = stepY === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / direction.y);
    const deltaZ = stepZ === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / direction.z);
    let maxX = stepX === 0 ? Number.POSITIVE_INFINITY : (stepX > 0 ? x + 1 - origin.x : origin.x - x) * deltaX;
    let maxY = stepY === 0 ? Number.POSITIVE_INFINITY : (stepY > 0 ? y + 1 - origin.y : origin.y - y) * deltaY;
    let maxZ = stepZ === 0 ? Number.POSITIVE_INFINITY : (stepZ > 0 ? z + 1 - origin.z : origin.z - z) * deltaZ;
    let normal: Vec3 = { x: 0, y: 0, z: 0 };
    let distance = 0;
    for (let iteration = 0; iteration < 256; iteration += 1) {
      const id = this.get(x, y, z);
      if (id !== AIR && !blockById(id).liquid && VoxelWorld.inBounds(x, y, z) && iteration > 0) return Object.freeze({ x, y, z, id, normal: Object.freeze(normal), distance });
      if (maxX < maxY && maxX < maxZ) { distance = maxX; x += stepX; maxX += deltaX; normal = { x: -stepX, y: 0, z: 0 }; }
      else if (maxY < maxZ) { distance = maxY; y += stepY; maxY += deltaY; normal = { x: 0, y: -stepY, z: 0 }; }
      else { distance = maxZ; z += stepZ; maxZ += deltaZ; normal = { x: 0, y: 0, z: -stepZ }; }
      if (distance > maximumDistance) return null;
      if (y < 0 || y >= WORLD.sizeY) return null;
    }
    return null;
  }

  // --- Generation --------------------------------------------------------------

  private generate(): void {
    const seed = this.seed;
    const base = this.base;
    for (let z = 0; z < WORLD.sizeZ; z += 1) for (let x = 0; x < WORLD.sizeX; x += 1) {
      const continental = fbm2(x * 0.018 + 100, z * 0.018 + 100, seed, 4);
      const detail = fbm2(x * 0.07, z * 0.07, seed + 17, 3);
      const height = Math.max(4, Math.min(WORLD.sizeY - 6, Math.round(WORLD.seaLevel - 13 + continental * 36 + detail * 5)));
      this.heights[z * WORLD.sizeX + x] = height;
      const beach = height <= WORLD.seaLevel + 1;
      for (let y = 0; y <= height; y += 1) {
        let id = STONE;
        if (y === 0) id = BEDROCK;
        else if (y === height) id = beach ? SAND : GRASS;
        else if (y >= height - 3) id = beach ? SAND : DIRT;
        else {
          const ore = hash3(x, y, z, seed + 31);
          if (y < 12 && ore < 0.0035) id = DIAMOND_ORE;
          else if (y < 18 && ore < 0.008) id = GOLD_ORE;
          else if (y < 30 && ore < 0.02) id = IRON_ORE;
          else if (y < 44 && ore < 0.045) id = COAL_ORE;
          if (y > 4 && y < height - 5 && y < WORLD.seaLevel - 2 && valueNoise3(x * 0.11, y * 0.16, z * 0.11, seed + 5) > 0.7) id = AIR;
        }
        base[VoxelWorld.index(x, y, z)] = id;
      }
      for (let y = height + 1; y <= WORLD.seaLevel; y += 1) base[VoxelWorld.index(x, y, z)] = WATER;
    }
    for (let z = 3; z < WORLD.sizeZ - 3; z += 1) for (let x = 3; x < WORLD.sizeX - 3; x += 1) {
      const height = this.heights[z * WORLD.sizeX + x]!;
      if (height <= WORLD.seaLevel + 1 || base[VoxelWorld.index(x, height, z)] !== GRASS) continue;
      if (hash2(x, z, seed + 7) > 0.018) continue;
      let clear = true;
      for (let dx = -2; dx <= 2 && clear; dx += 1) for (let dz = -2; dz <= 2; dz += 1) if (dx !== 0 || dz !== 0) if (base[VoxelWorld.index(x + dx, Math.min(WORLD.sizeY - 1, height + 4), z + dz)] === LOG) { clear = false; break; }
      if (!clear) continue;
      const trunk = 4 + Math.floor(hash2(x, z, seed + 9) * 3);
      if (height + trunk + 3 >= WORLD.sizeY) continue;
      for (let y = 1; y <= trunk; y += 1) base[VoxelWorld.index(x, height + y, z)] = LOG;
      for (let dy = trunk - 2; dy <= trunk + 1; dy += 1) {
        const radius = dy >= trunk ? 1 : 2;
        for (let dx = -radius; dx <= radius; dx += 1) for (let dz = -radius; dz <= radius; dz += 1) {
          if (Math.abs(dx) === radius && Math.abs(dz) === radius && (radius === 2 ? hash3(x + dx, dy, z + dz, seed + 11) < 0.55 : true)) continue;
          const index = VoxelWorld.index(x + dx, height + dy, z + dz);
          if (base[index] === AIR) base[index] = LEAVES;
        }
      }
      base[VoxelWorld.index(x, height + trunk + 1, z)] = LEAVES;
    }
    this.voxels.set(base);
  }
}
