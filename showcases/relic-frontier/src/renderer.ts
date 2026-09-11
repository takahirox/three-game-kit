/// <reference lib="dom" />
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { createThreeAnimationRuntime, type AnimationCharacterSet, type AnimationClipEvent, type AnimationRuntime } from "@three-game-kit/client/animation";
import type { RenderingFeatureAdapter, RendererCameraTransform } from "@three-game-kit/client/rendering";
import { createVfxRuntime, type VfxRuntime } from "@three-game-kit/client/vfx";
import { ATTACKS, PLAYER_CAPSULE_CENTER } from "./game.js";
import {
  CHECKPOINTS,
  CONSOLE_POSITION,
  DT,
  PLAYER_ID,
  type AnimationCue,
  type EnemyKind,
  type GuidanceStage,
  type RelicEvent,
  type RelicSnapshot,
} from "./state.js";

export interface RelicRigInspection {
  readonly status: "pending" | "loaded" | "failed";
  readonly clipIds: readonly string[];
  readonly bones: number;
  readonly characters: readonly string[];
  readonly triangles: number;
}

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
  readonly rig: RelicRigInspection;
  readonly animationEvents: number;
  readonly width: number;
  readonly height: number;
}

export interface RelicFrontierRenderer extends RenderingFeatureAdapter {
  readonly vfx: VfxRuntime;
  readonly disposed: boolean;
  readonly screenshotReady: boolean;
  setCameraTransform(transform: RendererCameraTransform): void;
  setDebugCamera(enabled: boolean): void;
  attachCharacterRig(asset: unknown, characters: AnimationCharacterSet): boolean;
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
  relic: COLORS.amber, escape: COLORS.amber, complete: COLORS.cyan, downed: COLORS.coral,
});

const ENEMY_TINTS: Readonly<Record<EnemyKind, { readonly color: number; readonly emissive: number; readonly scale: number; readonly height: number }>> = Object.freeze({
  husk: { color: 0xffa090, emissive: 0x3a1010, scale: 1, height: 2.1 },
  warden: { color: 0xc8b0ff, emissive: 0x2a1650, scale: 1.08, height: 2.25 },
  boss: { color: 0xa890e0, emissive: 0x321860, scale: 2.05, height: 4.3 },
});

const CLIP_EVENTS = Object.freeze([
  { clipId: "run", id: "footstep", seconds: 0.15 },
  { clipId: "run", id: "footstep-2", seconds: 0.45 },
  { clipId: "walk", id: "footstep", seconds: 0.25 },
  { clipId: "walk", id: "footstep-2", seconds: 0.75 },
  { clipId: "attack-light", id: "swing", seconds: 0.16 },
  { clipId: "attack-light-2", id: "swing", seconds: 0.16 },
  { clipId: "attack-heavy", id: "slam", seconds: 0.42 },
  { clipId: "dodge-roll", id: "roll", seconds: 0.1 },
  { clipId: "cast", id: "release", seconds: 0.42 },
]);

interface Character {
  readonly id: string;
  readonly kind: EnemyKind | null;
  readonly root: THREE.Group;
  readonly fallback: THREE.Object3D;
  readonly height: number;
  readonly scale: number;
  rig: THREE.Object3D | null;
  runtime: AnimationRuntime | null;
  material: THREE.MeshStandardMaterial | null;
  lastSequence: number;
}

interface Telegraph {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  angle: number;
}

class Renderer implements RelicFrontierRenderer {
  readonly vfx: VfxRuntime;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 180);
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly characters = new Map<string, Character>();
  private readonly telegraphs = new Map<string, Telegraph>();
  private readonly sectorGeometries = new Map<string, THREE.RingGeometry>();
  private readonly clipDurations = new Map<string, number>();
  private readonly pickupMeshes = new Map<string, THREE.Object3D>();
  private readonly upgradeMeshes = new Map<string, THREE.Object3D>();
  private readonly checkpointCrystals = new Map<string, THREE.MeshStandardMaterial>();
  private readonly guardianGate = new THREE.Group();
  private readonly relic = new THREE.Group();
  private readonly lockReticle = new THREE.Group();
  private readonly objectiveBeacon: THREE.PointLight;
  private readonly cellRings = new Map<string, THREE.Mesh>();
  private readonly objectiveMarker = new THREE.Group();
  private readonly markerMaterial: THREE.MeshBasicMaterial;
  private readonly consoleMaterial: THREE.MeshStandardMaterial;
  private readonly reticleMaterial: THREE.MeshBasicMaterial;
  private readonly telegraphColors: Readonly<Record<EnemyKind, number>> = Object.freeze({ husk: COLORS.coral, warden: COLORS.violet, boss: COLORS.violet });
  private snapshot: RelicSnapshot | null = null;
  private cameraTransform: RendererCameraTransform = Object.freeze({ position: { x: 0, y: 8, z: 31 }, lookAt: { x: 0, y: 1.4, z: 18 } });
  private rigStatus: RelicRigInspection["status"] = "pending";
  private rigClipIds: readonly string[] = Object.freeze([]);
  private rigBones = 0;
  private rigTriangles = 0;
  private animationEventCount = 0;
  private eventOrdinal = 0;
  private frameCount = 0;
  private drawCalls = 0;
  private width = 1280;
  private height = 720;
  private isDisposed = false;
  private ready = false;
  private debugCamera = false;
  private readonly testMode: boolean;

  constructor(canvas: HTMLCanvasElement, testMode: boolean) {
    this.testMode = testMode;
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
    this.vfx = createVfxRuntime(this.scene, { commandCapacity: 128, burstEffectCapacity: 24, trailEffectCapacity: 24, popupEffectCapacity: 12, maxBurstParticles: 48 });

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

    // Procedural stand-ins stay visible until the authored rig attaches, and whenever loading fails.
    const playerFallback = new THREE.Group();
    const playerMat = mat(new THREE.MeshToonMaterial({ color: 0xe9e2cf, emissive: 0x183a3b }));
    const body = new THREE.Mesh(geo(new THREE.CapsuleGeometry(0.46, 0.78, 5, 10)), playerMat);
    body.position.y = 1.02;
    body.castShadow = true;
    const hoodMaterial = mat(new THREE.MeshToonMaterial({ color: 0x213d3d }));
    const hood = new THREE.Mesh(geo(new THREE.SphereGeometry(0.38, 8, 6)), hoodMaterial);
    hood.position.y = 1.76;
    const face = new THREE.Mesh(geo(new THREE.BoxGeometry(0.38, 0.13, 0.04)), mat(new THREE.MeshBasicMaterial({ color: COLORS.cyan })));
    face.position.set(0, 1.76, 0.355);
    playerFallback.add(body, hood, face);
    this.registerCharacter(PLAYER_ID, null, playerFallback, 2.1, 1);

    const enemyKinds: readonly (readonly [string, EnemyKind])[] = [["husk-1", "husk"], ["husk-2", "husk"], ["warden-1", "warden"], ["husk-3", "husk"], ["relic-guardian", "boss"]];
    const enemyCoreGeo = geo(new THREE.DodecahedronGeometry(0.8, 0));
    for (const [id, kind] of enemyKinds) {
      const tint = ENEMY_TINTS[kind];
      const fallback = new THREE.Group();
      const material = mat(new THREE.MeshStandardMaterial({ color: this.telegraphColors[kind], emissive: this.telegraphColors[kind], emissiveIntensity: 0.45, roughness: 0.38, metalness: 0.7 }));
      const core = new THREE.Mesh(enemyCoreGeo, material);
      core.position.y = 1.05 * tint.scale;
      core.scale.setScalar(tint.scale);
      core.castShadow = true;
      fallback.add(core);
      this.registerCharacter(id, kind, fallback, tint.height, tint.scale);
      const telegraphMaterial = mat(new THREE.MeshBasicMaterial({ color: this.telegraphColors[kind], transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }));
      const telegraph = new THREE.Mesh(this.sectorGeometry(Math.PI * 2), telegraphMaterial);
      telegraph.visible = false;
      telegraph.position.y = 0.06;
      this.scene.add(telegraph);
      this.telegraphs.set(id, { mesh: telegraph, material: telegraphMaterial, angle: Math.PI * 2 });
    }

    const pickupMat = mat(new THREE.MeshStandardMaterial({ color: COLORS.cell, emissive: COLORS.cell, emissiveIntensity: 1.9, metalness: 0.5, roughness: 0.2 }));
    const medMat = mat(new THREE.MeshStandardMaterial({ color: 0x8dff89, emissive: 0x2a8a45, emissiveIntensity: 1.2 }));
    const crystalGeo = geo(new THREE.OctahedronGeometry(0.58, 0));
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
    for (const [index, id] of ["upgrade-dodge", "upgrade-projectile", "upgrade-health"].entries()) {
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

    // Checkpoint beacons: a stone plinth, a floor ring, and a crystal whose glow tracks activation.
    const beaconRingGeo = geo(new THREE.RingGeometry(1.7, 2.1, 28));
    beaconRingGeo.rotateX(-Math.PI / 2);
    const beaconRingMat = mat(new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.45 }));
    const plinthGeo = geo(new THREE.CylinderGeometry(0.42, 0.55, 1.1, 6));
    const crystalBeaconGeo = geo(new THREE.OctahedronGeometry(0.34, 0));
    for (const checkpoint of CHECKPOINTS) {
      const beacon = new THREE.Group();
      const ring = new THREE.Mesh(beaconRingGeo, beaconRingMat);
      ring.position.y = 0.03;
      const plinth = new THREE.Mesh(plinthGeo, stone);
      plinth.position.set(2.2, 0.55, 0.4);
      const crystalMaterial = mat(new THREE.MeshStandardMaterial({ color: COLORS.cyan, emissive: COLORS.cyan, emissiveIntensity: 0.6, roughness: 0.2 }));
      const crystal = new THREE.Mesh(crystalBeaconGeo, crystalMaterial);
      crystal.position.set(2.2, 1.45, 0.4);
      crystal.scale.set(1, 1.6, 1);
      this.checkpointCrystals.set(checkpoint.id, crystalMaterial);
      beacon.add(ring, plinth, crystal);
      if (checkpoint.id === "checkpoint-camp") {
        const pole = new THREE.Mesh(geo(new THREE.BoxGeometry(0.12, 4, 0.12)), stone);
        pole.position.set(2.7, 2, -1.2);
        const flag = new THREE.Mesh(geo(new THREE.BoxGeometry(1.1, 0.6, 0.06)), mat(new THREE.MeshBasicMaterial({ color: COLORS.amber })));
        flag.position.set(3.3, 3.6, -1.2);
        beacon.add(pole, flag);
      }
      beacon.position.set(checkpoint.position.x, checkpoint.position.y, checkpoint.position.z);
      this.scene.add(beacon);
    }

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

    this.reticleMaterial = mat(new THREE.MeshBasicMaterial({ color: COLORS.amber, transparent: true, opacity: 0.9, depthTest: false }));
    const reticleRing = new THREE.Mesh(geo(new THREE.TorusGeometry(0.55, 0.05, 6, 24)), this.reticleMaterial);
    const reticleTip = new THREE.Mesh(geo(new THREE.ConeGeometry(0.16, 0.34, 4)), this.reticleMaterial);
    reticleTip.position.y = 0.72;
    reticleTip.rotation.x = Math.PI;
    this.lockReticle.add(reticleRing, reticleTip);
    this.lockReticle.visible = false;
    this.lockReticle.renderOrder = 10;
    this.scene.add(this.lockReticle);

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

  private registerCharacter(id: string, kind: EnemyKind | null, fallback: THREE.Object3D, height: number, scale: number): void {
    const root = new THREE.Group();
    root.add(fallback);
    this.scene.add(root);
    this.characters.set(id, { id, kind, root, fallback, height, scale, rig: null, runtime: null, material: null, lastSequence: -1 });
  }

  private sectorGeometry(angle: number): THREE.RingGeometry {
    const key = angle.toFixed(4);
    let geometry = this.sectorGeometries.get(key);
    if (geometry === undefined) {
      geometry = new THREE.RingGeometry(0.15, 1, 28, 1, Math.PI / 2 - angle / 2, angle);
      geometry.rotateX(-Math.PI / 2);
      this.geometries.push(geometry);
      this.sectorGeometries.set(key, geometry);
    }
    return geometry;
  }

  setCameraTransform(transform: RendererCameraTransform): void { this.cameraTransform = transform; }
  setDebugCamera(enabled: boolean): void { this.debugCamera = enabled; }

  attachCharacterRig(asset: unknown, characters: AnimationCharacterSet): boolean {
    if (this.isDisposed || this.rigStatus === "loaded") return false;
    if (typeof asset !== "object" || asset === null || !("scene" in asset) || !(asset.scene instanceof THREE.Object3D) || !("animations" in asset) || !Array.isArray(asset.animations)) {
      this.rigStatus = "failed";
      return false;
    }
    const source = asset.scene;
    const clips = asset.animations.filter((clip): clip is THREE.AnimationClip => clip instanceof THREE.AnimationClip);
    let bones = 0;
    let triangles = 0;
    source.traverse((object) => {
      if (object instanceof THREE.Bone) bones += 1;
      if (object instanceof THREE.SkinnedMesh) triangles += object.geometry.index === null ? object.geometry.attributes.position?.count ?? 0 : object.geometry.index.count / 3;
    });
    if (clips.length === 0 || bones === 0) { this.rigStatus = "failed"; return false; }
    const clipIds = clips.map((clip) => clip.name);
    for (const state of ["idle", "walk", "run", "death"]) if (!clipIds.includes(state)) { this.rigStatus = "failed"; return false; }
    const events = CLIP_EVENTS.filter((event) => clipIds.includes(event.clipId));
    for (const clip of clips) this.clipDurations.set(clip.name, clip.duration);
    for (const character of this.characters.values()) {
      const rig = cloneSkeleton(source);
      const tint = character.kind === null ? null : ENEMY_TINTS[character.kind];
      rig.traverse((object) => {
        if (!(object instanceof THREE.SkinnedMesh)) return;
        object.castShadow = !this.testMode;
        object.frustumCulled = false;
        if (tint !== null && object.material instanceof THREE.MeshStandardMaterial) {
          const material = object.material.clone();
          material.color.setHex(tint.color);
          material.emissive.setHex(tint.emissive);
          material.emissiveIntensity = 1;
          this.materials.push(material);
          object.material = material;
          character.material = material;
        }
      });
      rig.scale.setScalar(character.scale);
      const runtime = createThreeAnimationRuntime({
        root: rig,
        clips: clips.map((clip) => ({ id: clip.name, clip })),
        states: {
          idle: "idle",
          walk: { clip: "walk", crossFadeSeconds: 0.12 },
          run: { clip: "run", crossFadeSeconds: 0.1 },
          dead: { clip: "death", loop: false, clampWhenFinished: true, crossFadeSeconds: 0.08 },
        },
        initialState: "idle",
        events,
      });
      runtime.onEvent((event) => this.onAnimationEvent(character, event));
      characters.add(character.id, runtime, () => this.cueFor(character.id).state);
      character.rig = rig;
      character.runtime = runtime;
      character.fallback.visible = false;
      character.root.add(rig);
    }
    this.rigStatus = "loaded";
    this.rigClipIds = Object.freeze(clipIds);
    this.rigBones = bones;
    this.rigTriangles = triangles;
    return true;
  }

  private cueFor(id: string): AnimationCue {
    if (this.snapshot === null) return { state: "idle", oneShot: null, sequence: 0, durationTicks: 0 };
    if (id === PLAYER_ID) return this.snapshot.player.animation;
    return this.snapshot.enemies.find((enemy) => enemy.id === id)?.animation ?? { state: "idle", oneShot: null, sequence: 0, durationTicks: 0 };
  }

  private onAnimationEvent(character: Character, event: AnimationClipEvent): void {
    if (this.isDisposed) return;
    this.animationEventCount += 1;
    const position = character.root.position;
    const yaw = character.root.rotation.y;
    const seed = (this.animationEventCount * 2246822519) >>> 0;
    if (event.id.startsWith("footstep")) {
      this.vfx.enqueue({ kind: "burst", position: { x: position.x, y: position.y + 0.1, z: position.z }, count: 3, color: 0x9a9277, speed: 0.9, lifetimeMs: 320, seed });
    } else if (event.id === "swing" || event.id === "slam") {
      const reach = (event.id === "slam" ? 1.9 : 1.6) * character.scale;
      const side = event.clipId === "attack-light-2" ? -1 : 1;
      const start = { x: position.x + Math.sin(yaw + side * 0.9) * reach, y: position.y + 1.2 * character.scale, z: position.z + Math.cos(yaw + side * 0.9) * reach };
      const end = { x: position.x + Math.sin(yaw - side * 0.9) * reach, y: position.y + 1.0 * character.scale, z: position.z + Math.cos(yaw - side * 0.9) * reach };
      this.vfx.enqueue({ kind: "trail", start, end, color: character.id === PLAYER_ID ? COLORS.cyan : COLORS.coral, width: 0.16 * character.scale, lifetimeMs: 220, seed });
      if (event.id === "slam") this.vfx.enqueue({ kind: "burst", position: { x: position.x + Math.sin(yaw) * reach, y: position.y + 0.2, z: position.z + Math.cos(yaw) * reach }, count: 14, color: COLORS.amber, speed: 3.2, lifetimeMs: 520, seed: (seed ^ 0x9e3779b9) >>> 0 });
    } else if (event.id === "roll") {
      this.vfx.enqueue({ kind: "burst", position: { x: position.x, y: position.y + 0.2, z: position.z }, count: 8, color: 0x9a9277, speed: 1.6, lifetimeMs: 420, seed });
    } else if (event.id === "release") {
      this.vfx.enqueue({ kind: "burst", position: { x: position.x, y: position.y + 1.4 * character.scale, z: position.z }, count: 10, color: COLORS.violet, speed: 2.2, lifetimeMs: 480, seed });
    }
  }

  private syncCharacter(character: Character, cue: AnimationCue, position: { readonly x: number; readonly y: number; readonly z: number }, yaw: number): void {
    character.root.position.set(position.x, position.y, position.z);
    character.root.rotation.y = yaw;
    const runtime = character.runtime;
    if (runtime === null || runtime.disposed) return;
    if (cue.sequence === character.lastSequence) return;
    character.lastSequence = cue.sequence;
    if (cue.oneShot === null) { runtime.cancelOneShot(); return; }
    const duration = this.clipDurations.get(cue.oneShot) ?? 0;
    if (duration <= 0 || cue.durationTicks <= 0) return;
    // Gameplay windows are tick-authoritative; the clip is stretched so the swing reads at the same moment.
    runtime.playOneShot(cue.oneShot, { playbackRate: duration / (cue.durationTicks * DT), crossFadeSeconds: 0.05 });
  }

  prepare(snapshot: RelicSnapshot, events: readonly RelicEvent[]): void {
    if (this.isDisposed) return;
    this.snapshot = snapshot;
    const player = this.characters.get(PLAYER_ID);
    if (player !== undefined) this.syncCharacter(player, snapshot.player.animation, { x: snapshot.player.position.x, y: snapshot.player.position.y - PLAYER_CAPSULE_CENTER, z: snapshot.player.position.z }, snapshot.player.facingYaw);
    for (const enemy of snapshot.enemies) {
      const character = this.characters.get(enemy.id);
      const telegraph = this.telegraphs.get(enemy.id);
      if (character === undefined) continue;
      const visible = enemy.alive ? (enemy.kind !== "boss" || snapshot.phase === "guardian") : (enemy.kind !== "boss" || snapshot.phase === "guardian") && character.rig !== null;
      character.root.visible = visible;
      this.syncCharacter(character, enemy.animation, enemy.position, enemy.facingYaw);
      if (character.rig === null) character.fallback.rotation.y = snapshot.time * (enemy.kind === "boss" ? 0.5 : 1.1);
      if (character.material !== null) character.material.emissiveIntensity = enemy.combat.kind === "attack" && enemy.combat.phase === "startup" ? 2.2 : 0.7 + (1 - enemy.health / enemy.maximumHealth) * 1.3;
      if (telegraph === undefined) continue;
      const attack = enemy.combat.kind === "attack" && enemy.alive ? enemy.combat : null;
      const definition = attack === null || attack.attackId === null ? null : ATTACKS[attack.attackId];
      if (attack === null || definition === null || attack.phase === "recovery") { telegraph.mesh.visible = false; continue; }
      const shape = definition.volume.kind === "arc" ? { radius: definition.volume.radius, angle: definition.volume.angle } : definition.volume.kind === "sphere" ? { radius: definition.volume.radius, angle: Math.PI * 2 } : { radius: 1.4 * character.scale, angle: Math.PI * 2 };
      if (telegraph.angle !== shape.angle) { telegraph.mesh.geometry = this.sectorGeometry(shape.angle); telegraph.angle = shape.angle; }
      const center = enemy.slamTarget ?? enemy.position;
      const progress = attack.phase === "active" ? 1 : Math.min(1, attack.ticks / Math.max(1, definition.startup));
      telegraph.mesh.visible = true;
      telegraph.mesh.position.set(center.x, 0.06, center.z);
      telegraph.mesh.rotation.y = enemy.facingYaw + Math.PI;
      telegraph.mesh.scale.setScalar(shape.radius * (0.35 + 0.65 * progress));
      telegraph.material.opacity = attack.phase === "active" ? 0.95 : 0.25 + 0.5 * progress;
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
    const target = snapshot.lockOn.targetId === null ? undefined : snapshot.enemies.find(({ id }) => id === snapshot.lockOn.targetId);
    const targetCharacter = target === undefined ? undefined : this.characters.get(target.id);
    this.lockReticle.visible = target !== undefined && targetCharacter !== undefined;
    if (target !== undefined && targetCharacter !== undefined) {
      this.lockReticle.position.set(target.position.x, target.position.y + targetCharacter.height + 0.4, target.position.z);
      this.lockReticle.rotation.y = snapshot.time * 2.4;
      const pulse = 1 + Math.sin(snapshot.time * 8) * 0.08;
      this.lockReticle.scale.setScalar(pulse * (target.kind === "boss" ? 1.6 : 1));
    }
    for (const checkpoint of CHECKPOINTS) {
      const material = this.checkpointCrystals.get(checkpoint.id);
      if (material === undefined) continue;
      const active = snapshot.checkpoint.activeId === checkpoint.id;
      material.emissiveIntensity = active ? 2.4 + Math.sin(snapshot.time * 4) * 0.5 : 0.5;
      material.emissive.setHex(active ? COLORS.cyan : COLORS.stone);
    }
    const boss = snapshot.enemies.find(({ kind }) => kind === "boss");
    this.guardianGate.visible = !snapshot.mechanismPowered;
    this.relic.visible = boss?.alive === false && !snapshot.relicOwned && snapshot.mechanismPowered;
    this.relic.rotation.y = snapshot.time * 0.8;
    const guidance = snapshot.guidance[PLAYER_ID];
    const marker = guidance?.target ?? null;
    const stageColor = STAGE_COLORS[guidance?.stage ?? "start"];
    this.objectiveMarker.visible = marker !== null && guidance?.stage !== "guardian";
    this.objectiveBeacon.visible = marker !== null;
    if (marker !== null) {
      this.objectiveMarker.position.set(marker.x, marker.y, marker.z);
      this.objectiveBeacon.position.set(marker.x, marker.y + 4, marker.z);
    }
    this.objectiveMarker.rotation.y = snapshot.time * 0.6;
    this.markerMaterial.color.setHex(stageColor);
    this.objectiveBeacon.color.setHex(stageColor);
    const consoleColor = snapshot.mechanismPowered ? COLORS.cyan : COLORS.coral;
    this.consoleMaterial.color.setHex(consoleColor);
    this.consoleMaterial.emissive.setHex(consoleColor);
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
    let objects = 0, meshes = 0, lights = 0, triangles = 0, skinned = 0;
    this.scene.traverse((object) => {
      objects += 1;
      if (object instanceof THREE.Mesh) {
        meshes += 1;
        const geometry = object.geometry;
        triangles += geometry.index === null ? Math.floor((geometry.attributes.position?.count ?? 0) / 3) : Math.floor(geometry.index.count / 3);
      }
      if (object instanceof THREE.SkinnedMesh && object.visible && object.parent?.parent?.visible !== false) skinned += 1;
      if (object instanceof THREE.Light) lights += 1;
    });
    return Object.freeze({
      backend: "three-webgl", disposed: this.isDisposed, frames: this.frameCount, drawCalls: this.drawCalls, sceneObjects: objects, meshes, lights, triangles,
      textures: this.renderer.info.memory.textures, estimatedTextureBytes: 0, activeSkinnedMeshes: skinned,
      rig: Object.freeze({ status: this.rigStatus, clipIds: this.rigClipIds, bones: this.rigBones, characters: Object.freeze([...this.characters.values()].filter(({ rig }) => rig !== null).map(({ id }) => id)), triangles: this.rigTriangles }),
      animationEvents: this.animationEventCount, width: this.width, height: this.height,
    });
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    for (const geometry of new Set(this.geometries)) geometry.dispose();
    for (const material of new Set(this.materials)) material.dispose();
    this.characters.clear();
    this.telegraphs.clear();
    this.renderer.dispose();
    this.scene.clear();
    this.ready = false;
  }
}

export function createRelicFrontierRenderer(canvas: HTMLCanvasElement, testMode = false): RelicFrontierRenderer {
  return new Renderer(canvas, testMode);
}
