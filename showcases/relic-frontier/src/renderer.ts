/// <reference lib="dom" />
import * as THREE from "three";
import type { RenderingFeatureAdapter, RendererCameraTransform } from "@three-game-kit/client/rendering";
import { createVfxRuntime, type VfxRuntime } from "@three-game-kit/client/vfx";
import { CONSOLE_POSITION, PLAYER_ID, PLAYER_SPAWN, type GuidanceStage, type RelicEvent, type RelicSnapshot } from "./state.js";

export interface RelicRendererInspection {
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
  readonly activeSkinnedMeshes: number;
  readonly width: number;
  readonly height: number;
}

export interface RelicFrontierRenderer extends RenderingFeatureAdapter {
  readonly vfx: VfxRuntime;
  readonly disposed: boolean;
  readonly screenshotReady: boolean;
  setCameraTransform(transform: RendererCameraTransform): void;
  setDebugCamera(enabled: boolean): void;
  prepare(snapshot: RelicSnapshot, events: readonly RelicEvent[]): void;
  resize(width?: number, height?: number): void;
  inspect(): RelicRendererInspection;
}

const COLORS = Object.freeze({
  night: 0x07151b,
  stone: 0x4b625f,
  stoneDark: 0x1c3436,
  cyan: 0x6fffe1,
  amber: 0xffb45f,
  coral: 0xff6b63,
  violet: 0xb496ff,
  moss: 0x4c8c71,
  cell: 0xffdc73,
  white: 0xf5f2e9,
});

const STAGE_COLORS: Readonly<Record<GuidanceStage, number>> = Object.freeze({
  start: COLORS.cyan, cells: COLORS.cell, mechanism: COLORS.coral, guardian: COLORS.violet,
  relic: COLORS.amber, escape: COLORS.amber, complete: COLORS.cyan, failed: COLORS.coral,
});

class Renderer implements RelicFrontierRenderer {
  readonly vfx: VfxRuntime;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 180);
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly player = new THREE.Group();
  private readonly enemyMeshes = new Map<string, THREE.Group>();
  private readonly pickupMeshes = new Map<string, THREE.Object3D>();
  private readonly upgradeMeshes = new Map<string, THREE.Object3D>();
  private readonly guardianGate = new THREE.Group();
  private readonly relic = new THREE.Group();
  private readonly objectiveBeacon: THREE.PointLight;
  private readonly cellRings = new Map<string, THREE.Mesh>();
  private readonly objectiveMarker = new THREE.Group();
  private readonly markerMaterial: THREE.MeshBasicMaterial;
  private readonly consoleMaterial: THREE.MeshStandardMaterial;
  private bossMaterial: THREE.MeshStandardMaterial | null = null;
  private snapshot: RelicSnapshot | null = null;
  private cameraTransform: RendererCameraTransform = Object.freeze({ position: { x: 0, y: 8, z: 31 }, lookAt: { x: 0, y: 1.4, z: 18 } });
  private eventOrdinal = 0;
  private frameCount = 0;
  private drawCalls = 0;
  private width = 1280;
  private height = 720;
  private isDisposed = false;
  private ready = false;
  private debugCamera = false;

  constructor(canvas: HTMLCanvasElement, testMode: boolean) {
    const geo = <T extends THREE.BufferGeometry>(value: T): T => { this.geometries.push(value); return value; };
    const mat = <T extends THREE.Material>(value: T): T => { this.materials.push(value); return value; };
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(testMode ? 1 : Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.renderer.shadowMap.enabled = !testMode;
    this.scene.background = new THREE.Color(COLORS.night);
    this.scene.fog = new THREE.FogExp2(0x0b2025, 0.014);
    this.vfx = createVfxRuntime(this.scene, { commandCapacity: 96, burstEffectCapacity: 16, trailEffectCapacity: 20, popupEffectCapacity: 12, maxBurstParticles: 48 });

    this.scene.add(new THREE.HemisphereLight(0xbce9e4, 0x362b24, 2.05));
    const moonLight = new THREE.DirectionalLight(0xffd4a8, 2.9);
    moonLight.position.set(-12, 28, 18);
    moonLight.castShadow = !testMode;
    this.scene.add(moonLight);
    const horizonLight = new THREE.PointLight(COLORS.coral, 28, 62, 2);
    horizonLight.position.set(18, 9, -31);
    this.scene.add(horizonLight);
    this.objectiveBeacon = new THREE.PointLight(COLORS.cyan, 18, 20, 2);
    this.objectiveBeacon.position.set(0, 4, -16);
    this.scene.add(this.objectiveBeacon);

    const floorGeo = geo(new THREE.PlaneGeometry(42, 60, 1, 1));
    floorGeo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(floorGeo, mat(new THREE.MeshStandardMaterial({ color: 0x203c35, roughness: 0.97, metalness: 0.02 })));
    floor.receiveShadow = true;
    floor.position.z = -4;
    this.scene.add(floor);

    const pathGeo = geo(new THREE.PlaneGeometry(8, 52));
    pathGeo.rotateX(-Math.PI / 2);
    const path = new THREE.Mesh(pathGeo, mat(new THREE.MeshStandardMaterial({ color: 0x6f7667, roughness: 0.92, metalness: 0.03 })));
    path.position.set(0, 0.015, -5);
    this.scene.add(path);

    const stepGeo = geo(new THREE.CylinderGeometry(2.25, 2.45, 0.24, 6));
    const stepMaterial = mat(new THREE.MeshStandardMaterial({ color: 0x9a9277, roughness: 0.93, flatShading: true }));
    const steps = new THREE.InstancedMesh(stepGeo, stepMaterial, 13);
    const stepTransform = new THREE.Object3D();
    for (let index = 0; index < 13; index += 1) {
      stepTransform.position.set(Math.sin(index * 1.7) * 0.85, 0.14, 18 - index * 3.8);
      stepTransform.rotation.set(0, index * 0.43, 0);
      stepTransform.scale.set(0.9 + (index % 3) * 0.08, 1, 0.72 + (index % 2) * 0.12);
      stepTransform.updateMatrix();
      steps.setMatrixAt(index, stepTransform.matrix);
    }
    steps.receiveShadow = true;
    this.scene.add(steps);

    // A small, authored low-poly landscape gives the arena readable silhouettes
    // without adding downloaded assets or texture memory.
    const cliffGeo = geo(new THREE.ConeGeometry(4.4, 9, 6));
    const cliffMaterial = mat(new THREE.MeshStandardMaterial({ color: 0x29443d, roughness: 0.98, flatShading: true }));
    const cliffs = new THREE.InstancedMesh(cliffGeo, cliffMaterial, 14);
    const cliffTransform = new THREE.Object3D();
    for (const [index, x, z, scale, rotation] of [
      [0, -21, 17, 1.35, 0.1], [1, 21, 14, 1.65, 0.55], [2, -22, 6, 1.8, 0.2], [3, 22, 2, 1.5, 0.8],
      [4, -22, -8, 1.75, 0.5], [5, 22, -11, 1.9, 0.15], [6, -20, -23, 1.55, 0.8], [7, 20, -26, 1.65, 0.3],
      [8, -14, -35, 1.9, 0.7], [9, 0, -39, 2.4, 0.1], [10, 15, -36, 2.1, 0.45], [11, -31, -17, 2.6, 0.25],
      [12, 31, -10, 2.9, 0.65], [13, 28, 22, 2.25, 0.4],
    ] as const) {
      cliffTransform.position.set(x, 2.1 * scale - 3.2, z);
      cliffTransform.rotation.set(0, rotation, Math.PI);
      cliffTransform.scale.set(scale, scale, scale);
      cliffTransform.updateMatrix();
      cliffs.setMatrixAt(index, cliffTransform.matrix);
    }
    cliffs.castShadow = !testMode;
    cliffs.receiveShadow = true;
    this.scene.add(cliffs);

    const monolithGeo = geo(new THREE.BoxGeometry(2.6, 8, 2.2));
    const monolithMaterial = mat(new THREE.MeshStandardMaterial({ color: 0x304b49, roughness: 0.86, metalness: 0.09 }));
    const monoliths = new THREE.InstancedMesh(monolithGeo, monolithMaterial, 9);
    const monolithTransform = new THREE.Object3D();
    for (const [index, x, z, height, tilt] of [
      [0, -10, 20, 0.62, -0.08], [1, 11, 18, 0.82, 0.09], [2, -17, 9, 0.9, 0.04],
      [3, 17, 5, 0.7, -0.06], [4, -17, -9, 1.1, 0.08], [5, 18, -14, 0.85, -0.08],
      [6, -12, -27, 1.25, 0.04], [7, 12, -28, 1.05, -0.04], [8, 0, -34, 1.45, 0],
    ] as const) {
      monolithTransform.position.set(x, height * 4 - 0.7, z);
      monolithTransform.rotation.set(tilt, index * 0.42, tilt * 0.5);
      monolithTransform.scale.set(1, height, 1);
      monolithTransform.updateMatrix();
      monoliths.setMatrixAt(index, monolithTransform.matrix);
    }
    monoliths.castShadow = !testMode;
    monoliths.receiveShadow = true;
    this.scene.add(monoliths);

    const grassGeo = geo(new THREE.ConeGeometry(0.32, 1.8, 3));
    grassGeo.translate(0, 0.9, 0);
    const grassMaterial = mat(new THREE.MeshStandardMaterial({ color: 0x69a36f, roughness: 1, flatShading: true }));
    const grass = new THREE.InstancedMesh(grassGeo, grassMaterial, 30);
    const grassTransform = new THREE.Object3D();
    for (let index = 0; index < 30; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const z = 20 - Math.floor(index / 2) * 3.55;
      const x = side * (5.8 + (index % 5) * 1.7);
      const scale = 0.58 + (index % 4) * 0.17;
      grassTransform.position.set(x, 0, z);
      grassTransform.rotation.set((index % 3 - 1) * 0.11, index * 1.31, side * 0.09);
      grassTransform.scale.set(scale, scale, scale);
      grassTransform.updateMatrix();
      grass.setMatrixAt(index, grassTransform.matrix);
    }
    this.scene.add(grass);

    const pillarGeo = geo(new THREE.CylinderGeometry(1.15, 1.4, 7, 6));
    const capGeo = geo(new THREE.CylinderGeometry(1.55, 1.55, 0.5, 6));
    const stone = mat(new THREE.MeshStandardMaterial({ color: COLORS.stone, roughness: 0.8, metalness: 0.22 }));
    const glow = mat(new THREE.MeshStandardMaterial({ color: COLORS.cyan, emissive: COLORS.cyan, emissiveIntensity: 2.3, roughness: 0.25 }));
    for (const [x, z, height] of [[-15, 13, 7], [15, 13, 5], [-15, 0, 5], [15, -2, 8], [-13, -14, 7], [13, -14, 6], [-8, -24, 9], [8, -24, 9]] as const) {
      const group = new THREE.Group();
      const shaft = new THREE.Mesh(pillarGeo, stone);
      shaft.scale.y = height / 7;
      shaft.position.y = height / 2;
      shaft.castShadow = true;
      shaft.receiveShadow = true;
      const cap = new THREE.Mesh(capGeo, glow);
      cap.position.y = height;
      group.add(shaft, cap);
      group.position.set(x, 0, z);
      this.scene.add(group);
    }

    const archMat = mat(new THREE.MeshStandardMaterial({ color: COLORS.stoneDark, roughness: 0.72, metalness: 0.35 }));
    for (const z of [14, 2, -11]) {
      const arch = new THREE.Group();
      for (const x of [-4.5, 4.5]) {
        const side = new THREE.Mesh(geo(new THREE.BoxGeometry(1.4, 6, 1.8)), archMat);
        side.position.set(x, 3, 0);
        side.castShadow = true;
        arch.add(side);
      }
      const top = new THREE.Mesh(geo(new THREE.BoxGeometry(10.4, 1.2, 1.8)), archMat);
      top.position.y = z < 0 ? 8.5 : 6;
      arch.add(top);
      arch.position.z = z;
      this.scene.add(arch);
    }

    const crystalGeo = geo(new THREE.OctahedronGeometry(0.58, 0));
    const playerMat = mat(new THREE.MeshToonMaterial({ color: 0xe9e2cf, emissive: 0x183a3b }));
    const body = new THREE.Mesh(geo(new THREE.CapsuleGeometry(0.46, 0.78, 5, 10)), playerMat);
    body.position.y = 1.02;
    body.castShadow = true;
    const hoodMaterial = mat(new THREE.MeshToonMaterial({ color: 0x213d3d }));
    const hood = new THREE.Mesh(geo(new THREE.SphereGeometry(0.38, 8, 6)), hoodMaterial);
    hood.position.y = 1.76;
    hood.castShadow = true;
    const face = new THREE.Mesh(geo(new THREE.BoxGeometry(0.38, 0.13, 0.04)), mat(new THREE.MeshBasicMaterial({ color: COLORS.cyan })));
    face.position.set(0, 1.76, 0.355);
    const pack = new THREE.Mesh(geo(new THREE.BoxGeometry(0.7, 0.72, 0.28)), hoodMaterial);
    pack.position.set(0, 1.08, -0.42);
    const scarf = new THREE.Mesh(geo(new THREE.BoxGeometry(0.18, 0.11, 1.25)), mat(new THREE.MeshBasicMaterial({ color: COLORS.coral })));
    scarf.position.set(0.23, 1.48, -0.55);
    scarf.rotation.y = -0.15;
    this.player.add(body, hood, face, pack, scarf);
    this.scene.add(this.player);

    const enemyColors = { drone: COLORS.cyan, shooter: COLORS.amber, sentinel: COLORS.coral, boss: COLORS.violet } as const;
    const enemyKinds = ["drone", "shooter", "sentinel", "boss"] as const;
    for (const [index, id] of ["drone-1", "shooter-1", "sentinel-1", "relic-guardian"].entries()) {
      const kind = enemyKinds[index] ?? "drone";
      const group = new THREE.Group();
      const scale = kind === "boss" ? 2.1 : kind === "sentinel" ? 1.35 : 1;
      const material = mat(new THREE.MeshStandardMaterial({ color: enemyColors[kind], emissive: enemyColors[kind], emissiveIntensity: 0.45, roughness: 0.38, metalness: 0.7 }));
      if (kind === "boss") this.bossMaterial = material;
      const core = new THREE.Mesh(kind === "drone" ? geo(new THREE.OctahedronGeometry(0.75, 0)) : geo(new THREE.DodecahedronGeometry(0.8, 0)), material);
      core.position.y = kind === "drone" ? 2.2 : 1.05;
      core.scale.setScalar(scale);
      core.castShadow = true;
      group.add(core);
      const ring = new THREE.Mesh(geo(new THREE.TorusGeometry(1.05 * scale, 0.08, 6, 18)), mat(new THREE.MeshBasicMaterial({ color: enemyColors[kind] })));
      ring.position.y = kind === "drone" ? 2.2 : 0.35;
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
      this.enemyMeshes.set(id, group);
      this.scene.add(group);
    }

    const pickupMat = mat(new THREE.MeshStandardMaterial({ color: COLORS.cell, emissive: COLORS.cell, emissiveIntensity: 1.9, metalness: 0.5, roughness: 0.2 }));
    const medMat = mat(new THREE.MeshStandardMaterial({ color: 0x8dff89, emissive: 0x2a8a45, emissiveIntensity: 1.2 }));
    const cellRingGeo = geo(new THREE.RingGeometry(0.85, 1.2, 24));
    cellRingGeo.rotateX(-Math.PI / 2);
    const cellRingMat = mat(new THREE.MeshBasicMaterial({ color: COLORS.cell, transparent: true, opacity: 0.55 }));
    for (const id of ["cell-garden", "cell-power", "cell-tower"]) {
      const mesh = new THREE.Mesh(crystalGeo, pickupMat);
      mesh.scale.set(0.9, 1.5, 0.9);
      this.pickupMeshes.set(id, mesh);
      this.scene.add(mesh);
      const ring = new THREE.Mesh(cellRingGeo, cellRingMat);
      this.cellRings.set(id, ring);
      this.scene.add(ring);
    }
    const medGeo = geo(new THREE.BoxGeometry(0.8, 0.55, 0.8));
    const crossMat = mat(new THREE.MeshBasicMaterial({ color: COLORS.white }));
    const crossLongGeo = geo(new THREE.BoxGeometry(0.5, 0.08, 0.16));
    const crossShortGeo = geo(new THREE.BoxGeometry(0.16, 0.08, 0.5));
    for (const id of ["medkit-camp", "medkit-ruin"]) {
      const group = new THREE.Group();
      const crossLong = new THREE.Mesh(crossLongGeo, crossMat);
      const crossShort = new THREE.Mesh(crossShortGeo, crossMat);
      crossLong.position.y = 0.31;
      crossShort.position.y = 0.31;
      group.add(new THREE.Mesh(medGeo, medMat), crossLong, crossShort);
      this.pickupMeshes.set(id, group);
      this.scene.add(group);
    }
    for (const [index, id] of ["upgrade-dash", "upgrade-projectile", "upgrade-health"].entries()) {
      const upgradeColor = [COLORS.cyan, COLORS.violet, 0x7dff8f][index] ?? COLORS.cyan;
      const mesh = new THREE.Mesh(geo(new THREE.CylinderGeometry(1.1, 1.3, 0.28, 12)), mat(new THREE.MeshStandardMaterial({ color: upgradeColor, emissive: upgradeColor, emissiveIntensity: 0.7 })));
      this.upgradeMeshes.set(id, mesh);
      this.scene.add(mesh);
    }

    const powerConsole = new THREE.Group();
    const pedestal = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.9, 1.2, 1.4, 8)), stone);
    pedestal.position.y = 0.7;
    pedestal.castShadow = true;
    this.consoleMaterial = mat(new THREE.MeshStandardMaterial({ color: COLORS.coral, emissive: COLORS.coral, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.5 }));
    const consoleTop = new THREE.Mesh(geo(new THREE.BoxGeometry(1.3, 0.3, 1.3)), this.consoleMaterial);
    consoleTop.position.y = 1.55;
    powerConsole.add(pedestal, consoleTop);
    powerConsole.position.set(CONSOLE_POSITION.x, CONSOLE_POSITION.y, CONSOLE_POSITION.z);
    this.scene.add(powerConsole);

    const camp = new THREE.Group();
    const campRingGeo = geo(new THREE.RingGeometry(2.6, 3.1, 24));
    campRingGeo.rotateX(-Math.PI / 2);
    const campRing = new THREE.Mesh(campRingGeo, mat(new THREE.MeshBasicMaterial({ color: COLORS.amber, transparent: true, opacity: 0.5 })));
    campRing.position.y = 0.03;
    const pole = new THREE.Mesh(geo(new THREE.BoxGeometry(0.12, 4, 0.12)), stone);
    pole.position.set(2.7, 2, 0);
    const flag = new THREE.Mesh(geo(new THREE.BoxGeometry(1.1, 0.6, 0.06)), mat(new THREE.MeshBasicMaterial({ color: COLORS.amber })));
    flag.position.set(3.3, 3.6, 0);
    camp.add(campRing, pole, flag);
    camp.position.set(PLAYER_SPAWN.x, PLAYER_SPAWN.y, PLAYER_SPAWN.z);
    this.scene.add(camp);

    this.markerMaterial = mat(new THREE.MeshBasicMaterial({ color: COLORS.cell, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }));
    const markerColumn = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.3, 0.9, 9, 8, 1, true)), this.markerMaterial);
    markerColumn.position.y = 4.5;
    const markerRingGeo = geo(new THREE.RingGeometry(1.15, 1.6, 24));
    markerRingGeo.rotateX(-Math.PI / 2);
    const markerRing = new THREE.Mesh(markerRingGeo, this.markerMaterial);
    markerRing.position.y = 0.05;
    this.objectiveMarker.add(markerColumn, markerRing);
    this.objectiveMarker.visible = false;
    this.scene.add(this.objectiveMarker);

    const gateMaterial = mat(new THREE.MeshStandardMaterial({ color: COLORS.coral, emissive: COLORS.coral, emissiveIntensity: 1.4, transparent: true, opacity: 0.72 }));
    for (const x of [-3, -1.5, 0, 1.5, 3]) {
      const beam = new THREE.Mesh(geo(new THREE.BoxGeometry(0.18, 5.5, 0.18)), gateMaterial);
      beam.position.set(x, 2.75, 0);
      this.guardianGate.add(beam);
    }
    this.guardianGate.position.z = -19;
    this.scene.add(this.guardianGate);

    const relicCore = new THREE.Mesh(geo(new THREE.IcosahedronGeometry(0.9, 1)), mat(new THREE.MeshStandardMaterial({ color: 0xfff2a8, emissive: COLORS.amber, emissiveIntensity: 2.8, metalness: 0.9, roughness: 0.12 })));
    const relicRing = new THREE.Mesh(geo(new THREE.TorusKnotGeometry(1.35, 0.08, 56, 8)), mat(new THREE.MeshBasicMaterial({ color: COLORS.cyan })));
    this.relic.add(relicCore, relicRing);
    this.relic.position.set(0, 2, -26);
    this.scene.add(this.relic);

    const stars = new Float32Array(360);
    for (let i = 0; i < 120; i += 1) {
      const angle = i * 2.399963;
      const radius = 28 + (i % 13) * 3;
      stars[i * 3] = Math.cos(angle) * radius;
      stars[i * 3 + 1] = 12 + (i % 17) * 1.8;
      stars[i * 3 + 2] = Math.sin(angle) * radius - 5;
    }
    const starGeo = geo(new THREE.BufferGeometry());
    starGeo.setAttribute("position", new THREE.BufferAttribute(stars, 3));
    this.scene.add(new THREE.Points(starGeo, mat(new THREE.PointsMaterial({ color: 0xb9dcff, size: 0.16 }))));

    const motes = new Float32Array(210);
    for (let index = 0; index < 70; index += 1) {
      motes[index * 3] = Math.sin(index * 4.17) * (6 + (index % 9) * 1.25);
      motes[index * 3 + 1] = 0.65 + (index % 11) * 0.42;
      motes[index * 3 + 2] = 21 - (index % 19) * 3.2;
    }
    const moteGeo = geo(new THREE.BufferGeometry());
    moteGeo.setAttribute("position", new THREE.BufferAttribute(motes, 3));
    this.scene.add(new THREE.Points(moteGeo, mat(new THREE.PointsMaterial({ color: 0xffcc82, size: 0.09, transparent: true, opacity: 0.78, depthWrite: false }))));
    this.resize();
  }

  get disposed(): boolean { return this.isDisposed; }
  get screenshotReady(): boolean { return this.ready && !this.isDisposed; }

  setCameraTransform(transform: RendererCameraTransform): void { this.cameraTransform = transform; }
  setDebugCamera(enabled: boolean): void { this.debugCamera = enabled; }

  prepare(snapshot: RelicSnapshot, events: readonly RelicEvent[]): void {
    if (this.isDisposed) return;
    this.snapshot = snapshot;
    this.player.position.set(snapshot.player.position.x, snapshot.player.position.y, snapshot.player.position.z);
    this.player.rotation.y = snapshot.player.velocity.x === 0 && snapshot.player.velocity.z === 0 ? this.player.rotation.y : Math.atan2(snapshot.player.velocity.x, snapshot.player.velocity.z);
    for (const enemy of snapshot.enemies) {
      const mesh = this.enemyMeshes.get(enemy.id);
      if (mesh === undefined) continue;
      mesh.visible = enemy.alive && (enemy.kind !== "boss" || snapshot.phase === "guardian");
      mesh.position.set(enemy.position.x, enemy.position.y, enemy.position.z);
      mesh.rotation.y = snapshot.time * (enemy.kind === "boss" ? 0.5 : 1.1);
    }
    for (const pickup of snapshot.pickups) {
      const mesh = this.pickupMeshes.get(pickup.id);
      const ring = this.cellRings.get(pickup.id);
      if (ring !== undefined) {
        ring.visible = !pickup.collected;
        ring.position.set(pickup.position.x, pickup.position.y + 0.04, pickup.position.z);
      }
      if (mesh === undefined) continue;
      mesh.visible = !pickup.collected;
      mesh.position.set(pickup.position.x, pickup.position.y + 0.85 + Math.sin(snapshot.time * 2 + pickup.id.length) * 0.15, pickup.position.z);
      mesh.rotation.y = snapshot.time;
    }
    for (const upgrade of snapshot.upgrades) {
      const mesh = this.upgradeMeshes.get(upgrade.id);
      if (mesh === undefined) continue;
      mesh.position.set(upgrade.position.x, 0.18, upgrade.position.z);
      mesh.scale.setScalar(upgrade.selected ? 1.2 : snapshot.upgrades.some(({ selected }) => selected) ? 0.72 : 1);
    }
    const boss = snapshot.enemies.find(({ kind }) => kind === "boss");
    this.guardianGate.visible = !snapshot.mechanismPowered;
    this.relic.visible = snapshot.phase === "guardian" && boss?.alive === false && !snapshot.relicOwned;
    this.relic.rotation.y = snapshot.time * 0.8;
    const guidance = snapshot.guidance[PLAYER_ID];
    const target = guidance?.target ?? null;
    const stageColor = STAGE_COLORS[guidance?.stage ?? "start"];
    this.objectiveMarker.visible = target !== null;
    this.objectiveBeacon.visible = target !== null;
    if (target !== null) {
      this.objectiveMarker.position.set(target.x, target.y, target.z);
      this.objectiveBeacon.position.set(target.x, target.y + 4, target.z);
    }
    this.objectiveMarker.rotation.y = snapshot.time * 0.6;
    this.markerMaterial.color.setHex(stageColor);
    this.objectiveBeacon.color.setHex(stageColor);
    const consoleColor = snapshot.mechanismPowered ? COLORS.cyan : COLORS.coral;
    this.consoleMaterial.color.setHex(consoleColor);
    this.consoleMaterial.emissive.setHex(consoleColor);
    if (this.bossMaterial !== null && boss !== undefined) this.bossMaterial.emissiveIntensity = 0.45 + (1 - boss.health / boss.maximumHealth) * 1.4;
    this.eventOrdinal += events.length;
  }

  render(): void {
    if (this.isDisposed) throw new Error("Relic Frontier renderer has been disposed");
    if (this.debugCamera) {
      this.camera.position.set(0, 42, 8);
      this.camera.lookAt(0, 0, -6);
    } else {
      this.camera.position.set(this.cameraTransform.position.x, this.cameraTransform.position.y, this.cameraTransform.position.z);
      this.camera.lookAt(this.cameraTransform.lookAt.x, this.cameraTransform.lookAt.y, this.cameraTransform.lookAt.z);
    }
    if (this.snapshot !== null) {
      const bob = Math.sin(this.snapshot.time * 7) * Math.min(0.08, Math.hypot(this.snapshot.player.velocity.x, this.snapshot.player.velocity.z) * 0.01);
      this.player.position.y = this.snapshot.player.position.y + bob;
    }
    this.renderer.render(this.scene, this.camera);
    this.frameCount += 1;
    this.drawCalls = this.renderer.info.render.calls;
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

  inspect(): RelicRendererInspection {
    let objects = 0, meshes = 0, lights = 0, triangles = 0;
    this.scene.traverse((object) => {
      objects += 1;
      if (object instanceof THREE.Mesh) {
        meshes += 1;
        const geometry = object.geometry;
        triangles += geometry.index === null ? Math.floor((geometry.attributes.position?.count ?? 0) / 3) : Math.floor(geometry.index.count / 3);
      }
      if (object instanceof THREE.Light) lights += 1;
    });
    return Object.freeze({ backend: "three-webgl", disposed: this.isDisposed, frames: this.frameCount, drawCalls: this.drawCalls, sceneObjects: objects, meshes, lights, triangles, textures: this.renderer.info.memory.textures, estimatedTextureBytes: 0, activeSkinnedMeshes: 0, width: this.width, height: this.height });
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    for (const geometry of new Set(this.geometries)) geometry.dispose();
    for (const material of new Set(this.materials)) material.dispose();
    this.renderer.dispose();
    this.scene.clear();
    this.ready = false;
  }
}

export function createRelicFrontierRenderer(canvas: HTMLCanvasElement, testMode = false): RelicFrontierRenderer {
  return new Renderer(canvas, testMode);
}
