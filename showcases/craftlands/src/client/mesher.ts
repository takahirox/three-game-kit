/**
 * Chunk meshing with face culling, per-vertex ambient occlusion, smooth sky / block light sampling,
 * biome tints, cross-shaped plants, torches and lowered liquid surfaces.
 */
import { AIR, GRASS, TILE, WATER, blockById, type BlockDefinition } from "../shared/blocks.js";
import { BIOME, BIOME_FOLIAGE, BIOME_GRASS, CHUNK, HEIGHT, chunkIndex } from "../shared/terrain.js";
import type { Chunk, World } from "../shared/world.js";

export interface ChunkGeometry {
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly colors: Float32Array;
  readonly lights: Float32Array;
  readonly indices: Uint32Array;
  readonly quadCount: number;
}

export interface ChunkMeshes { readonly opaque: ChunkGeometry; readonly cutout: ChunkGeometry; readonly water: ChunkGeometry; }
export type TileUv = (tile: number) => readonly [u0: number, v0: number, u1: number, v1: number];

interface FaceSpec {
  readonly normal: readonly [number, number, number];
  readonly corners: readonly (readonly [number, number, number])[];
  readonly ao: readonly (readonly [readonly [number, number, number], readonly [number, number, number]])[];
  readonly shade: number;
  readonly tile: "top" | "side" | "bottom" | "front" | "back";
}

const FACES: readonly FaceSpec[] = Object.freeze([
  { normal: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], ao: [[[-1, 1, 0], [0, 1, 1]], [[1, 1, 0], [0, 1, 1]], [[1, 1, 0], [0, 1, -1]], [[-1, 1, 0], [0, 1, -1]]], shade: 1.0, tile: "top" },
  { normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], ao: [[[-1, -1, 0], [0, -1, -1]], [[1, -1, 0], [0, -1, -1]], [[1, -1, 0], [0, -1, 1]], [[-1, -1, 0], [0, -1, 1]]], shade: 0.5, tile: "bottom" },
  { normal: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], ao: [[[1, -1, 0], [1, 0, 1]], [[1, -1, 0], [1, 0, -1]], [[1, 1, 0], [1, 0, -1]], [[1, 1, 0], [1, 0, 1]]], shade: 0.6, tile: "side" },
  { normal: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], ao: [[[-1, -1, 0], [-1, 0, -1]], [[-1, -1, 0], [-1, 0, 1]], [[-1, 1, 0], [-1, 0, 1]], [[-1, 1, 0], [-1, 0, -1]]], shade: 0.6, tile: "side" },
  { normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], ao: [[[0, -1, 1], [-1, 0, 1]], [[0, -1, 1], [1, 0, 1]], [[0, 1, 1], [1, 0, 1]], [[0, 1, 1], [-1, 0, 1]]], shade: 0.8, tile: "front" },
  { normal: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], ao: [[[0, -1, -1], [1, 0, -1]], [[0, -1, -1], [-1, 0, -1]], [[0, 1, -1], [-1, 0, -1]], [[0, 1, -1], [1, 0, -1]]], shade: 0.8, tile: "back" },
]);

const UV_CORNERS: readonly (readonly [number, number])[] = Object.freeze([[0, 0], [1, 0], [1, 1], [0, 1]]);
const AO_LEVELS: readonly number[] = Object.freeze([0.5, 0.7, 0.85, 1]);

function unpackColor(hex: number): readonly [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

class GeometryBuilder {
  positions: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  lights: number[] = [];
  indices: number[] = [];
  quadCount = 0;

  quad(x: number, y: number, z: number, face: FaceSpec, uv: readonly [number, number, number, number], ao: readonly [number, number, number, number], light: readonly (readonly [number, number])[], tint: readonly [number, number, number], lower = 0, inset = 0): void {
    const base = this.positions.length / 3;
    for (let corner = 0; corner < 4; corner += 1) {
      const offset = face.corners[corner]!;
      const cornerY = offset[1] === 1 ? 1 - lower : 0;
      const px = offset[0] === 1 ? 1 - inset : inset;
      const pz = offset[2] === 1 ? 1 - inset : inset;
      this.positions.push(x + (face.normal[0] === 0 ? px : offset[0]), y + cornerY, z + (face.normal[2] === 0 ? pz : offset[2]));
      const uvCorner = UV_CORNERS[corner]!;
      this.uvs.push(uvCorner[0] === 0 ? uv[0] : uv[2], uvCorner[1] === 0 ? uv[1] : uv[3]);
      const shade = face.shade * (AO_LEVELS[ao[corner]!] ?? 1);
      this.colors.push(tint[0] * shade, tint[1] * shade, tint[2] * shade);
      const sample = light[corner]!;
      this.lights.push(sample[0], sample[1]);
    }
    if (ao[0]! + ao[2]! > ao[1]! + ao[3]!) this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    this.quadCount += 1;
  }

  /** Two crossed diagonal quads for plants; both sides are drawn by the material. */
  cross(x: number, y: number, z: number, uv: readonly [number, number, number, number], light: readonly [number, number], tint: readonly [number, number, number]): void {
    const diagonals: readonly (readonly [number, number, number, number])[] = [[0.15, 0.15, 0.85, 0.85], [0.85, 0.15, 0.15, 0.85]];
    for (const [ax, az, bx, bz] of diagonals) {
      const base = this.positions.length / 3;
      this.positions.push(x + ax, y, z + az, x + bx, y, z + bz, x + bx, y + 1, z + bz, x + ax, y + 1, z + az);
      this.uvs.push(uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]);
      for (let corner = 0; corner < 4; corner += 1) { this.colors.push(tint[0] * 0.9, tint[1] * 0.9, tint[2] * 0.9); this.lights.push(light[0], light[1]); }
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3, base, base + 2, base + 1, base, base + 3, base + 2);
      this.quadCount += 2;
    }
  }

  /** A slim upright box (torch) using the torch tile column, plus a top cap. */
  torch(x: number, y: number, z: number, uv: readonly [number, number, number, number], light: readonly [number, number]): void {
    const r = 1 / 16;
    const x0 = x + 0.5 - r;
    const x1 = x + 0.5 + r;
    const z0 = z + 0.5 - r;
    const z1 = z + 0.5 + r;
    const h = 10 / 16;
    const uw = uv[2] - uv[0];
    const vh = uv[3] - uv[1];
    const su0 = uv[0] + uw * (7 / 16);
    const su1 = uv[0] + uw * (9 / 16);
    const sides: readonly (readonly [number, number, number, number, number, number, number, number])[] = [
      [x0, z0, x1, z0, x1, z0, x0, z0], [x1, z1, x0, z1, x0, z1, x1, z1], [x1, z0, x1, z1, x1, z1, x1, z0], [x0, z1, x0, z0, x0, z0, x0, z1],
    ];
    for (const side of sides) {
      const base = this.positions.length / 3;
      this.positions.push(side[0], y, side[1], side[2], y, side[3], side[4], y + h, side[5], side[6], y + h, side[7]);
      this.uvs.push(su0, uv[1], su1, uv[1], su1, uv[1] + vh * (10 / 16), su0, uv[1] + vh * (10 / 16));
      for (let corner = 0; corner < 4; corner += 1) { this.colors.push(0.95, 0.95, 0.95); this.lights.push(light[0], light[1]); }
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3, base, base + 2, base + 1, base, base + 3, base + 2);
      this.quadCount += 2;
    }
    const base = this.positions.length / 3;
    this.positions.push(x0, y + h, z1, x1, y + h, z1, x1, y + h, z0, x0, y + h, z0);
    this.uvs.push(su0, uv[1] + vh * (8 / 16), su1, uv[1] + vh * (8 / 16), su1, uv[1] + vh * (10 / 16), su0, uv[1] + vh * (10 / 16));
    for (let corner = 0; corner < 4; corner += 1) { this.colors.push(1, 1, 1); this.lights.push(light[0], light[1]); }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.quadCount += 1;
  }

  build(): ChunkGeometry {
    return Object.freeze({
      positions: new Float32Array(this.positions),
      uvs: new Float32Array(this.uvs),
      colors: new Float32Array(this.colors),
      lights: new Float32Array(this.lights),
      indices: new Uint32Array(this.indices),
      quadCount: this.quadCount,
    });
  }
}

function occludes(world: World, x: number, y: number, z: number): boolean {
  const definition = blockById(world.get(x, y, z));
  return definition.solid && definition.opaque;
}

function vertexAo(world: World, x: number, y: number, z: number, sideA: readonly [number, number, number], sideB: readonly [number, number, number]): number {
  const a = occludes(world, x + sideA[0], y + sideA[1], z + sideA[2]) ? 1 : 0;
  const b = occludes(world, x + sideB[0], y + sideB[1], z + sideB[2]) ? 1 : 0;
  const cornerX = sideA[0] + sideB[0];
  const cornerY = sideA[1] === 0 ? sideB[1] : sideA[1];
  const cornerZ = sideA[2] + sideB[2];
  const corner = occludes(world, x + (cornerX === 0 ? 0 : Math.sign(cornerX)), y + cornerY, z + (cornerZ === 0 ? 0 : Math.sign(cornerZ))) ? 1 : 0;
  if (a === 1 && b === 1) return 0;
  return 3 - (a + b + corner);
}

/** Average light of the four blocks touching a face vertex on the face's outer side (Minecraft "smooth lighting"). */
function vertexLight(world: World, x: number, y: number, z: number, normal: readonly [number, number, number], sideA: readonly [number, number, number], sideB: readonly [number, number, number]): readonly [number, number] {
  const nx = x + normal[0];
  const ny = y + normal[1];
  const nz = z + normal[2];
  const cornerX = sideA[0] + sideB[0] - normal[0];
  const cornerY = sideA[1] + sideB[1] - normal[1];
  const cornerZ = sideA[2] + sideB[2] - normal[2];
  const cells: readonly (readonly [number, number, number])[] = [
    [nx, ny, nz],
    [x + sideA[0], y + sideA[1], z + sideA[2]],
    [x + sideB[0], y + sideB[1], z + sideB[2]],
    [x + cornerX, y + cornerY, z + cornerZ],
  ];
  let sky = 0;
  let block = 0;
  let count = 0;
  let bestSky = 0;
  let bestBlock = 0;
  for (const [cx, cy, cz] of cells) {
    if (occludes(world, cx, cy, cz)) continue;
    const s = world.skyLight(cx, cy, cz);
    const b = world.blockLight(cx, cy, cz);
    sky += s;
    block += b;
    count += 1;
    if (s > bestSky) bestSky = s;
    if (b > bestBlock) bestBlock = b;
  }
  if (count === 0) return [world.skyLight(nx, ny, nz) / 15, world.blockLight(nx, ny, nz) / 15];
  return [Math.max(sky / count, bestSky * 0.7) / 15, Math.max(block / count, bestBlock * 0.7) / 15];
}

function blockLightSample(world: World, x: number, y: number, z: number): readonly [number, number] {
  return [world.skyLight(x, y, z) / 15, world.blockLight(x, y, z) / 15];
}

function tintFor(definition: BlockDefinition, biome: number, face: FaceSpec["tile"]): readonly [number, number, number] {
  if (definition.tint === "grass") return face === "top" || definition.shape === "cross" ? unpackColor(BIOME_GRASS[biome] ?? 0x91bd59) : [1, 1, 1];
  if (definition.tint === "foliage") return unpackColor(BIOME_FOLIAGE[biome] ?? 0x77ab2f);
  return [1, 1, 1];
}

/** Builds opaque, cutout (alpha-tested) and water geometry for one chunk column. */
export function meshChunk(world: World, chunk: Chunk, tileUv: TileUv): ChunkMeshes {
  const opaque = new GeometryBuilder();
  const cutout = new GeometryBuilder();
  const water = new GeometryBuilder();
  const x0 = chunk.cx * CHUNK;
  const z0 = chunk.cz * CHUNK;
  let maxHeight = 0;
  for (let column = 0; column < CHUNK * CHUNK; column += 1) if ((chunk.heights[column] ?? -1) > maxHeight) maxHeight = chunk.heights[column]!;
  const topY = Math.min(HEIGHT - 1, maxHeight + 1);
  for (let y = 0; y <= topY; y += 1) for (let lz = 0; lz < CHUNK; lz += 1) for (let lx = 0; lx < CHUNK; lx += 1) {
    const id = chunk.blocks[chunkIndex(lx, y, lz)] ?? AIR;
    if (id === AIR) continue;
    const definition = blockById(id);
    const x = x0 + lx;
    const z = z0 + lz;
    const biome = chunk.biomes[lz * CHUNK + lx] ?? BIOME.plains;
    if (definition.shape === "cross") {
      cutout.cross(x, y, z, tileUv(definition.tiles.top), blockLightSample(world, x, y, z), tintFor(definition, biome, "top"));
      continue;
    }
    if (definition.shape === "torch") {
      cutout.torch(x, y, z, tileUv(TILE.torch), [world.skyLight(x, y, z) / 15, 1]);
      continue;
    }
    const snowy = id === GRASS && biome === BIOME.snowy;
    for (const face of FACES) {
      const nx = x + face.normal[0];
      const ny = y + face.normal[1];
      const nz = z + face.normal[2];
      const neighbour = world.get(nx, ny, nz);
      const neighbourDefinition = blockById(neighbour);
      if (definition.liquid) {
        if (neighbour === id) continue;
        if (neighbourDefinition.opaque && neighbourDefinition.solid) continue;
        if (face.normal[1] === -1 && neighbourDefinition.solid) continue;
        const uv = tileUv(definition.tiles.top);
        const light = blockLightSample(world, nx, ny, nz);
        const lowered = face.normal[1] === 1 ? 2 / 16 : 0;
        water.quad(x, y, z, face, uv, [3, 3, 3, 3], [light, light, light, light], [1, 1, 1], lowered);
        continue;
      }
      if (neighbourDefinition.opaque && neighbourDefinition.solid) continue;
      if (!definition.opaque && neighbour === id) continue;
      if (neighbour === WATER && !definition.opaque && definition.solid && face.normal[1] === 1) continue;
      const ao: [number, number, number, number] = [3, 3, 3, 3];
      const light: (readonly [number, number])[] = [];
      for (let corner = 0; corner < 4; corner += 1) {
        const spec = face.ao[corner]!;
        ao[corner] = vertexAo(world, x, y, z, spec[0], spec[1]);
        light.push(vertexLight(world, x, y, z, face.normal, spec[0], spec[1]));
      }
      let tile = face.tile === "top" ? definition.tiles.top : face.tile === "bottom" ? definition.tiles.bottom : face.tile === "front" ? definition.tiles.front : definition.tiles.side;
      if (snowy) tile = face.tile === "top" ? TILE.snow : face.tile === "bottom" ? TILE.dirt : TILE.grassSideSnow;
      const tint = snowy ? [1, 1, 1] as const : tintFor(definition, biome, face.tile);
      const builder = definition.opaque ? opaque : cutout;
      builder.quad(x, y, z, face, tileUv(tile), ao, light, tint, 0, definition.key === "cactus" && face.normal[1] === 0 ? 1 / 16 : 0);
    }
  }
  return Object.freeze({ opaque: opaque.build(), cutout: cutout.build(), water: water.build() });
}
