import * as THREE from "three";
import {
  defineFeatureConfiguration,
  type ClientFeatureDescriptor,
  type ClientFeatureSetupContext,
} from "@three-game-kit/core";
import {
  __internalResolveGltfAvatarScene,
  type GltfAvatarAsset,
} from "./assets.js";

export interface RendererVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface RendererCameraTransform {
  readonly position: RendererVector3;
  readonly lookAt: RendererVector3;
}

export interface RenderingSnapshot {
  readonly avatarPosition: RendererVector3;
  readonly cameraTransform: RendererCameraTransform;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly renderCount: number;
}

export interface RenderingFeatureAdapter {
  render(): void;
  dispose(): void;
}

export interface ClientRendererAdapter extends RenderingFeatureAdapter {
  attachAvatarAsset(asset: GltfAvatarAsset): void;
  setAvatarPosition(position: RendererVector3): void;
  setCameraTransform(transform: RendererCameraTransform): void;
  resize(width: number, height: number, pixelRatio: number): void;
  snapshot(): RenderingSnapshot;
}

export class RendererDisposedError extends Error {
  readonly code = "renderer-disposed";

  constructor() {
    super("Renderer has been disposed");
    this.name = "RendererDisposedError";
  }
}

function hasExactlyKeys(value: object, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => keys.includes(key))
  );
}

function copyFiniteVector(
  value: RendererVector3,
  label: string,
): RendererVector3 {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !hasExactlyKeys(value, ["x", "y", "z"])
  ) {
    throw new TypeError(`${label} must contain exactly x, y, and z`);
  }

  const x = value.x;
  const y = value.y;
  const z = value.z;
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    typeof y !== "number" ||
    !Number.isFinite(y) ||
    typeof z !== "number" ||
    !Number.isFinite(z)
  ) {
    throw new TypeError(`${label} components must be finite numbers`);
  }

  return Object.freeze({ x, y, z });
}

function copyCameraTransform(
  value: RendererCameraTransform,
): RendererCameraTransform {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !hasExactlyKeys(value, ["position", "lookAt"])
  ) {
    throw new TypeError(
      "Camera transform must contain exactly position and lookAt",
    );
  }

  return Object.freeze({
    position: copyFiniteVector(value.position, "Camera position"),
    lookAt: copyFiniteVector(value.lookAt, "Camera lookAt"),
  });
}

function requirePositiveFinite(value: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive finite number`);
  }
  return value;
}

function requireCanvasLike(canvas: unknown): object {
  if (
    typeof canvas !== "object" ||
    canvas === null ||
    Array.isArray(canvas) ||
    typeof Reflect.get(canvas, "getContext") !== "function"
  ) {
    throw new TypeError("Renderer canvas must be a canvas-like object");
  }
  return canvas;
}

function readInitialDimension(
  canvas: object,
  property: "width" | "height",
): number {
  const value = Reflect.get(canvas, property);
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 1;
}

function throwDisposed(): never {
  throw new RendererDisposedError();
}

export function createThreeRenderer(
  canvas: unknown,
  options?: Readonly<{ readonly antialias?: boolean }>,
): ClientRendererAdapter {
  const canvasLike = requireCanvasLike(canvas);
  if (
    options !== undefined &&
    (typeof options !== "object" ||
      options === null ||
      Array.isArray(options) ||
      (!hasExactlyKeys(options, []) &&
        !hasExactlyKeys(options, ["antialias"])))
  ) {
    throw new TypeError("Renderer options are invalid");
  }
  const antialias = options?.antialias ?? true;
  if (typeof antialias !== "boolean") {
    throw new TypeError("Renderer antialias option must be boolean");
  }

  const renderer = new THREE.WebGLRenderer({
    canvas: canvasLike as never,
    antialias,
  });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x16202a);

  const initialWidth = readInitialDimension(canvasLike, "width");
  const initialHeight = readInitialDimension(canvasLike, "height");
  const camera = new THREE.PerspectiveCamera(
    60,
    initialWidth / initialHeight,
    0.1,
    100,
  );
  const initialCameraTransform = copyCameraTransform({
    position: { x: 4, y: 3, z: 6 },
    lookAt: { x: 0, y: 1, z: 0 },
  });
  camera.position.set(
    initialCameraTransform.position.x,
    initialCameraTransform.position.y,
    initialCameraTransform.position.z,
  );
  camera.lookAt(
    initialCameraTransform.lookAt.x,
    initialCameraTransform.lookAt.y,
    initialCameraTransform.lookAt.z,
  );

  const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 2.4);
  directionalLight.position.set(4, 8, 5);
  scene.add(ambientLight, directionalLight);

  const floorGeometry = new THREE.PlaneGeometry(20, 20);
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x627d5a });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const obstacleGeometry = new THREE.BoxGeometry(2, 2, 2);
  const obstacleMaterial = new THREE.MeshStandardMaterial({ color: 0x9a6b45 });
  const obstacle = new THREE.Mesh(obstacleGeometry, obstacleMaterial);
  obstacle.position.set(0, 1, -3);
  scene.add(obstacle);

  const avatarGeometry = new THREE.CapsuleGeometry(0.5, 1, 8, 16);
  const avatarMaterial = new THREE.MeshStandardMaterial({ color: 0x48a9e6 });
  const avatarPlaceholder = new THREE.Mesh(avatarGeometry, avatarMaterial);
  const avatarRoot = new THREE.Group();
  let avatarPosition = copyFiniteVector(
    { x: 0, y: 1, z: 0 },
    "Avatar position",
  );
  avatarRoot.position.set(avatarPosition.x, avatarPosition.y, avatarPosition.z);
  avatarRoot.add(avatarPlaceholder);
  scene.add(avatarRoot);
  let loadedAvatarScene: THREE.Object3D | undefined;

  let cameraTransform = initialCameraTransform;
  let width = initialWidth;
  let height = initialHeight;
  let pixelRatio = 1;
  let renderCount = 0;
  let disposed = false;

  function requireActive(): void {
    if (disposed) throwDisposed();
  }

  return Object.freeze({
    setAvatarPosition(position: RendererVector3): void {
      requireActive();
      const copied = copyFiniteVector(position, "Avatar position");
      avatarRoot.position.set(copied.x, copied.y, copied.z);
      avatarPosition = copied;
    },
    attachAvatarAsset(asset: GltfAvatarAsset): void {
      requireActive();
      if (asset.disposed) {
        throw new TypeError("Cannot attach a disposed GLTF avatar asset");
      }
      const resolvedScene = __internalResolveGltfAvatarScene(asset);
      if (!(resolvedScene instanceof THREE.Object3D)) {
        throw new TypeError("GLTF avatar asset scene is unavailable");
      }

      if (loadedAvatarScene !== undefined) {
        avatarRoot.remove(loadedAvatarScene);
      }
      avatarRoot.remove(avatarPlaceholder);
      avatarRoot.add(resolvedScene);
      loadedAvatarScene = resolvedScene;
    },
    setCameraTransform(transform: RendererCameraTransform): void {
      requireActive();
      const copied = copyCameraTransform(transform);
      camera.position.set(
        copied.position.x,
        copied.position.y,
        copied.position.z,
      );
      camera.lookAt(copied.lookAt.x, copied.lookAt.y, copied.lookAt.z);
      cameraTransform = copied;
    },
    resize(
      nextWidth: number,
      nextHeight: number,
      nextPixelRatio: number,
    ): void {
      requireActive();
      const copiedWidth = requirePositiveFinite(nextWidth, "Renderer width");
      const copiedHeight = requirePositiveFinite(nextHeight, "Renderer height");
      const copiedPixelRatio = requirePositiveFinite(
        nextPixelRatio,
        "Renderer pixel ratio",
      );

      renderer.setPixelRatio(copiedPixelRatio);
      renderer.setSize(copiedWidth, copiedHeight, false);
      camera.aspect = copiedWidth / copiedHeight;
      camera.updateProjectionMatrix();
      width = copiedWidth;
      height = copiedHeight;
      pixelRatio = copiedPixelRatio;
    },
    render(): void {
      requireActive();
      renderer.render(scene, camera);
      renderCount += 1;
    },
    snapshot(): RenderingSnapshot {
      requireActive();
      return Object.freeze({
        avatarPosition: copyFiniteVector(avatarPosition, "Avatar position"),
        cameraTransform: copyCameraTransform(cameraTransform),
        width,
        height,
        pixelRatio,
        renderCount,
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;

      let cleanupFailed = false;
      let firstError: unknown;
      const attempt = (operation: () => void): void => {
        try {
          operation();
        } catch (error) {
          if (!cleanupFailed) {
            cleanupFailed = true;
            firstError = error;
          }
        }
      };

      attempt(() => {
        if (loadedAvatarScene === undefined) return;
        avatarRoot.remove(loadedAvatarScene);
        loadedAvatarScene = undefined;
      });
      attempt(() => renderer.dispose());
      attempt(() => floorGeometry.dispose());
      attempt(() => floorMaterial.dispose());
      attempt(() => obstacleGeometry.dispose());
      attempt(() => obstacleMaterial.dispose());
      attempt(() => avatarGeometry.dispose());
      attempt(() => avatarMaterial.dispose());
      attempt(() => scene.clear());

      if (cleanupFailed) throw firstError;
    },
  });
}

type RenderingFeatureConfiguration = Readonly<Record<string, never>>;

const RENDERING_FEATURE_CONFIGURATION =
  defineFeatureConfiguration<RenderingFeatureConfiguration>({
    defaultValue: () => Object.freeze({}),
    parse(input: unknown) {
      if (
        typeof input === "object" &&
        input !== null &&
        !Array.isArray(input) &&
        hasExactlyKeys(input, [])
      ) {
        return {
          ok: true,
          value: Object.freeze({}) as RenderingFeatureConfiguration,
        };
      }
      return {
        ok: false,
        issues: [{ path: [], code: "empty-object-required" }],
      };
    },
  });

export function createRenderingFeature(options: {
  readonly renderer: RenderingFeatureAdapter;
}): ClientFeatureDescriptor<RenderingFeatureConfiguration> {
  if (
    typeof options !== "object" ||
    options === null ||
    Array.isArray(options) ||
    !hasExactlyKeys(options, ["renderer"]) ||
    typeof options.renderer !== "object" ||
    options.renderer === null ||
    typeof options.renderer.render !== "function" ||
    typeof options.renderer.dispose !== "function"
  ) {
    throw new TypeError("Rendering feature options are invalid");
  }

  const renderer = options.renderer;
  const render = renderer.render;
  const disposeRenderer = renderer.dispose;
  let active = false;
  let disposed = false;

  const contribution = Object.freeze({
    kind: "system" as const,
    id: "three-render-frame",
    domain: "client-presentation" as const,
    phase: "render" as const,
    priority: 0,
    run(): void {
      if (disposed) throwDisposed();
      if (!active) return;
      render.call(renderer);
    },
  });

  return Object.freeze({
    id: "three-rendering",
    description: "Renders the owned Three.js scene once per presentation frame",
    runtimeContributions: Object.freeze([contribution]),
    requires: Object.freeze([]),
    conflicts: Object.freeze([]),
    configuration: RENDERING_FEATURE_CONFIGURATION,
    setup({ ledger }: ClientFeatureSetupContext<RenderingFeatureConfiguration>): void {
      if (disposed) throwDisposed();
      active = true;
      try {
        ledger.activateSystem(contribution.id);
      } catch (error) {
        active = false;
        throw error;
      }
    },
    dispose(): void {
      if (disposed) return;
      active = false;
      disposed = true;
      disposeRenderer.call(renderer);
    },
  });
}
