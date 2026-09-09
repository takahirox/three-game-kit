/// <reference lib="dom" />
import * as THREE from "three";
import { createParticleEmitter, type ParticleEmitter } from "@three-game-kit/client/particles";
import type { RenderingFeatureAdapter } from "@three-game-kit/client/rendering";
import { paintAtlas, tileUv } from "./atlas.js";
import { AIR, blockByKey, HOTBAR_ITEMS } from "./blocks.js";
import { meshChunk, type ChunkGeometry } from "./mesher.js";
import { hash2 } from "./noise.js";
import { TUNING, type DeepfieldEvent, type DeepfieldSnapshot } from "./state.js";
import { CHUNKS_X, CHUNKS_Z, VoxelWorld, WORLD, type Vec3 } from "./world.js";

export interface DeepfieldRendererInspection {
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
  readonly particles: Readonly<{ readonly active: number; readonly emitted: number; readonly capacity: number }>;
  readonly width: number;
  readonly height: number;
  readonly fov: number;
  readonly daylight: number;
  readonly hand: Readonly<{ readonly visible: boolean; readonly key: string }>;
  readonly stars: Readonly<{ readonly visible: boolean; readonly opacity: number }>;
}

export interface DeepfieldRenderer extends RenderingFeatureAdapter {
  readonly debris: ParticleEmitter;
  readonly disposed: boolean;
  readonly screenshotReady: boolean;
  attachWorld(world: VoxelWorld): void;
  setCamera(eye: Vec3, yaw: number, pitch: number): void;
  emitDebris(position: Vec3, color: number, count: number, seed: number): void;
  prepare(snapshot: DeepfieldSnapshot, events: readonly DeepfieldEvent[]): void;
  resize(width?: number, height?: number): void;
  inspect(): DeepfieldRendererInspection;
}

const SKY_NIGHT = new THREE.Color(0x0a1224);
const SKY_DAWN = new THREE.Color(0xf2a15a);
const SKY_DAY = new THREE.Color(0x8fd0f7);
const SUN_RADIUS = 220;
const BASE_FOV = 72;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

interface ChunkEntry { opaque: THREE.Mesh; water: THREE.Mesh; }

class Renderer implements DeepfieldRenderer {
  readonly debris: ParticleEmitter;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(BASE_FOV, 16 / 9, 0.08, 400);
  private readonly atlas: THREE.CanvasTexture;
  private readonly opaqueMaterial: THREE.MeshLambertMaterial;
  private readonly waterMaterial: THREE.MeshLambertMaterial;
  private readonly handMaterial: THREE.MeshLambertMaterial;
  private readonly hemisphere: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly sunDisc: THREE.Mesh;
  private readonly moonDisc: THREE.Mesh;
  private readonly stars: THREE.Points;
  private readonly starMaterial: THREE.PointsMaterial;
  private readonly clouds: THREE.Group;
  private readonly cloudMaterial: THREE.MeshLambertMaterial;
  private readonly highlight: THREE.LineSegments;
  private readonly crack: THREE.Mesh;
  private readonly crackMaterial: THREE.MeshBasicMaterial;
  private readonly hand: THREE.Mesh;
  private readonly handGeometry: THREE.BoxGeometry;
  private readonly handScene = new THREE.Scene();
  private readonly handCamera = new THREE.PerspectiveCamera(BASE_FOV, 16 / 9, 0.05, 10);
  private readonly handLight: THREE.DirectionalLight;
  private readonly handAmbient: THREE.HemisphereLight;
  private readonly fog: THREE.Fog;
  private readonly chunks = new Map<string, ChunkEntry>();
  private readonly dirty = new Set<string>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private world: VoxelWorld | null = null;
  private unsubscribe: (() => void) | null = null;
  private snapshot: DeepfieldSnapshot | null = null;
  private handKey = "";
  private swing = 0;
  private bob = 0;
  private fov = BASE_FOV;
  private daylight = 1;
  private frameCount = 0;
  private drawCalls = 0;
  private chunkRebuilds = 0;
  private width = 1;
  private height = 1;
  private ready = false;
  private isDisposed = false;

  constructor(canvas: HTMLCanvasElement, private readonly testMode: boolean) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !testMode, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(testMode ? 1 : Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false;
    this.scene.background = SKY_DAY.clone();
    this.fog = new THREE.Fog(SKY_DAY.clone(), 48, 120);
    this.scene.fog = this.fog;
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);

    const atlasCanvas = paintAtlas(document.createElement("canvas"));
    this.atlas = new THREE.CanvasTexture(atlasCanvas);
    this.atlas.magFilter = THREE.NearestFilter;
    this.atlas.minFilter = THREE.NearestFilter;
    this.atlas.generateMipmaps = false;
    this.atlas.colorSpace = THREE.SRGBColorSpace;
    this.opaqueMaterial = this.mat(new THREE.MeshLambertMaterial({ map: this.atlas, vertexColors: true }));
    this.waterMaterial = this.mat(new THREE.MeshLambertMaterial({ map: this.atlas, vertexColors: true, transparent: true, opacity: 0.78, depthWrite: false, side: THREE.DoubleSide }));
    this.handMaterial = this.mat(new THREE.MeshLambertMaterial({ map: this.atlas }));

    this.hemisphere = new THREE.HemisphereLight(0xcfe9ff, 0x6a5a3a, 0.9);
    this.sun = new THREE.DirectionalLight(0xfff2d6, 1.4);
    this.sun.position.set(60, 100, 30);
    this.scene.add(this.hemisphere, this.sun);

    this.sunDisc = new THREE.Mesh(this.geo(new THREE.CircleGeometry(11, 20)), this.mat(new THREE.MeshBasicMaterial({ color: 0xfff1b0, fog: false })));
    this.moonDisc = new THREE.Mesh(this.geo(new THREE.CircleGeometry(7, 20)), this.mat(new THREE.MeshBasicMaterial({ color: 0xdfe6f5, fog: false })));
    this.scene.add(this.sunDisc, this.moonDisc);

    const starPositions = new Float32Array(500 * 3);
    for (let index = 0; index < 500; index += 1) {
      const theta = hash2(index, 0, 5) * Math.PI * 2;
      const phi = Math.acos(hash2(index, 1, 5) * 0.97);
      starPositions[index * 3] = Math.cos(theta) * Math.sin(phi) * 300;
      starPositions[index * 3 + 1] = Math.cos(phi) * 300 + 6;
      starPositions[index * 3 + 2] = Math.sin(theta) * Math.sin(phi) * 300;
    }
    const starGeometry = this.geo(new THREE.BufferGeometry());
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    this.starMaterial = this.mat(new THREE.PointsMaterial({ color: 0xffffff, size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars = new THREE.Points(starGeometry, this.starMaterial);
    this.scene.add(this.stars);

    this.clouds = new THREE.Group();
    this.cloudMaterial = this.mat(new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
    const cloudGeometry = this.geo(new THREE.BoxGeometry(1, 1, 1));
    for (let index = 0; index < 14; index += 1) {
      const cloud = new THREE.Mesh(cloudGeometry, this.cloudMaterial);
      cloud.scale.set(10 + ((index * 7) % 5) * 4, 1.2, 6 + ((index * 5) % 4) * 3);
      cloud.position.set(((index * 37) % WORLD.sizeX), 60 + ((index * 3) % 4), ((index * 53) % WORLD.sizeZ));
      this.clouds.add(cloud);
    }
    this.scene.add(this.clouds);

    this.highlight = new THREE.LineSegments(this.geo(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004))), this.mat(new THREE.LineBasicMaterial({ color: 0x0b0b0b, transparent: true, opacity: 0.75 })));
    this.highlight.visible = false;
    this.crackMaterial = this.mat(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false }));
    this.crack = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.01, 1.01, 1.01)), this.crackMaterial);
    this.crack.visible = false;
    this.scene.add(this.highlight, this.crack);

    this.handGeometry = this.geo(new THREE.BoxGeometry(0.42, 0.42, 0.42));
    this.hand = new THREE.Mesh(this.handGeometry, this.handMaterial);
    this.hand.position.set(0.62, -0.55, -0.95);
    this.hand.rotation.set(0.15, -0.55, 0.05);
    this.hand.frustumCulled = false;
    // The held block lives in its own camera-space scene drawn after a depth clear, so walls never hide it.
    this.handScene.add(this.hand);
    this.handAmbient = new THREE.HemisphereLight(0xffffff, 0x777777, 0.9);
    this.handLight = new THREE.DirectionalLight(0xffffff, 1.1);
    this.handLight.position.set(1, 2, 1);
    this.handScene.add(this.handAmbient, this.handLight);
    this.setHandBlock(HOTBAR_ITEMS[0] ?? "dirt");

    // Block chips: small lit cubes tumbling under gravity, rendered by the public particle module.
    const cube = [-0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5];
    const cubeIndices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
    this.debris = createParticleEmitter(this.scene, {
      capacity: 640,
      seed: 7,
      shape: { kind: "box", halfExtents: { x: 0.3, y: 0.3, z: 0.3 } },
      speed: [1.4, 4.2],
      lifetimeMs: [420, 900],
      size: [0.08, 0.16],
      acceleration: { x: 0, y: -16, z: 0 },
      drag: 0.6,
      rotation3D: { x: [0, 6.28], y: [0, 6.28], z: [0, 6.28] },
      angularVelocity3D: { x: [-7, 7], y: [-7, 7], z: [-7, 7] },
      renderer: { kind: "mesh", positions: cube, indices: cubeIndices },
      lighting: { ambient: 0.55, intensity: 0.75, direction: { x: 0.4, y: 1, z: 0.35 } },
      blending: "normal",
    });
    this.resize(testMode ? 1280 : innerWidth, testMode ? 720 : innerHeight);
  }

  private geo<T extends THREE.BufferGeometry>(geometry: T): T { this.geometries.push(geometry); return geometry; }
  private mat<T extends THREE.Material>(material: T): T { this.materials.push(material); return material; }

  // --- World meshes ------------------------------------------------------------------

  attachWorld(world: VoxelWorld): void {
    if (this.isDisposed) return;
    this.unsubscribe?.();
    for (const entry of this.chunks.values()) this.dropChunk(entry);
    this.chunks.clear();
    this.world = world;
    this.unsubscribe = world.subscribe((x, _y, z) => this.markDirty(x, z));
    for (let cz = 0; cz < CHUNKS_Z; cz += 1) for (let cx = 0; cx < CHUNKS_X; cx += 1) this.rebuildChunk(cx, cz);
  }

  private markDirty(x: number, z: number): void {
    const cx = Math.floor(x / WORLD.chunk);
    const cz = Math.floor(z / WORLD.chunk);
    const localX = x - cx * WORLD.chunk;
    const localZ = z - cz * WORLD.chunk;
    for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1) {
      if ((dx === -1 && localX > 0) || (dx === 1 && localX < WORLD.chunk - 1) || (dz === -1 && localZ > 0) || (dz === 1 && localZ < WORLD.chunk - 1)) continue;
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx >= 0 && nz >= 0 && nx < CHUNKS_X && nz < CHUNKS_Z) this.dirty.add(`${nx},${nz}`);
    }
  }

  private toGeometry(chunk: ChunkGeometry): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(chunk.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(chunk.normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(chunk.uvs, 2));
    geometry.setAttribute("color", new THREE.BufferAttribute(chunk.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(chunk.indices, 1));
    geometry.computeBoundingSphere();
    return geometry;
  }

  private dropChunk(entry: ChunkEntry): void {
    this.scene.remove(entry.opaque, entry.water);
    entry.opaque.geometry.dispose();
    entry.water.geometry.dispose();
  }

  private rebuildChunk(cx: number, cz: number): void {
    if (this.world === null || this.isDisposed) return;
    const key = `${cx},${cz}`;
    const previous = this.chunks.get(key);
    if (previous !== undefined) this.dropChunk(previous);
    const meshes = meshChunk(this.world, cx, cz, tileUv);
    const opaque = new THREE.Mesh(this.toGeometry(meshes.opaque), this.opaqueMaterial);
    const water = new THREE.Mesh(this.toGeometry(meshes.water), this.waterMaterial);
    water.renderOrder = 10;
    this.scene.add(opaque, water);
    this.chunks.set(key, { opaque, water });
    this.chunkRebuilds += 1;
    this.dirty.delete(key);
  }

  private flushDirty(limit: number): void {
    let count = 0;
    for (const key of [...this.dirty]) {
      if (count >= limit) break;
      const [cx, cz] = key.split(",").map(Number) as [number, number];
      this.rebuildChunk(cx, cz);
      count += 1;
    }
  }

  // --- Held block ---------------------------------------------------------------------

  private setHandBlock(key: string): void {
    if (key === this.handKey) return;
    this.handKey = key;
    const definition = blockByKey(key);
    const tiles = definition?.tiles ?? blockByKey("dirt")!.tiles;
    const uv = this.handGeometry.getAttribute("uv") as THREE.BufferAttribute;
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z; four vertices per face.
    const faces = [tiles.side, tiles.side, tiles.top, tiles.bottom, tiles.side, tiles.side];
    faces.forEach((tile, face) => {
      const [u0, v0, u1, v1] = tileUv(tile);
      uv.setXY(face * 4, u0, v1);
      uv.setXY(face * 4 + 1, u1, v1);
      uv.setXY(face * 4 + 2, u0, v0);
      uv.setXY(face * 4 + 3, u1, v0);
    });
    uv.needsUpdate = true;
    this.hand.visible = definition !== undefined && definition.id !== AIR;
  }

  // --- Presentation -------------------------------------------------------------------

  get disposed(): boolean { return this.isDisposed; }
  get screenshotReady(): boolean { return this.ready && !this.isDisposed; }

  setCamera(eye: Vec3, yaw: number, pitch: number): void {
    if (this.isDisposed) return;
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.set(pitch, yaw, 0);
  }

  emitDebris(position: Vec3, color: number, count: number, seed: number): void {
    if (this.isDisposed) return;
    this.debris.emit(count, { position: { x: position.x, y: position.y, z: position.z }, color, seed: (seed * 2654435761 + count) >>> 0 });
  }

  prepare(snapshot: DeepfieldSnapshot, events: readonly DeepfieldEvent[]): void {
    if (this.isDisposed) return;
    this.snapshot = snapshot;
    this.flushDirty(6);
    const target = snapshot.target;
    this.highlight.visible = target !== null && snapshot.phase === "playing";
    if (target !== null) {
      this.highlight.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
      this.crack.position.copy(this.highlight.position);
    }
    const progress = snapshot.mining.progress;
    this.crack.visible = progress > 0 && target !== null;
    this.crackMaterial.opacity = progress * 0.55;
    const key = HOTBAR_ITEMS[snapshot.selectedSlot] ?? "dirt";
    const slot = snapshot.hotbar[snapshot.selectedSlot];
    this.setHandBlock(slot !== undefined && slot.count > 0 ? key : "");
    for (const event of events) if (event.kind === "block-mined" || event.kind === "block-placed" || event.kind === "jumped") this.swing = 1;
    if (snapshot.held.mine && target !== null) this.swing = Math.max(this.swing, 0.35);
  }

  render(): void {
    if (this.isDisposed) throw new Error("Deepfield renderer has been disposed");
    this.drawCalls = this.renderer.info.render.calls;
    this.renderer.info.reset();
    const snapshot = this.snapshot;
    if (snapshot !== null) {
      const theta = (snapshot.timeOfDay - 0.25) * Math.PI * 2;
      const sunHeight = Math.sin(theta);
      const daylight = smoothstep(-0.12, 0.28, sunHeight);
      const dawn = 1 - smoothstep(0, 0.4, Math.abs(sunHeight));
      this.daylight = daylight;
      const sky = SKY_NIGHT.clone().lerp(SKY_DAY, daylight).lerp(SKY_DAWN, dawn * daylight * 0.75);
      const underwater = snapshot.player.eyeInWater;
      if (underwater) sky.set(0x1a4f9a);
      (this.scene.background as THREE.Color).copy(sky);
      this.fog.color.copy(sky);
      this.fog.near = underwater ? 2 : 48;
      this.fog.far = underwater ? 22 : 120;
      this.sun.intensity = 0.15 + daylight * 1.35;
      this.sun.color.set(0xfff2d6).lerp(new THREE.Color(0xffa060), dawn);
      this.hemisphere.intensity = 0.22 + daylight * 0.75;
      this.hemisphere.color.copy(sky).lerp(new THREE.Color(0xffffff), 0.5);
      const eye = this.camera.position;
      this.sun.position.set(eye.x + Math.cos(theta) * 80, eye.y + Math.max(8, sunHeight * 100), eye.z + 30);
      this.sun.target.position.copy(eye);
      this.sun.target.updateMatrixWorld();
      this.sunDisc.position.set(eye.x + Math.cos(theta) * SUN_RADIUS, eye.y + sunHeight * SUN_RADIUS, eye.z);
      this.sunDisc.lookAt(eye);
      this.moonDisc.position.set(eye.x - Math.cos(theta) * SUN_RADIUS, eye.y - sunHeight * SUN_RADIUS, eye.z);
      this.moonDisc.lookAt(eye);
      this.starMaterial.opacity = (1 - daylight) * 0.9;
      this.stars.position.set(eye.x, 0, eye.z);
      this.stars.visible = daylight < 0.98;
      this.cloudMaterial.opacity = 0.28 + daylight * 0.6;
      this.cloudMaterial.color.set(0xffffff).multiplyScalar(0.45 + daylight * 0.55);
      this.clouds.position.x = (snapshot.time * 0.6) % WORLD.sizeX;
      const speed = Math.hypot(snapshot.player.velocity.x, snapshot.player.velocity.z);
      const targetFov = BASE_FOV + (snapshot.player.sprinting ? 8 : 0) + (underwater ? -4 : 0);
      this.fov = this.testMode ? targetFov : this.fov + (targetFov - this.fov) * 0.12;
      if (Math.abs(this.camera.fov - this.fov) > 0.01) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); this.handCamera.fov = this.fov; this.handCamera.updateProjectionMatrix(); }
      this.bob += Math.min(1, speed / TUNING.walkSpeed) * (snapshot.player.grounded ? 0.19 : 0.04);
      this.swing = Math.max(0, this.swing - (this.testMode ? 0.5 : 0.08));
      this.hand.position.set(0.62 + Math.sin(this.bob) * 0.02, -0.55 + Math.abs(Math.cos(this.bob)) * 0.03 - this.swing * 0.12, -0.95 - this.swing * 0.08);
      this.hand.rotation.set(0.15 - this.swing * 0.9, -0.55 - this.swing * 0.35, 0.05);
      this.hand.visible = this.hand.visible && snapshot.phase === "playing";
    }
    this.renderer.render(this.scene, this.camera);
    if (this.hand.visible) {
      this.handAmbient.intensity = 0.35 + this.daylight * 0.65;
      this.handLight.intensity = 0.4 + this.daylight * 0.8;
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.handScene, this.handCamera);
      this.renderer.autoClear = true;
    }
    this.frameCount += 1;
    this.ready = true;
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

  inspect(): DeepfieldRendererInspection {
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
      estimatedTextureBytes: 64 * 64 * 4,
      chunks: this.chunks.size,
      chunkRebuilds: this.chunkRebuilds,
      dirtyChunks: this.dirty.size,
      particles: Object.freeze({ active: particles.activeParticleCount, emitted: particles.emittedParticleCount, capacity: particles.capacity }),
      width: this.width,
      height: this.height,
      fov: this.camera.fov,
      daylight: this.daylight,
      hand: Object.freeze({ visible: this.hand.visible, key: this.handKey }),
      stars: Object.freeze({ visible: this.stars.visible, opacity: this.starMaterial.opacity }),
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
    for (const geometry of new Set(this.geometries)) geometry.dispose();
    for (const material of new Set(this.materials)) material.dispose();
    this.atlas.dispose();
    this.renderer.dispose();
    this.scene.clear();
    this.handScene.clear();
    this.ready = false;
  }
}

export function createDeepfieldRenderer(canvas: HTMLCanvasElement, testMode = false): DeepfieldRenderer {
  return new Renderer(canvas, testMode);
}
