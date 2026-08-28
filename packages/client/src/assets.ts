import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface AssetCause {
  readonly name: string;
  readonly code: string | null;
  readonly message: string;
}

export interface GltfAvatarLoadFailure {
  readonly code: "load-failed" | "disposed-resource";
  readonly cause: AssetCause | null;
}

export type GltfAvatarLoadOutcome =
  | Readonly<{ readonly ok: true; readonly value: GltfAvatarAsset }>
  | Readonly<{
      readonly ok: false;
      readonly failure: GltfAvatarLoadFailure;
    }>;

export interface GltfAvatarAsset {
  readonly source: string;
  readonly clipCount: 0 | 1;
  readonly disposed: boolean;
  advance(seconds: number): void;
  dispose(): void;
}

export interface GltfAvatarLoader {
  readonly disposed: boolean;
  load(source: string): Promise<GltfAvatarLoadOutcome>;
  dispose(): void;
}

interface AssetPrivateState {
  disposed: boolean;
  scene: THREE.Object3D | undefined;
  mixer: THREE.AnimationMixer | undefined;
  action: THREE.AnimationAction | undefined;
  clip: THREE.AnimationClip | undefined;
  onDisposed: (() => void) | undefined;
}

const MAX_SOURCE_LENGTH = 2_048;
const MAX_CAUSE_NAME_LENGTH = 64;
const MAX_CAUSE_CODE_LENGTH = 64;
const MAX_CAUSE_MESSAGE_LENGTH = 512;

const ASSET_STATES = new WeakMap<GltfAvatarAsset, AssetPrivateState>();

const DISPOSED_FAILURE: GltfAvatarLoadFailure = Object.freeze({
  code: "disposed-resource",
  cause: null,
});

const DISPOSED_OUTCOME: GltfAvatarLoadOutcome = Object.freeze({
  ok: false,
  failure: DISPOSED_FAILURE,
});

function requireSource(source: string): string {
  if (
    typeof source !== "string" ||
    source.length === 0 ||
    source.length > MAX_SOURCE_LENGTH ||
    source.trim().length === 0
  ) {
    throw new TypeError(
      `GLTF avatar source must be a non-empty string of at most ${MAX_SOURCE_LENGTH} characters`,
    );
  }
  return source;
}

function requireAdvanceSeconds(seconds: number): number {
  if (
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds < 0
  ) {
    throw new TypeError(
      "GLTF avatar advance seconds must be a non-negative finite number",
    );
  }
  return seconds;
}

function boundedText(value: string, limit: number, fallback: string): string {
  const characters: string[] = [];
  for (const character of value) {
    if (characters.length === limit) break;
    const codePoint = character.codePointAt(0) ?? 0xfffd;
    characters.push(
      codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
        ? " "
        : character,
    );
  }
  const sanitized = characters.join("").trim();
  return sanitized.length === 0 ? fallback : sanitized;
}

function safeProperty(value: object, property: PropertyKey): unknown {
  try {
    return Reflect.get(value, property);
  } catch {
    return undefined;
  }
}

function summarizeCause(cause: unknown): AssetCause {
  if (
    (typeof cause === "object" && cause !== null) ||
    typeof cause === "function"
  ) {
    const objectCause = cause as object;
    const rawName = safeProperty(objectCause, "name");
    const rawCode = safeProperty(objectCause, "code");
    const rawMessage = safeProperty(objectCause, "message");
    const code =
      typeof rawCode === "string"
        ? boundedText(rawCode, MAX_CAUSE_CODE_LENGTH, "") || null
        : null;
    return Object.freeze({
      name: boundedText(
        typeof rawName === "string" ? rawName : "Error",
        MAX_CAUSE_NAME_LENGTH,
        "Error",
      ),
      code,
      message: boundedText(
        typeof rawMessage === "string" ? rawMessage : "Asset load failed",
        MAX_CAUSE_MESSAGE_LENGTH,
        "Asset load failed",
      ),
    });
  }

  if (typeof cause === "string") {
    return Object.freeze({
      name: "string",
      code: null,
      message: boundedText(
        cause,
        MAX_CAUSE_MESSAGE_LENGTH,
        "String thrown value",
      ),
    });
  }

  if (
    typeof cause === "number" ||
    typeof cause === "boolean" ||
    typeof cause === "bigint"
  ) {
    return Object.freeze({
      name: typeof cause,
      code: null,
      message:
        typeof cause === "number" && !Number.isFinite(cause)
          ? "Non-finite number thrown value"
          : boundedText(
              String(cause),
              MAX_CAUSE_MESSAGE_LENGTH,
              "Asset load failed",
            ),
    });
  }

  const type = cause === null ? "null" : typeof cause;
  return Object.freeze({
    name: type,
    code: null,
    message: `${type[0]?.toUpperCase() ?? "U"}${type.slice(1)} thrown value`,
  });
}

function loadFailedOutcome(cause: unknown): GltfAvatarLoadOutcome {
  const failure: GltfAvatarLoadFailure = Object.freeze({
    code: "load-failed",
    cause: summarizeCause(cause),
  });
  return Object.freeze({ ok: false, failure });
}

function safeAttempt(operation: () => void): void {
  try {
    operation();
  } catch {}
}

function collectTextures(
  value: unknown,
  textures: Set<THREE.Texture>,
  visited: Set<object>,
): void {
  if (value instanceof THREE.Texture) {
    textures.add(value);
    return;
  }
  if (typeof value !== "object" || value === null || visited.has(value)) {
    return;
  }
  visited.add(value);

  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return;
  }
  for (const key of keys) {
    collectTextures(safeProperty(value, key), textures, visited);
  }
}

function disposeOwnedScene(scene: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  safeAttempt(() => {
    scene.traverse((object) => {
      const geometry = safeProperty(object, "geometry");
      if (geometry instanceof THREE.BufferGeometry) geometries.add(geometry);

      const material = safeProperty(object, "material");
      const candidates = Array.isArray(material) ? material : [material];
      for (const candidate of candidates) {
        if (candidate instanceof THREE.Material) materials.add(candidate);
      }
    });
  });

  for (const material of materials) {
    collectTextures(material, textures, new Set<object>());
  }
  for (const geometry of geometries) {
    safeAttempt(() => geometry.dispose());
  }
  for (const material of materials) {
    safeAttempt(() => material.dispose());
  }
  for (const texture of textures) {
    safeAttempt(() => texture.dispose());
  }
}

function disposeAssetState(state: AssetPrivateState): void {
  if (state.disposed) return;
  state.disposed = true;

  const scene = state.scene;
  const mixer = state.mixer;
  const action = state.action;
  const clip = state.clip;
  const onDisposed = state.onDisposed;
  state.scene = undefined;
  state.mixer = undefined;
  state.action = undefined;
  state.clip = undefined;
  state.onDisposed = undefined;

  if (action !== undefined) safeAttempt(() => action.stop());
  if (mixer !== undefined) {
    safeAttempt(() => mixer.stopAllAction());
    if (clip !== undefined && scene !== undefined) {
      safeAttempt(() => mixer.uncacheAction(clip, scene));
    }
    if (scene !== undefined) safeAttempt(() => mixer.uncacheRoot(scene));
  }
  if (scene !== undefined) disposeOwnedScene(scene);
  if (onDisposed !== undefined) onDisposed();
}

function disposeUnpublishedAsset(
  scene: THREE.Object3D | undefined,
  mixer: THREE.AnimationMixer | undefined,
  action: THREE.AnimationAction | undefined,
  clip: THREE.AnimationClip | undefined,
): void {
  disposeAssetState({
    disposed: false,
    scene,
    mixer,
    action,
    clip,
    onDisposed: undefined,
  });
}

function createAsset(
  source: string,
  scene: THREE.Object3D,
  mixer: THREE.AnimationMixer | undefined,
  action: THREE.AnimationAction | undefined,
  clip: THREE.AnimationClip | undefined,
  onDisposed: () => void,
): GltfAvatarAsset {
  const state: AssetPrivateState = {
    disposed: false,
    scene,
    mixer,
    action,
    clip,
    onDisposed,
  };
  const asset: GltfAvatarAsset = Object.freeze({
    source,
    clipCount: clip === undefined ? 0 : 1,
    get disposed(): boolean {
      return state.disposed;
    },
    advance(seconds: number): void {
      const elapsed = requireAdvanceSeconds(seconds);
      if (state.disposed || state.mixer === undefined) return;
      try {
        state.mixer.update(elapsed);
      } catch {
        disposeAssetState(state);
      }
    },
    dispose(): void {
      disposeAssetState(state);
    },
  });
  ASSET_STATES.set(asset, state);
  return asset;
}

/** @internal Renderer bridge; its signature deliberately exposes no Three type. */
export function __internalResolveGltfAvatarScene(
  asset: GltfAvatarAsset,
): unknown {
  const state = ASSET_STATES.get(asset);
  return state === undefined || state.disposed ? undefined : state.scene;
}

export function createGltfAvatarLoader(): GltfAvatarLoader {
  let vendorLoader: GLTFLoader | undefined;
  let disposed = false;
  const completedAssets = new Set<GltfAvatarAsset>();

  return Object.freeze({
    get disposed(): boolean {
      return disposed;
    },
    async load(source: string): Promise<GltfAvatarLoadOutcome> {
      const validatedSource = requireSource(source);
      if (disposed) return DISPOSED_OUTCOME;

      let scene: THREE.Object3D | undefined;
      let mixer: THREE.AnimationMixer | undefined;
      let action: THREE.AnimationAction | undefined;
      let clip: THREE.AnimationClip | undefined;
      try {
        const activeLoader = vendorLoader ?? new GLTFLoader();
        vendorLoader = activeLoader;
        const loaded = await activeLoader.loadAsync(validatedSource);
        scene = loaded.scene;
        if (!(scene instanceof THREE.Object3D)) {
          throw new TypeError("Loaded GLTF avatar does not contain a scene");
        }
        if (disposed) {
          disposeUnpublishedAsset(scene, undefined, undefined, undefined);
          return DISPOSED_OUTCOME;
        }

        clip = loaded.animations[0];
        if (clip !== undefined) {
          mixer = new THREE.AnimationMixer(scene);
          action = mixer.clipAction(clip);
          action.play();
        }

        let completedAsset: GltfAvatarAsset | null = null;
        const asset = createAsset(
          validatedSource,
          scene,
          mixer,
          action,
          clip,
          () => {
            if (completedAsset !== null) completedAssets.delete(completedAsset);
          },
        );
        completedAsset = asset;
        if (disposed) {
          asset.dispose();
          return DISPOSED_OUTCOME;
        }
        completedAssets.add(asset);
        return Object.freeze({ ok: true, value: asset });
      } catch (cause) {
        disposeUnpublishedAsset(scene, mixer, action, clip);
        return disposed ? DISPOSED_OUTCOME : loadFailedOutcome(cause);
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      vendorLoader = undefined;
      const assets = [...completedAssets];
      completedAssets.clear();
      for (const asset of assets) safeAttempt(() => asset.dispose());
    },
  });
}
