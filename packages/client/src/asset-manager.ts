import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  defineFeatureConfiguration,
  type ClientFeatureDescriptor,
} from "@three-game-kit/core";

export type AssetKind = "gltf" | "texture" | "audio";

export interface AssetManifestEntry {
  readonly id: string;
  readonly kind: AssetKind;
  readonly source: string;
  readonly groups?: readonly string[];
}

export interface AssetProgress {
  readonly total: number;
  readonly started: number;
  readonly completed: number;
  readonly failed: number;
  readonly pending: number;
}

export interface AssetManagerFailure {
  readonly code: "unknown-asset" | "load-failed" | "disposed-resource" | "unsupported-kind";
  readonly assetId: string;
  readonly message: string;
}

export type AssetManagerOutcome<T = unknown> =
  | Readonly<{ readonly ok: true; readonly value: T }>
  | Readonly<{ readonly ok: false; readonly failure: AssetManagerFailure }>;

export interface AssetBackend {
  load(entry: AssetManifestEntry): Promise<unknown>;
  disposeAsset(kind: AssetKind, value: unknown): void;
  dispose(): void;
}

export interface AssetManagerInspection {
  readonly disposed: boolean;
  readonly manifestIds: readonly string[];
  readonly cachedIds: readonly string[];
  readonly inFlightIds: readonly string[];
  readonly progress: AssetProgress;
}

export interface AssetManager {
  readonly disposed: boolean;
  load<T = unknown>(id: string): Promise<AssetManagerOutcome<T>>;
  preloadGroup(group: string): Promise<readonly AssetManagerOutcome[]>;
  get<T = unknown>(id: string): T | undefined;
  subscribeProgress(listener: (progress: AssetProgress) => void): () => void;
  inspect(): AssetManagerInspection;
  dispose(): void;
}

function stableId(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || value.trim() !== value) {
    throw new TypeError(`${label} must be a trimmed non-empty string of at most 128 characters`);
  }
  return value;
}

function source(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048 || value.trim().length === 0) {
    throw new TypeError("Asset source must be non-empty and at most 2048 characters");
  }
  return value;
}

function entry(value: AssetManifestEntry): AssetManifestEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      !Reflect.ownKeys(value).every((key) => typeof key === "string" && ["id", "kind", "source", "groups"].includes(key)) ||
      !["gltf", "texture", "audio"].includes(value.kind) ||
      (value.groups !== undefined && !Array.isArray(value.groups))) {
    throw new TypeError("Asset manifest entry is invalid");
  }
  const groups = value.groups?.map((group) => stableId(group, "Asset group ID")) ?? [];
  if (new Set(groups).size !== groups.length) throw new TypeError("Asset groups must be unique per entry");
  return Object.freeze({ id: stableId(value.id, "Asset ID"), kind: value.kind, source: source(value.source), groups: Object.freeze(groups) });
}

function boundedMessage(cause: unknown): string {
  const value = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "Asset load failed";
  return [...value].slice(0, 512).join("") || "Asset load failed";
}

function disposeThreeValue(kind: AssetKind, value: unknown): void {
  if (kind === "texture") {
    if (value instanceof THREE.Texture) value.dispose();
    return;
  }
  if (kind !== "gltf" || typeof value !== "object" || value === null || !("scene" in value) || !(value.scene instanceof THREE.Object3D)) return;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  value.scene.traverse((object) => {
    if ("geometry" in object && object.geometry instanceof THREE.BufferGeometry) geometries.add(object.geometry);
    if ("material" in object) {
      const candidates = Array.isArray(object.material) ? object.material : [object.material];
      for (const candidate of candidates) if (candidate instanceof THREE.Material) materials.add(candidate);
    }
  });
  for (const material of materials) {
    for (const property of Object.values(material)) if (property instanceof THREE.Texture) textures.add(property);
  }
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
  value.scene.clear();
}

export function createThreeAssetBackend(options: {
  readonly loadAudio?: (source: string) => Promise<unknown>;
} = {}): AssetBackend {
  if (typeof options !== "object" || options === null || Array.isArray(options) ||
      !Reflect.ownKeys(options).every((key) => key === "loadAudio") ||
      (options.loadAudio !== undefined && typeof options.loadAudio !== "function")) {
    throw new TypeError("Three asset backend options are invalid");
  }
  const gltf = new GLTFLoader();
  const texture = new THREE.TextureLoader();
  let disposed = false;
  return Object.freeze({
    async load(manifestEntry: AssetManifestEntry): Promise<unknown> {
      if (disposed) throw new Error("Asset backend has been disposed");
      if (manifestEntry.kind === "gltf") return gltf.loadAsync(manifestEntry.source);
      if (manifestEntry.kind === "texture") return texture.loadAsync(manifestEntry.source);
      if (options.loadAudio === undefined) {
        const failure = new Error("Audio assets require a loadAudio adapter");
        failure.name = "UnsupportedAssetKind";
        throw failure;
      }
      return options.loadAudio(manifestEntry.source);
    },
    disposeAsset(kind: AssetKind, value: unknown): void { disposeThreeValue(kind, value); },
    dispose(): void { disposed = true; },
  });
}

export function createAssetManager(manifest: readonly AssetManifestEntry[], backend: AssetBackend = createThreeAssetBackend()): AssetManager {
  if (!Array.isArray(manifest) || typeof backend !== "object" || backend === null ||
      typeof backend.load !== "function" || typeof backend.disposeAsset !== "function" || typeof backend.dispose !== "function") {
    throw new TypeError("Asset manager options are invalid");
  }
  const entries = new Map<string, AssetManifestEntry>();
  for (const rawEntry of manifest) {
    const copied = entry(rawEntry);
    if (entries.has(copied.id)) throw new TypeError(`Duplicate asset ID: ${copied.id}`);
    entries.set(copied.id, copied);
  }
  const cached = new Map<string, unknown>();
  const inFlight = new Map<string, Promise<AssetManagerOutcome>>();
  const listeners = new Set<(progress: AssetProgress) => void>();
  let started = 0;
  let completed = 0;
  let failed = 0;
  let disposed = false;

  function progress(): AssetProgress {
    return Object.freeze({ total: entries.size, started, completed, failed, pending: inFlight.size });
  }
  function notify(): void {
    const value = progress();
    for (const listener of [...listeners]) {
      try { listener(value); } catch {}
    }
  }
  function failure(code: AssetManagerFailure["code"], assetId: string, message: string): AssetManagerOutcome {
    return Object.freeze({ ok: false, failure: Object.freeze({ code, assetId, message }) });
  }

  const manager: AssetManager = Object.freeze({
    get disposed(): boolean { return disposed; },
    load<T = unknown>(rawId: string): Promise<AssetManagerOutcome<T>> {
      const assetId = stableId(rawId, "Asset ID");
      if (disposed) return Promise.resolve(failure("disposed-resource", assetId, "Asset manager has been disposed") as AssetManagerOutcome<T>);
      if (cached.has(assetId)) return Promise.resolve(Object.freeze({ ok: true, value: cached.get(assetId) as T }));
      const pending = inFlight.get(assetId);
      if (pending !== undefined) return pending as Promise<AssetManagerOutcome<T>>;
      const manifestEntry = entries.get(assetId);
      if (manifestEntry === undefined) return Promise.resolve(failure("unknown-asset", assetId, `Unknown asset: ${assetId}`) as AssetManagerOutcome<T>);
      started += 1;
      const load = Promise.resolve().then(() => backend.load(manifestEntry)).then((value): AssetManagerOutcome => {
        if (disposed) {
          try { backend.disposeAsset(manifestEntry.kind, value); } catch {}
          return failure("disposed-resource", assetId, "Asset manager was disposed while loading");
        }
        cached.set(assetId, value);
        completed += 1;
        return Object.freeze({ ok: true, value });
      }, (cause): AssetManagerOutcome => {
        failed += 1;
        const unsupported = cause instanceof Error && cause.name === "UnsupportedAssetKind";
        return failure(unsupported ? "unsupported-kind" : "load-failed", assetId, boundedMessage(cause));
      }).finally(() => { inFlight.delete(assetId); notify(); });
      inFlight.set(assetId, load);
      notify();
      return load as Promise<AssetManagerOutcome<T>>;
    },
    async preloadGroup(rawGroup: string): Promise<readonly AssetManagerOutcome[]> {
      const group = stableId(rawGroup, "Asset group ID");
      const selected = [...entries.values()].filter((candidate) => candidate.groups?.includes(group) === true);
      return Object.freeze(await Promise.all(selected.map((candidate) => manager.load(candidate.id))));
    },
    get<T = unknown>(rawId: string): T | undefined {
      return cached.get(stableId(rawId, "Asset ID")) as T | undefined;
    },
    subscribeProgress(listener: (progress: AssetProgress) => void): () => void {
      if (disposed) throw new Error("Asset manager has been disposed");
      if (typeof listener !== "function") throw new TypeError("Asset progress listener is invalid");
      listeners.add(listener);
      listener(progress());
      let subscribed = true;
      return () => { if (subscribed) { subscribed = false; listeners.delete(listener); } };
    },
    inspect(): AssetManagerInspection {
      return Object.freeze({
        disposed,
        manifestIds: Object.freeze([...entries.keys()]),
        cachedIds: Object.freeze([...cached.keys()]),
        inFlightIds: Object.freeze([...inFlight.keys()]),
        progress: progress(),
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      let firstError: unknown;
      for (const [assetId, value] of cached) {
        const manifestEntry = entries.get(assetId);
        if (manifestEntry !== undefined) {
          try { backend.disposeAsset(manifestEntry.kind, value); } catch (error) { firstError ??= error; }
        }
      }
      cached.clear();
      try { backend.dispose(); } catch (error) { firstError ??= error; }
      if (firstError !== undefined) throw firstError;
    },
  });
  return manager;
}

type EmptyConfiguration = Readonly<Record<string, never>>;
const EMPTY_CONFIGURATION = defineFeatureConfiguration<EmptyConfiguration>({
  defaultValue: () => Object.freeze({}),
  parse(value: unknown) {
    return typeof value === "object" && value !== null && !Array.isArray(value) && Reflect.ownKeys(value).length === 0
      ? { ok: true as const, value: Object.freeze({}) as EmptyConfiguration }
      : { ok: false as const, issues: [{ path: [], code: "empty-object-required" }] };
  },
});

export function createAssetManagerFeature(manager: AssetManager): ClientFeatureDescriptor<EmptyConfiguration> {
  if (typeof manager !== "object" || manager === null || typeof manager.load !== "function" || typeof manager.dispose !== "function") {
    throw new TypeError("Asset Manager Feature manager is invalid");
  }
  let disposed = false;
  return Object.freeze({
    id: "asset-manager",
    description: "Owns manifest-based deduplicated assets and deterministic cleanup",
    runtimeContributions: Object.freeze([]),
    requires: Object.freeze([]),
    conflicts: Object.freeze([]),
    configuration: EMPTY_CONFIGURATION,
    setup(): void { if (disposed) throw new Error("Asset Manager Feature has been disposed"); },
    dispose(): void { if (!disposed) { disposed = true; manager.dispose(); } },
  });
}
