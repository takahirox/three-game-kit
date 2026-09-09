/// <reference lib="dom" />
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createParticleEmitter, type ParticleEmitter } from "@three-game-kit/client/particles";
import type { RendererCameraTransform, RenderingFeatureAdapter } from "@three-game-kit/client/rendering";
import type { RenderFrame } from "./game.js";
import { createRng } from "./rng.js";
import { ARENA_HALF, ENEMIES, SHRINES, type EnemyKind, type GravetideEvent, type GravetideSnapshot } from "./state.js";

export interface GravetideRendererInspection {
  readonly backend: "three-webgl";
  readonly disposed: boolean;
  readonly frames: number;
  readonly drawCalls: number;
  readonly sceneObjects: number;
  readonly meshes: number;
  readonly triangles: number;
  readonly textures: number;
  readonly estimatedTextureBytes: number;
  readonly width: number;
  readonly height: number;
  readonly instances: Readonly<{ readonly enemies: number; readonly gems: number; readonly projectiles: number; readonly axes: number }>;
  readonly particles: Readonly<{ readonly active: number; readonly emitted: number; readonly capacity: number }>;
}

export interface GravetideRenderer extends RenderingFeatureAdapter {
  readonly emitters: readonly ParticleEmitter[];
  readonly disposed: boolean;
  readonly screenshotReady: boolean;
  setCameraTransform(transform: RendererCameraTransform): void;
  prepare(snapshot: GravetideSnapshot, frame: RenderFrame, events: readonly GravetideEvent[]): void;
  hit(x: number, z: number, color: number): void;
  death(x: number, z: number, color: number, scale: number): void;
  pickup(x: number, z: number): void;
  levelUp(x: number, z: number): void;
  heroHit(x: number, z: number): void;
  strike(x: number, z: number): void;
  bell(x: number, z: number): void;
  resize(width?: number, height?: number): void;
  inspect(): GravetideRendererInspection;
}

const COLORS = Object.freeze({
  sky: 0x090b16,
  fog: 0x0b0e1c,
  ground: 0x4f7050,
  groundDark: 0x3a5440,
  stone: 0x8c8c94,
  wood: 0x5a4636,
  moon: 0x8fa8ff,
  hero: 0x2b2438,
  heroSkin: 0xf0c9a0,
  heroHat: 0x1a1522,
  gem: 0x6fe3ff,
  gemBig: 0x7dff9c,
  gemHuge: 0xff6b81,
  whip: 0xf2e6c4,
  aura: 0xffd166,
  bolt: 0x6fe3ff,
  knife: 0xe9f5ff,
  axe: 0xc9c9d6,
  strike: 0xbfe3ff,
  shrine: 0x7dffb0,
  shrineOff: 0x2d5a3f,
});

const STRIKE_POOL = 6;
const WHIP_POOL = 2;

/** Merges primitives into one geometry; polyhedra are non-indexed while boxes are indexed, so normalize first. */
function merge(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts.map((part) => (part.index === null ? part : part.toNonIndexed())));
  if (merged === null) throw new Error("Gravetide geometry merge failed");
  for (const part of parts) part.dispose();
  return merged;
}

function paintGround(canvas: HTMLCanvasElement): HTMLCanvasElement {
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Gravetide ground texture requires a 2D canvas context");
  const image = context.createImageData(64, 64);
  const rng = createRng(99);
  for (let index = 0; index < 64 * 64; index += 1) {
    const noise = rng.next();
    const dark = noise < 0.22;
    const base = dark ? COLORS.groundDark : COLORS.ground;
    const shade = 0.85 + rng.next() * 0.3;
    image.data[index * 4] = ((base >> 16) & 255) * shade;
    image.data[index * 4 + 1] = ((base >> 8) & 255) * shade;
    image.data[index * 4 + 2] = (base & 255) * shade;
    image.data[index * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

interface Pool { readonly mesh: THREE.InstancedMesh; readonly base: THREE.Color; }

class Renderer implements GravetideRenderer {
  readonly emitters: readonly ParticleEmitter[];
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.5, 220);
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly ground: THREE.CanvasTexture;
  private readonly heroGroup = new THREE.Group();
  private heroCoat!: THREE.MeshStandardMaterial;
  private readonly heroLight: THREE.PointLight;
  private readonly enemyPools = new Map<EnemyKind, Pool>();
  private readonly gems: THREE.InstancedMesh;
  private readonly bolts: THREE.InstancedMesh;
  private readonly knives: THREE.InstancedMesh;
  private readonly axes: THREE.InstancedMesh;
  private readonly whips: THREE.Mesh[] = [];
  private readonly whipMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly aura: THREE.Mesh;
  private readonly auraMaterial: THREE.MeshBasicMaterial;
  private readonly bellRing: THREE.Mesh;
  private readonly bellMaterial: THREE.MeshBasicMaterial;
  private readonly strikes: { pillar: THREE.Mesh; disc: THREE.Mesh; material: THREE.MeshBasicMaterial }[] = [];
  private readonly shrineMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly sparks: ParticleEmitter;
  private readonly chunks: ParticleEmitter;
  private readonly glow: ParticleEmitter;
  private readonly transform = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private cameraTransform: RendererCameraTransform = Object.freeze({ position: Object.freeze({ x: 0, y: 21, z: 11 }), lookAt: Object.freeze({ x: 0, y: 0.4, z: 0 }) });
  private snapshot: GravetideSnapshot | null = null;
  private heroFlash = 0;
  private heroBob = 0;
  private frameCount = 0;
  private drawCalls = 0;
  private width = 1;
  private height = 1;
  private ready = false;
  private isDisposed = false;
  private enemyInstances = 0;
  private gemInstances = 0;
  private projectileInstances = 0;
  private axeInstances = 0;

  constructor(canvas: HTMLCanvasElement, private readonly testMode: boolean) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !testMode, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(testMode ? 1 : Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.info.autoReset = false;
    this.scene.background = new THREE.Color(COLORS.sky);
    this.scene.fog = new THREE.FogExp2(COLORS.fog, testMode ? 0.014 : 0.017);

    this.scene.add(new THREE.HemisphereLight(0x8090c0, 0x3a3028, 1.4));
    const moon = new THREE.DirectionalLight(0xdde4ff, 1.7);
    moon.position.set(-24, 50, 18);
    this.scene.add(moon);
    this.heroLight = new THREE.PointLight(0xffc98a, 5, 12, 2);
    this.heroLight.position.set(0, 2.2, 0);
    this.scene.add(this.heroLight);

    this.ground = new THREE.CanvasTexture(paintGround(document.createElement("canvas")));
    this.ground.wrapS = THREE.RepeatWrapping;
    this.ground.wrapT = THREE.RepeatWrapping;
    this.ground.repeat.set(48, 48);
    this.ground.magFilter = THREE.NearestFilter;
    this.ground.minFilter = THREE.LinearMipmapLinearFilter;
    this.ground.colorSpace = THREE.SRGBColorSpace;
    const groundMesh = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(ARENA_HALF * 2 + 40, ARENA_HALF * 2 + 40)), this.mat(new THREE.MeshStandardMaterial({ map: this.ground, roughness: 0.95, metalness: 0 })));
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = -0.02;
    this.scene.add(groundMesh);
    this.buildProps();
    this.buildHero();
    for (const kind of ["bat", "ghoul", "brute", "wraith", "elite"] as const) this.enemyPools.set(kind, this.buildEnemyPool(kind));

    this.gems = new THREE.InstancedMesh(this.geo(new THREE.OctahedronGeometry(0.24, 0)), this.mat(new THREE.MeshBasicMaterial({ color: 0xffffff })), 420);
    this.gems.count = 0;
    this.bolts = new THREE.InstancedMesh(this.geo(new THREE.SphereGeometry(0.2, 8, 6)), this.mat(new THREE.MeshBasicMaterial({ color: COLORS.bolt })), 96);
    this.bolts.count = 0;
    this.knives = new THREE.InstancedMesh(this.geo(new THREE.BoxGeometry(0.14, 0.06, 0.7)), this.mat(new THREE.MeshBasicMaterial({ color: COLORS.knife })), 96);
    this.knives.count = 0;
    const axeGeometry = this.geo(merge([new THREE.BoxGeometry(0.16, 0.06, 1.0), new THREE.BoxGeometry(0.7, 0.06, 0.5).translate(0.2, 0, -0.35)]));
    this.axes = new THREE.InstancedMesh(axeGeometry, this.mat(new THREE.MeshStandardMaterial({ color: COLORS.axe, roughness: 0.4, metalness: 0.7, emissive: 0x333344 })), 24);
    this.axes.count = 0;
    this.scene.add(this.gems, this.bolts, this.knives, this.axes);

    for (let index = 0; index < WHIP_POOL; index += 1) {
      const material = this.mat(new THREE.MeshBasicMaterial({ color: COLORS.whip, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
      const mesh = new THREE.Mesh(this.geo(new THREE.RingGeometry(0.4, 1, 24, 1, -0.6, 1.2)), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.6;
      mesh.visible = false;
      this.whips.push(mesh);
      this.whipMaterials.push(material);
      this.scene.add(mesh);
    }
    this.auraMaterial = this.mat(new THREE.MeshBasicMaterial({ color: COLORS.aura, transparent: true, opacity: 0.22, depthWrite: false }));
    this.aura = new THREE.Mesh(this.geo(new THREE.CircleGeometry(1, 40)), this.auraMaterial);
    this.aura.rotation.x = -Math.PI / 2;
    this.aura.position.y = 0.05;
    this.aura.visible = false;
    this.scene.add(this.aura);
    this.bellMaterial = this.mat(new THREE.MeshBasicMaterial({ color: COLORS.aura, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    this.bellRing = new THREE.Mesh(this.geo(new THREE.RingGeometry(0.85, 1, 48)), this.bellMaterial);
    this.bellRing.rotation.x = -Math.PI / 2;
    this.bellRing.position.y = 0.08;
    this.bellRing.visible = false;
    this.scene.add(this.bellRing);
    for (let index = 0; index < STRIKE_POOL; index += 1) {
      const material = this.mat(new THREE.MeshBasicMaterial({ color: COLORS.strike, transparent: true, opacity: 0, depthWrite: false }));
      const pillar = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.12, 0.28, 16, 6)), material);
      pillar.position.y = 8;
      pillar.visible = false;
      const disc = new THREE.Mesh(this.geo(new THREE.CircleGeometry(1.5, 20)), material);
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.06;
      disc.visible = false;
      this.strikes.push({ pillar, disc, material });
      this.scene.add(pillar, disc);
    }
    for (const shrine of SHRINES) {
      const material = this.mat(new THREE.MeshStandardMaterial({ color: 0x3a4650, roughness: 0.7, emissive: COLORS.shrine, emissiveIntensity: 0.8 }));
      this.shrineMaterials.push(material);
      const pillar = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.4, 0.55, 1.6, 8)), material);
      pillar.position.set(shrine.x, 0.8, shrine.z);
      const orb = new THREE.Mesh(this.geo(new THREE.OctahedronGeometry(0.4, 0)), material);
      orb.position.set(shrine.x, 2.0, shrine.z);
      const ring = new THREE.Mesh(this.geo(new THREE.RingGeometry(2.1, 2.4, 32)), this.mat(new THREE.MeshBasicMaterial({ color: COLORS.shrine, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(shrine.x, 0.04, shrine.z);
      this.scene.add(pillar, orb, ring);
    }

    this.sparks = createParticleEmitter(this.scene, { capacity: 1024, seed: 3, shape: { kind: "sphere", radius: 0.25 }, speed: [2, 6], lifetimeMs: [180, 420], size: [0.06, 0.14], acceleration: { x: 0, y: -6, z: 0 }, drag: 1.2, blending: "additive" });
    const cube = [-0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5];
    const cubeIndices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
    this.chunks = createParticleEmitter(this.scene, { capacity: 768, seed: 5, shape: { kind: "sphere", radius: 0.3 }, speed: [2, 5], lifetimeMs: [400, 900], size: [0.1, 0.22], acceleration: { x: 0, y: -14, z: 0 }, drag: 0.5, rotation3D: { x: [0, 6.28], y: [0, 6.28], z: [0, 6.28] }, angularVelocity3D: { x: [-8, 8], y: [-8, 8], z: [-8, 8] }, renderer: { kind: "mesh", positions: cube, indices: cubeIndices }, lighting: { ambient: 0.45, intensity: 0.8, direction: { x: -0.3, y: 1, z: -0.2 } }, blending: "normal" });
    this.glow = createParticleEmitter(this.scene, { capacity: 512, seed: 9, shape: { kind: "ring", radius: 0.6 }, speed: [1, 3], lifetimeMs: [300, 700], size: [0.12, 0.3], acceleration: { x: 0, y: 2.5, z: 0 }, drag: 0.8, blending: "additive" });
    this.emitters = Object.freeze([this.sparks, this.chunks, this.glow]);
    this.resize(testMode ? 1280 : innerWidth, testMode ? 720 : innerHeight);
  }

  private geo<T extends THREE.BufferGeometry>(geometry: T): T { this.geometries.push(geometry); return geometry; }
  private mat<T extends THREE.Material>(material: T): T { this.materials.push(material); return material; }

  private buildProps(): void {
    const rng = createRng(77);
    const stone = this.mat(new THREE.MeshStandardMaterial({ color: COLORS.stone, roughness: 0.9 }));
    const wood = this.mat(new THREE.MeshStandardMaterial({ color: COLORS.wood, roughness: 0.95 }));
    const tombstone = this.geo(merge([new THREE.BoxGeometry(0.8, 1.1, 0.22).translate(0, 0.55, 0), new THREE.CylinderGeometry(0.4, 0.4, 0.22, 12).rotateX(Math.PI / 2).translate(0, 1.1, 0)]));
    const cross = this.geo(merge([new THREE.BoxGeometry(0.18, 1.5, 0.18).translate(0, 0.75, 0), new THREE.BoxGeometry(0.8, 0.18, 0.18).translate(0, 1.05, 0)]));
    const trunk = this.geo(new THREE.CylinderGeometry(0.18, 0.32, 3.2, 6).translate(0, 1.6, 0));
    const branches = this.geo(merge([new THREE.CylinderGeometry(0.06, 0.12, 1.8, 5).rotateZ(0.7).translate(0.6, 3.4, 0), new THREE.CylinderGeometry(0.06, 0.12, 1.6, 5).rotateZ(-0.8).translate(-0.55, 3.2, 0.1), new THREE.CylinderGeometry(0.05, 0.1, 1.4, 5).rotateX(0.7).translate(0, 3.6, 0.5)]));
    const tombstones = new THREE.InstancedMesh(tombstone, stone, 90);
    const crosses = new THREE.InstancedMesh(cross, wood, 50);
    const trunks = new THREE.InstancedMesh(trunk, wood, 40);
    const canopies = new THREE.InstancedMesh(branches, wood, 40);
    const place = (mesh: THREE.InstancedMesh, count: number, minimum: number): void => {
      for (let index = 0; index < count; index += 1) {
        let x = 0;
        let z = 0;
        for (let attempt = 0; attempt < 8; attempt += 1) {
          x = rng.range(-ARENA_HALF, ARENA_HALF);
          z = rng.range(-ARENA_HALF, ARENA_HALF);
          if (Math.hypot(x, z) > minimum && SHRINES.every((shrine) => Math.hypot(x - shrine.x, z - shrine.z) > 4)) break;
        }
        this.transform.position.set(x, 0, z);
        this.transform.rotation.set(0, rng.range(0, Math.PI * 2), rng.range(-0.08, 0.08));
        const scale = rng.range(0.8, 1.25);
        this.transform.scale.set(scale, scale, scale);
        this.transform.updateMatrix();
        mesh.setMatrixAt(index, this.transform.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    };
    place(tombstones, 90, 4);
    place(crosses, 50, 4);
    for (const mesh of [trunks, canopies]) place(mesh, 40, 8);
    canopies.instanceMatrix.copy(trunks.instanceMatrix);
    this.scene.add(tombstones, crosses, trunks, canopies);
    const fence = this.geo(new THREE.BoxGeometry(ARENA_HALF * 2 + 4, 1.2, 0.3).translate(0, 0.6, 0));
    const fenceMaterial = this.mat(new THREE.MeshStandardMaterial({ color: 0x2a2a38, roughness: 0.8, emissive: 0x30204a, emissiveIntensity: 0.5 }));
    for (const [x, z, rotation] of [[0, -ARENA_HALF - 1.5, 0], [0, ARENA_HALF + 1.5, 0], [-ARENA_HALF - 1.5, 0, Math.PI / 2], [ARENA_HALF + 1.5, 0, Math.PI / 2]] as const) {
      const wall = new THREE.Mesh(fence, fenceMaterial);
      wall.position.set(x, 0, z);
      wall.rotation.y = rotation;
      this.scene.add(wall);
    }
  }

  private buildHero(): void {
    this.heroCoat = this.mat(new THREE.MeshStandardMaterial({ color: COLORS.hero, roughness: 0.7, emissive: 0x000000 }));
    const body = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.38, 0.6, 4, 10)), this.heroCoat);
    body.position.y = 0.85;
    const head = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.28, 12, 10)), this.mat(new THREE.MeshStandardMaterial({ color: COLORS.heroSkin, roughness: 0.8 })));
    head.position.y = 1.55;
    const brim = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 16)), this.mat(new THREE.MeshStandardMaterial({ color: COLORS.heroHat, roughness: 0.9 })));
    brim.position.y = 1.78;
    const crown = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.26, 0.34, 0.5, 12)), brim.material);
    crown.position.y = 2.02;
    const cape = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.7, 0.9, 0.12)), this.mat(new THREE.MeshStandardMaterial({ color: 0x5a1f2e, roughness: 0.9 })));
    cape.position.set(0, 0.95, 0.32);
    cape.rotation.x = 0.18;
    const lantern = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.22, 0.3, 0.22)), this.mat(new THREE.MeshBasicMaterial({ color: 0xffc98a })));
    lantern.position.set(0.55, 0.9, 0);
    this.heroGroup.add(body, head, brim, crown, cape, lantern);
    this.scene.add(this.heroGroup);
  }

  private buildEnemyPool(kind: EnemyKind): Pool {
    const definition = ENEMIES[kind];
    let geometry: THREE.BufferGeometry;
    let material: THREE.Material;
    switch (kind) {
      case "bat":
        geometry = merge([new THREE.OctahedronGeometry(0.42, 0).scale(1, 0.45, 0.7), new THREE.BoxGeometry(0.9, 0.05, 0.4).translate(0.7, 0.05, 0), new THREE.BoxGeometry(0.9, 0.05, 0.4).translate(-0.7, 0.05, 0)]);
        material = new THREE.MeshStandardMaterial({ color: definition.color, roughness: 0.8, emissive: 0x2a1050, emissiveIntensity: 0.6 });
        break;
      case "ghoul":
        geometry = merge([new THREE.BoxGeometry(0.7, 1.05, 0.5).translate(0, 0.55, 0), new THREE.BoxGeometry(0.42, 0.42, 0.42).translate(0, 1.3, 0), new THREE.BoxGeometry(0.2, 0.7, 0.2).translate(0.5, 0.75, 0.2), new THREE.BoxGeometry(0.2, 0.7, 0.2).translate(-0.5, 0.75, 0.2)]);
        material = new THREE.MeshStandardMaterial({ color: definition.color, roughness: 0.9, emissive: 0x0d2a10, emissiveIntensity: 0.5 });
        break;
      case "brute":
        geometry = merge([new THREE.BoxGeometry(1.4, 1.7, 1.0).translate(0, 0.9, 0), new THREE.BoxGeometry(0.6, 0.55, 0.6).translate(0, 2.0, 0), new THREE.BoxGeometry(0.45, 1.3, 0.45).translate(0.95, 0.8, 0), new THREE.BoxGeometry(0.45, 1.3, 0.45).translate(-0.95, 0.8, 0)]);
        material = new THREE.MeshStandardMaterial({ color: definition.color, roughness: 0.85, emissive: 0x3a1408, emissiveIntensity: 0.5 });
        break;
      case "wraith":
        geometry = merge([new THREE.ConeGeometry(0.55, 1.6, 8).translate(0, 0.8, 0), new THREE.SphereGeometry(0.3, 10, 8).translate(0, 1.75, 0)]);
        material = new THREE.MeshStandardMaterial({ color: definition.color, roughness: 0.4, emissive: 0x3a6fa8, emissiveIntensity: 0.9, transparent: true, opacity: 0.85 });
        break;
      default:
        geometry = merge([new THREE.BoxGeometry(2.4, 2.8, 1.7).translate(0, 1.45, 0), new THREE.BoxGeometry(0.9, 0.8, 0.9).translate(0, 3.3, 0), new THREE.ConeGeometry(0.25, 0.7, 4).translate(-0.4, 3.9, 0), new THREE.ConeGeometry(0.25, 0.7, 4).translate(0.4, 3.9, 0), new THREE.BoxGeometry(0.7, 2.2, 0.7).translate(1.7, 1.2, 0), new THREE.BoxGeometry(0.7, 2.2, 0.7).translate(-1.7, 1.2, 0)]);
        material = new THREE.MeshStandardMaterial({ color: definition.color, roughness: 0.6, emissive: 0x7a0a1e, emissiveIntensity: 0.9 });
    }
    const mesh = new THREE.InstancedMesh(this.geo(geometry), this.mat(material), definition.capacity + 4);
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return { mesh, base: new THREE.Color(definition.color) };
  }

  // --- Effects -------------------------------------------------------------------------

  private seed(x: number, z: number): number { return ((Math.floor(x * 97) * 31 + Math.floor(z * 89) * 17 + this.frameCount * 13) >>> 0) % 4294967295; }
  hit(x: number, z: number, color: number): void { if (!this.isDisposed) this.sparks.emit(6, { position: { x, y: 0.9, z }, color, seed: this.seed(x, z) }); }
  death(x: number, z: number, color: number, scale: number): void { if (!this.isDisposed) { this.chunks.emit(Math.round(7 * scale), { position: { x, y: 0.8, z }, color, seed: this.seed(x, z), size: [0.09 * scale, 0.2 * scale], lifetimeMs: [300, 650] }); this.sparks.emit(Math.round(6 * scale), { position: { x, y: 0.8, z }, color, seed: this.seed(z, x) }); } }
  pickup(x: number, z: number): void { if (!this.isDisposed) this.glow.emit(5, { position: { x, y: 0.9, z }, color: COLORS.gem, seed: this.seed(x, z) }); }
  levelUp(x: number, z: number): void { if (!this.isDisposed) this.glow.emit(60, { position: { x, y: 0.4, z }, color: COLORS.aura, seed: this.seed(x, z), speed: [3, 7], size: [0.2, 0.4] }); }
  heroHit(x: number, z: number): void { this.heroFlash = 1; if (!this.isDisposed) this.sparks.emit(14, { position: { x, y: 1.2, z }, color: 0xff5b68, seed: this.seed(x, z) }); }
  strike(x: number, z: number): void { if (!this.isDisposed) { this.sparks.emit(24, { position: { x, y: 0.6, z }, color: COLORS.strike, seed: this.seed(x, z), speed: [4, 9] }); this.glow.emit(10, { position: { x, y: 0.3, z }, color: COLORS.strike, seed: this.seed(z, x) }); } }
  bell(x: number, z: number): void { if (!this.isDisposed) this.glow.emit(80, { position: { x, y: 0.5, z }, color: COLORS.aura, seed: this.seed(x, z), speed: [6, 12], size: [0.18, 0.36] }); }

  // --- Presentation --------------------------------------------------------------------

  get disposed(): boolean { return this.isDisposed; }
  get screenshotReady(): boolean { return this.ready && !this.isDisposed; }

  setCameraTransform(transform: RendererCameraTransform): void { this.cameraTransform = transform; }

  prepare(snapshot: GravetideSnapshot, frame: RenderFrame, _events: readonly GravetideEvent[]): void {
    if (this.isDisposed) return;
    this.snapshot = snapshot;
    const time = snapshot.time;
    const hero = snapshot.hero;
    this.heroGroup.position.set(hero.x, 0, hero.z);
    this.heroGroup.rotation.y = hero.facing;
    this.heroGroup.visible = snapshot.phase !== "title" && hero.alive;
    this.heroLight.position.set(hero.x, 2.2, hero.z);
    this.heroLight.visible = snapshot.phase !== "title";

    const counts = new Map<EnemyKind, number>();
    for (const slot of frame.enemies) {
      if (!slot.alive) continue;
      const pool = this.enemyPools.get(slot.kind);
      if (pool === undefined) continue;
      const index = counts.get(slot.kind) ?? 0;
      if (index >= pool.mesh.instanceMatrix.count) continue;
      const definition = ENEMIES[slot.kind];
      const bob = definition.height > 0 ? definition.height + Math.sin(slot.bob) * 0.18 : 0;
      this.transform.position.set(slot.x, bob, slot.z);
      this.transform.rotation.set(0, Math.atan2(hero.x - slot.x, hero.z - slot.z), slot.kind === "bat" ? Math.sin(slot.bob * 2) * 0.25 : 0);
      const squash = 1 + Math.sin(slot.bob) * (slot.kind === "bat" ? 0.08 : 0.04);
      this.transform.scale.set(1, squash, 1);
      this.transform.updateMatrix();
      pool.mesh.setMatrixAt(index, this.transform.matrix);
      this.color.copy(pool.base).lerp(new THREE.Color(0xffffff), Math.min(1, slot.flash));
      pool.mesh.setColorAt(index, this.color);
      counts.set(slot.kind, index + 1);
    }
    let enemyInstances = 0;
    for (const [kind, pool] of this.enemyPools) {
      const count = counts.get(kind) ?? 0;
      pool.mesh.count = count;
      pool.mesh.instanceMatrix.needsUpdate = true;
      if (pool.mesh.instanceColor !== null) pool.mesh.instanceColor.needsUpdate = true;
      enemyInstances += count;
    }
    this.enemyInstances = enemyInstances;

    let gemCount = 0;
    for (const gem of frame.gems) {
      if (gemCount >= this.gems.instanceMatrix.count) break;
      const tier = gem.value >= 20 ? 2 : gem.value >= 5 ? 1 : 0;
      const size = 1 + tier * 0.45;
      this.transform.position.set(gem.x, 0.55 + Math.sin(time * 4 + gem.x) * 0.1, gem.z);
      this.transform.rotation.set(0, time * 2.2 + gem.z, 0);
      this.transform.scale.set(size, size * 1.4, size);
      this.transform.updateMatrix();
      this.gems.setMatrixAt(gemCount, this.transform.matrix);
      this.gems.setColorAt(gemCount, this.color.setHex(tier === 2 ? COLORS.gemHuge : tier === 1 ? COLORS.gemBig : COLORS.gem));
      gemCount += 1;
    }
    this.gems.count = gemCount;
    this.gems.instanceMatrix.needsUpdate = true;
    if (this.gems.instanceColor !== null) this.gems.instanceColor.needsUpdate = true;
    this.gemInstances = gemCount;

    let boltCount = 0;
    let knifeCount = 0;
    for (const projectile of frame.projectiles) {
      const mesh = projectile.definitionId === "bolt" ? this.bolts : this.knives;
      const index = projectile.definitionId === "bolt" ? boltCount : knifeCount;
      if (index >= mesh.instanceMatrix.count) continue;
      this.transform.position.set(projectile.position.x, projectile.position.y, projectile.position.z);
      this.transform.rotation.set(0, Math.atan2(projectile.velocity.x, projectile.velocity.z), 0);
      this.transform.scale.set(1, 1, 1);
      this.transform.updateMatrix();
      mesh.setMatrixAt(index, this.transform.matrix);
      if (projectile.definitionId === "bolt") boltCount += 1; else knifeCount += 1;
    }
    this.bolts.count = boltCount;
    this.knives.count = knifeCount;
    this.bolts.instanceMatrix.needsUpdate = true;
    this.knives.instanceMatrix.needsUpdate = true;
    this.projectileInstances = boltCount + knifeCount;

    let axeCount = 0;
    for (const axe of frame.axes) {
      if (axeCount >= this.axes.instanceMatrix.count) break;
      this.transform.position.set(axe.x, 1.0 + Math.sin(axe.ticks * 0.08) * 0.3, axe.z);
      this.transform.rotation.set(0, axe.spin, 0);
      this.transform.scale.set(1, 1, 1);
      this.transform.updateMatrix();
      this.axes.setMatrixAt(axeCount, this.transform.matrix);
      axeCount += 1;
    }
    this.axes.count = axeCount;
    this.axes.instanceMatrix.needsUpdate = true;
    this.axeInstances = axeCount;

    this.whips.forEach((mesh, index) => {
      const whip = frame.whips[index];
      const material = this.whipMaterials[index]!;
      if (whip === undefined) { mesh.visible = false; return; }
      mesh.visible = true;
      mesh.position.set(whip.x, 0.6, whip.z);
      mesh.rotation.set(-Math.PI / 2, 0, -whip.facing + Math.PI / 2);
      mesh.scale.set(whip.length, whip.width, 1);
      material.opacity = Math.min(0.85, whip.ticks / 9);
    });
    this.aura.visible = frame.auraRadius > 0 && snapshot.phase !== "title";
    if (this.aura.visible) {
      this.aura.position.set(hero.x, 0.05, hero.z);
      const pulse = 0.92 + Math.sin(time * 6) * 0.06;
      this.aura.scale.set(frame.auraRadius * pulse, frame.auraRadius * pulse, 1);
      this.auraMaterial.opacity = 0.16 + frame.auraLevel * 0.03;
    }
    this.bellRing.visible = frame.bellRing > 0;
    if (this.bellRing.visible) {
      const radius = 1 + (1 - frame.bellRing) * 7;
      this.bellRing.position.set(hero.x, 0.08, hero.z);
      this.bellRing.scale.set(radius, radius, 1);
      this.bellMaterial.opacity = frame.bellRing * 0.9;
    }
    this.strikes.forEach((strike, index) => {
      const active = frame.strikes[index];
      if (active === undefined) { strike.pillar.visible = false; strike.disc.visible = false; return; }
      strike.pillar.visible = true;
      strike.disc.visible = true;
      strike.pillar.position.set(active.x, 8, active.z);
      strike.disc.position.set(active.x, 0.06, active.z);
      strike.material.opacity = Math.min(1, active.ticks / 8);
      strike.pillar.scale.set(1 + (12 - active.ticks) * 0.08, 1, 1 + (12 - active.ticks) * 0.08);
    });
    snapshot.shrines.forEach((shrine, index) => {
      const material = this.shrineMaterials[index];
      if (material === undefined) return;
      const ready = shrine.readyInSeconds <= 0;
      material.emissive.setHex(ready ? COLORS.shrine : COLORS.shrineOff);
      material.emissiveIntensity = ready ? 0.7 + Math.sin(time * 3 + index) * 0.3 : 0.25;
    });
  }

  render(): void {
    if (this.isDisposed) throw new Error("Gravetide renderer has been disposed");
    this.drawCalls = this.renderer.info.render.calls;
    this.renderer.info.reset();
    const transform = this.cameraTransform;
    this.camera.position.set(transform.position.x, transform.position.y, transform.position.z);
    this.camera.lookAt(transform.lookAt.x, transform.lookAt.y, transform.lookAt.z);
    const snapshot = this.snapshot;
    if (snapshot !== null) {
      this.heroFlash = Math.max(0, this.heroFlash - (this.testMode ? 0.5 : 0.08));
      this.heroCoat.emissive.setHex(0xff2040).multiplyScalar(this.heroFlash * 0.8);
      this.heroBob += snapshot.hero.moving ? 0.28 : 0.05;
      this.heroGroup.position.y = Math.abs(Math.sin(this.heroBob)) * (snapshot.hero.moving ? 0.12 : 0.03);
      this.heroGroup.rotation.z = snapshot.hero.moving ? Math.sin(this.heroBob) * 0.06 : 0;
      this.heroLight.intensity = 4.5 + Math.sin(snapshot.time * 9) * 0.6 + this.heroFlash * 6;
    }
    this.renderer.render(this.scene, this.camera);
    this.frameCount += 1;
    this.ready = true;
  }

  resize(width = innerWidth, height = innerHeight): void {
    if (this.isDisposed) return;
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
  }

  inspect(): GravetideRendererInspection {
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
    let active = 0;
    let emitted = 0;
    let capacity = 0;
    for (const emitter of this.emitters) {
      const inspection = emitter.inspect();
      active += inspection.activeParticleCount;
      emitted += inspection.emittedParticleCount;
      capacity += inspection.capacity;
    }
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
      width: this.width,
      height: this.height,
      instances: Object.freeze({ enemies: this.enemyInstances, gems: this.gemInstances, projectiles: this.projectileInstances, axes: this.axeInstances }),
      particles: Object.freeze({ active, emitted, capacity }),
    });
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    for (const pool of this.enemyPools.values()) pool.mesh.dispose();
    this.gems.dispose();
    this.bolts.dispose();
    this.knives.dispose();
    this.axes.dispose();
    for (const geometry of new Set(this.geometries)) geometry.dispose();
    for (const material of new Set(this.materials)) material.dispose();
    this.ground.dispose();
    this.renderer.dispose();
    this.scene.clear();
    this.ready = false;
  }
}

export function createGravetideRenderer(canvas: HTMLCanvasElement, testMode = false): GravetideRenderer {
  return new Renderer(canvas, testMode);
}
