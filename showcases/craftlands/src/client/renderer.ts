/// <reference lib="dom" />
import * as THREE from "three";
import { createParticleEmitter, type ParticleEmitter } from "@three-game-kit/client/particles";
import type { RenderingFeatureAdapter } from "@three-game-kit/client/rendering";
import { AIR, TILE, blockByKey } from "../shared/blocks.js";
import { itemByKey } from "../shared/items.js";
import { CHUNK, HEIGHT, chunkKey } from "../shared/terrain.js";
import type { CraftlandsEvent, CraftlandsSnapshot } from "../shared/state.js";
import { TUNING } from "../shared/state.js";
import type { Vec3, World } from "../shared/world.js";
import { ATLAS_SIZE, paintAtlas, tileUv } from "./atlas.js";
import { meshChunk, type ChunkGeometry } from "./mesher.js";
import { createMobRenderer, type MobRenderer } from "./mob-renderer.js";
import { hash2 } from "../shared/noise.js";
import { MOB_TILE } from "../shared/mob-tiles.js";

export interface CraftlandsRendererInspection {
  readonly backend: "three-webgl";
  readonly disposed: boolean;
  readonly frames: number;
  readonly drawCalls: number;
  readonly sceneObjects: number;
  readonly meshes: number;
  readonly triangles: number;
  readonly textures: number;
  readonly estimatedTextureBytes: number;
  readonly chunks: number;
  readonly chunkRebuilds: number;
  readonly dirtyChunks: number;
  readonly renderDistance: number;
  readonly particles: Readonly<{ readonly active: number; readonly emitted: number; readonly capacity: number }>;
  readonly mobModels: number;
  readonly itemEntities: number;
  readonly width: number;
  readonly height: number;
  readonly fov: number;
  readonly daylight: number;
  readonly hand: Readonly<{ readonly visible: boolean; readonly key: string }>;
  readonly stars: Readonly<{ readonly visible: boolean; readonly opacity: number }>;
  readonly thirdPerson: boolean;
}

export interface CraftlandsRenderer extends RenderingFeatureAdapter {
  readonly debris: ParticleEmitter;
  readonly flames: ParticleEmitter;
  readonly disposed: boolean;
  readonly screenshotReady: boolean;
  readonly atlasCanvas: HTMLCanvasElement;
  attachWorld(world: World): void;
  setCamera(eye: Vec3, yaw: number, pitch: number): void;
  emitDebris(position: Vec3, color: number, count: number, seed: number): void;
  prepare(snapshot: CraftlandsSnapshot, events: readonly CraftlandsEvent[]): void;
  resize(width?: number, height?: number): void;
  setRenderDistance(chunks: number): void;
  setBaseFov(degrees: number): void;
  inspect(): CraftlandsRendererInspection;
}

const SKY_NIGHT = new THREE.Color(0x070b18);
const SKY_DAWN = new THREE.Color(0xf0a060);
const SKY_DAY = new THREE.Color(0x78a7ff);
const FOG_DAY = new THREE.Color(0xc0d8ff);
const SUN_RADIUS = 180;
const BASE_FOV = 70;

const CHUNK_VERTEX = /* glsl */ `
attribute vec2 light;
attribute vec3 color;
varying vec2 vUv;
varying vec3 vColor;
varying vec2 vLight;
varying float vDist;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vColor = color;
  vLight = light;
  vWorld = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const CHUNK_FRAGMENT = /* glsl */ `
uniform sampler2D atlas;
uniform float daylight;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform float alphaTest;
uniform float opacity;
uniform float ripple;
uniform float time;
varying vec2 vUv;
varying vec3 vColor;
varying vec2 vLight;
varying float vDist;
varying vec3 vWorld;
void main() {
  vec4 tex = texture2D(atlas, vUv);
  if (tex.a < alphaTest) discard;
  // Water shimmers with two slow travelling waves, in place of Minecraft's animated water frames.
  tex.rgb *= 1.0 + ripple * 0.08 * (sin(vWorld.x * 1.7 + vWorld.z * 0.9 + time * 1.6) + sin(vWorld.z * 2.3 - vWorld.x * 0.6 - time * 1.1));
  float sky = vLight.x * daylight;
  float level = max(sky, vLight.y);
  float brightness = level / (4.0 - 3.0 * level);
  brightness = 0.05 + 0.95 * brightness;
  float warm = clamp(vLight.y - sky, 0.0, 1.0);
  vec3 lit = tex.rgb * vColor * brightness * mix(vec3(1.0), vec3(1.05, 0.96, 0.84), warm * 0.6);
  float fog = smoothstep(fogNear, fogFar, vDist);
  gl_FragColor = vec4(mix(lit, fogColor, fog), tex.a * opacity);
}`;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

interface ChunkEntry { readonly opaque: THREE.Mesh; readonly cutout: THREE.Mesh; readonly water: THREE.Mesh; readonly torches: readonly Vec3[]; }
interface ItemEntry { readonly group: THREE.Group; readonly material: THREE.MeshBasicMaterial; key: string; }

class Renderer implements CraftlandsRenderer {
  readonly debris: ParticleEmitter;
  readonly flames: ParticleEmitter;
  readonly atlasCanvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(BASE_FOV, 16 / 9, 0.05, 512);
  private readonly atlas: THREE.CanvasTexture;
  private readonly opaqueMaterial: THREE.ShaderMaterial;
  private readonly cutoutMaterial: THREE.ShaderMaterial;
  private readonly waterMaterial: THREE.ShaderMaterial;
  private readonly sunDisc: THREE.Mesh;
  private readonly moonDisc: THREE.Mesh;
  private readonly stars: THREE.Points;
  private readonly starMaterial: THREE.PointsMaterial;
  private readonly clouds: THREE.InstancedMesh;
  private readonly cloudMaterial: THREE.MeshBasicMaterial;
  private readonly highlight: THREE.LineSegments;
  private readonly crack: THREE.Mesh;
  private readonly crackMaterial: THREE.MeshBasicMaterial;
  private readonly crackGeometry: THREE.BoxGeometry;
  private readonly handScene = new THREE.Scene();
  private readonly handCamera = new THREE.PerspectiveCamera(BASE_FOV, 16 / 9, 0.05, 10);
  private readonly handBlock: THREE.Mesh;
  private readonly handBlockGeometry: THREE.BoxGeometry;
  private readonly handItem: THREE.Mesh;
  private readonly handItemGeometry: THREE.PlaneGeometry;
  private readonly handArm: THREE.Mesh;
  private readonly handMaterial: THREE.MeshBasicMaterial;
  private readonly handItemMaterial: THREE.MeshBasicMaterial;
  private readonly handArmMaterial: THREE.MeshBasicMaterial;
  private readonly mobs: MobRenderer;
  private readonly items = new Map<number, ItemEntry>();
  private readonly arrows = new Map<number, THREE.Mesh>();
  private readonly orbs = new Map<number, THREE.Mesh>();
  private readonly orbGeometry: THREE.PlaneGeometry;
  private readonly orbMaterial: THREE.MeshBasicMaterial;
  private readonly arrowGeometry: THREE.BoxGeometry;
  private readonly arrowMaterial: THREE.MeshBasicMaterial;
  private readonly itemBlockGeometry: THREE.BoxGeometry;
  private readonly itemFlatGeometry: THREE.PlaneGeometry;
  private readonly chunks = new Map<string, ChunkEntry>();
  private readonly dirty = new Set<string>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private world: World | null = null;
  private unsubscribe: (() => void) | null = null;
  private snapshot: CraftlandsSnapshot | null = null;
  private handKey = "\u0000";
  private handVisible = false;
  private swing = 0;
  private bob = 0;
  private fov = BASE_FOV;
  private baseFov = BASE_FOV;
  private daylight = 1;
  private frameCount = 0;
  private drawCalls = 0;
  private chunkRebuilds = 0;
  private renderDistance = 6;
  private width = 1;
  private height = 1;
  private ready = false;
  private isDisposed = false;
  private eye: Vec3 = { x: 0, y: 70, z: 0 };
  private yaw = 0;
  private pitch = 0;

  constructor(canvas: HTMLCanvasElement, private readonly testMode: boolean) {
    // Minecraft shades in gamma space: raw texel × light with no linear conversion anywhere.
    THREE.ColorManagement.enabled = false;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(testMode ? 1 : Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.info.autoReset = false;
    this.scene.background = SKY_DAY.clone();
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);

    this.atlasCanvas = paintAtlas(document.createElement("canvas"));
    this.atlas = new THREE.CanvasTexture(this.atlasCanvas);
    this.atlas.magFilter = THREE.NearestFilter;
    this.atlas.minFilter = THREE.NearestFilter;
    this.atlas.generateMipmaps = false;
    this.atlas.colorSpace = THREE.NoColorSpace;
    const chunkMaterial = (alphaTest: number, opacity: number, transparent: boolean, doubleSide: boolean): THREE.ShaderMaterial => this.mat(new THREE.ShaderMaterial({
      vertexShader: CHUNK_VERTEX,
      fragmentShader: CHUNK_FRAGMENT,
      uniforms: { atlas: { value: this.atlas }, daylight: { value: 1 }, fogColor: { value: FOG_DAY.clone() }, fogNear: { value: 60 }, fogFar: { value: 120 }, alphaTest: { value: alphaTest }, opacity: { value: opacity }, ripple: { value: transparent ? 1 : 0 }, time: { value: 0 } },
      transparent,
      depthWrite: !transparent,
      side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    }));
    this.opaqueMaterial = chunkMaterial(0, 1, false, false);
    this.cutoutMaterial = chunkMaterial(0.5, 1, false, true);
    this.waterMaterial = chunkMaterial(0, 0.8, true, true);

    const discGeometry = this.geo(new THREE.PlaneGeometry(30, 30));
    this.sunDisc = new THREE.Mesh(discGeometry, this.mat(new THREE.MeshBasicMaterial({ map: this.atlas, transparent: true, fog: false, depthWrite: false })));
    this.moonDisc = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(20, 20)), this.mat(new THREE.MeshBasicMaterial({ map: this.atlas, transparent: true, fog: false, depthWrite: false })));
    this.setPlaneTile(discGeometry, TILE.sun);
    this.setPlaneTile(this.moonDisc.geometry as THREE.PlaneGeometry, TILE.moon);
    this.sunDisc.renderOrder = -10;
    this.moonDisc.renderOrder = -10;
    this.scene.add(this.sunDisc, this.moonDisc);

    const starPositions = new Float32Array(700 * 3);
    for (let index = 0; index < 700; index += 1) {
      const theta = hash2(index, 0, 5) * Math.PI * 2;
      const phi = Math.acos(hash2(index, 1, 5) * 0.98);
      starPositions[index * 3] = Math.cos(theta) * Math.sin(phi) * 300;
      starPositions[index * 3 + 1] = Math.cos(phi) * 300 + 6;
      starPositions[index * 3 + 2] = Math.sin(theta) * Math.sin(phi) * 300;
    }
    const starGeometry = this.geo(new THREE.BufferGeometry());
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    this.starMaterial = this.mat(new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars = new THREE.Points(starGeometry, this.starMaterial);
    this.stars.renderOrder = -11;
    this.scene.add(this.stars);

    // Flat pixel clouds: a 24 × 24 cell field of 12-block squares, cells chosen by hashed noise, drifting east.
    this.cloudMaterial = this.mat(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, fog: false }));
    const cloudGeometry = this.geo(new THREE.BoxGeometry(12, 4, 12));
    this.clouds = new THREE.InstancedMesh(cloudGeometry, this.cloudMaterial, 24 * 24);
    this.clouds.frustumCulled = false;
    this.scene.add(this.clouds);

    this.highlight = new THREE.LineSegments(this.geo(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004))), this.mat(new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 })));
    this.highlight.visible = false;
    this.crackGeometry = this.geo(new THREE.BoxGeometry(1.01, 1.01, 1.01));
    this.crackMaterial = this.mat(new THREE.MeshBasicMaterial({ map: this.atlas, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    this.crack = new THREE.Mesh(this.crackGeometry, this.crackMaterial);
    this.crack.visible = false;
    this.scene.add(this.highlight, this.crack);

    // First-person hand: block cube, flat item sprite, or the bare arm; drawn in a depth-cleared pass.
    this.handMaterial = this.mat(new THREE.MeshBasicMaterial({ map: this.atlas, vertexColors: true }));
    this.handBlockGeometry = this.geo(new THREE.BoxGeometry(0.4, 0.4, 0.4));
    this.handBlock = new THREE.Mesh(this.handBlockGeometry, this.handMaterial);
    this.handBlock.frustumCulled = false;
    this.handItemMaterial = this.mat(new THREE.MeshBasicMaterial({ map: this.atlas, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }));
    this.handItemGeometry = this.geo(new THREE.PlaneGeometry(0.55, 0.55));
    this.handItem = new THREE.Mesh(this.handItemGeometry, this.handItemMaterial);
    this.handItem.frustumCulled = false;
    this.handArmMaterial = this.mat(new THREE.MeshBasicMaterial({ map: this.atlas }));
    const armGeometry = this.geo(new THREE.BoxGeometry(0.2, 0.2, 0.75));
    this.setBoxTiles(armGeometry, [MOB_TILE.steveSkin, MOB_TILE.steveSkin, MOB_TILE.steveSkin, MOB_TILE.steveSkin, MOB_TILE.steveSkin, MOB_TILE.steveShirt]);
    this.handArm = new THREE.Mesh(armGeometry, this.handArmMaterial);
    this.handArm.frustumCulled = false;
    this.handScene.add(this.handBlock, this.handItem, this.handArm);
    this.handBlock.visible = false;
    this.handItem.visible = false;
    this.handArm.visible = false;

    this.orbGeometry = this.geo(new THREE.PlaneGeometry(0.28, 0.28));
    this.setPlaneTile(this.orbGeometry, MOB_TILE.xpOrb);
    this.orbMaterial = this.mat(new THREE.MeshBasicMaterial({ map: this.atlas, transparent: true, alphaTest: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.arrowGeometry = this.geo(new THREE.BoxGeometry(0.05, 0.05, 0.6));
    this.arrowMaterial = this.mat(new THREE.MeshBasicMaterial({ color: 0xd9c9a0 }));
    this.itemBlockGeometry = this.geo(new THREE.BoxGeometry(0.25, 0.25, 0.25));
    this.itemFlatGeometry = this.geo(new THREE.PlaneGeometry(0.3, 0.3));
    this.mobs = createMobRenderer(this.scene, this.atlas, tileUv);

    const cube = [-0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5];
    const cubeIndices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
    this.debris = createParticleEmitter(this.scene, {
      capacity: 800,
      seed: 7,
      shape: { kind: "box", halfExtents: { x: 0.3, y: 0.3, z: 0.3 } },
      speed: [1.2, 4],
      lifetimeMs: [400, 900],
      size: [0.05, 0.1],
      acceleration: { x: 0, y: -18, z: 0 },
      drag: 0.7,
      rotation3D: { x: [0, 6.28], y: [0, 6.28], z: [0, 6.28] },
      angularVelocity3D: { x: [-7, 7], y: [-7, 7], z: [-7, 7] },
      renderer: { kind: "mesh", positions: cube, indices: cubeIndices },
      lighting: { ambient: 0.6, intensity: 0.7, direction: { x: 0.4, y: 1, z: 0.35 } },
      blending: "normal",
    });
    // Torch flames and smoke: tiny rising billboards, emitted each frame above nearby torches.
    this.flames = createParticleEmitter(this.scene, {
      capacity: 256,
      seed: 11,
      shape: { kind: "box", halfExtents: { x: 0.04, y: 0.02, z: 0.04 } },
      speed: [0.05, 0.25],
      lifetimeMs: [350, 700],
      size: [0.05, 0.09],
      acceleration: { x: 0, y: 0.6, z: 0 },
      drag: 0.4,
      blending: "additive",
    });
    this.resize(testMode ? 1280 : innerWidth, testMode ? 720 : innerHeight);
  }

  private geo<T extends THREE.BufferGeometry>(geometry: T): T { this.geometries.push(geometry); return geometry; }
  private mat<T extends THREE.Material>(material: T): T { this.materials.push(material); return material; }

  private setPlaneTile(geometry: THREE.PlaneGeometry, tile: number): void {
    const [u0, v0, u1, v1] = tileUv(tile);
    const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
    uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
    uv.needsUpdate = true;
  }

  /** BoxGeometry face order: +x, -x, +y, -y, +z, -z; four vertices per face. */
  private setBoxTiles(geometry: THREE.BoxGeometry, tiles: readonly number[]): void {
    const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
    tiles.forEach((tile, face) => {
      const [u0, v0, u1, v1] = tileUv(tile);
      uv.setXY(face * 4, u0, v1); uv.setXY(face * 4 + 1, u1, v1); uv.setXY(face * 4 + 2, u0, v0); uv.setXY(face * 4 + 3, u1, v0);
    });
    uv.needsUpdate = true;
  }

  // --- World meshes ------------------------------------------------------------------

  attachWorld(world: World): void {
    if (this.isDisposed) return;
    this.unsubscribe?.();
    for (const entry of this.chunks.values()) this.dropChunk(entry);
    this.chunks.clear();
    this.dirty.clear();
    this.world = world;
    this.unsubscribe = world.subscribeChunks((cx, cz, kind) => {
      const key = chunkKey(cx, cz);
      if (kind === "unloaded") { const entry = this.chunks.get(key); if (entry !== undefined) { this.dropChunk(entry); this.chunks.delete(key); } this.dirty.delete(key); return; }
      this.dirty.add(key);
    });
    for (const chunk of world.loadedChunks()) this.dirty.add(chunkKey(chunk.cx, chunk.cz));
  }

  setRenderDistance(chunks: number): void {
    this.renderDistance = Math.max(2, Math.min(16, Math.floor(chunks)));
  }

  setBaseFov(degrees: number): void {
    if (Number.isFinite(degrees)) this.baseFov = Math.max(30, Math.min(110, degrees));
  }

  private toGeometry(chunk: ChunkGeometry): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(chunk.positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(chunk.uvs, 2));
    geometry.setAttribute("color", new THREE.BufferAttribute(chunk.colors, 3));
    geometry.setAttribute("light", new THREE.BufferAttribute(chunk.lights, 2));
    geometry.setIndex(new THREE.BufferAttribute(chunk.indices, 1));
    geometry.computeBoundingSphere();
    return geometry;
  }

  private dropChunk(entry: ChunkEntry): void {
    this.scene.remove(entry.opaque, entry.cutout, entry.water);
    entry.opaque.geometry.dispose();
    entry.cutout.geometry.dispose();
    entry.water.geometry.dispose();
  }

  private rebuildChunk(key: string): void {
    if (this.world === null || this.isDisposed) return;
    const [cx, cz] = key.split(",").map(Number) as [number, number];
    const chunk = this.world.chunkAt(cx, cz);
    this.dirty.delete(key);
    const previous = this.chunks.get(key);
    if (previous !== undefined) { this.dropChunk(previous); this.chunks.delete(key); }
    if (chunk === undefined) return;
    const meshes = meshChunk(this.world, chunk, tileUv);
    const opaque = new THREE.Mesh(this.toGeometry(meshes.opaque), this.opaqueMaterial);
    const cutout = new THREE.Mesh(this.toGeometry(meshes.cutout), this.cutoutMaterial);
    const water = new THREE.Mesh(this.toGeometry(meshes.water), this.waterMaterial);
    water.renderOrder = 10;
    cutout.renderOrder = 1;
    this.scene.add(opaque, cutout, water);
    const torches: Vec3[] = [];
    const torchId = blockByKey("torch")!.id;
    for (let y = 0; y < HEIGHT; y += 1) for (let lz = 0; lz < CHUNK; lz += 1) for (let lx = 0; lx < CHUNK; lx += 1) if (chunk.blocks[(y * CHUNK + lz) * CHUNK + lx] === torchId) torches.push({ x: cx * CHUNK + lx + 0.5, y: y + 0.85, z: cz * CHUNK + lz + 0.5 });
    this.chunks.set(key, { opaque, cutout, water, torches });
    this.chunkRebuilds += 1;
  }

  private flushDirty(limit: number): void {
    if (this.dirty.size === 0) return;
    // Nearest chunks first so the player's surroundings appear before the horizon.
    const ecx = Math.floor(this.eye.x / CHUNK);
    const ecz = Math.floor(this.eye.z / CHUNK);
    const keys = [...this.dirty].sort((a, b) => {
      const [ax, az] = a.split(",").map(Number) as [number, number];
      const [bx, bz] = b.split(",").map(Number) as [number, number];
      return (Math.abs(ax - ecx) + Math.abs(az - ecz)) - (Math.abs(bx - ecx) + Math.abs(bz - ecz));
    });
    let count = 0;
    for (const key of keys) {
      if (count >= limit) break;
      this.rebuildChunk(key);
      count += 1;
    }
  }

  // --- Hand ---------------------------------------------------------------------------

  private setHand(key: string): void {
    if (key === this.handKey) return;
    this.handKey = key;
    const block = blockByKey(key);
    const item = itemByKey(key);
    this.handBlock.visible = false;
    this.handItem.visible = false;
    this.handArm.visible = false;
    if (block !== undefined && block.id !== AIR && (block.shape === "cube" || block.shape === "slab")) {
      const t = block.tiles;
      this.setBoxTiles(this.handBlockGeometry, [t.side, t.side, t.top, t.bottom, t.front, t.side]);
      const colors = this.handBlockGeometry.getAttribute("color") as THREE.BufferAttribute | undefined;
      const shades = [0.6, 0.6, 1, 0.5, 0.8, 0.8];
      const array = new Float32Array(24 * 3);
      for (let face = 0; face < 6; face += 1) for (let vertex = 0; vertex < 4; vertex += 1) { const tint = block.tint === "grass" && face === 2 ? [0.57, 0.74, 0.35] : block.tint === "foliage" ? [0.47, 0.67, 0.18] : [1, 1, 1]; const index = (face * 4 + vertex) * 3; array[index] = shades[face]! * tint[0]!; array[index + 1] = shades[face]! * tint[1]!; array[index + 2] = shades[face]! * tint[2]!; }
      if (colors === undefined) this.handBlockGeometry.setAttribute("color", new THREE.BufferAttribute(array, 3)); else { (colors.array as Float32Array).set(array); colors.needsUpdate = true; }
      this.handBlock.visible = true;
    } else if (item !== undefined) {
      this.setPlaneTile(this.handItemGeometry, item.tile);
      this.handItem.visible = true;
    } else {
      this.handArm.visible = true;
    }
    this.handVisible = true;
  }

  // --- Presentation -------------------------------------------------------------------

  get disposed(): boolean { return this.isDisposed; }
  get screenshotReady(): boolean { return this.ready && !this.isDisposed; }

  setCamera(eye: Vec3, yaw: number, pitch: number): void {
    if (this.isDisposed) return;
    this.eye = eye;
    this.yaw = yaw;
    this.pitch = pitch;
  }

  emitDebris(position: Vec3, color: number, count: number, seed: number): void {
    if (this.isDisposed) return;
    this.debris.emit(count, { position: { x: position.x, y: position.y, z: position.z }, color, seed: (seed * 2654435761 + count) >>> 0 });
  }

  prepare(snapshot: CraftlandsSnapshot, events: readonly CraftlandsEvent[]): void {
    if (this.isDisposed) return;
    this.snapshot = snapshot;
    // Meshing costs ~10 ms per chunk on the main thread; two per frame keeps streaming hitches short while edits near the player rebuild first.
    this.flushDirty(this.testMode ? 64 : 2);
    const target = snapshot.target;
    const playing = snapshot.phase === "playing" && snapshot.screen === "none";
    this.highlight.visible = target !== null && snapshot.phase === "playing";
    if (target !== null) {
      this.highlight.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
      this.crack.position.copy(this.highlight.position);
    }
    const progress = snapshot.mining.progress;
    this.crack.visible = progress > 0 && target !== null;
    if (this.crack.visible) { const stage = Math.min(9, Math.floor(progress * 10)); const tile = TILE.crack0 + stage; this.setBoxTiles(this.crackGeometry, [tile, tile, tile, tile, tile, tile]); }
    this.setHand(snapshot.heldItem?.key ?? "");
    for (const event of events) if (event.kind === "block-mined" || event.kind === "block-placed" || event.kind === "attack" || event.kind === "use") this.swing = 1;
    if (snapshot.held.attack && target !== null && playing) this.swing = Math.max(this.swing, 0.4);
    this.syncItems(snapshot);
    this.syncArrows(snapshot);
    this.syncOrbs(snapshot);
  }

  private syncOrbs(snapshot: CraftlandsSnapshot): void {
    const seen = new Set<number>();
    for (const orb of snapshot.orbs) {
      seen.add(orb.id);
      let mesh = this.orbs.get(orb.id);
      if (mesh === undefined) { mesh = new THREE.Mesh(this.orbGeometry, this.orbMaterial); mesh.renderOrder = 12; this.scene.add(mesh); this.orbs.set(orb.id, mesh); }
      mesh.position.set(orb.position.x, orb.position.y + 0.15 + Math.sin(snapshot.time * 6 + orb.id) * 0.04, orb.position.z);
      mesh.quaternion.copy(this.camera.quaternion);
      const pulse = 0.85 + 0.15 * Math.sin(snapshot.time * 9 + orb.id);
      mesh.scale.setScalar(pulse * (orb.value >= 7 ? 1.4 : orb.value >= 3 ? 1.15 : 1));
    }
    for (const [id, mesh] of this.orbs) if (!seen.has(id)) { this.scene.remove(mesh); this.orbs.delete(id); }
  }

  private syncArrows(snapshot: CraftlandsSnapshot): void {
    const seen = new Set<number>();
    for (const arrow of snapshot.arrows) {
      seen.add(arrow.id);
      let mesh = this.arrows.get(arrow.id);
      if (mesh === undefined) { mesh = new THREE.Mesh(this.arrowGeometry, this.arrowMaterial); this.scene.add(mesh); this.arrows.set(arrow.id, mesh); }
      mesh.position.set(arrow.position.x, arrow.position.y, arrow.position.z);
      if (!arrow.stuck) { const v = arrow.velocity; const length = Math.hypot(v.x, v.y, v.z); if (length > 0.01) mesh.lookAt(arrow.position.x + v.x / length, arrow.position.y + v.y / length, arrow.position.z + v.z / length); }
    }
    for (const [id, mesh] of this.arrows) if (!seen.has(id)) { this.scene.remove(mesh); this.arrows.delete(id); }
  }

  private syncItems(snapshot: CraftlandsSnapshot): void {
    const seen = new Set<number>();
    for (const item of snapshot.items) {
      seen.add(item.id);
      let entry = this.items.get(item.id);
      if (entry === undefined || entry.key !== item.key) {
        if (entry !== undefined) { this.scene.remove(entry.group); entry.material.dispose(); }
        const block = blockByKey(item.key);
        const definition = itemByKey(item.key);
        const group = new THREE.Group();
        const material = new THREE.MeshBasicMaterial({ map: this.atlas, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: false });
        if (block !== undefined && (block.shape === "cube" || block.shape === "slab")) {
          const geometry = this.itemBlockGeometry.clone();
          this.setBoxTiles(geometry, [block.tiles.side, block.tiles.side, block.tiles.top, block.tiles.bottom, block.tiles.front, block.tiles.side]);
          if (block.tint !== "none") material.color.set(block.tint === "grass" ? 0x91bd59 : 0x77ab2f);
          group.add(new THREE.Mesh(geometry, material));
        } else {
          const geometry = this.itemFlatGeometry.clone();
          this.setPlaneTile(geometry, definition?.tile ?? block?.tiles.top ?? 0);
          group.add(new THREE.Mesh(geometry, material));
        }
        entry = { group, material, key: item.key };
        this.items.set(item.id, entry);
        this.scene.add(group);
      }
      const bobTime = (snapshot.time + item.id * 0.37);
      entry.group.position.set(item.position.x, item.position.y + 0.15 + Math.sin(bobTime * 2.2) * 0.05, item.position.z);
      entry.group.rotation.y = bobTime * 1.6;
      entry.material.color.setScalar(this.brightnessAt(item.position.x, item.position.y + 0.3, item.position.z));
    }
    for (const [id, entry] of this.items) if (!seen.has(id)) { this.scene.remove(entry.group); entry.material.dispose(); this.items.delete(id); }
  }

  private brightnessAt(x: number, y: number, z: number): number {
    if (this.world === null) return 1;
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);
    const sky = this.world.skyLight(bx, by, bz) / 15 * this.daylight;
    const block = this.world.blockLight(bx, by, bz) / 15;
    const level = Math.max(sky, block);
    return 0.06 + 0.94 * (level / (4 - 3 * level));
  }

  render(): void {
    if (this.isDisposed) throw new Error("Craftlands renderer has been disposed");
    this.drawCalls = this.renderer.info.render.calls;
    this.renderer.info.reset();
    const snapshot = this.snapshot;
    if (snapshot !== null) {
      const theta = (snapshot.timeOfDay - 0.25) * Math.PI * 2;
      const sunHeight = Math.sin(theta);
      const daylight = smoothstep(-0.12, 0.16, sunHeight);
      const dawn = 1 - smoothstep(0, 0.2, Math.abs(sunHeight));
      this.daylight = 0.3 + daylight * 0.7;
      const underwater = snapshot.player.eyeInWater;
      // Minecraft keeps the zenith blue while the horizon fog turns orange at sunrise and sunset.
      const sky = SKY_NIGHT.clone().lerp(SKY_DAY, daylight).lerp(SKY_DAWN, dawn * daylight * 0.2);
      const fogColor = SKY_NIGHT.clone().lerp(FOG_DAY, daylight).lerp(SKY_DAWN, dawn * Math.max(0.35, daylight) * 0.9);
      if (underwater) { sky.set(0x0d2f6b); fogColor.set(0x0d2f6b); }
      // Underground the horizon fog goes nearly black so unloaded space beyond a cavern never reads as sky.
      const eyeSky = this.world === null ? 15 : this.world.skyLight(Math.floor(this.eye.x), Math.floor(this.eye.y), Math.floor(this.eye.z));
      const caveDark = Math.max(0.08, Math.pow(eyeSky / 15, 1.5));
      (this.scene.background as THREE.Color).copy(sky).lerp(fogColor.clone().multiplyScalar(caveDark), 1 - caveDark);
      this.sunDisc.visible = this.sunDisc.visible && caveDark > 0.5;
      this.moonDisc.visible = this.moonDisc.visible && caveDark > 0.5;
      this.clouds.visible = caveDark > 0.3;
      const fogNear = underwater ? 1 : this.renderDistance * CHUNK * 0.72;
      const fogFar = underwater ? 16 : this.renderDistance * CHUNK * 1.0;
      for (const material of [this.opaqueMaterial, this.cutoutMaterial, this.waterMaterial]) {
        material.uniforms["daylight"]!.value = this.daylight;
        (material.uniforms["fogColor"]!.value as THREE.Color).copy(fogColor).multiplyScalar(underwater ? 1 : caveDark);
        material.uniforms["fogNear"]!.value = fogNear;
        material.uniforms["fogFar"]!.value = fogFar;
        material.uniforms["time"]!.value = snapshot.time % 1000;
      }
      const eye = this.eye;
      this.sunDisc.position.set(eye.x + Math.cos(theta) * SUN_RADIUS, eye.y + sunHeight * SUN_RADIUS, eye.z);
      this.sunDisc.lookAt(eye.x, eye.y, eye.z);
      this.moonDisc.position.set(eye.x - Math.cos(theta) * SUN_RADIUS, eye.y - sunHeight * SUN_RADIUS, eye.z);
      this.moonDisc.lookAt(eye.x, eye.y, eye.z);
      this.sunDisc.visible = !underwater;
      this.moonDisc.visible = !underwater;
      this.starMaterial.opacity = (1 - daylight) * 0.9;
      this.stars.position.set(eye.x, eye.y - 40, eye.z);
      this.stars.visible = daylight < 0.98 && !underwater;
      this.cloudMaterial.opacity = 0.35 + daylight * 0.5;
      this.cloudMaterial.color.set(0xffffff).multiplyScalar(0.3 + daylight * 0.7);
      this.layoutClouds(snapshot.time);
      const speed = Math.hypot(snapshot.player.velocity.x, snapshot.player.velocity.z);
      const targetFov = this.baseFov + (snapshot.player.sprinting ? this.baseFov * 0.14 : 0) + (snapshot.player.flying ? 6 : 0) + (underwater ? -6 : 0);
      this.fov = this.testMode ? targetFov : this.fov + (targetFov - this.fov) * 0.15;
      if (Math.abs(this.camera.fov - this.fov) > 0.01) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); this.handCamera.fov = this.fov; this.handCamera.updateProjectionMatrix(); }
      this.bob += Math.min(1, speed / TUNING.walkSpeed) * (snapshot.player.grounded ? 0.2 : 0.04);
      this.swing = Math.max(0, this.swing - (this.testMode ? 0.5 : 0.09));
      const bobX = Math.sin(this.bob) * 0.02;
      const bobY = Math.abs(Math.cos(this.bob)) * 0.03;
      const eat = snapshot.eating > 0 ? Math.sin(snapshot.time * 30) * 0.03 + 0.12 : 0;
      const swingAngle = Math.sin(this.swing * Math.PI) ;
      const camOffsetY = snapshot.player.hurtTicks > 0 ? Math.sin(snapshot.player.hurtTicks * 0.9) * 0.01 : 0;
      this.camera.position.set(eye.x, eye.y + Math.abs(Math.cos(this.bob)) * 0.025 * Math.min(1, speed / TUNING.walkSpeed) + camOffsetY, eye.z);
      this.camera.rotation.set(this.pitch, this.yaw, snapshot.player.hurtTicks > 0 ? Math.sin(snapshot.player.hurtTicks * 0.8) * 0.015 : 0);
      if (snapshot.phase === "title") {
        // Title panorama: a slow orbit above the spawn, like Minecraft's rotating menu backdrop.
        const orbit = (this.testMode ? 0 : performance.now() / 1000) * 0.06;
        const height = (this.world?.heightAt(Math.floor(snapshot.spawn.x), Math.floor(snapshot.spawn.z)) ?? snapshot.spawn.y) + 10;
        this.camera.position.set(snapshot.spawn.x + Math.sin(orbit) * 6, height, snapshot.spawn.z + Math.cos(orbit) * 6);
        this.camera.rotation.set(-0.28, orbit + Math.PI, 0);
      }
      if (snapshot.thirdPerson) {
        const back = 4;
        const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
        let distance = back;
        if (this.world !== null) {
          // Probe from just behind the head so the player's own head block never counts as a wall.
          const start = { x: eye.x - dir.x * 0.4, y: eye.y - dir.y * 0.4, z: eye.z - dir.z * 0.4 };
          const hit = this.world.raycast(start, { x: -dir.x, y: -dir.y, z: -dir.z }, back - 0.4);
          if (hit !== null) distance = Math.max(0.8, hit.distance + 0.4 - 0.35);
        }
        this.camera.position.set(eye.x - dir.x * distance, eye.y - dir.y * distance, eye.z - dir.z * distance);
        if (snapshot.perspective === 2) {
          // Front view: mirror the probe forward and turn the camera back toward the player.
          let front = back;
          if (this.world !== null) { const start = { x: eye.x + dir.x * 0.4, y: eye.y + dir.y * 0.4, z: eye.z + dir.z * 0.4 }; const hit = this.world.raycast(start, dir, back - 0.4); if (hit !== null) front = Math.max(0.8, hit.distance + 0.4 - 0.35); }
          this.camera.position.set(eye.x + dir.x * front, eye.y + dir.y * front, eye.z + dir.z * front);
          this.camera.rotation.set(-this.pitch, this.yaw + Math.PI, 0);
        }
      }
      this.handBlock.position.set(0.56 + bobX, -0.52 + bobY - swingAngle * 0.35 - eat, -0.9 - swingAngle * 0.1);
      this.handBlock.rotation.set(0.1 - swingAngle * 0.9, -0.6 - swingAngle * 0.4, 0.05);
      this.handItem.position.set(0.62 + bobX, -0.5 + bobY - swingAngle * 0.3 - eat, -0.95 - swingAngle * 0.15);
      this.handItem.rotation.set(-0.25 - swingAngle * 1.2, -0.45 - swingAngle * 0.5, 0.35);
      this.handArm.position.set(0.72 + bobX, -0.78 + bobY - swingAngle * 0.35, -0.8 - swingAngle * 0.2);
      this.handArm.rotation.set(-0.75 - swingAngle * 1.1, -0.2 - swingAngle * 0.4, 0.35);
      this.handVisible = snapshot.phase === "playing" && !snapshot.thirdPerson && !snapshot.hudHidden;
      const brightness = this.brightnessAt(eye.x, eye.y, eye.z);
      this.handMaterial.color.setScalar(brightness);
      this.handItemMaterial.color.setScalar(brightness);
      this.handArmMaterial.color.setScalar(brightness);
      this.mobs.sync(snapshot.mobs, snapshot.time, (x, y, z) => this.brightnessAt(x, y, z));
      if (!this.testMode && this.frameCount % 3 === 0) {
        for (const entry of this.chunks.values()) for (const torch of entry.torches) {
          if (Math.abs(torch.x - eye.x) > 24 || Math.abs(torch.z - eye.z) > 24) continue;
          this.flames.emit(1, { position: { x: torch.x, y: torch.y, z: torch.z }, color: (this.frameCount % 6 === 0) ? 0xffd14a : 0x555555, seed: (this.frameCount * 7 + Math.floor(torch.x) * 13 + Math.floor(torch.z) * 31) >>> 0 });
        }
      }
      this.mobs.setPlayerModel(snapshot.thirdPerson && snapshot.phase !== "title" ? { position: snapshot.player.position, yaw: snapshot.player.yaw, pitch: snapshot.player.pitch, walkPhase: snapshot.player.walkPhase, swing: this.swing, sneaking: snapshot.player.sneaking, hurtTicks: snapshot.player.hurtTicks } : null);
      this.highlight.visible = this.highlight.visible && snapshot.phase === "playing";
    }
    this.renderer.render(this.scene, this.camera);
    if (this.handVisible) {
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.handScene, this.handCamera);
      this.renderer.autoClear = true;
    }
    this.frameCount += 1;
    this.ready = true;
  }

  private readonly cloudMatrix = new THREE.Matrix4();

  private layoutClouds(time: number): void {
    const cell = 12;
    const drift = time * 0.9;
    const originX = Math.floor((this.eye.x - drift) / cell) - 12;
    const originZ = Math.floor(this.eye.z / cell) - 12;
    let index = 0;
    for (let iz = 0; iz < 24; iz += 1) for (let ix = 0; ix < 24; ix += 1) {
      const gx = originX + ix;
      const gz = originZ + iz;
      const present = hash2(gx, gz, 77) < 0.28 && (hash2(gx + 1, gz, 77) < 0.5 || hash2(gx, gz + 1, 77) < 0.5);
      this.cloudMatrix.makeTranslation(gx * cell + drift, HEIGHT + 4, gz * cell);
      if (!present) this.cloudMatrix.makeScale(0, 0, 0);
      this.clouds.setMatrixAt(index, this.cloudMatrix);
      index += 1;
    }
    this.clouds.instanceMatrix.needsUpdate = true;
  }

  resize(width = innerWidth, height = innerHeight): void {
    if (this.isDisposed) return;
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.handCamera.aspect = this.width / this.height;
    this.handCamera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
  }

  inspect(): CraftlandsRendererInspection {
    let objects = 0;
    let meshes = 0;
    let triangles = 0;
    this.scene.traverse((object) => {
      objects += 1;
      if (object instanceof THREE.Mesh) {
        meshes += 1;
        const geometry = object.geometry as THREE.BufferGeometry;
        const instances = object instanceof THREE.InstancedMesh ? object.count : 1;
        triangles += instances * (geometry.index === null ? Math.floor((geometry.attributes["position"]?.count ?? 0) / 3) : Math.floor(geometry.index.count / 3));
      }
    });
    const particles = this.debris.inspect();
    return Object.freeze({
      backend: "three-webgl",
      disposed: this.isDisposed,
      frames: this.frameCount,
      drawCalls: this.drawCalls,
      sceneObjects: objects,
      meshes,
      triangles,
      textures: this.renderer.info.memory.textures,
      estimatedTextureBytes: ATLAS_SIZE * ATLAS_SIZE * 4,
      chunks: this.chunks.size,
      chunkRebuilds: this.chunkRebuilds,
      dirtyChunks: this.dirty.size,
      renderDistance: this.renderDistance,
      particles: Object.freeze({ active: particles.activeParticleCount, emitted: particles.emittedParticleCount, capacity: particles.capacity }),
      mobModels: this.mobs.inspect().models,
      itemEntities: this.items.size,
      width: this.width,
      height: this.height,
      fov: this.camera.fov,
      daylight: this.daylight,
      hand: Object.freeze({ visible: this.handVisible, key: this.handKey }),
      stars: Object.freeze({ visible: this.stars.visible, opacity: this.starMaterial.opacity }),
      thirdPerson: this.snapshot?.thirdPerson ?? false,
    });
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const entry of this.chunks.values()) this.dropChunk(entry);
    this.chunks.clear();
    this.dirty.clear();
    for (const entry of this.items.values()) { this.scene.remove(entry.group); entry.material.dispose(); }
    this.items.clear();
    for (const mesh of this.arrows.values()) this.scene.remove(mesh);
    this.arrows.clear();
    for (const mesh of this.orbs.values()) this.scene.remove(mesh);
    this.orbs.clear();
    this.mobs.dispose();
    for (const geometry of new Set(this.geometries)) geometry.dispose();
    for (const material of new Set(this.materials)) material.dispose();
    this.atlas.dispose();
    this.renderer.dispose();
    this.scene.clear();
    this.handScene.clear();
    this.ready = false;
  }
}

export function createCraftlandsRenderer(canvas: HTMLCanvasElement, testMode = false): CraftlandsRenderer {
  return new Renderer(canvas, testMode);
}
