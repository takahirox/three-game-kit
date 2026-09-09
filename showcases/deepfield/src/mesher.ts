import { AIR, WATER, blockById } from "./blocks.js";
import { VoxelWorld, WORLD } from "./world.js";

export interface ChunkGeometry {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly colors: Float32Array;
  readonly indices: Uint32Array;
  readonly quadCount: number;
}

export interface ChunkMeshes {
  readonly opaque: ChunkGeometry;
  readonly water: ChunkGeometry;
}

export type TileUv = (tile: number) => readonly [u0: number, v0: number, u1: number, v1: number];

interface FaceSpec {
  readonly normal: readonly [number, number, number];
  /** Four corner offsets in counter-clockwise order seen from outside. */
  readonly corners: readonly (readonly [number, number, number])[];
  /** Tangent axes used for ambient-occlusion neighbour sampling, per corner: [sideA, sideB]. */
  readonly ao: readonly (readonly [readonly [number, number, number], readonly [number, number, number]])[];
  readonly shade: number;
  readonly tile: "top" | "side" | "bottom";
}

const FACES: readonly FaceSpec[] = Object.freeze([
  { normal: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], ao: [[[-1, 1, 0], [0, 1, 1]], [[1, 1, 0], [0, 1, 1]], [[1, 1, 0], [0, 1, -1]], [[-1, 1, 0], [0, 1, -1]]], shade: 1.0, tile: "top" },
  { normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], ao: [[[-1, -1, 0], [0, -1, -1]], [[1, -1, 0], [0, -1, -1]], [[1, -1, 0], [0, -1, 1]], [[-1, -1, 0], [0, -1, 1]]], shade: 0.5, tile: "bottom" },
  { normal: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], ao: [[[1, -1, 0], [1, 0, 1]], [[1, -1, 0], [1, 0, -1]], [[1, 1, 0], [1, 0, -1]], [[1, 1, 0], [1, 0, 1]]], shade: 0.72, tile: "side" },
  { normal: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], ao: [[[-1, -1, 0], [-1, 0, -1]], [[-1, -1, 0], [-1, 0, 1]], [[-1, 1, 0], [-1, 0, 1]], [[-1, 1, 0], [-1, 0, -1]]], shade: 0.72, tile: "side" },
  { normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], ao: [[[0, -1, 1], [-1, 0, 1]], [[0, -1, 1], [1, 0, 1]], [[0, 1, 1], [1, 0, 1]], [[0, 1, 1], [-1, 0, 1]]], shade: 0.84, tile: "side" },
  { normal: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], ao: [[[0, -1, -1], [1, 0, -1]], [[0, -1, -1], [-1, 0, -1]], [[0, 1, -1], [-1, 0, -1]], [[0, 1, -1], [1, 0, -1]]], shade: 0.84, tile: "side" },
]);

const UV_CORNERS: readonly (readonly [number, number])[] = Object.freeze([[0, 0], [1, 0], [1, 1], [0, 1]]);
const AO_LEVELS: readonly number[] = Object.freeze([0.52, 0.68, 0.84, 1]);

class GeometryBuilder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  indices: number[] = [];
  quadCount = 0;

  quad(x: number, y: number, z: number, face: FaceSpec, uv: readonly [number, number, number, number], ao: readonly [number, number, number, number], tint: number, lower = 0): void {
    const base = this.positions.length / 3;
    for (let corner = 0; corner < 4; corner += 1) {
      const offset = face.corners[corner]!;
      const cornerY = offset[1] === 1 ? 1 - lower : 0;
      this.positions.push(x + offset[0], y + cornerY, z + offset[2]);
      this.normals.push(face.normal[0], face.normal[1], face.normal[2]);
      const uvCorner = UV_CORNERS[corner]!;
      this.uvs.push(uvCorner[0] === 0 ? uv[0] : uv[2], uvCorner[1] === 0 ? uv[1] : uv[3]);
      const light = face.shade * (AO_LEVELS[ao[corner]!] ?? 1) * tint;
      this.colors.push(light, light, light);
    }
    // Flip the diagonal when the opposite corners are darker to avoid AO artifacts.
    if (ao[0]! + ao[2]! > ao[1]! + ao[3]!) this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    this.quadCount += 1;
  }

  build(): ChunkGeometry {
    return Object.freeze({
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      uvs: new Float32Array(this.uvs),
      colors: new Float32Array(this.colors),
      indices: new Uint32Array(this.indices),
      quadCount: this.quadCount,
    });
  }
}

function occludes(world: VoxelWorld, x: number, y: number, z: number): boolean {
  const definition = blockById(world.get(x, y, z));
  return definition.solid && definition.opaque;
}

function vertexAo(world: VoxelWorld, x: number, y: number, z: number, sideA: readonly [number, number, number], sideB: readonly [number, number, number]): number {
  const a = occludes(world, x + sideA[0], y + sideA[1], z + sideA[2]) ? 1 : 0;
  const b = occludes(world, x + sideB[0], y + sideB[1], z + sideB[2]) ? 1 : 0;
  const cornerX = sideA[0] + sideB[0];
  const cornerY = sideA[1] === 0 ? sideB[1] : sideA[1];
  const cornerZ = sideA[2] + sideB[2];
  const corner = occludes(world, x + (cornerX === 0 ? 0 : Math.sign(cornerX)), y + cornerY, z + (cornerZ === 0 ? 0 : Math.sign(cornerZ))) ? 1 : 0;
  if (a === 1 && b === 1) return 0;
  return 3 - (a + b + corner);
}

/** Builds opaque and water geometry for one 16x16 column chunk with per-vertex ambient occlusion. */
export function meshChunk(world: VoxelWorld, chunkX: number, chunkZ: number, tileUv: TileUv): ChunkMeshes {
  const opaque = new GeometryBuilder();
  const water = new GeometryBuilder();
  const x0 = chunkX * WORLD.chunk;
  const z0 = chunkZ * WORLD.chunk;
  for (let y = 0; y < WORLD.sizeY; y += 1) for (let z = z0; z < z0 + WORLD.chunk; z += 1) for (let x = x0; x < x0 + WORLD.chunk; x += 1) {
    const id = world.get(x, y, z);
    if (id === AIR) continue;
    const definition = blockById(id);
    for (const face of FACES) {
      const nx = x + face.normal[0];
      const ny = y + face.normal[1];
      const nz = z + face.normal[2];
      const neighbor = world.get(nx, ny, nz);
      const neighborDefinition = blockById(neighbor);
      if (definition.liquid) {
        if (neighbor !== AIR) continue;
        const uv = tileUv(definition.tiles.top);
        water.quad(x, y, z, face, uv, [3, 3, 3, 3], 1, face.normal[1] === 1 ? 0.12 : 0);
        continue;
      }
      if (neighborDefinition.opaque && neighborDefinition.solid) continue;
      if (!definition.opaque && neighbor === id) continue;
      if (neighbor === WATER && face.normal[1] === 1 && !definition.opaque) continue;
      const ao: [number, number, number, number] = [3, 3, 3, 3];
      for (let corner = 0; corner < 4; corner += 1) {
        const spec = face.ao[corner]!;
        ao[corner] = vertexAo(world, x, y, z, spec[0], spec[1]);
      }
      const tile = face.tile === "top" ? definition.tiles.top : face.tile === "bottom" ? definition.tiles.bottom : definition.tiles.side;
      opaque.quad(x, y, z, face, tileUv(tile), ao, 1);
    }
  }
  return Object.freeze({ opaque: opaque.build(), water: water.build() });
}
