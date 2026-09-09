/// <reference lib="dom" />
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { Pass } from "three/examples/jsm/postprocessing/Pass.js";
import { RGBShiftShader } from "three/examples/jsm/shaders/RGBShiftShader.js";
import { VignetteShader } from "three/examples/jsm/shaders/VignetteShader.js";
import { createPostProcessingRuntime, type AdvancedCameraTransform, type PostProcessingComposerAdapter, type PostProcessingRuntime } from "@three-game-kit/client/advanced";
import type { RenderingFeatureAdapter } from "@three-game-kit/client/rendering";
import { createVfxRuntime, type VfxRuntime } from "@three-game-kit/client/vfx";
import { TUNING, type AfterglowEvent, type AfterglowSnapshot, type Vec3 } from "./state.js";
import type { GateHazard, Track } from "./track.js";

export interface AfterglowRendererInspection {
  readonly backend: "three-webgl";
  readonly disposed: boolean;
  readonly frames: number;
  readonly drawCalls: number;
  readonly sceneObjects: number;
  readonly meshes: number;
  readonly lights: number;
  readonly triangles: number;
  readonly textures: number;
  readonly estimatedTextureBytes: number;
  readonly width: number;
  readonly height: number;
  readonly fov: number;
  readonly composer: Readonly<{ readonly renderCount: number; readonly passIds: readonly string[]; readonly enabledPassIds: readonly string[] }>;
  readonly trailPoints: number;
  readonly effects: Readonly<{ readonly crashFlash: number; readonly chromaAmount: number; readonly vignetteDarkness: number; readonly vignetteOffset: number; readonly bloomStrength: number; readonly cameraRoll: number }>;
}

export interface AfterglowRenderer extends RenderingFeatureAdapter {
  readonly vfx: VfxRuntime;
  readonly postProcessing: PostProcessingRuntime;
  readonly disposed: boolean;
  readonly screenshotReady: boolean;
  setCameraTransform(transform: AdvancedCameraTransform): void;
  setBloomEnabled(enabled: boolean): void;
  prepare(snapshot: AfterglowSnapshot, events: readonly AfterglowEvent[]): void;
  resize(width?: number, height?: number): void;
  inspect(): AfterglowRendererInspection;
}

const COLORS = Object.freeze({
  void: 0x03050c,
  fog: 0x060912,
  road: 0x121a2a,
  roadEdge: 0x35f2ff,
  roadLine: 0x2a8a99,
  laser: 0xff2d7a,
  laserCore: 0xff86b6,
  boost: 0xffb340,
  checkpoint: 0x35f2ff,
  checkpointPassed: 0x7dffb0,
  checkpointBar: 0x158a99,
  checkpointBarPassed: 0x2fb37a,
  finish: 0xfff0a8,
  pillar: 0x0d1220,
  car: 0x0c1118,
  carGlow: 0x35f2ff,
  carTail: 0xff2d7a,
  ghost: 0xbfe9ff,
  city: 0x05070f,
  citySeam: 0x2fb7cc,
  citySeamWarm: 0xd23a8a,
  grid: 0x145460,
  star: 0xcfe6ff,
});

const TRAIL_POINTS = 56;
const BASE_FOV = 66;
const ROAD_STEP = 2;

function toVector(vector: Vec3): THREE.Vector3 { return new THREE.Vector3(vector.x, vector.y, vector.z); }

class ComposerAdapter implements PostProcessingComposerAdapter {
  private readonly passes: { handle: Pass; order: number }[] = [];
  constructor(private readonly composer: EffectComposer) {}
  private rebuild(): void {
    this.composer.passes.length = 0;
    for (const entry of [...this.passes].sort((a, b) => a.order - b.order)) this.composer.addPass(entry.handle);
  }
  addPass(handle: unknown, order: number): void { this.passes.push({ handle: handle as Pass, order }); this.rebuild(); }
  removePass(handle: unknown): void { const index = this.passes.findIndex((entry) => entry.handle === handle); if (index >= 0) this.passes.splice(index, 1); this.rebuild(); }
  setPassEnabled(handle: unknown, enabled: boolean): void { (handle as Pass).enabled = enabled; }
  resize(width: number, height: number, pixelRatio: number): void { this.composer.setPixelRatio(pixelRatio); this.composer.setSize(width, height); }
  render(): void { this.composer.render(); }
  dispose(): void { this.passes.length = 0; this.composer.dispose(); }
}

class Renderer implements AfterglowRenderer {
  readonly vfx: VfxRuntime;
  readonly postProcessing: PostProcessingRuntime;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(BASE_FOV, 16 / 9, 0.2, 900);
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly chroma: ShaderPass;
  private readonly vignette: ShaderPass;
  private readonly canopyMaterial: THREE.MeshStandardMaterial;
  private readonly checkpointFlash = new Map<string, number>();
  private crashFlash = 0;
  private gateFlash = 0;
  private padFlash = 0;
  private boostFlash = 0;
  private cameraRoll = 0;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly car = new THREE.Group();
  private readonly ghost = new THREE.Group();
  private readonly carLight: THREE.PointLight;
  private readonly boostFlame: THREE.Mesh;
  private readonly boostFlameMaterial: THREE.MeshBasicMaterial;
  private readonly wheelGlow: THREE.MeshBasicMaterial;
  private readonly trails: { geometry: THREE.BufferGeometry; positions: Float32Array; colors: Float32Array; alphas: Float32Array; history: THREE.Vector3[]; side: number }[] = [];
  private readonly checkpointMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private readonly gateMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly boostMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly finishMaterial: THREE.MeshBasicMaterial;
  private readonly countdownRing: THREE.Mesh;
  private readonly countdownMaterial: THREE.MeshBasicMaterial;
  private cameraTransform: AdvancedCameraTransform = Object.freeze({ position: Object.freeze({ x: 0, y: 40, z: 40 }), lookAt: Object.freeze({ x: 0, y: 30, z: 0 }), zoom: 1 });
  private readonly smoothedPosition = new THREE.Vector3(0, 40, 40);
  private readonly smoothedLookAt = new THREE.Vector3(0, 30, 0);
  private snapshot: AfterglowSnapshot | null = null;
  private lastPresentedTick = -1;
  private fov = BASE_FOV;
  private frameCount = 0;
  private drawCalls = 0;
  private width = 1;
  private height = 1;
  private ready = false;
  private isDisposed = false;
  private trailPointCount = 0;

  constructor(canvas: HTMLCanvasElement, private readonly track: Track, private readonly testMode: boolean) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !testMode, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(testMode ? 1 : Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.info.autoReset = false;
    this.scene.background = new THREE.Color(COLORS.void);
    this.scene.fog = new THREE.FogExp2(COLORS.fog, testMode ? 0.0011 : 0.0013);
    this.vfx = createVfxRuntime(this.scene, { commandCapacity: 512, burstEffectCapacity: 48, trailEffectCapacity: 72, popupEffectCapacity: 16, maxBurstParticles: 96 });

    this.scene.add(new THREE.HemisphereLight(0x2a4a7a, 0x05060a, 1.4));
    const key = new THREE.DirectionalLight(0x5f7dff, 0.75);
    key.position.set(-80, 120, 40);
    this.scene.add(key);
    this.carLight = new THREE.PointLight(COLORS.carGlow, 14, 18, 2);
    this.scene.add(this.carLight);

    this.buildRoad();
    this.buildFeatures();
    this.buildCity();
    this.buildSky();
    const { flame, flameMaterial, wheelGlow, canopyMaterial } = this.buildCar(this.car, false);
    this.boostFlame = flame;
    this.boostFlameMaterial = flameMaterial;
    this.wheelGlow = wheelGlow;
    this.canopyMaterial = canopyMaterial;
    this.buildCar(this.ghost, true);
    this.ghost.visible = false;
    this.scene.add(this.car, this.ghost);
    this.buildTrails();
    this.finishMaterial = this.mat(new THREE.MeshBasicMaterial({ color: COLORS.finish }));
    this.countdownMaterial = this.mat(new THREE.MeshBasicMaterial({ color: COLORS.carGlow, transparent: true, opacity: 0, side: THREE.DoubleSide }));
    this.countdownRing = new THREE.Mesh(this.geo(new THREE.RingGeometry(2.6, 3, 48)), this.countdownMaterial);
    this.scene.add(this.countdownRing);
    this.buildFinish();

    this.composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(320, 180), 0.5, 0.4, 0.5);
    const output = new OutputPass();
    this.chroma = new ShaderPass(RGBShiftShader);
    this.chroma.uniforms["amount"]!.value = 0.0004;
    this.vignette = new ShaderPass(VignetteShader);
    this.vignette.uniforms["offset"]!.value = 0.75;
    this.vignette.uniforms["darkness"]!.value = 1.0;
    this.postProcessing = createPostProcessingRuntime(new ComposerAdapter(this.composer));
    this.postProcessing.register({ id: "scene", order: 0, handle: renderPass, dispose: () => renderPass.dispose() });
    this.postProcessing.register({ id: "bloom", order: 10, handle: this.bloom, dispose: () => this.bloom.dispose() });
    this.postProcessing.register({ id: "chroma", order: 20, handle: this.chroma, dispose: () => this.chroma.dispose() });
    this.postProcessing.register({ id: "vignette", order: 30, handle: this.vignette, dispose: () => this.vignette.dispose() });
    this.postProcessing.register({ id: "output", order: 100, handle: output, dispose: () => output.dispose() });
    this.resize(testMode ? 1280 : innerWidth, testMode ? 720 : innerHeight);
  }

  private geo<T extends THREE.BufferGeometry>(geometry: T): T { this.geometries.push(geometry); return geometry; }
  private mat<T extends THREE.Material>(material: T): T { this.materials.push(material); return material; }

  // --- Scene construction ---------------------------------------------------

  private ribbon(s0: number, s1: number, leftX: number, rightX: number, lift: number, material: THREE.Material): THREE.Mesh | null {
    const count = Math.max(2, Math.ceil((s1 - s0) / ROAD_STEP) + 1);
    if (s1 - s0 < 0.5) return null;
    const positions = new Float32Array(count * 6);
    const normals = new Float32Array(count * 6);
    const indices: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const s = s0 + ((s1 - s0) * index) / (count - 1);
      const frame = this.track.frame(s);
      const left = this.track.worldPosition(s, leftX, lift);
      const right = this.track.worldPosition(s, rightX, lift);
      positions.set([left.x, left.y, left.z, right.x, right.y, right.z], index * 6);
      normals.set([frame.up.x, frame.up.y, frame.up.z, frame.up.x, frame.up.y, frame.up.z], index * 6);
      if (index > 0) {
        const base = (index - 1) * 2;
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }
    const geometry = this.geo(new THREE.BufferGeometry());
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(indices);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return mesh;
  }

  private buildRoad(): void {
    const road = this.mat(new THREE.MeshStandardMaterial({ color: COLORS.road, roughness: 0.5, metalness: 0.35, emissive: 0x0a1220, side: THREE.DoubleSide }));
    const edge = this.mat(new THREE.MeshBasicMaterial({ color: COLORS.roadEdge, side: THREE.DoubleSide }));
    const line = this.mat(new THREE.MeshBasicMaterial({ color: COLORS.roadLine, side: THREE.DoubleSide }));
    const under = this.mat(new THREE.MeshBasicMaterial({ color: 0x120a22, side: THREE.DoubleSide }));
    const half = this.track.halfWidth;
    const boundaries = [0, ...this.track.gaps.flatMap((gap) => [gap.s0, gap.s1]), this.track.length];
    for (let index = 0; index + 1 < boundaries.length; index += 2) {
      const s0 = boundaries[index]!;
      const s1 = boundaries[index + 1]!;
      this.ribbon(s0, s1, -half, half, 0, road);
      this.ribbon(s0, s1, -half - 0.12, -half + 0.3, 0.03, edge);
      this.ribbon(s0, s1, half - 0.3, half + 0.12, 0.03, edge);
      this.ribbon(s0, s1, -0.09, 0.09, 0.02, line);
      this.ribbon(s0, s1, -half - 0.9, half + 0.9, -0.5, under);
      for (let s = Math.ceil(s0 / 25) * 25; s < s1; s += 25) this.ribbon(Math.max(s0, s - 0.22), Math.min(s1, s + 0.22), -half + 0.6, half - 0.6, 0.02, line);
    }
    const chevron = this.mat(new THREE.MeshBasicMaterial({ color: COLORS.laser, side: THREE.DoubleSide }));
    for (const gap of this.track.gaps) {
      this.ribbon(gap.s0 - 6, gap.s0 - 0.4, -half + 0.5, half - 0.5, 0.025, chevron);
      this.ribbon(gap.s1 + 0.4, gap.s1 + 3, -half + 0.5, half - 0.5, 0.025, chevron);
    }
  }

  private pylon(s: number, x: number, height: number, color: number): void {
    const frame = this.track.frame(s);
    const base = this.track.worldPosition(s, x, 0);
    const body = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.7, height, 0.7)), this.mat(new THREE.MeshStandardMaterial({ color: COLORS.pillar, roughness: 0.92, metalness: 0.08 })));
    body.position.set(base.x + frame.up.x * height / 2, base.y + frame.up.y * height / 2, base.z + frame.up.z * height / 2);
    body.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(toVector(frame.right), toVector(frame.up), toVector(frame.forward).negate()));
    const edges = new THREE.LineSegments(this.geo(new THREE.EdgesGeometry(body.geometry)), this.mat(new THREE.LineBasicMaterial({ color })));
    body.add(edges);
    this.scene.add(body);
  }

  private orient(object: THREE.Object3D, s: number, x: number, h: number): void {
    const frame = this.track.frame(s);
    const position = this.track.worldPosition(s, x, h);
    object.position.set(position.x, position.y, position.z);
    object.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(toVector(frame.right), toVector(frame.up), toVector(frame.forward).negate()));
  }

  private buildGate(gate: GateHazard): void {
    const half = this.track.halfWidth;
    this.pylon(gate.s, -half - 0.6, 4.2, COLORS.laser);
    this.pylon(gate.s, half + 0.6, 4.2, COLORS.laser);
    const beamMaterial = this.mat(new THREE.MeshBasicMaterial({ color: COLORS.laser, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }));
    const coreMaterial = this.mat(new THREE.MeshBasicMaterial({ color: COLORS.laserCore }));
    this.gateMaterials.push(beamMaterial, coreMaterial);
    const addBeam = (x0: number, x1: number, y0: number, y1: number): void => {
      const width = x1 - x0;
      const height = y1 - y0;
      const plane = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(width, height)), beamMaterial);
      this.orient(plane, gate.s, (x0 + x1) / 2, (y0 + y1) / 2);
      this.scene.add(plane);
      for (const y of [y0, y1]) {
        const core = new THREE.Mesh(this.geo(new THREE.BoxGeometry(width, 0.16, 0.16)), coreMaterial);
        this.orient(core, gate.s, (x0 + x1) / 2, y);
        this.scene.add(core);
      }
    };
    if (gate.gate === "low") addBeam(-half, half, 0.25, TUNING.lowBarClearance);
    else if (gate.gate === "left") addBeam(-half, 0, 0.2, 3.2);
    else if (gate.gate === "right") addBeam(0, half, 0.2, 3.2);
    else addBeam(-half / 3, half / 3, 0.2, 3.2);
  }

  private buildFeatures(): void {
    for (const gate of this.track.gates) this.buildGate(gate);
    for (const pillar of this.track.pillars) {
      const frame = this.track.frame(pillar.s);
      const base = this.track.worldPosition(pillar.s, pillar.x, 0);
      const height = TUNING.pillarHeight;
      const body = new THREE.Mesh(this.geo(new THREE.BoxGeometry(TUNING.pillarHalfWidth * 2, height, TUNING.pillarHalfWidth * 2)), this.mat(new THREE.MeshStandardMaterial({ color: COLORS.pillar, roughness: 0.9, metalness: 0.1 })));
      body.position.set(base.x + frame.up.x * height / 2, base.y + frame.up.y * height / 2, base.z + frame.up.z * height / 2);
      body.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(toVector(frame.right), toVector(frame.up), toVector(frame.forward).negate()));
      body.add(new THREE.LineSegments(this.geo(new THREE.EdgesGeometry(body.geometry)), this.mat(new THREE.LineBasicMaterial({ color: COLORS.boost }))));
      this.scene.add(body);
    }
    for (const pad of this.track.boosts) {
      const material = this.mat(new THREE.MeshBasicMaterial({ color: COLORS.boost, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
      this.boostMaterials.push(material);
      const half = this.track.halfWidth - 0.8;
      for (let index = 0; index < 4; index += 1) {
        const s = pad.s0 + 1 + index * 2.2;
        this.ribbon(s, s + 0.7, -half, -0.4, 0.03, material);
        this.ribbon(s, s + 0.7, 0.4, half, 0.03, material);
      }
    }
    for (const checkpoint of this.track.checkpoints) {
      const material = this.mat(new THREE.MeshBasicMaterial({ color: COLORS.checkpointBar }));
      this.checkpointMaterials.set(checkpoint.id, material);
      const half = this.track.halfWidth;
      this.pylon(checkpoint.s, -half - 0.8, 7, COLORS.checkpoint);
      this.pylon(checkpoint.s, half + 0.8, 7, COLORS.checkpoint);
      const bar = new THREE.Mesh(this.geo(new THREE.BoxGeometry(half * 2 + 2.2, 0.3, 0.3)), material);
      this.orient(bar, checkpoint.s, 0, 7);
      this.scene.add(bar);
    }
  }

  private buildFinish(): void {
    const half = this.track.halfWidth;
    const s = this.track.finish.s;
    this.pylon(s, -half - 1.2, 10, COLORS.finish);
    this.pylon(s, half + 1.2, 10, COLORS.finish);
    const bar = new THREE.Mesh(this.geo(new THREE.BoxGeometry(half * 2 + 3.2, 0.45, 0.45)), this.finishMaterial);
    this.orient(bar, s, 0, 10);
    this.scene.add(bar);
    const stripe = this.mat(new THREE.MeshBasicMaterial({ color: COLORS.finish, side: THREE.DoubleSide }));
    this.ribbon(s - 0.5, s + 0.5, -half, half, 0.03, stripe);
  }

  private buildCity(): void {
    const towerCount = this.testMode ? 140 : 260;
    const tower = this.geo(new THREE.BoxGeometry(1, 1, 1));
    tower.translate(0, 0.5, 0);
    const towers = new THREE.InstancedMesh(tower, this.mat(new THREE.MeshStandardMaterial({ color: COLORS.city, roughness: 0.6, metalness: 0.4, emissive: 0x0a1626, emissiveIntensity: 0.8 })), towerCount);
    const beacons = new THREE.InstancedMesh(this.geo(new THREE.SphereGeometry(1.3, 8, 6)), this.mat(new THREE.MeshBasicMaterial({ color: COLORS.laser })), towerCount);
    const seams = new THREE.InstancedMesh(this.geo(new THREE.BoxGeometry(1, 1, 1)), this.mat(new THREE.MeshBasicMaterial({ color: COLORS.citySeam })), towerCount);
    const warmSeams = new THREE.InstancedMesh(this.geo(new THREE.BoxGeometry(1, 1, 1)), this.mat(new THREE.MeshBasicMaterial({ color: COLORS.citySeamWarm })), Math.floor(towerCount / 3));
    const transform = new THREE.Object3D();
    let warm = 0;
    for (let index = 0; index < towerCount; index += 1) {
      const t = (index / towerCount) * this.track.length;
      const frame = this.track.frame(t);
      const side = index % 2 === 0 ? -1 : 1;
      const lateral = side * (26 + ((index * 37) % 11) * 10 + ((index * 13) % 5) * 5);
      const height = 36 + ((index * 53) % 17) * 9 + ((index * 7) % 3) * 16;
      const width = 9 + ((index * 11) % 4) * 5;
      const baseY = frame.position.y - 58 - ((index * 19) % 6) * 9;
      const x = frame.position.x + frame.right.x * lateral + frame.forward.x * (((index * 29) % 9) - 4) * 6;
      const z = frame.position.z + frame.right.z * lateral + frame.forward.z * (((index * 29) % 9) - 4) * 6;
      transform.position.set(x, baseY, z);
      transform.rotation.set(0, ((index * 31) % 8) * 0.2, 0);
      transform.scale.set(width, height, width * (0.7 + ((index * 3) % 3) * 0.25));
      transform.updateMatrix();
      towers.setMatrixAt(index, transform.matrix);
      const seamHeight = height * (0.45 + ((index * 17) % 4) * 0.12);
      transform.position.set(x + Math.cos(transform.rotation.y) * width * 0.52, baseY + seamHeight / 2 + 4, z - Math.sin(transform.rotation.y) * width * 0.52);
      transform.scale.set(1.0, seamHeight, 1.0);
      transform.updateMatrix();
      seams.setMatrixAt(index, transform.matrix);
      transform.position.set(x, baseY + height + 1.2, z);
      transform.scale.set(index % 4 === 0 ? 1 : 0.55, index % 4 === 0 ? 1 : 0.55, index % 4 === 0 ? 1 : 0.55);
      transform.updateMatrix();
      beacons.setMatrixAt(index, transform.matrix);
      if (index % 3 === 0 && warm < warmSeams.count) {
        transform.position.set(x - Math.sin(transform.rotation.y) * width * 0.52, baseY + height * 0.35, z - Math.cos(transform.rotation.y) * width * 0.52);
        transform.scale.set(0.9, height * 0.3, 0.9);
        transform.updateMatrix();
        warmSeams.setMatrixAt(warm, transform.matrix);
        warm += 1;
      }
    }
    this.scene.add(towers, seams, warmSeams, beacons);

    const gridSize = 2400;
    const cells = 40;
    const vertices: number[] = [];
    const center = this.track.frame(this.track.length / 2).position;
    for (let index = 0; index <= cells; index += 1) {
      const offset = -gridSize / 2 + (gridSize * index) / cells;
      vertices.push(center.x + offset, -125, center.z - gridSize / 2, center.x + offset, -125, center.z + gridSize / 2);
      vertices.push(center.x - gridSize / 2, -125, center.z + offset, center.x + gridSize / 2, -125, center.z + offset);
    }
    const gridGeometry = this.geo(new THREE.BufferGeometry());
    gridGeometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    this.scene.add(new THREE.LineSegments(gridGeometry, this.mat(new THREE.LineBasicMaterial({ color: COLORS.grid, transparent: true, opacity: 0.8 }))));
  }

  private buildSky(): void {
    const count = 700;
    const stars = new Float32Array(count * 3);
    const center = this.track.frame(this.track.length / 2).position;
    for (let index = 0; index < count; index += 1) {
      const angle = index * 2.399;
      const radius = 420 + ((index * 47) % 13) * 30;
      stars[index * 3] = center.x + Math.cos(angle) * radius;
      stars[index * 3 + 1] = 90 + ((index * 31) % 23) * 14;
      stars[index * 3 + 2] = center.z + Math.sin(angle) * radius;
    }
    const geometry = this.geo(new THREE.BufferGeometry());
    geometry.setAttribute("position", new THREE.BufferAttribute(stars, 3));
    this.scene.add(new THREE.Points(geometry, this.mat(new THREE.PointsMaterial({ color: COLORS.star, size: 1.6, sizeAttenuation: true, transparent: true, opacity: 0.85, fog: false }))));
  }

  private buildCar(root: THREE.Group, ghost: boolean): { flame: THREE.Mesh; flameMaterial: THREE.MeshBasicMaterial; wheelGlow: THREE.MeshBasicMaterial; canopyMaterial: THREE.MeshStandardMaterial } {
    const bodyMaterial = this.mat(ghost
      ? new THREE.MeshBasicMaterial({ color: COLORS.ghost, transparent: true, opacity: 0.22, depthWrite: false })
      : new THREE.MeshStandardMaterial({ color: COLORS.car, roughness: 0.32, metalness: 0.85 }));
    const glowMaterial = this.mat(new THREE.MeshBasicMaterial({ color: ghost ? COLORS.ghost : COLORS.carGlow, transparent: ghost, opacity: ghost ? 0.5 : 1 }));
    const tailMaterial = this.mat(new THREE.MeshBasicMaterial({ color: ghost ? COLORS.ghost : COLORS.carTail, transparent: ghost, opacity: ghost ? 0.5 : 1 }));
    const outline = new THREE.Shape();
    outline.moveTo(-0.62, 2.55);
    outline.lineTo(0.62, 2.55);
    outline.lineTo(1.12, 0.9);
    outline.lineTo(1.05, -2.15);
    outline.lineTo(-1.05, -2.15);
    outline.lineTo(-1.12, 0.9);
    outline.closePath();
    const chassisGeometry = this.geo(new THREE.ExtrudeGeometry(outline, { depth: 0.4, bevelEnabled: false }));
    chassisGeometry.rotateX(-Math.PI / 2);
    chassisGeometry.translate(0, 0.36, 0);
    const chassis = new THREE.Mesh(chassisGeometry, bodyMaterial);
    const deckGeometry = this.geo(new THREE.ExtrudeGeometry(outline, { depth: 0.16, bevelEnabled: false }));
    deckGeometry.rotateX(-Math.PI / 2);
    deckGeometry.scale(0.8, 1, 0.82);
    deckGeometry.translate(0, 0.76, 0.35);
    const deck = new THREE.Mesh(deckGeometry, bodyMaterial);
    const canopyGeometry = this.geo(new THREE.CylinderGeometry(0.32, 0.62, 0.42, 4, 1));
    canopyGeometry.rotateY(Math.PI / 4);
    canopyGeometry.scale(1.15, 1, 1.75);
    const canopyMaterial = this.mat(new THREE.MeshStandardMaterial({ color: 0x0a1a24, roughness: 0.1, metalness: 0.9, emissive: ghost ? COLORS.ghost : COLORS.carGlow, emissiveIntensity: ghost ? 0.2 : 0.45, transparent: ghost, opacity: ghost ? 0.3 : 1 }));
    const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
    canopy.position.set(0, 1.05, -0.05);
    const spoiler = new THREE.Mesh(this.geo(new THREE.BoxGeometry(2.5, 0.07, 0.42)), bodyMaterial);
    spoiler.position.set(0, 1.12, 1.95);
    const spoilerEdge = new THREE.Mesh(this.geo(new THREE.BoxGeometry(2.5, 0.05, 0.06)), tailMaterial);
    spoilerEdge.position.set(0, 1.12, 2.16);
    const tail = new THREE.Mesh(this.geo(new THREE.BoxGeometry(2.0, 0.12, 0.1)), tailMaterial);
    tail.position.set(0, 0.56, 2.18);
    root.add(chassis, deck, canopy, spoiler, spoilerEdge, tail);
    if (!ghost) {
      const edges = new THREE.LineSegments(this.geo(new THREE.EdgesGeometry(chassis.geometry)), this.mat(new THREE.LineBasicMaterial({ color: COLORS.carGlow })));
      chassis.add(edges);
      const stripe = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.1, 0.04, 3.9)), glowMaterial);
      stripe.position.set(0, 0.8, -0.4);
      root.add(stripe);
      for (const x of [-0.98, 0.98]) {
        const skirt = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.06, 0.08, 3.4)), glowMaterial);
        skirt.position.set(x, 0.3, 0.1);
        root.add(skirt);
      }
    }
    const tire = this.mat(new THREE.MeshStandardMaterial({ color: 0x05070c, roughness: 0.9, metalness: 0.2, transparent: ghost, opacity: ghost ? 0.25 : 1 }));
    for (const [x, z] of [[-1.15, -1.45], [1.15, -1.45], [-1.15, 1.45], [1.15, 1.45]] as const) {
      const wheel = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.46, 0.46, 0.34, 18)), tire);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.46, z);
      const rim = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.42, 0.06, 8, 24)), glowMaterial);
      rim.rotation.y = Math.PI / 2;
      rim.position.set(x + Math.sign(x) * 0.18, 0.46, z);
      root.add(wheel, rim);
    }
    const flameMaterial = this.mat(new THREE.MeshBasicMaterial({ color: COLORS.boost, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    const flame = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.42, 2.4, 12)), flameMaterial);
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(0, 0.6, 3.4);
    root.add(flame);
    return { flame, flameMaterial, wheelGlow: glowMaterial, canopyMaterial };
  }

  private buildTrails(): void {
    for (const side of [-0.9, 0.9]) {
      const positions = new Float32Array(TRAIL_POINTS * 6);
      const colors = new Float32Array(TRAIL_POINTS * 6);
      const alphas = new Float32Array(TRAIL_POINTS * 2);
      const geometry = this.geo(new THREE.BufferGeometry());
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute("alpha", new THREE.BufferAttribute(alphas, 1));
      const indices: number[] = [];
      for (let index = 0; index + 1 < TRAIL_POINTS; index += 1) {
        const base = index * 2;
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
      geometry.setIndex(indices);
      geometry.setDrawRange(0, 0);
      const mesh = new THREE.Mesh(geometry, this.mat(new THREE.ShaderMaterial({
        vertexShader: "attribute float alpha; varying vec3 vColor; varying float vAlpha; void main() { vColor = color; vAlpha = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: "varying vec3 vColor; varying float vAlpha; void main() { gl_FragColor = vec4(vColor, vAlpha); }",
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      })));
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.trails.push({ geometry, positions, colors, alphas, history: [], side });
    }
  }

  // --- Presentation ---------------------------------------------------------

  get disposed(): boolean { return this.isDisposed; }
  get screenshotReady(): boolean { return this.ready && !this.isDisposed; }

  setCameraTransform(transform: AdvancedCameraTransform): void { this.cameraTransform = transform; }
  setBloomEnabled(enabled: boolean): void { if (!this.isDisposed) this.postProcessing.setEnabled("bloom", enabled); }

  prepare(snapshot: AfterglowSnapshot, events: readonly AfterglowEvent[]): void {
    if (this.isDisposed) return;
    this.snapshot = snapshot;
    for (const event of events) {
      if (event.kind === "crashed") this.crashFlash = 1;
      else if (event.kind === "checkpoint" && event.subject !== undefined) this.checkpointFlash.set(event.subject, 1);
      else if (event.kind === "gate-cleared" || event.kind === "near-miss") this.gateFlash = 1;
      else if (event.kind === "boost-pad") this.padFlash = 1;
      else if (event.kind === "boost-started" || event.kind === "run-started" || event.kind === "respawned") this.boostFlash = 1;
      else if (event.kind === "finished") { this.crashFlash = 0.6; this.padFlash = 1; }
    }
    this.placeCar(this.car, snapshot.car.s, snapshot.car.x, snapshot.car.h, snapshot.car.steering, snapshot.car.verticalSpeed);
    this.car.visible = snapshot.car.alive || snapshot.phase !== "running";
    if (snapshot.ghost !== null) {
      this.ghost.visible = true;
      this.placeCar(this.ghost, snapshot.ghost.s, snapshot.ghost.x, snapshot.ghost.h, 0, 0);
    } else this.ghost.visible = false;
    if (snapshot.tick !== this.lastPresentedTick && snapshot.phase === "running" && snapshot.car.alive) {
      this.recordTrail(snapshot);
    } else if (!snapshot.car.alive || snapshot.phase !== "running") {
      for (const trail of this.trails) trail.history.length = 0;
    }
    this.lastPresentedTick = snapshot.tick;
    this.countdownRing.visible = snapshot.phase === "countdown";
    if (snapshot.phase === "countdown") {
      this.orient(this.countdownRing, snapshot.car.s + 12, 0, 3);
      this.countdownMaterial.opacity = 0.35 + 0.65 * (snapshot.countdownSeconds % 0.5) * 2;
    }
  }

  private placeCar(root: THREE.Group, s: number, x: number, h: number, steering: number, verticalSpeed: number): void {
    const frame = this.track.frame(s);
    const position = this.track.worldPosition(s, x, h);
    root.position.set(position.x, position.y, position.z);
    const basis = new THREE.Matrix4().makeBasis(toVector(frame.right), toVector(frame.up), toVector(frame.forward).negate());
    root.quaternion.setFromRotationMatrix(basis);
    root.rotateY(-steering * 0.22);
    root.rotateZ(-steering * 0.18);
    root.rotateX(Math.max(-0.3, Math.min(0.3, -verticalSpeed * 0.03)));
  }

  private recordTrail(snapshot: AfterglowSnapshot): void {
    const frame = this.track.frame(snapshot.car.s);
    for (const trail of this.trails) {
      const point = this.track.worldPosition(snapshot.car.s - 2.0, snapshot.car.x + trail.side, snapshot.car.h + 0.6);
      trail.history.push(new THREE.Vector3(point.x, point.y, point.z));
      if (trail.history.length > TRAIL_POINTS) trail.history.shift();
      const count = trail.history.length;
      const up = toVector(frame.up).multiplyScalar(0.28);
      const boosting = snapshot.car.boosting;
      for (let index = 0; index < count; index += 1) {
        const point = trail.history[index]!;
        const fade = count <= 1 ? 1 : index / (count - 1);
        trail.positions.set([point.x - up.x, point.y - up.y, point.z - up.z, point.x + up.x, point.y + up.y, point.z + up.z], index * 6);
        const r = boosting ? 1.0 : 1.0;
        const g = boosting ? 0.62 : 0.2;
        const b = boosting ? 0.2 : 0.5;
        trail.colors.set([r, g, b, r, g, b], index * 6);
        trail.alphas.set([fade * 0.9, fade * 0.9], index * 2);
      }
      trail.geometry.setDrawRange(0, Math.max(0, (count - 1) * 6));
      (trail.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (trail.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
      (trail.geometry.getAttribute("alpha") as THREE.BufferAttribute).needsUpdate = true;
      this.trailPointCount = count;
    }
  }

  render(): void {
    if (this.isDisposed) throw new Error("Afterglow renderer has been disposed");
    this.drawCalls = this.renderer.info.render.calls;
    this.renderer.info.reset();
    const target = this.cameraTransform;
    const position = new THREE.Vector3(target.position.x, target.position.y, target.position.z);
    const lookAt = new THREE.Vector3(target.lookAt.x, target.lookAt.y, target.lookAt.z);
    if (this.testMode || this.frameCount === 0) {
      this.smoothedPosition.copy(position);
      this.smoothedLookAt.copy(lookAt);
    } else {
      this.smoothedPosition.lerp(position, 0.22);
      this.smoothedLookAt.lerp(lookAt, 0.35);
    }
    this.camera.position.copy(this.smoothedPosition);
    const steering = this.snapshot?.car.steering ?? 0;
    const targetRoll = -steering * 0.06;
    this.cameraRoll = this.testMode ? targetRoll : this.cameraRoll + (targetRoll - this.cameraRoll) * 0.15;
    this.camera.up.set(Math.sin(this.cameraRoll), Math.cos(this.cameraRoll), 0);
    this.camera.lookAt(this.smoothedLookAt);
    const decay = this.testMode ? 0.6 : 0.86;
    this.crashFlash *= decay;
    this.gateFlash *= decay;
    this.padFlash *= decay;
    this.boostFlash *= decay;
    for (const [id, value] of this.checkpointFlash) this.checkpointFlash.set(id, value * decay);
    const targetFov = BASE_FOV / target.zoom;
    this.fov = this.testMode ? targetFov : this.fov + (targetFov - this.fov) * 0.12;
    if (Math.abs(this.camera.fov - this.fov) > 0.01) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }

    const snapshot = this.snapshot;
    if (snapshot !== null) {
      const car = snapshot.car;
      this.carLight.position.copy(this.car.position);
      this.carLight.intensity = car.alive ? (car.boosting ? 26 : 14) : 0;
      this.carLight.color.setHex(car.boosting ? COLORS.boost : COLORS.carGlow);
      this.boostFlameMaterial.opacity = car.boosting ? 0.5 + Math.sin(snapshot.time * 40) * 0.12 : Math.min(0.2, car.speed / TUNING.maxSpeed * 0.2);
      this.boostFlame.scale.set(car.boosting ? 0.9 : 0.5, car.boosting ? 1.4 : 0.6, car.boosting ? 0.9 : 0.5);
      this.wheelGlow.color.setHex(car.heat > 0.85 ? COLORS.laser : car.boosting ? COLORS.boost : COLORS.carGlow);
      const pulse = 0.55 + Math.sin(snapshot.time * 6) * 0.2;
      for (const material of this.gateMaterials) material.opacity = material.transparent ? 0.22 + pulse * 0.22 + this.gateFlash * 0.4 : 1;
      for (const material of this.boostMaterials) { material.opacity = Math.min(1, 0.55 + Math.sin(snapshot.time * 9) * 0.3 + this.padFlash); material.color.setHex(this.padFlash > 0.35 ? COLORS.finish : COLORS.boost); }
      for (const checkpoint of this.track.checkpoints) {
        const material = this.checkpointMaterials.get(checkpoint.id);
        const flash = this.checkpointFlash.get(checkpoint.id) ?? 0;
        if (material !== undefined) material.color.setHex(checkpoint.index <= snapshot.checkpointsPassed ? COLORS.checkpointBarPassed : COLORS.checkpointBar).lerp(new THREE.Color(COLORS.checkpointPassed), Math.min(0.35, flash * 0.5));
      }
      this.finishMaterial.color.setHex(snapshot.phase === "results" ? COLORS.checkpointPassed : COLORS.finish);
      const heatGlow = Math.max(0, car.heat - 0.55) / 0.45;
      this.canopyMaterial.emissive.setHex(COLORS.carGlow).lerp(new THREE.Color(COLORS.laser), heatGlow);
      this.canopyMaterial.emissiveIntensity = 0.45 + heatGlow * 1.2 + (car.boosting ? Math.sin(snapshot.time * 30) * 0.15 + 0.2 : 0);
      this.bloom.strength = (car.boosting ? 0.62 : 0.5) + this.crashFlash * 1.0 + this.boostFlash * 0.2;
      this.chroma.uniforms["amount"]!.value = 0.0004 + (car.boosting ? 0.0009 : 0) + this.crashFlash * 0.006 + this.boostFlash * 0.0012 + Math.min(1, car.speed / TUNING.boostSpeed) * 0.0004;
      this.vignette.uniforms["darkness"]!.value = 1.0;
      this.vignette.uniforms["offset"]!.value = 0.75 + (car.boosting ? 0.3 : 0) + this.crashFlash * 0.45 + heatGlow * 0.15;
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
    this.renderer.setSize(this.width, this.height, false);
    this.postProcessing.resize(this.width, this.height, this.renderer.getPixelRatio());
  }

  inspect(): AfterglowRendererInspection {
    let objects = 0;
    let meshes = 0;
    let lights = 0;
    let triangles = 0;
    this.scene.traverse((object) => {
      objects += 1;
      if (object instanceof THREE.Mesh) {
        meshes += 1;
        const geometry = object.geometry as THREE.BufferGeometry;
        const instances = object instanceof THREE.InstancedMesh ? object.count : 1;
        triangles += instances * (geometry.index === null ? Math.floor((geometry.attributes["position"]?.count ?? 0) / 3) : Math.floor(geometry.index.count / 3));
      }
      if (object instanceof THREE.Light) lights += 1;
    });
    const composer = this.postProcessing.disposed ? { renderCount: 0, passIds: [], enabledPassIds: [] } : this.postProcessing.inspect();
    return Object.freeze({
      backend: "three-webgl",
      disposed: this.isDisposed,
      frames: this.frameCount,
      drawCalls: this.drawCalls,
      sceneObjects: objects,
      meshes,
      lights,
      triangles,
      textures: this.renderer.info.memory.textures,
      estimatedTextureBytes: 0,
      width: this.width,
      height: this.height,
      fov: this.camera.fov,
      composer: Object.freeze({ renderCount: composer.renderCount, passIds: Object.freeze([...composer.passIds]), enabledPassIds: Object.freeze([...composer.enabledPassIds]) }),
      trailPoints: this.trailPointCount,
      effects: Object.freeze({
        crashFlash: this.crashFlash,
        chromaAmount: this.chroma.uniforms["amount"]!.value as number,
        vignetteDarkness: this.vignette.uniforms["darkness"]!.value as number,
        vignetteOffset: this.vignette.uniforms["offset"]!.value as number,
        bloomStrength: this.bloom.strength,
        cameraRoll: this.cameraRoll,
      }),
    });
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    if (!this.postProcessing.disposed) this.postProcessing.dispose();
    for (const geometry of new Set(this.geometries)) geometry.dispose();
    for (const material of new Set(this.materials)) material.dispose();
    this.renderer.dispose();
    this.scene.clear();
    this.ready = false;
  }
}

export function createAfterglowRenderer(canvas: HTMLCanvasElement, track: Track, testMode = false): AfterglowRenderer {
  return new Renderer(canvas, track, testMode);
}
