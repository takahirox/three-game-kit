/// <reference lib="dom" />
/**
 * Minecraft-style box models for mobs and the third-person player, textured from the runtime atlas.
 * Each model is a small tree of pivots so legs, arms and heads animate around their joints.
 */
import * as THREE from "three";
import { MOB_TILE } from "../shared/mob-tiles.js";
import { MOB_DEFINITIONS, type MobKind } from "../shared/mobs.js";
import type { Vec3 } from "../shared/world.js";

export interface MobRendererInspection {
  readonly models: number;
  readonly kinds: Readonly<Record<string, number>>;
}

export interface MobView {
  readonly id: number;
  readonly kind: MobKind;
  readonly position: Vec3;
  readonly yaw: number;
  readonly headYaw: number;
  readonly headPitch?: number;
  readonly walkPhase: number;
  readonly hurtTicks: number;
  readonly deadTicks: number;
  readonly fuse: number;
  readonly burning: boolean;
  readonly health: number;
}

export interface PlayerModelView {
  readonly position: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  readonly walkPhase: number;
  readonly swing: number;
  readonly sneaking: boolean;
  readonly hurtTicks: number;
}

export interface MobRenderer {
  sync(mobs: readonly MobView[], timeSeconds: number, brightnessAt: (x: number, y: number, z: number) => number): void;
  setPlayerModel(view: PlayerModelView | null): void;
  inspect(): MobRendererInspection;
  dispose(): void;
}

type TileUv = (tile: number) => readonly [number, number, number, number];
/** Tiles per BoxGeometry face in Three.js order: +x, −x, +y, −y, +z, −z. The model faces −z. */
type FaceTiles = readonly [number, number, number, number, number, number];
type Role = "upper" | "torso" | "head" | "beak" | "armL" | "armR" | "legL" | "legR" | "legFL" | "legFR" | "legBL" | "legBR" | "body";

interface PartSpec {
  readonly role: Role;
  readonly parent: Role | null;
  readonly pivot: readonly [number, number, number];
  /** Width, height, depth in blocks; null for an empty joint. */
  readonly size: readonly [number, number, number] | null;
  readonly offset: readonly [number, number, number];
  readonly tiles: FaceTiles;
  /** Initial rotation applied before animation (zombie arms held forward). */
  readonly rest?: readonly [number, number, number];
}

type ModelKind = MobKind | "player";

const DEATH_TICKS = 20;

function uniform(tile: number): FaceTiles {
  return [tile, tile, tile, tile, tile, tile];
}

function withFront(front: number, other: number, bottom = other, top = other): FaceTiles {
  return [other, other, top, bottom, other, front];
}

function humanoid(face: number, hair: number, skin: number, shirt: number, pants: number, armsForward: boolean): readonly PartSpec[] {
  const armRest: readonly [number, number, number] | undefined = armsForward ? [-Math.PI / 2, 0, 0] : undefined;
  return [
    { role: "upper", parent: null, pivot: [0, 0.75, 0], size: null, offset: [0, 0, 0], tiles: uniform(0) },
    { role: "torso", parent: "upper", pivot: [0, 0, 0], size: [0.5, 0.75, 0.25], offset: [0, 0.375, 0], tiles: uniform(shirt) },
    { role: "head", parent: "upper", pivot: [0, 0.75, 0], size: [0.5, 0.5, 0.5], offset: [0, 0.25, 0], tiles: withFront(face, hair, skin, hair) },
    { role: "armL", parent: "upper", pivot: [0.375, 0.625, 0], size: [0.25, 0.75, 0.25], offset: [0, -0.25, 0], tiles: uniform(skin), ...(armRest === undefined ? {} : { rest: armRest }) },
    { role: "armR", parent: "upper", pivot: [-0.375, 0.625, 0], size: [0.25, 0.75, 0.25], offset: [0, -0.25, 0], tiles: uniform(skin), ...(armRest === undefined ? {} : { rest: armRest }) },
    { role: "legL", parent: null, pivot: [0.125, 0.75, 0], size: [0.25, 0.75, 0.25], offset: [0, -0.375, 0], tiles: uniform(pants) },
    { role: "legR", parent: null, pivot: [-0.125, 0.75, 0], size: [0.25, 0.75, 0.25], offset: [0, -0.375, 0], tiles: uniform(pants) },
  ];
}

interface QuadrupedShape {
  readonly legHeight: number;
  readonly legWidth: number;
  readonly body: readonly [number, number, number];
  readonly head: readonly [number, number, number];
  readonly headLift: number;
  readonly face: number;
  readonly headSkin: number;
  readonly bodySkin: number;
  readonly legSkin: number;
}

function quadruped(shape: QuadrupedShape): readonly PartSpec[] {
  const [bodyWidth, bodyHeight, bodyLength] = shape.body;
  const [headWidth, headHeight, headDepth] = shape.head;
  const legX = bodyWidth / 2 - shape.legWidth / 2;
  const legZ = bodyLength / 2 - shape.legWidth / 2;
  const legSize: readonly [number, number, number] = [shape.legWidth, shape.legHeight, shape.legWidth];
  const legOffset: readonly [number, number, number] = [0, -shape.legHeight / 2, 0];
  return [
    { role: "body", parent: null, pivot: [0, shape.legHeight, 0], size: [bodyWidth, bodyHeight, bodyLength], offset: [0, bodyHeight / 2, 0], tiles: uniform(shape.bodySkin) },
    { role: "head", parent: null, pivot: [0, shape.legHeight + bodyHeight * 0.55 + shape.headLift, -bodyLength / 2], size: [headWidth, headHeight, headDepth], offset: [0, headHeight * 0.15, -headDepth / 2 + 0.05], tiles: withFront(shape.face, shape.headSkin) },
    { role: "legFL", parent: null, pivot: [legX, shape.legHeight, -legZ], size: legSize, offset: legOffset, tiles: uniform(shape.legSkin) },
    { role: "legFR", parent: null, pivot: [-legX, shape.legHeight, -legZ], size: legSize, offset: legOffset, tiles: uniform(shape.legSkin) },
    { role: "legBL", parent: null, pivot: [legX, shape.legHeight, legZ], size: legSize, offset: legOffset, tiles: uniform(shape.legSkin) },
    { role: "legBR", parent: null, pivot: [-legX, shape.legHeight, legZ], size: legSize, offset: legOffset, tiles: uniform(shape.legSkin) },
  ];
}

const MODEL_SPECS: Readonly<Record<ModelKind, readonly PartSpec[]>> = Object.freeze({
  pig: quadruped({ legHeight: 0.375, legWidth: 0.25, body: [0.625, 0.5, 1.0], head: [0.5, 0.5, 0.5], headLift: 0, face: MOB_TILE.pigFace, headSkin: MOB_TILE.pigSkin, bodySkin: MOB_TILE.pigSkin, legSkin: MOB_TILE.pigSkin }),
  cow: quadruped({ legHeight: 0.625, legWidth: 0.25, body: [0.75, 0.625, 1.125], head: [0.5, 0.5, 0.375], headLift: 0.1, face: MOB_TILE.cowFace, headSkin: MOB_TILE.cowHide, bodySkin: MOB_TILE.cowHide, legSkin: MOB_TILE.cowHide }),
  sheep: quadruped({ legHeight: 0.5, legWidth: 0.25, body: [0.75, 0.75, 1.0], head: [0.5, 0.5, 0.5], headLift: 0.05, face: MOB_TILE.sheepFace, headSkin: MOB_TILE.sheepWool, bodySkin: MOB_TILE.sheepWool, legSkin: MOB_TILE.sheepSkin }),
  chicken: [
    ...quadruped({ legHeight: 0.3, legWidth: 0.125, body: [0.375, 0.375, 0.5], head: [0.25, 0.375, 0.2], headLift: 0.1, face: MOB_TILE.chickenFace, headSkin: MOB_TILE.chickenBody, bodySkin: MOB_TILE.chickenBody, legSkin: MOB_TILE.chickenBody }),
    { role: "beak", parent: "head", pivot: [0, 0.05, -0.2], size: [0.25, 0.125, 0.125], offset: [0, 0, -0.06], tiles: uniform(MOB_TILE.chickenFace) },
  ],
  zombie: humanoid(MOB_TILE.zombieFace, MOB_TILE.zombieSkin, MOB_TILE.zombieSkin, MOB_TILE.zombieShirt, MOB_TILE.zombiePants, true),
  skeleton: humanoid(MOB_TILE.skeletonFace, MOB_TILE.skeletonBone, MOB_TILE.skeletonBone, MOB_TILE.skeletonBone, MOB_TILE.skeletonBone, false),
  creeper: [
    { role: "body", parent: null, pivot: [0, 0.375, 0], size: [0.5, 0.75, 0.25], offset: [0, 0.375, 0], tiles: uniform(MOB_TILE.creeperSkin) },
    { role: "head", parent: null, pivot: [0, 1.125, 0], size: [0.5, 0.5, 0.5], offset: [0, 0.25, 0], tiles: withFront(MOB_TILE.creeperFace, MOB_TILE.creeperSkin) },
    { role: "legFL", parent: null, pivot: [0.125, 0.375, -0.25], size: [0.25, 0.375, 0.25], offset: [0, -0.1875, 0], tiles: uniform(MOB_TILE.creeperSkin) },
    { role: "legFR", parent: null, pivot: [-0.125, 0.375, -0.25], size: [0.25, 0.375, 0.25], offset: [0, -0.1875, 0], tiles: uniform(MOB_TILE.creeperSkin) },
    { role: "legBL", parent: null, pivot: [0.125, 0.375, 0.25], size: [0.25, 0.375, 0.25], offset: [0, -0.1875, 0], tiles: uniform(MOB_TILE.creeperSkin) },
    { role: "legBR", parent: null, pivot: [-0.125, 0.375, 0.25], size: [0.25, 0.375, 0.25], offset: [0, -0.1875, 0], tiles: uniform(MOB_TILE.creeperSkin) },
  ],
  player: humanoid(MOB_TILE.steveFace, MOB_TILE.steveHair, MOB_TILE.steveSkin, MOB_TILE.steveShirt, MOB_TILE.stevePants, false),
});

interface Model {
  readonly kind: ModelKind;
  readonly root: THREE.Group;
  readonly parts: Map<Role, THREE.Group>;
  readonly material: THREE.MeshBasicMaterial;
}

function wrapAngle(angle: number): number {
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

class Renderer implements MobRenderer {
  private readonly baseMaterial: THREE.MeshBasicMaterial;
  private readonly geometries = new Map<string, THREE.BoxGeometry>();
  private readonly models = new Map<number, Model>();
  private playerModel: Model | null = null;
  private disposed = false;

  constructor(private readonly scene: THREE.Scene, atlas: THREE.Texture, private readonly tileUv: TileUv) {
    this.baseMaterial = new THREE.MeshBasicMaterial({ map: atlas, alphaTest: 0.5, side: THREE.FrontSide });
  }

  private geometry(kind: ModelKind, spec: PartSpec): THREE.BoxGeometry {
    const key = `${kind}:${spec.role}`;
    const cached = this.geometries.get(key);
    if (cached !== undefined) return cached;
    const [width, height, depth] = spec.size ?? [0.1, 0.1, 0.1];
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
    // BoxGeometry emits four vertices per face in the order (0,1), (1,1), (0,0), (1,0).
    spec.tiles.forEach((tile, face) => {
      const [u0, v0, u1, v1] = this.tileUv(tile);
      uv.setXY(face * 4, u0, v1);
      uv.setXY(face * 4 + 1, u1, v1);
      uv.setXY(face * 4 + 2, u0, v0);
      uv.setXY(face * 4 + 3, u1, v0);
    });
    uv.needsUpdate = true;
    this.geometries.set(key, geometry);
    return geometry;
  }

  private build(kind: ModelKind): Model {
    const root = new THREE.Group();
    root.rotation.order = "YXZ";
    const material = this.baseMaterial.clone();
    const parts = new Map<Role, THREE.Group>();
    for (const spec of MODEL_SPECS[kind]) {
      const pivot = new THREE.Group();
      pivot.position.set(spec.pivot[0], spec.pivot[1], spec.pivot[2]);
      if (spec.rest !== undefined) pivot.rotation.set(spec.rest[0], spec.rest[1], spec.rest[2]);
      if (spec.size !== null) {
        const mesh = new THREE.Mesh(this.geometry(kind, spec), material);
        mesh.position.set(spec.offset[0], spec.offset[1], spec.offset[2]);
        mesh.frustumCulled = true;
        pivot.add(mesh);
      }
      const parent = spec.parent === null ? root : parts.get(spec.parent) ?? root;
      parent.add(pivot);
      parts.set(spec.role, pivot);
    }
    this.scene.add(root);
    return { kind, root, parts, material };
  }

  private drop(model: Model): void {
    this.scene.remove(model.root);
    model.material.dispose();
  }

  private animateLimbs(model: Model, walkPhase: number, armsForward: boolean): void {
    const swing = Math.sin(walkPhase) * 0.6;
    const rotate = (role: Role, x: number): void => { const part = model.parts.get(role); if (part !== undefined) part.rotation.x = x; };
    rotate("legFL", swing);
    rotate("legBR", swing);
    rotate("legFR", -swing);
    rotate("legBL", -swing);
    rotate("legL", swing);
    rotate("legR", -swing);
    if (armsForward) {
      rotate("armL", -Math.PI / 2 + Math.sin(walkPhase * 0.5) * 0.08);
      rotate("armR", -Math.PI / 2 - Math.sin(walkPhase * 0.5) * 0.08);
    } else {
      rotate("armL", -swing);
      rotate("armR", swing);
    }
  }

  private animateHead(model: Model, relativeYaw: number, pitch: number): void {
    const head = model.parts.get("head");
    if (head === undefined) return;
    head.rotation.y = clamp(wrapAngle(relativeYaw), -1.2, 1.2);
    head.rotation.x = clamp(pitch, -0.8, 0.8);
  }

  private tint(model: Model, brightness: number, hurt: boolean, burning: boolean, flash: boolean, deadTicks: number): void {
    let r = 1;
    let g = 1;
    let b = 1;
    if (hurt) { g = 0.45; b = 0.45; }
    else if (burning) { g = 0.65; b = 0.35; }
    const level = flash ? Math.max(brightness, 1) * 2 : brightness;
    model.material.color.setRGB(r * level, g * level, b * level);
    const dying = deadTicks > 0;
    if (model.material.transparent !== dying) { model.material.transparent = dying; model.material.needsUpdate = true; }
    model.material.opacity = dying ? 1 - Math.min(1, deadTicks / DEATH_TICKS) * 0.9 : 1;
  }

  sync(mobs: readonly MobView[], timeSeconds: number, brightnessAt: (x: number, y: number, z: number) => number): void {
    if (this.disposed) return;
    void timeSeconds;
    const seen = new Set<number>();
    for (const view of mobs) {
      seen.add(view.id);
      let model = this.models.get(view.id);
      if (model === undefined || model.kind !== view.kind) {
        if (model !== undefined) this.drop(model);
        model = this.build(view.kind);
        this.models.set(view.id, model);
      }
      const definition = MOB_DEFINITIONS[view.kind];
      const tilt = Math.min(1, view.deadTicks / DEATH_TICKS) * (Math.PI / 2);
      model.root.position.set(view.position.x, view.position.y, view.position.z);
      model.root.rotation.set(0, view.yaw, tilt);
      this.animateLimbs(model, view.deadTicks > 0 ? 0 : view.walkPhase, view.kind === "zombie");
      this.animateHead(model, view.headYaw - view.yaw, view.headPitch ?? 0);
      const flash = view.kind === "creeper" && view.fuse > 0 && Math.floor(view.fuse / 6) % 2 === 0;
      const brightness = brightnessAt(view.position.x, view.position.y + definition.height * 0.5, view.position.z);
      this.tint(model, brightness, view.hurtTicks > 0, view.burning, flash, view.deadTicks);
    }
    for (const [id, model] of [...this.models]) {
      if (seen.has(id)) continue;
      this.drop(model);
      this.models.delete(id);
    }
  }

  setPlayerModel(view: PlayerModelView | null): void {
    if (this.disposed) return;
    if (view === null) {
      if (this.playerModel !== null) this.playerModel.root.visible = false;
      return;
    }
    if (this.playerModel === null) this.playerModel = this.build("player");
    const model = this.playerModel;
    model.root.visible = true;
    model.root.position.set(view.position.x, view.position.y, view.position.z);
    model.root.rotation.set(0, view.yaw, 0);
    this.animateLimbs(model, view.walkPhase, false);
    const upper = model.parts.get("upper");
    const head = model.parts.get("head");
    if (upper !== undefined) {
      upper.rotation.x = view.sneaking ? 0.5 : 0;
      upper.position.y = view.sneaking ? 0.6 : 0.75;
    }
    if (head !== undefined) {
      head.rotation.y = 0;
      head.rotation.x = clamp(view.pitch, -1.4, 1.4) - (view.sneaking ? 0.5 : 0);
    }
    const armR = model.parts.get("armR");
    if (armR !== undefined && view.swing > 0) armR.rotation.x = -Math.sin(view.swing * Math.PI) * 1.4 - 0.2;
    this.tint(model, 1, view.hurtTicks > 0, false, false, 0);
  }

  inspect(): MobRendererInspection {
    const kinds: Record<string, number> = {};
    for (const model of this.models.values()) kinds[model.kind] = (kinds[model.kind] ?? 0) + 1;
    if (this.playerModel !== null && this.playerModel.root.visible) kinds["player"] = 1;
    return Object.freeze({ models: this.models.size + (this.playerModel !== null && this.playerModel.root.visible ? 1 : 0), kinds: Object.freeze(kinds) });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of this.models.values()) this.drop(model);
    this.models.clear();
    if (this.playerModel !== null) { this.drop(this.playerModel); this.playerModel = null; }
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.geometries.clear();
    this.baseMaterial.dispose();
  }
}

export function createMobRenderer(scene: THREE.Scene, atlas: THREE.Texture, tileUv: TileUv): MobRenderer {
  return new Renderer(scene, atlas, tileUv);
}
