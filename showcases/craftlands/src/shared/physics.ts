/** Axis-aligned voxel collision shared by the player and mobs. Authority-neutral. */
import type { Vec3, World } from "./world.js";

export interface Body {
  /** Feet centre. */
  position: Vec3;
  velocity: Vec3;
  readonly halfWidth: number;
  readonly height: number;
  grounded: boolean;
}

export interface MoveResult { readonly position: Vec3; readonly hitX: boolean; readonly hitY: boolean; readonly hitZ: boolean; }

export function vec3(x: number, y: number, z: number): Vec3 {
  return Object.freeze({ x, y, z });
}

export function overlapsSolid(world: World, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
  const x0 = Math.floor(minX);
  const y0 = Math.floor(minY);
  const z0 = Math.floor(minZ);
  const x1 = Math.floor(maxX - 1e-6);
  const y1 = Math.floor(maxY - 1e-6);
  const z1 = Math.floor(maxZ - 1e-6);
  for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) for (let z = z0; z <= z1; z += 1) if (world.isSolid(x, y, z)) return true;
  return false;
}

/** Moves a box by (dx, dy, dz), resolving each axis against solid blocks in turn (Y first, like Minecraft). */
export function moveWithCollision(world: World, position: Vec3, halfWidth: number, height: number, dx: number, dy: number, dz: number, sneakEdgeGuard = false): MoveResult {
  const half = halfWidth;
  let x = position.x;
  let y = position.y;
  let z = position.z;
  let hitX = false;
  let hitY = false;
  let hitZ = false;
  let ny = y + dy;
  if (overlapsSolid(world, x - half, ny, z - half, x + half, ny + height, z + half)) {
    hitY = true;
    ny = dy < 0 ? Math.floor(ny) + 1 : Math.floor(ny + height) - height - 1e-4;
    if (overlapsSolid(world, x - half, ny, z - half, x + half, ny + height, z + half)) ny = y;
  }
  y = ny;
  const onGround = overlapsSolid(world, x - half, y - 0.05, z - half, x + half, y, z + half);
  let nx = x + dx;
  if (overlapsSolid(world, nx - half, y, z - half, nx + half, y + height, z + half)) {
    hitX = true;
    nx = dx > 0 ? Math.floor(nx + half) - half - 1e-4 : Math.floor(nx - half) + 1 + half + 1e-4;
    if (overlapsSolid(world, nx - half, y, z - half, nx + half, y + height, z + half)) nx = x;
  } else if (sneakEdgeGuard && onGround && !overlapsSolid(world, nx - half, y - 0.6, z - half, nx + half, y, z + half)) {
    hitX = true;
    nx = x;
  }
  x = nx;
  let nz = z + dz;
  if (overlapsSolid(world, x - half, y, nz - half, x + half, y + height, nz + half)) {
    hitZ = true;
    nz = dz > 0 ? Math.floor(nz + half) - half - 1e-4 : Math.floor(nz - half) + 1 + half + 1e-4;
    if (overlapsSolid(world, x - half, y, nz - half, x + half, y + height, nz + half)) nz = z;
  } else if (sneakEdgeGuard && onGround && !overlapsSolid(world, x - half, y - 0.6, nz - half, x + half, y, nz + half)) {
    hitZ = true;
    nz = z;
  }
  z = nz;
  return { position: vec3(x, y, z), hitX, hitY, hitZ };
}

export function boxIntersectsBlock(position: Vec3, halfWidth: number, height: number, x: number, y: number, z: number): boolean {
  return x + 1 > position.x - halfWidth && x < position.x + halfWidth && y + 1 > position.y && y < position.y + height && z + 1 > position.z - halfWidth && z < position.z + halfWidth;
}

export function bodyInLiquid(world: World, position: Vec3, height: number): boolean {
  const x = Math.floor(position.x);
  const z = Math.floor(position.z);
  return world.isLiquid(x, Math.floor(position.y + 0.3), z) || world.isLiquid(x, Math.floor(position.y + Math.min(height - 0.2, 1.2)), z);
}
