/**
 * Infinite chunked voxel world with a sparse edit journal, block entities, flood-fill sky and block
 * lighting, and a grid ray walk. Authority-neutral: no DOM, no Three.js.
 */
import { AIR, BEDROCK, LOG, WATER, blockById, type BlockDefinition } from "./blocks.js";
import { CHUNK, CHUNK_VOLUME, HEIGHT, SEA_LEVEL, TerrainGenerator, chunkIndex, chunkKey, type BiomeId } from "./terrain.js";

export interface Vec3 { readonly x: number; readonly y: number; readonly z: number; }
export interface BlockHit { readonly x: number; readonly y: number; readonly z: number; readonly id: number; readonly normal: Vec3; readonly distance: number; }
export type BlockListener = (x: number, y: number, z: number) => void;
export type ChunkListener = (cx: number, cz: number, kind: "loaded" | "unloaded" | "dirty") => void;

export interface FurnaceState {
  input: ItemSlotData | null;
  fuel: ItemSlotData | null;
  output: ItemSlotData | null;
  /** Remaining burn ticks of the current fuel item and the total it started with. */
  burn: number;
  burnTotal: number;
  progress: number;
}

export interface ItemSlotData { key: string; count: number; damage: number; }
export interface ChestState { kind: "chest"; slots: (ItemSlotData | null)[]; }
export type BlockEntityState = FurnaceState | ChestState;
export function isChestState(state: BlockEntityState | undefined): state is ChestState { return state !== undefined && (state as ChestState).kind === "chest"; }

export class Chunk {
  readonly blocks = new Uint8Array(CHUNK_VOLUME);
  /** High nibble sky light, low nibble block light. */
  readonly light = new Uint8Array(CHUNK_VOLUME);
  readonly biomes = new Uint8Array(CHUNK * CHUNK);
  /** Highest non-air block per column, -1 if empty. */
  readonly heights = new Int16Array(CHUNK * CHUNK).fill(-1);
  constructor(readonly cx: number, readonly cz: number) {}
}

const NEIGHBOURS: readonly (readonly [number, number, number])[] = Object.freeze([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]);

function posKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export class World {
  readonly generator: TerrainGenerator;
  private readonly chunks = new Map<string, Chunk>();
  /** Persistent journal of edits per chunk key: local index → block id. Survives chunk unloads. */
  private readonly journal = new Map<string, Map<number, number>>();
  readonly blockEntities = new Map<string, BlockEntityState>();
  private readonly blockListeners = new Set<BlockListener>();
  private readonly chunkListeners = new Set<ChunkListener>();
  private readonly dirtyChunks = new Set<string>();
  private lightQueue: number[] = [];

  constructor(readonly seed: number) {
    this.generator = new TerrainGenerator(seed);
  }

  // --- Chunk access ---------------------------------------------------------------

  get loadedChunkCount(): number { return this.chunks.size; }
  get editCount(): number { let total = 0; for (const edits of this.journal.values()) total += edits.size; return total; }

  chunkAt(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  hasChunk(cx: number, cz: number): boolean {
    return this.chunks.has(chunkKey(cx, cz));
  }

  loadedChunks(): IterableIterator<Chunk> {
    return this.chunks.values();
  }

  /** Generates (or returns) a chunk, re-applies journaled edits, and seeds its lighting. */
  ensureChunk(cx: number, cz: number): Chunk {
    const key = chunkKey(cx, cz);
    const existing = this.chunks.get(key);
    if (existing !== undefined) return existing;
    const chunk = new Chunk(cx, cz);
    this.generator.generate(cx, cz, chunk.blocks, chunk.biomes);
    const edits = this.journal.get(key);
    if (edits !== undefined) for (const [index, id] of edits) chunk.blocks[index] = id;
    this.chunks.set(key, chunk);
    this.recomputeHeights(chunk);
    this.seedLight(chunk);
    this.propagateLight();
    this.markDirty(cx, cz);
    for (const listener of this.chunkListeners) listener(cx, cz, "loaded");
    return chunk;
  }

  unloadChunk(cx: number, cz: number): boolean {
    const key = chunkKey(cx, cz);
    if (!this.chunks.delete(key)) return false;
    this.dirtyChunks.delete(key);
    for (const listener of this.chunkListeners) listener(cx, cz, "unloaded");
    return true;
  }

  /** Unloads every chunk farther than `radius` chunks (Chebyshev) from the given chunk. */
  unloadBeyond(centerX: number, centerZ: number, radius: number): number {
    let count = 0;
    for (const chunk of [...this.chunks.values()]) {
      if (Math.max(Math.abs(chunk.cx - centerX), Math.abs(chunk.cz - centerZ)) > radius && this.unloadChunk(chunk.cx, chunk.cz)) count += 1;
    }
    return count;
  }

  takeDirtyChunks(): string[] {
    const result = [...this.dirtyChunks];
    this.dirtyChunks.clear();
    return result;
  }

  private markDirty(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    if (!this.chunks.has(key)) return;
    // Listeners (the renderer) keep their own dedupe set, so every edit notifies even while a previous
    // dirty mark is still pending in `dirtyChunks` for pull-style consumers.
    this.dirtyChunks.add(key);
    for (const listener of this.chunkListeners) listener(cx, cz, "dirty");
  }

  private markDirtyAround(x: number, y: number, z: number): void {
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const lx = x - cx * CHUNK;
    const lz = z - cz * CHUNK;
    this.markDirty(cx, cz);
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK - 1) this.markDirty(cx, cz + 1);
    if (lx === 0 && lz === 0) this.markDirty(cx - 1, cz - 1);
    if (lx === 0 && lz === CHUNK - 1) this.markDirty(cx - 1, cz + 1);
    if (lx === CHUNK - 1 && lz === 0) this.markDirty(cx + 1, cz - 1);
    if (lx === CHUNK - 1 && lz === CHUNK - 1) this.markDirty(cx + 1, cz + 1);
    void y;
  }

  // --- Block access -----------------------------------------------------------------

  get(x: number, y: number, z: number): number {
    if (y < 0) return BEDROCK;
    if (y >= HEIGHT) return AIR;
    const chunk = this.chunks.get(chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    if (chunk === undefined) return AIR;
    return chunk.blocks[chunkIndex(x & 15, y, z & 15)] ?? AIR;
  }

  definition(x: number, y: number, z: number): BlockDefinition {
    return blockById(this.get(x, y, z));
  }

  isSolid(x: number, y: number, z: number): boolean {
    return blockById(this.get(x, y, z)).solid;
  }

  isLiquid(x: number, y: number, z: number): boolean {
    return blockById(this.get(x, y, z)).liquid;
  }

  isLoaded(x: number, z: number): boolean {
    return this.chunks.has(chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
  }

  biomeAt(x: number, z: number): BiomeId {
    const chunk = this.chunks.get(chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    if (chunk !== undefined) return (chunk.biomes[(z & 15) * CHUNK + (x & 15)] ?? 2) as BiomeId;
    return this.generator.column(x, z).biome;
  }

  /** Sky light 0–15 (before daylight scaling) and block light 0–15 at a position. */
  skyLight(x: number, y: number, z: number): number {
    if (y >= HEIGHT) return 15;
    if (y < 0) return 0;
    const chunk = this.chunks.get(chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    return chunk === undefined ? 15 : (chunk.light[chunkIndex(x & 15, y, z & 15)] ?? 0) >> 4;
  }

  blockLight(x: number, y: number, z: number): number {
    if (y >= HEIGHT || y < 0) return 0;
    const chunk = this.chunks.get(chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    return chunk === undefined ? 0 : (chunk.light[chunkIndex(x & 15, y, z & 15)] ?? 0) & 15;
  }

  /** Highest non-air block in a column of a loaded chunk, or the generated height when unloaded. */
  heightAt(x: number, z: number): number {
    const chunk = this.chunks.get(chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    if (chunk === undefined) return this.generator.column(x, z).height;
    return chunk.heights[(z & 15) * CHUNK + (x & 15)] ?? -1;
  }

  /** Sets a block, journals the edit, updates lighting and heights, and notifies listeners. */
  set(x: number, y: number, z: number, id: number): boolean {
    if (y < 0 || y >= HEIGHT) return false;
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (chunk === undefined) return false;
    const index = chunkIndex(x & 15, y, z & 15);
    const previous = chunk.blocks[index] ?? AIR;
    if (previous === id) return false;
    chunk.blocks[index] = id;
    const key = chunkKey(cx, cz);
    let edits = this.journal.get(key);
    if (edits === undefined) { edits = new Map(); this.journal.set(key, edits); }
    edits.set(index, id);
    const column = (z & 15) * CHUNK + (x & 15);
    if (id !== AIR && y > (chunk.heights[column] ?? -1)) chunk.heights[column] = y;
    else if (id === AIR && y === chunk.heights[column]) { let top = y - 1; while (top >= 0 && chunk.blocks[chunkIndex(x & 15, top, z & 15)] === AIR) top -= 1; chunk.heights[column] = top; }
    if (previous !== AIR && blockById(previous).light === 0 && id === AIR) { /* nothing */ }
    this.blockEntities.delete(posKey(x, y, z));
    this.updateLightAfterEdit(x, y, z, blockById(previous), blockById(id));
    this.markDirtyAround(x, y, z);
    for (const listener of this.blockListeners) listener(x, y, z);
    return true;
  }

  /** Persistence: every journaled edit as [cx, cz, index, id, index, id, ...] groups. */
  serializeEdits(): number[][] {
    const result: number[][] = [];
    for (const [key, edits] of [...this.journal].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (edits.size === 0) continue;
      const [cx, cz] = key.split(",").map(Number) as [number, number];
      const group = [cx, cz];
      for (const [index, id] of [...edits].sort((a, b) => a[0] - b[0])) group.push(index, id);
      result.push(group);
    }
    return result;
  }

  applyEdits(groups: readonly (readonly number[])[]): number {
    let applied = 0;
    for (const group of groups) {
      if (group.length < 4) continue;
      const cx = group[0]!;
      const cz = group[1]!;
      if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cz)) continue;
      const key = chunkKey(cx, cz);
      let edits = this.journal.get(key);
      if (edits === undefined) { edits = new Map(); this.journal.set(key, edits); }
      for (let cursor = 2; cursor + 1 < group.length; cursor += 2) {
        const index = group[cursor]!;
        const id = group[cursor + 1]!;
        if (!Number.isSafeInteger(index) || index < 0 || index >= CHUNK_VOLUME || !Number.isSafeInteger(id) || id < 0 || id > 255) continue;
        edits.set(index, id);
        applied += 1;
      }
    }
    return applied;
  }

  serializeBlockEntities(): readonly (readonly [string, BlockEntityState])[] {
    return [...this.blockEntities].map(([key, state]) => {
      if (isChestState(state)) return [key, { kind: "chest", slots: state.slots.map((slot) => (slot === null ? null : { ...slot })) }] as const;
      return [key, { input: state.input === null ? null : { ...state.input }, fuel: state.fuel === null ? null : { ...state.fuel }, output: state.output === null ? null : { ...state.output }, burn: state.burn, burnTotal: state.burnTotal, progress: state.progress }] as const;
    });
  }

  /** Drops every loaded chunk and journal entry; used when starting a fresh world. */
  reset(): void {
    for (const chunk of [...this.chunks.values()]) this.unloadChunk(chunk.cx, chunk.cz);
    this.journal.clear();
    this.blockEntities.clear();
    this.dirtyChunks.clear();
    this.lightQueue = [];
  }

  subscribe(listener: BlockListener): () => void {
    this.blockListeners.add(listener);
    return () => this.blockListeners.delete(listener);
  }

  subscribeChunks(listener: ChunkListener): () => void {
    this.chunkListeners.add(listener);
    return () => this.chunkListeners.delete(listener);
  }

  // --- Queries ----------------------------------------------------------------------

  private recomputeHeights(chunk: Chunk): void {
    for (let lz = 0; lz < CHUNK; lz += 1) for (let lx = 0; lx < CHUNK; lx += 1) {
      let top = HEIGHT - 1;
      while (top >= 0 && chunk.blocks[chunkIndex(lx, top, lz)] === AIR) top -= 1;
      chunk.heights[lz * CHUNK + lx] = top;
    }
  }

  topSolid(x: number, z: number): number {
    for (let y = HEIGHT - 1; y >= 0; y -= 1) if (blockById(this.get(x, y, z)).solid) return y;
    return -1;
  }

  /** Flat grass near the origin, above sea level, with head room. Scans generated column data first, then loads the winning chunk. */
  findSpawn(): Vec3 {
    let best: Vec3 | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let radius = 0; radius <= 320 && best === null; radius += 8) {
      for (let dx = -radius; dx <= radius; dx += 8) for (let dz = -radius; dz <= radius; dz += 8) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const column = this.generator.column(dx, dz);
        if (column.height <= SEA_LEVEL + 1 || column.height > SEA_LEVEL + 24 || column.biome === 0 || column.biome === 1 || column.biome === 8 || column.biome === 5) continue;
        let flat = true;
        for (let nx = -2; nx <= 2 && flat; nx += 1) for (let nz = -2; nz <= 2; nz += 1) {
          if (Math.abs(this.generator.column(dx + nx, dz + nz).height - column.height) > 1) { flat = false; break; }
        }
        if (!flat) continue;
        const score = dx * dx + dz * dz;
        if (score < bestScore) { bestScore = score; best = { x: dx + 0.5, y: column.height + 1, z: dz + 0.5 }; }
      }
    }
    const candidate = best ?? { x: 0.5, y: this.generator.column(0, 0).height + 1, z: 0.5 };
    const bx = Math.floor(candidate.x);
    const bz = Math.floor(candidate.z);
    this.ensureChunk(Math.floor(bx / CHUNK), Math.floor(bz / CHUNK));
    let top = this.topSolid(bx, bz);
    // Never spawn inside a tree trunk or under leaves: walk down to the ground block.
    while (top > 0 && this.get(bx, top, bz) === LOG) top -= 1;
    for (let y = top + 1; y <= top + 2; y += 1) if (this.get(bx, y, bz) !== AIR && !blockById(this.get(bx, y, bz)).replaceable) this.set(bx, y, bz, AIR);
    return { x: candidate.x, y: top + 1, z: candidate.z };
  }

  /** Nearest block of the given id to a point, scanning loaded chunks in expanding shells. */
  findNearest(id: number, origin: Vec3, maximumRadius = 48): Vec3 | null {
    const ox = Math.floor(origin.x);
    const oy = Math.floor(origin.y);
    const oz = Math.floor(origin.z);
    let best: Vec3 | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let radius = 0; radius <= maximumRadius; radius += 1) {
      for (let x = ox - radius; x <= ox + radius; x += 1) for (let z = oz - radius; z <= oz + radius; z += 1) {
        if (Math.max(Math.abs(x - ox), Math.abs(z - oz)) !== radius || !this.isLoaded(x, z)) continue;
        for (let y = 0; y < HEIGHT; y += 1) {
          if (this.get(x, y, z) !== id) continue;
          const distance = Math.abs(x - ox) + Math.abs(z - oz) + Math.abs(y - oy) * 0.5;
          if (distance < bestDistance) { bestDistance = distance; best = { x, y, z }; }
        }
      }
      if (best !== null && radius >= Math.min(maximumRadius, Math.ceil(bestDistance))) break;
    }
    return best;
  }

  /** Amanatides–Woo grid traversal. Liquids are transparent to the ray unless `hitLiquid` is set. */
  raycast(origin: Vec3, direction: Vec3, maximumDistance: number, hitLiquid = false): BlockHit | null {
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
      if (id !== AIR && iteration > 0 && y >= 0 && y < HEIGHT) {
        const definition = blockById(id);
        if (!definition.liquid || hitLiquid) return Object.freeze({ x, y, z, id, normal: Object.freeze(normal), distance });
      }
      if (maxX < maxY && maxX < maxZ) { distance = maxX; x += stepX; maxX += deltaX; normal = { x: -stepX, y: 0, z: 0 }; }
      else if (maxY < maxZ) { distance = maxY; y += stepY; maxY += deltaY; normal = { x: 0, y: -stepY, z: 0 }; }
      else { distance = maxZ; z += stepZ; maxZ += deltaZ; normal = { x: 0, y: 0, z: -stepZ }; }
      if (distance > maximumDistance) return null;
      if (y < 0 || y >= HEIGHT) return null;
    }
    return null;
  }

  // --- Lighting --------------------------------------------------------------------

  private lightAt(x: number, y: number, z: number): number {
    if (y >= HEIGHT) return 0xf0;
    if (y < 0) return 0;
    const chunk = this.chunks.get(chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    return chunk === undefined ? -1 : chunk.light[chunkIndex(x & 15, y, z & 15)] ?? 0;
  }

  private setLight(x: number, y: number, z: number, packed: number): void {
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (chunk === undefined) return;
    chunk.light[chunkIndex(x & 15, y, z & 15)] = packed;
    this.markDirtyAround(x, y, z);
  }

  private push(x: number, y: number, z: number): void {
    this.lightQueue.push(x, y, z);
  }

  private seedLight(chunk: Chunk): void {
    const x0 = chunk.cx * CHUNK;
    const z0 = chunk.cz * CHUNK;
    for (let lz = 0; lz < CHUNK; lz += 1) for (let lx = 0; lx < CHUNK; lx += 1) {
      let y = HEIGHT - 1;
      for (; y >= 0; y -= 1) {
        const definition = blockById(chunk.blocks[chunkIndex(lx, y, lz)] ?? AIR);
        if (definition.lightFilter > 0) break;
        chunk.light[chunkIndex(lx, y, lz)] = 0xf0;
      }
      // Every column edge between full light and the shaded part below spreads sideways from here.
      if (y + 1 < HEIGHT) this.push(x0 + lx, y + 1, z0 + lz);
      if (y >= 0) this.push(x0 + lx, y, z0 + lz);
    }
    for (let y = 0; y < HEIGHT; y += 1) for (let lz = 0; lz < CHUNK; lz += 1) for (let lx = 0; lx < CHUNK; lx += 1) {
      const definition = blockById(chunk.blocks[chunkIndex(lx, y, lz)] ?? AIR);
      if (definition.light > 0) { const index = chunkIndex(lx, y, lz); chunk.light[index] = ((chunk.light[index] ?? 0) & 0xf0) | definition.light; this.push(x0 + lx, y, z0 + lz); }
    }
    // Border columns of neighbouring chunks re-spread into this fresh chunk.
    for (let lz = 0; lz < CHUNK; lz += 1) for (let lx = 0; lx < CHUNK; lx += 1) {
      if (lx !== 0 && lx !== CHUNK - 1 && lz !== 0 && lz !== CHUNK - 1) continue;
      const nx = lx === 0 ? x0 - 1 : lx === CHUNK - 1 ? x0 + CHUNK : x0 + lx;
      const nz = lz === 0 ? z0 - 1 : lz === CHUNK - 1 ? z0 + CHUNK : z0 + lz;
      if (!this.isLoaded(nx, nz)) continue;
      for (let y = 0; y < HEIGHT; y += 1) if (this.lightAt(nx, y, nz) > 0) this.push(nx, y, nz);
      if (lx === 0 || lx === CHUNK - 1) for (let y = 0; y < HEIGHT; y += 1) if (this.isLoaded(x0 + lx, nz) && this.lightAt(x0 + lx, y, nz) > 0) this.push(x0 + lx, y, nz);
    }
  }

  /** Breadth-first spread of both light channels from every queued position. */
  private propagateLight(): void {
    const queue = this.lightQueue;
    let head = 0;
    while (head < queue.length) {
      const x = queue[head]!;
      const y = queue[head + 1]!;
      const z = queue[head + 2]!;
      head += 3;
      const packed = this.lightAt(x, y, z);
      if (packed <= 0) continue;
      const sky = packed >> 4;
      const block = packed & 15;
      for (const [dx, dy, dz] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (ny < 0 || ny >= HEIGHT) continue;
        const current = this.lightAt(nx, ny, nz);
        if (current < 0) continue;
        const filter = blockById(this.get(nx, ny, nz)).lightFilter;
        if (filter >= 15) continue;
        const nextSky = dy === -1 && sky === 15 && filter === 0 ? 15 : Math.max(0, sky - 1 - filter);
        const nextBlock = Math.max(0, block - 1 - filter);
        const currentSky = current >> 4;
        const currentBlock = current & 15;
        if (nextSky <= currentSky && nextBlock <= currentBlock) continue;
        this.setLight(nx, ny, nz, (Math.max(nextSky, currentSky) << 4) | Math.max(nextBlock, currentBlock));
        this.push(nx, ny, nz);
      }
      if (head > 30_000 && head === queue.length) break;
    }
    this.lightQueue = [];
  }

  /** Removes a light channel from a region by flood fill, re-queuing brighter borders for re-propagation. */
  private removeLight(x: number, y: number, z: number, channel: "sky" | "block"): void {
    const shift = channel === "sky" ? 4 : 0;
    const mask = channel === "sky" ? 0x0f : 0xf0;
    const start = this.lightAt(x, y, z);
    if (start < 0) return;
    const startLevel = (start >> shift) & 15;
    this.setLight(x, y, z, start & mask);
    const removal: number[] = [x, y, z, startLevel];
    let head = 0;
    while (head < removal.length) {
      const rx = removal[head]!;
      const ry = removal[head + 1]!;
      const rz = removal[head + 2]!;
      const level = removal[head + 3]!;
      head += 4;
      for (const [dx, dy, dz] of NEIGHBOURS) {
        const nx = rx + dx;
        const ny = ry + dy;
        const nz = rz + dz;
        if (ny < 0 || ny >= HEIGHT) continue;
        const packed = this.lightAt(nx, ny, nz);
        if (packed < 0) continue;
        const neighbourLevel = (packed >> shift) & 15;
        if (neighbourLevel === 0) continue;
        const fedByUs = neighbourLevel < level || (channel === "sky" && level === 15 && neighbourLevel === 15 && dy === -1);
        if (fedByUs) {
          this.setLight(nx, ny, nz, packed & mask);
          removal.push(nx, ny, nz, neighbourLevel);
        } else {
          this.push(nx, ny, nz);
        }
      }
      if (removal.length > 200_000) break;
    }
  }

  private updateLightAfterEdit(x: number, y: number, z: number, previous: BlockDefinition, next: BlockDefinition): void {
    if (previous.light > 0) this.removeLight(x, y, z, "block");
    if (next.lightFilter > previous.lightFilter) {
      this.removeLight(x, y, z, "sky");
      if (next.lightFilter < 15) { for (const [dx, dy, dz] of NEIGHBOURS) this.push(x + dx, y + dy, z + dz); }
      if (previous.light === 0 && next.light === 0) this.removeLight(x, y, z, "block");
    } else if (next.lightFilter < previous.lightFilter) {
      for (const [dx, dy, dz] of NEIGHBOURS) this.push(x + dx, y + dy, z + dz);
    }
    if (next.light > 0) {
      const packed = Math.max(0, this.lightAt(x, y, z));
      this.setLight(x, y, z, (packed & 0xf0) | Math.max(packed & 15, next.light));
      this.push(x, y, z);
    }
    this.propagateLight();
  }

  /** Sea level exposed for spawn logic and swimming checks. */
  static readonly seaLevel = SEA_LEVEL;
  static readonly water = WATER;
}
