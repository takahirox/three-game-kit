/// <reference lib="dom" />
import * as THREE from "three";
import type {
  RenderingFeatureAdapter,
  RendererCameraTransform,
} from "@three-game-kit/client/rendering";
import {
  createVfxRuntime,
  type VfxRuntime,
} from "@three-game-kit/client/vfx";
import { CORE_PLACEMENTS } from "./features/cores.js";
import { BASE_POSITION, BASE_RADIUS } from "./features/deposit.js";
import { HAZARD_MAX, HAZARD_MIN } from "./features/hazard.js";
import { JUMP_PAD_POSITION, JUMP_PAD_RADIUS } from "./features/jump-pad.js";
import {
  PLATFORM_CENTER,
  PLATFORM_HALF_DEPTH,
  PLATFORM_HALF_WIDTH,
} from "./features/moving-platform.js";
import type {
  CoreKind,
  CoreRunSnapshot,
  TelemetryEvent,
  Vec3,
} from "./state.js";

/*
 * Core Run Three.js renderer: a real WebGL third-person neon arena view.
 *
 * - Meshes and lights are built once; render() only syncs transforms,
 *   visibility, and materials from the snapshot.
 * - All motion derives from `snapshot.time`; no wall clocks are consulted.
 * - Core Run telemetry is mapped to the public deterministic VFX runtime.
 * - The renderer owns no DOM listeners; the host calls `resize()`.
 */

export const RENDER_WIDTH = 960;
export const RENDER_HEIGHT = 540;
export const MAX_DEVICE_PIXEL_RATIO = 2;
export const PARTICLE_CAPACITY = 256;
export const POPUP_CAPACITY = 16;
export const TRAIL_CAPACITY = 24;
export const ARENA_HALF_EXTENT = 18;

export interface RendererCounters {
  readonly frames: number;
  readonly drawCalls: number;
  readonly activeParticles: number;
  readonly activePopups: number;
  readonly eventsConsumed: number;
}

/** Structural probe: proves the WebGL backend is live and released. */
export interface CoreRunRendererInspection {
  readonly backend: "three-webgl";
  readonly webglRenderer: boolean;
  readonly scene: boolean;
  readonly camera: boolean;
  readonly cameraType: "PerspectiveCamera";
  readonly sceneObjectCount: number;
  readonly meshCount: number;
  readonly lightCount: number;
  readonly width: number;
  readonly height: number;
  readonly disposed: boolean;
  readonly cameraTransform: RendererCameraTransform;
}

export interface CoreRunRenderer extends RenderingFeatureAdapter {
  /** Public VFX runtime attached to this renderer's scene. */
  readonly vfx: VfxRuntime;
  prepareFrame(
    snapshot: CoreRunSnapshot,
    events: readonly TelemetryEvent[],
    debugCamera: boolean,
  ): void;
  setCameraTransform(transform: RendererCameraTransform): void;
  resize(width?: number, height?: number): void;
  readonly disposed: boolean;
  /** True once at least one full frame has been drawn. */
  readonly screenshotReady: boolean;
  counters(): RendererCounters;
  inspect(): CoreRunRendererInspection;
}

export interface CoreRunRendererOptions {
  /** Override the host pixel ratio (tests / headless). Capped at 2. */
  readonly devicePixelRatio?: number;
}

/* ----------------------------- deterministic PRNG ----------------------------- */

/** 32-bit FNV-1a style mix of integers into a seed. */
export function hashSeed(...values: readonly number[]): number {
  let h = 0x811c9dc5;
  for (const value of values) {
    const v = Math.trunc(Number.isFinite(value) ? value * 1000 : 0) | 0;
    h ^= v & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 16) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 24) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/* --------------------------------- palette --------------------------------- */

const CORE_COLORS: Readonly<Record<CoreKind, number>> = Object.freeze({
  blue: 0x4cc9ff,
  gold: 0xffd166,
  red: 0xff4d6d,
});
const COLOR_CYAN = 0x38f0ff;
const COLOR_MAGENTA = 0xff3df5;
const COLOR_PLAYER = 0x9dff57;
const COLOR_NIGHT = 0x05020f;

const DEBUG_DISTANCE = 34;
const DEBUG_HEIGHT = 30;
const PYLON_HEIGHT = 6;
const PARTICLE_LIFE_MS = 800;
const POPUP_LIFE_MS = 1_100;
const TRAIL_LIFE_MS = 350;

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clampRatio(value: number): number {
  return Math.max(1, Math.min(MAX_DEVICE_PIXEL_RATIO, value));
}

/* ---------------------------------- renderer --------------------------------- */

class ThreeCoreRunRenderer implements CoreRunRenderer {
  readonly vfx: VfxRuntime;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private snapshot: CoreRunSnapshot | null = null;
  private debugCamera = false;
  private cameraTransform: RendererCameraTransform = Object.freeze({
    position: Object.freeze({ x: 0, y: 9.2, z: 13 }),
    lookAt: Object.freeze({ x: 0, y: 1.2, z: 0 }),
  });
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly coreMeshes: THREE.Mesh[] = [];
  private readonly coreMaterials: Readonly<
    Record<CoreKind, THREE.MeshStandardMaterial>
  >;
  private readonly playerGroup: THREE.Group;
  private readonly playerMaterial: THREE.MeshToonMaterial;
  private readonly carriedMesh: THREE.Mesh;
  private readonly carriedMaterial: THREE.MeshStandardMaterial;
  private readonly baseMaterial: THREE.MeshStandardMaterial;
  private readonly jumpPadRing: THREE.Mesh;
  private readonly jumpPadMaterial: THREE.MeshStandardMaterial;
  private readonly platformMesh: THREE.Mesh;
  private readonly platformMaterial: THREE.MeshStandardMaterial;
  private readonly hazardMaterial: THREE.MeshStandardMaterial;
  private readonly sweepLine: THREE.LineSegments;
  private readonly focus = new THREE.Vector3();
  private readonly pixelRatioOverride: number | null;
  private lastTrailTime = -1;
  private lastTrailPosition: Vec3 | null = null;
  private frames = 0;
  private drawCalls = 0;
  private eventsConsumed = 0;
  private isDisposed = false;
  private ready = false;
  private width = RENDER_WIDTH;
  private height = RENDER_HEIGHT;

  constructor(canvas: HTMLCanvasElement, options: CoreRunRendererOptions) {
    this.pixelRatioOverride =
      options.devicePixelRatio !== undefined &&
      Number.isFinite(options.devicePixelRatio)
        ? options.devicePixelRatio
        : null;
    const geo = <T extends THREE.BufferGeometry>(geometry: T): T => {
      this.geometries.push(geometry);
      return geometry;
    };
    const mat = <T extends THREE.Material>(material: T): T => {
      this.materials.push(material);
      return material;
    };

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setClearColor(COLOR_NIGHT, 1);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLOR_NIGHT);
    this.scene.fog = new THREE.Fog(0x140a33, 36, 120);
    this.camera = new THREE.PerspectiveCamera(
      58,
      RENDER_WIDTH / RENDER_HEIGHT,
      0.1,
      260,
    );
    this.vfx = createVfxRuntime(this.scene, {
      commandCapacity: 64,
      burstEffectCapacity: 8,
      trailEffectCapacity: TRAIL_CAPACITY,
      popupEffectCapacity: POPUP_CAPACITY,
      maxBurstParticles: 64,
    });

    this.scene.add(new THREE.AmbientLight(0x3b2f6b, 1.1));
    const hemisphere = new THREE.HemisphereLight(
      COLOR_CYAN,
      COLOR_MAGENTA,
      0.85,
    );
    hemisphere.position.set(0, 24, 0);
    this.scene.add(hemisphere);
    const key = new THREE.DirectionalLight(0xfff0ff, 1.35);
    key.position.set(14, 26, 12);
    this.scene.add(key);

    const extent = ARENA_HALF_EXTENT;
    const floorGeometry = geo(new THREE.PlaneGeometry(extent * 2, extent * 2));
    floorGeometry.rotateX(-Math.PI / 2);
    const floorMaterial = mat(
      new THREE.MeshStandardMaterial({
        color: 0x140c32,
        emissive: 0x0b0725,
        roughness: 0.9,
        metalness: 0.15,
      }),
    );
    this.scene.add(new THREE.Mesh(floorGeometry, floorMaterial));

    const gridPoints: number[] = [];
    for (let i = -extent; i <= extent; i += 2) {
      gridPoints.push(i, 0.01, -extent, i, 0.01, extent);
      gridPoints.push(-extent, 0.01, i, extent, 0.01, i);
    }
    const gridGeometry = geo(new THREE.BufferGeometry());
    gridGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(gridPoints, 3),
    );
    this.scene.add(
      new THREE.LineSegments(
        gridGeometry,
        mat(
          new THREE.LineBasicMaterial({
            color: COLOR_CYAN,
            transparent: true,
            opacity: 0.16,
          }),
        ),
      ),
    );

    const boundaryGeometry = geo(new THREE.BufferGeometry());
    boundaryGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [
          -extent, 0.04, -extent, extent, 0.04, -extent, extent, 0.04, extent,
          -extent, 0.04, extent,
        ],
        3,
      ),
    );
    this.scene.add(
      new THREE.LineLoop(
        boundaryGeometry,
        mat(
          new THREE.LineBasicMaterial({
            color: COLOR_CYAN,
            transparent: true,
            opacity: 0.55,
          }),
        ),
      ),
    );

    const sweepGeometry = geo(new THREE.BufferGeometry());
    sweepGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([-extent, 0.05, 0, extent, 0.05, 0], 3),
    );
    this.sweepLine = new THREE.LineSegments(
      sweepGeometry,
      mat(
        new THREE.LineBasicMaterial({
          color: COLOR_CYAN,
          transparent: true,
          opacity: 0.4,
        }),
      ),
    );
    this.scene.add(this.sweepLine);

    const landmarks: readonly Vec3[] = [
      JUMP_PAD_POSITION,
      PLATFORM_CENTER,
      { x: -4, y: 0, z: -4 },
    ];
    const routePoints: number[] = [];
    for (const target of landmarks) {
      routePoints.push(
        BASE_POSITION.x,
        0.06,
        BASE_POSITION.z,
        target.x,
        target.y + 0.06,
        target.z,
      );
    }
    const routeGeometry = geo(new THREE.BufferGeometry());
    routeGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(routePoints, 3),
    );
    this.scene.add(
      new THREE.LineSegments(
        routeGeometry,
        mat(
          new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.14,
          }),
        ),
      ),
    );

    const pylonGeometry = geo(
      new THREE.CylinderGeometry(0.12, 0.3, PYLON_HEIGHT, 8),
    );
    const pylonMaterial = mat(
      new THREE.MeshStandardMaterial({
        color: 0x0d1b3a,
        emissive: COLOR_CYAN,
        emissiveIntensity: 0.7,
        roughness: 0.4,
      }),
    );
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const pylon = new THREE.Mesh(pylonGeometry, pylonMaterial);
        pylon.position.set(sx * extent, PYLON_HEIGHT / 2, sz * extent);
        this.scene.add(pylon);
      }
    }

    this.baseMaterial = mat(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: COLOR_CYAN,
        emissiveIntensity: 0.35,
        roughness: 0.25,
        metalness: 0.4,
      }),
    );
    const basePad = new THREE.Mesh(
      geo(new THREE.CylinderGeometry(BASE_RADIUS, BASE_RADIUS * 1.05, 0.2, 48)),
      this.baseMaterial,
    );
    basePad.position.set(BASE_POSITION.x, 0.1, BASE_POSITION.z);
    this.scene.add(basePad);
    const beacon = new THREE.Mesh(
      geo(new THREE.CylinderGeometry(0.1, 0.16, 3.6, 12)),
      this.baseMaterial,
    );
    beacon.position.set(BASE_POSITION.x, 1.8, BASE_POSITION.z);
    this.scene.add(beacon);

    this.jumpPadMaterial = mat(
      new THREE.MeshStandardMaterial({
        color: 0x082733,
        emissive: COLOR_CYAN,
        emissiveIntensity: 0.8,
        roughness: 0.3,
      }),
    );
    const pad = new THREE.Mesh(
      geo(
        new THREE.CylinderGeometry(
          JUMP_PAD_RADIUS,
          JUMP_PAD_RADIUS * 0.8,
          0.3,
          32,
        ),
      ),
      this.jumpPadMaterial,
    );
    pad.position.set(JUMP_PAD_POSITION.x, 0.15, JUMP_PAD_POSITION.z);
    this.scene.add(pad);
    const ringGeometry = geo(
      new THREE.TorusGeometry(JUMP_PAD_RADIUS, 0.06, 8, 32),
    );
    ringGeometry.rotateX(-Math.PI / 2);
    this.jumpPadRing = new THREE.Mesh(ringGeometry, this.jumpPadMaterial);
    this.jumpPadRing.position.set(
      JUMP_PAD_POSITION.x,
      0.35,
      JUMP_PAD_POSITION.z,
    );
    this.scene.add(this.jumpPadRing);

    this.hazardMaterial = mat(
      new THREE.MeshStandardMaterial({
        color: COLOR_MAGENTA,
        emissive: COLOR_MAGENTA,
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      }),
    );
    const hazard = new THREE.Mesh(
      geo(
        new THREE.BoxGeometry(
          HAZARD_MAX.x - HAZARD_MIN.x,
          HAZARD_MAX.y - HAZARD_MIN.y,
          HAZARD_MAX.z - HAZARD_MIN.z,
        ),
      ),
      this.hazardMaterial,
    );
    hazard.position.set(
      (HAZARD_MIN.x + HAZARD_MAX.x) / 2,
      (HAZARD_MIN.y + HAZARD_MAX.y) / 2,
      (HAZARD_MIN.z + HAZARD_MAX.z) / 2,
    );
    this.scene.add(hazard);

    this.platformMaterial = mat(
      new THREE.MeshStandardMaterial({
        color: 0x0f2b45,
        emissive: COLOR_CYAN,
        emissiveIntensity: 0.3,
        roughness: 0.35,
        metalness: 0.3,
      }),
    );
    this.platformMesh = new THREE.Mesh(
      geo(
        new THREE.BoxGeometry(
          PLATFORM_HALF_WIDTH * 2,
          0.4,
          PLATFORM_HALF_DEPTH * 2,
        ),
      ),
      this.platformMaterial,
    );
    this.scene.add(this.platformMesh);

    const coreGeometry = geo(new THREE.IcosahedronGeometry(0.45, 0));
    const coreMaterial = (color: number): THREE.MeshStandardMaterial =>
      mat(
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.9,
          roughness: 0.2,
          metalness: 0.1,
        }),
      );
    this.coreMaterials = Object.freeze({
      blue: coreMaterial(CORE_COLORS.blue),
      gold: coreMaterial(CORE_COLORS.gold),
      red: coreMaterial(CORE_COLORS.red),
    });
    for (const placement of CORE_PLACEMENTS) {
      const core = new THREE.Mesh(
        coreGeometry,
        this.coreMaterials[placement.kind],
      );
      core.position.set(
        placement.position.x,
        placement.position.y + 0.7,
        placement.position.z,
      );
      this.coreMeshes.push(core);
      this.scene.add(core);
    }

    this.playerMaterial = mat(
      new THREE.MeshToonMaterial({
        color: COLOR_PLAYER,
        emissive: COLOR_PLAYER,
        emissiveIntensity: 0.35,
      }),
    );
    const bodyGeometry = geo(new THREE.ConeGeometry(0.55, 1.4, 12));
    bodyGeometry.rotateX(Math.PI / 2);
    const body = new THREE.Mesh(bodyGeometry, this.playerMaterial);
    body.position.set(0, 0.5, 0);
    const head = new THREE.Mesh(
      geo(new THREE.SphereGeometry(0.3, 16, 12)),
      mat(
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: 0xffffff,
          emissiveIntensity: 0.5,
        }),
      ),
    );
    head.position.set(0, 1.2, 0);
    this.carriedMaterial = mat(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 1,
      }),
    );
    this.carriedMesh = new THREE.Mesh(
      geo(new THREE.OctahedronGeometry(0.35, 0)),
      this.carriedMaterial,
    );
    this.carriedMesh.position.set(0, 1.9, 0);
    this.carriedMesh.visible = false;
    this.playerGroup = new THREE.Group();
    this.playerGroup.add(body, head, this.carriedMesh);
    this.scene.add(this.playerGroup);

    this.resize();
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  get screenshotReady(): boolean {
    return this.ready && !this.isDisposed;
  }

  counters(): RendererCounters {
    const vfx = this.vfx.inspect();
    return Object.freeze({
      frames: this.frames,
      drawCalls: this.drawCalls,
      activeParticles: vfx.activeBurstCount,
      activePopups: vfx.activePopupCount,
      eventsConsumed: this.eventsConsumed,
    });
  }

  inspect(): CoreRunRendererInspection {
    let sceneObjectCount = 0;
    let meshCount = 0;
    let lightCount = 0;
    this.scene.traverse((object) => {
      if (object === this.scene) return;
      sceneObjectCount += 1;
      if (object instanceof THREE.Mesh) meshCount += 1;
      if (object instanceof THREE.Light) lightCount += 1;
    });
    return Object.freeze({
      backend: "three-webgl" as const,
      webglRenderer: !this.isDisposed,
      scene: !this.isDisposed,
      camera: !this.isDisposed,
      cameraType: "PerspectiveCamera" as const,
      sceneObjectCount,
      meshCount,
      lightCount,
      width: this.width,
      height: this.height,
      disposed: this.isDisposed,
      cameraTransform: Object.freeze({
        position: Object.freeze({ ...this.cameraTransform.position }),
        lookAt: Object.freeze({ ...this.cameraTransform.lookAt }),
      }),
    });
  }

  setCameraTransform(transform: RendererCameraTransform): void {
    if (this.isDisposed) return;
    this.cameraTransform = Object.freeze({
      position: Object.freeze({ ...transform.position }),
      lookAt: Object.freeze({ ...transform.lookAt }),
    });
  }

  resize(width = RENDER_WIDTH, height = RENDER_HEIGHT): void {
    if (this.isDisposed) return;
    const hostRatio =
      this.pixelRatioOverride ??
      (typeof globalThis.devicePixelRatio === "number"
        ? globalThis.devicePixelRatio
        : 1);
    this.width = Math.max(1, Math.round(finite(width, RENDER_WIDTH)));
    this.height = Math.max(1, Math.round(finite(height, RENDER_HEIGHT)));
    this.renderer.setPixelRatio(clampRatio(finite(hostRatio, 1)));
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.scene.clear();
    for (const geometry of this.geometries) geometry.dispose();
    this.geometries.length = 0;
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
    this.renderer.dispose();
  }

  prepareFrame(
    snapshot: CoreRunSnapshot,
    events: readonly TelemetryEvent[],
    debugCamera: boolean,
  ): void {
    if (this.isDisposed) return;
    this.snapshot = snapshot;
    this.debugCamera = debugCamera;
    this.enqueueEvents(snapshot, events);
    this.enqueueTrail(snapshot);
  }

  render(): void {
    if (this.isDisposed) return;
    const snapshot = this.snapshot;
    if (snapshot === null) return;
    const time = finite(snapshot.time, 0);
    this.syncCamera(this.cameraTransform, this.debugCamera);
    this.syncWorld(snapshot, time);
    this.renderer.render(this.scene, this.camera);
    this.drawCalls = this.renderer.info.render.calls;
    this.frames += 1;
    this.ready = true;
  }

  /* -------------------------------- events -------------------------------- */

  private enqueueEvents(
    snapshot: CoreRunSnapshot,
    events: readonly TelemetryEvent[],
  ): void {
    const p = snapshot.player.position;
    for (const event of events) {
      this.eventsConsumed += 1;
      switch (event.kind) {
        case "corePickedUp": {
          const at = snapshot.cores[event.coreId]?.position ?? p;
          const color = CORE_COLORS[event.coreKind];
          this.enqueueBurst(hashSeed(event.tick, 1, event.coreId), at, 18, color, 3);
          this.enqueuePopup(hashSeed(event.tick, 11, event.coreId), at, color);
          break;
        }
        case "coreDeposited": {
          this.enqueueBurst(
            hashSeed(event.tick, 2, event.coreId),
            BASE_POSITION,
            36,
            COLOR_CYAN,
            4.5,
          );
          this.enqueuePopup(hashSeed(event.tick, 12, event.coreId), BASE_POSITION, 0xffffff);
          break;
        }
        case "dash":
          this.enqueueBurst(hashSeed(event.tick, 3), p, 12, COLOR_PLAYER, 2.5);
          break;
        case "jumpPad":
          this.enqueueBurst(
            hashSeed(event.tick, 4),
            JUMP_PAD_POSITION,
            24,
            COLOR_CYAN,
            8,
          );
          this.enqueuePopup(hashSeed(event.tick, 14), JUMP_PAD_POSITION, COLOR_CYAN);
          break;
        case "hazardEntered":
          this.enqueueBurst(hashSeed(event.tick, 5), p, 10, COLOR_MAGENTA, 1.5);
          this.enqueuePopup(hashSeed(event.tick, 15), p, COLOR_MAGENTA);
          break;
        default:
          break;
      }
    }
  }

  private enqueueBurst(
    seed: number,
    at: Vec3,
    count: number,
    color: number,
    speed: number,
  ): void {
    this.vfx.enqueue({
      kind: "burst",
      position: { x: at.x, y: at.y + 0.4, z: at.z },
      count: Math.min(count, PARTICLE_CAPACITY),
      color,
      speed,
      lifetimeMs: PARTICLE_LIFE_MS,
      seed,
    });
  }

  private enqueuePopup(seed: number, at: Vec3, color: number): void {
    this.vfx.enqueue({
      kind: "popup",
      position: { x: at.x, y: at.y + 1.2, z: at.z },
      color,
      size: 1.1,
      lifetimeMs: POPUP_LIFE_MS,
      seed,
    });
  }

  private enqueueTrail(snapshot: CoreRunSnapshot): void {
    const time = finite(snapshot.time, 0);
    const player = snapshot.player;
    const moving = Math.hypot(player.velocity.x, player.velocity.z) > 0.5;
    const current = Object.freeze({ ...player.position });
    if (!moving || time === this.lastTrailTime) {
      this.lastTrailPosition = current;
      return;
    }
    const previous = this.lastTrailPosition ?? current;
    this.lastTrailTime = time;
    this.lastTrailPosition = current;
    this.vfx.enqueue({
      kind: "trail",
      start: { x: previous.x, y: previous.y + 0.6, z: previous.z },
      end: { x: current.x, y: current.y + 0.6, z: current.z },
      color: COLOR_PLAYER,
      width: 1,
      lifetimeMs: TRAIL_LIFE_MS,
      seed: hashSeed(snapshot.tick, 6),
    });
  }

  /* ----------------------------- scene sync ------------------------------ */

  private syncCamera(
    transform: RendererCameraTransform,
    debug: boolean,
  ): void {
    if (debug) {
      this.focus.set(0, 0, 0);
      this.camera.position.set(0, DEBUG_HEIGHT, DEBUG_DISTANCE);
    } else {
      this.focus.set(transform.lookAt.x, transform.lookAt.y, transform.lookAt.z);
      this.camera.position.set(
        transform.position.x,
        transform.position.y,
        transform.position.z,
      );
    }
    this.camera.lookAt(this.focus);
  }

  private syncWorld(snapshot: CoreRunSnapshot, time: number): void {
    const extent = ARENA_HALF_EXTENT;
    this.sweepLine.position.z = -extent + ((time * 2) % (extent * 2));
    this.hazardMaterial.opacity = 0.18 + 0.1 * Math.sin(time * 5);
    this.jumpPadMaterial.emissiveIntensity = 0.6 + 0.3 * Math.sin(time * 4);
    const ring = 1 + ((time * 1.5) % 1);
    this.jumpPadRing.scale.set(ring, 1, ring);
    this.baseMaterial.emissiveIntensity =
      snapshot.carry.coreId === null
        ? 0.35
        : 0.6 + 0.25 * Math.sin(time * 6);
    const platform = snapshot.platform.position;
    this.platformMesh.position.set(platform.x, platform.y, platform.z);
    this.platformMaterial.emissiveIntensity = 0.3 + 0.1 * Math.sin(time * 3);
    for (const [index, mesh] of this.coreMeshes.entries()) {
      const core = snapshot.cores[index];
      mesh.visible = core !== undefined && !core.collected;
      if (core === undefined) continue;
      mesh.scale.setScalar(0.7 + core.value * 0.12);
      mesh.position.set(
        core.position.x,
        core.position.y + 0.7 + 0.2 * Math.sin(time * 3 + core.id),
        core.position.z,
      );
      mesh.rotation.set(time * 0.8, time * 1.3 + core.id, 0);
    }
    const player = snapshot.player;
    this.playerGroup.position.set(
      player.position.x,
      player.position.y,
      player.position.z,
    );
    this.playerGroup.rotation.y = Math.atan2(
      player.facing.x,
      player.facing.z,
    );
    this.playerMaterial.color.setHex(
      player.inHazard ? 0xffb3f7 : COLOR_PLAYER,
    );
    this.playerMaterial.emissive.setHex(
      player.inHazard ? COLOR_MAGENTA : COLOR_PLAYER,
    );
    this.playerMaterial.emissiveIntensity = player.dashTicks > 0 ? 1.1 : 0.35;
    const carryId = snapshot.carry.coreId;
    const carried = carryId === null ? undefined : snapshot.cores[carryId];
    this.carriedMesh.visible = carried !== undefined;
    if (carried !== undefined) {
      this.carriedMesh.position.y = 1.9 + 0.15 * Math.sin(time * 5);
      this.carriedMesh.rotation.y = time * 2;
      this.carriedMaterial.color.setHex(CORE_COLORS[carried.kind]);
      this.carriedMaterial.emissive.setHex(CORE_COLORS[carried.kind]);
    }
  }

}

/** Creates a Three.js WebGL renderer bound to the Core Run canvas. */
export function createCoreRunRenderer(
  canvas: HTMLCanvasElement,
  options: CoreRunRendererOptions = {},
): CoreRunRenderer {
  return new ThreeCoreRunRenderer(canvas, options);
}
