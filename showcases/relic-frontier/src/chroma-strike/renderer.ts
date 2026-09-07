import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createVfxRuntime, type VfxInspection, type VfxRuntime } from "@three-game-kit/client/vfx";
import type { StrikeEvent, StrikeSnapshot } from "./state.js";

export type StrikeModelStatus = "loading" | "loaded" | "failed";

export interface StrikeModelInspection {
  readonly file: string;
  readonly status: StrikeModelStatus;
  readonly active: boolean;
  readonly fallbackVisible: boolean;
  readonly meshes: number;
  readonly instances: number;
}

export interface StrikeRendererInspection {
  readonly backend: "three-webgl";
  readonly disposed: boolean;
  readonly screenshotReady: boolean;
  readonly frames: number;
  readonly drawCalls: number;
  readonly meshes: number;
  readonly lights: number;
  readonly triangles: number;
  readonly width: number;
  readonly height: number;
  readonly weaponAsset: StrikeModelInspection;
  readonly enemyAsset: StrikeModelInspection;
}

export interface StrikeRenderer {
  readonly screenshotReady: boolean;
  prepare(snapshot: StrikeSnapshot, events: readonly StrikeEvent[]): void;
  render(timeMs: number): void;
  resize(width?: number, height?: number): void;
  inspect(): StrikeRendererInspection;
  inspectVfx(): VfxInspection;
  dispose(): void;
}

const PALETTE = Object.freeze({
  sky: 0x98dfe5,
  navy: 0x111a32,
  blue: 0x526dff,
  cyan: 0x51f0e3,
  pink: 0xff4f8b,
  orange: 0xffa84d,
  lime: 0xc7f36b,
  concrete: 0xd8d4c8,
  white: 0xf9fbff,
});

const WEAPON_MODEL_FILE = "chroma-pulse-rifle.gltf";
const ENEMY_MODEL_FILE = "chroma-combat-bot.gltf";

export function createStrikeRenderer(canvas: HTMLCanvasElement, testMode: boolean): StrikeRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(testMode ? 1 : Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.shadowMap.enabled = !testMode;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.sky, 28, 68);
  const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.08, 100);
  scene.add(camera);
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const geo = <T extends THREE.BufferGeometry>(value: T): T => { geometries.push(value); return value; };
  const mat = <T extends THREE.Material>(value: T): T => { materials.push(value); return value; };
  const vfx: VfxRuntime = createVfxRuntime(scene, { commandCapacity: 48, burstEffectCapacity: 8, trailEffectCapacity: 12, popupEffectCapacity: 4, maxBurstParticles: 28 });
  const enemyGroups = new Map<string, THREE.Group>();
  let snapshot: StrikeSnapshot | null = null;
  let disposed = false;
  let ready = false;
  let frames = 0;
  let width = 1280;
  let height = 720;
  let recoil = 0;
  let lastVfxTimeMs = 0;
  let weaponModelStatus: StrikeModelStatus = "loading";
  let enemyModelStatus: StrikeModelStatus = "loading";
  let weaponModelMeshes = 0;
  let enemyModelMeshes = 0;
  let enemyModelInstances = 0;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x667499, 2.7));
  const key = new THREE.DirectionalLight(0xfff0d5, 3.2);
  key.position.set(-12, 24, 14);
  key.castShadow = !testMode;
  scene.add(key);
  const colorLight = new THREE.PointLight(PALETTE.pink, 22, 28, 2);
  colorLight.position.set(13, 8, -11);
  scene.add(colorLight);

  const floorGeo = geo(new THREE.PlaneGeometry(42, 42));
  floorGeo.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(floorGeo, mat(new THREE.MeshStandardMaterial({ color: 0xe2e0d6, roughness: 0.88, metalness: 0.02 })));
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(42, 21, 0x6471a3, 0xb7b9b4);
  grid.position.y = 0.012;
  scene.add(grid);

  const wallGeo = geo(new THREE.BoxGeometry(2, 3.2, 2));
  const wallMat = mat(new THREE.MeshStandardMaterial({ color: PALETTE.navy, roughness: 0.62, metalness: 0.08, flatShading: true }));
  const walls = new THREE.InstancedMesh(wallGeo, wallMat, 72);
  const transform = new THREE.Object3D();
  let wallIndex = 0;
  for (let coordinate = -20; coordinate <= 20; coordinate += 2) {
    for (const [x, z] of [[coordinate, -20], [coordinate, 20], [-20, coordinate], [20, coordinate]] as const) {
      if (wallIndex >= 72) break;
      transform.position.set(x, 1.6 + ((wallIndex * 7) % 3) * 0.25, z);
      transform.rotation.set(0, wallIndex % 2 * Math.PI / 2, 0);
      transform.scale.set(1, 1 + (wallIndex % 4) * 0.1, 1);
      transform.updateMatrix();
      walls.setMatrixAt(wallIndex, transform.matrix);
      wallIndex += 1;
    }
  }
  walls.castShadow = !testMode;
  walls.receiveShadow = true;
  scene.add(walls);

  const coverGeo = geo(new THREE.BoxGeometry(3.4, 2.6, 3.4));
  const coverMaterials = [
    mat(new THREE.MeshStandardMaterial({ color: PALETTE.blue, roughness: 0.56, flatShading: true })),
    mat(new THREE.MeshStandardMaterial({ color: PALETTE.orange, roughness: 0.62, flatShading: true })),
    mat(new THREE.MeshStandardMaterial({ color: PALETTE.cyan, roughness: 0.54, flatShading: true })),
  ];
  for (const [index, x, z, scale] of [
    [0, -10, -4, 1], [1, 9, -3, 0.78], [2, -4, -12, 0.7], [3, 5, -13, 1.08],
    [4, -13, 9, 0.82], [5, 13, 10, 0.72], [6, 0, 2, 0.62], [7, -15, -14, 0.7], [8, 15, -15, 0.86],
  ] as const) {
    const block = new THREE.Mesh(coverGeo, coverMaterials[index % coverMaterials.length]);
    block.position.set(x, 1.3 * scale, z);
    block.scale.set(scale, scale, scale);
    block.rotation.y = index * 0.37;
    block.castShadow = !testMode;
    block.receiveShadow = true;
    scene.add(block);
  }

  const stripeGeo = geo(new THREE.BoxGeometry(7, 0.08, 1.1));
  for (const [index, x, z, color] of [[0, -9, 0, PALETTE.pink], [1, 10, 2, PALETTE.lime], [2, 0, -17, PALETTE.cyan]] as const) {
    const stripe = new THREE.Mesh(stripeGeo, mat(new THREE.MeshBasicMaterial({ color })));
    stripe.position.set(x, 0.06, z);
    stripe.rotation.y = index * Math.PI / 3;
    scene.add(stripe);
  }

  const botBodyGeo = geo(new THREE.BoxGeometry(1.25, 1.55, 0.9));
  const botHeadGeo = geo(new THREE.BoxGeometry(0.92, 0.72, 0.82));
  const visorGeo = geo(new THREE.BoxGeometry(0.7, 0.18, 0.05));
  const botMaterials = [PALETTE.pink, PALETTE.orange, PALETTE.blue, 0x9b63ff, 0x22c8b5].map((color) => mat(new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.18, flatShading: true })));
  const visorMaterial = mat(new THREE.MeshBasicMaterial({ color: PALETTE.white }));
  const enemyFallbacks = new Map<string, THREE.Group>();
  for (let index = 0; index < 5; index += 1) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(botBodyGeo, botMaterials[index]);
    body.position.y = 1.02;
    const head = new THREE.Mesh(botHeadGeo, botMaterials[index]);
    head.position.y = 2.05;
    const visor = new THREE.Mesh(visorGeo, visorMaterial);
    visor.position.set(0, 2.08, 0.435);
    body.castShadow = !testMode;
    head.castShadow = !testMode;
    const fallback = new THREE.Group();
    fallback.add(body, head, visor);
    group.add(fallback);
    enemyFallbacks.set(`bot-${index + 1}`, fallback);
    enemyGroups.set(`bot-${index + 1}`, group);
    scene.add(group);
  }

  const weapon = new THREE.Group();
  const gunDark = mat(new THREE.MeshStandardMaterial({ color: 0x151a2c, roughness: 0.32, metalness: 0.55 }));
  const gunSkin = mat(new THREE.MeshStandardMaterial({ color: PALETTE.pink, emissive: 0x441020, emissiveIntensity: 0.7, roughness: 0.3, metalness: 0.4 }));
  const gunGlow = mat(new THREE.MeshBasicMaterial({ color: PALETTE.cyan }));
  const receiver = new THREE.Mesh(geo(new THREE.BoxGeometry(0.52, 0.42, 1.25)), gunDark);
  const skin = new THREE.Mesh(geo(new THREE.BoxGeometry(0.56, 0.18, 0.76)), gunSkin);
  skin.position.set(0, 0.2, -0.14);
  const barrel = new THREE.Mesh(geo(new THREE.BoxGeometry(0.18, 0.18, 0.76)), gunDark);
  barrel.position.z = -0.96;
  const sight = new THREE.Mesh(geo(new THREE.BoxGeometry(0.1, 0.16, 0.32)), gunGlow);
  sight.position.set(0, 0.34, -0.38);
  const magazine = new THREE.Mesh(geo(new THREE.BoxGeometry(0.3, 0.62, 0.38)), gunDark);
  magazine.position.set(0, -0.43, 0.1);
  const weaponFallback = new THREE.Group();
  weaponFallback.add(receiver, skin, barrel, sight, magazine);
  weapon.add(weaponFallback);
  weapon.position.set(0.58, -0.52, -1.05);
  weapon.rotation.set(-0.05, -0.12, 0);
  camera.add(weapon);

  const loader = new GLTFLoader();

  function adoptLoadedScene(root: THREE.Object3D): number {
    let meshCount = 0;
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      meshCount += 1;
      object.castShadow = !testMode;
      geometries.push(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.push(material);
    });
    return meshCount;
  }

  function discardLoadedScene(root: THREE.Object3D): void {
    const resources = new Set<{ dispose(): void }>();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      resources.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) resources.add(material);
    });
    for (const resource of resources) resource.dispose();
  }

  loader.load(
    new URL("../../chroma-strike/assets/chroma-pulse-rifle.gltf", import.meta.url).href,
    (gltf) => {
      if (disposed) { discardLoadedScene(gltf.scene); return; }
      const meshCount = adoptLoadedScene(gltf.scene);
      if (meshCount === 0) { weaponModelStatus = "failed"; return; }
      gltf.scene.scale.setScalar(1.5);
      gltf.scene.position.set(0, -0.02, -0.12);
      weapon.add(gltf.scene);
      weaponFallback.visible = false;
      weaponModelMeshes = meshCount;
      weaponModelStatus = "loaded";
    },
    undefined,
    () => { weaponModelStatus = "failed"; },
  );

  loader.load(
    new URL("../../chroma-strike/assets/chroma-combat-bot.gltf", import.meta.url).href,
    (gltf) => {
      if (disposed) { discardLoadedScene(gltf.scene); return; }
      const meshCount = adoptLoadedScene(gltf.scene);
      if (meshCount === 0) { enemyModelStatus = "failed"; return; }
      gltf.scene.scale.setScalar(1.7);
      for (const [id, group] of enemyGroups) {
        group.add(gltf.scene.clone(true));
        const fallback = enemyFallbacks.get(id);
        if (fallback !== undefined) fallback.visible = false;
      }
      enemyModelInstances = enemyGroups.size;
      enemyModelMeshes = meshCount * enemyGroups.size;
      enemyModelStatus = "loaded";
    },
    undefined,
    () => { enemyModelStatus = "failed"; },
  );

  function prepare(next: StrikeSnapshot, events: readonly StrikeEvent[]): void {
    if (disposed) return;
    snapshot = next;
    camera.position.set(next.player.position.x, 1.66, next.player.position.z);
    camera.rotation.order = "YXZ";
    camera.rotation.set(next.player.pitch, -next.player.yaw, 0);
    for (const enemy of next.enemies) {
      const group = enemyGroups.get(enemy.id);
      if (group === undefined) continue;
      group.visible = enemy.alive;
      group.position.set(enemy.position.x, Math.sin(next.time * 4 + enemy.id.length) * 0.04, enemy.position.z);
      const dx = next.player.position.x - enemy.position.x;
      const dz = next.player.position.z - enemy.position.z;
      group.rotation.y = Math.atan2(dx, dz);
    }
    for (const event of events) {
      if (event.kind === "shot" && event.from !== undefined && event.to !== undefined) {
        recoil = 1;
        vfx.enqueue({ kind: "trail", start: event.from, end: event.to, color: PALETTE.cyan, width: 1, lifetimeMs: 95, seed: event.tick >>> 0 });
      }
      if ((event.kind === "hit" || event.kind === "enemy-defeated") && event.to !== undefined) {
        vfx.enqueue({ kind: "burst", position: event.to, count: event.kind === "enemy-defeated" ? 24 : 12, color: event.kind === "enemy-defeated" ? PALETTE.orange : PALETTE.pink, speed: 4.2, lifetimeMs: 430, seed: (event.tick * 2654435761) >>> 0 });
      }
    }
  }

  function render(timeMs: number): void {
    if (disposed) return;
    recoil *= 0.72;
    const move = snapshot === null ? 0 : Math.hypot(snapshot.player.position.x, snapshot.player.position.z);
    weapon.position.y = -0.52 + Math.sin((snapshot?.time ?? 0) * 9 + move * 0.1) * 0.012;
    weapon.position.z = -1.05 + recoil * 0.11;
    lastVfxTimeMs = Math.max(lastVfxTimeMs, timeMs);
    vfx.present(lastVfxTimeMs);
    renderer.render(scene, camera);
    frames += 1;
    ready = true;
  }

  function resize(nextWidth = innerWidth, nextHeight = innerHeight): void {
    if (disposed) return;
    width = Math.max(1, Math.floor(nextWidth));
    height = Math.max(1, Math.floor(nextHeight));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  resize();
  return Object.freeze({
    get screenshotReady() { return ready && !disposed; },
    prepare,
    render,
    resize,
    inspect(): StrikeRendererInspection {
      let meshes = 0, lights = 0, triangles = 0;
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          meshes += 1;
          triangles += object.geometry.index === null ? Math.floor((object.geometry.attributes.position?.count ?? 0) / 3) : Math.floor(object.geometry.index.count / 3);
        }
        if (object instanceof THREE.Light) lights += 1;
      });
      const enemyFallbackVisible = [...enemyFallbacks.values()].some((fallback) => fallback.visible);
      return Object.freeze({
        backend: "three-webgl", disposed, screenshotReady: ready && !disposed, frames, drawCalls: renderer.info.render.calls, meshes, lights, triangles, width, height,
        weaponAsset: Object.freeze({ file: WEAPON_MODEL_FILE, status: weaponModelStatus, active: weaponModelStatus === "loaded" && !weaponFallback.visible, fallbackVisible: weaponFallback.visible, meshes: weaponModelMeshes, instances: weaponModelStatus === "loaded" ? 1 : 0 }),
        enemyAsset: Object.freeze({ file: ENEMY_MODEL_FILE, status: enemyModelStatus, active: enemyModelStatus === "loaded" && !enemyFallbackVisible, fallbackVisible: enemyFallbackVisible, meshes: enemyModelMeshes, instances: enemyModelInstances }),
      });
    },
    inspectVfx(): VfxInspection { return vfx.inspect(); },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      vfx.dispose();
      for (const geometry of new Set(geometries)) geometry.dispose();
      for (const material of new Set(materials)) material.dispose();
      renderer.dispose();
      scene.clear();
    },
  });
}
