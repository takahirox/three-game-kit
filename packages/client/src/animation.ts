import * as THREE from "three";
import {
  defineFeatureConfiguration,
  type ClientFeatureDescriptor,
  type ClientFeatureSetupContext,
} from "@three-game-kit/core";

export interface AnimationClipRegistration {
  readonly id: string;
  readonly clip: unknown;
}

export interface AnimationStateMap {
  readonly [state: string]: string;
}

export interface AnimationPlayOptions {
  readonly loop?: boolean;
  readonly crossFadeSeconds?: number;
  readonly playbackRate?: number;
  readonly clampWhenFinished?: boolean;
}

export interface AnimationInspection {
  readonly disposed: boolean;
  readonly activeClipId: string | null;
  readonly activeState: string | null;
  readonly activeOneShotClipId: string | null;
  readonly elapsedSeconds: number;
  readonly completedOneShotCount: number;
  readonly registeredClipIds: readonly string[];
}

export interface AnimationRuntime {
  readonly disposed: boolean;
  setState(state: string): void;
  play(clipId: string, options?: AnimationPlayOptions): void;
  playOneShot(clipId: string, options?: Omit<AnimationPlayOptions, "loop">): void;
  update(seconds: number): void;
  onComplete(listener: (clipId: string) => void): () => void;
  inspect(): AnimationInspection;
  dispose(): void;
}

export interface AnimationFeatureOptions {
  readonly runtime: AnimationRuntime;
  readState(): string;
}

function id(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || value.trim() !== value) {
    throw new TypeError(`${label} must be a trimmed non-empty string of at most 128 characters`);
  }
  return value;
}

function exactOptions(value: AnimationPlayOptions | undefined): Required<AnimationPlayOptions> {
  if (value !== undefined && (typeof value !== "object" || value === null || Array.isArray(value) ||
      !Reflect.ownKeys(value).every((key) => typeof key === "string" && ["loop", "crossFadeSeconds", "playbackRate", "clampWhenFinished"].includes(key)))) {
    throw new TypeError("Animation play options are invalid");
  }
  const loop = value?.loop ?? true;
  const crossFadeSeconds = value?.crossFadeSeconds ?? 0.15;
  const playbackRate = value?.playbackRate ?? 1;
  const clampWhenFinished = value?.clampWhenFinished ?? false;
  if (typeof loop !== "boolean" || typeof clampWhenFinished !== "boolean" ||
      !Number.isFinite(crossFadeSeconds) || crossFadeSeconds < 0 ||
      !Number.isFinite(playbackRate) || playbackRate <= 0) {
    throw new TypeError("Animation play option values are invalid");
  }
  return Object.freeze({ loop, crossFadeSeconds, playbackRate, clampWhenFinished });
}

export function createThreeAnimationRuntime(options: {
  readonly root: unknown;
  readonly clips: readonly AnimationClipRegistration[];
  readonly states?: AnimationStateMap;
  readonly initialState?: string;
}): AnimationRuntime {
  if (typeof options !== "object" || options === null || Array.isArray(options) ||
      !Reflect.ownKeys(options).every((key) => typeof key === "string" && ["root", "clips", "states", "initialState"].includes(key)) ||
      !(options.root instanceof THREE.Object3D) || !Array.isArray(options.clips)) {
    throw new TypeError("Animation runtime options are invalid");
  }
  const root = options.root;
  const clips = new Map<string, THREE.AnimationClip>();
  for (const registration of options.clips) {
    if (typeof registration !== "object" || registration === null || Array.isArray(registration) ||
        Reflect.ownKeys(registration).length !== 2 || !(registration.clip instanceof THREE.AnimationClip)) {
      throw new TypeError("Animation clip registration is invalid");
    }
    const clipId = id(registration.id, "Animation clip ID");
    if (clips.has(clipId)) throw new TypeError(`Duplicate animation clip ID: ${clipId}`);
    clips.set(clipId, registration.clip);
  }
  if (clips.size === 0) throw new TypeError("At least one animation clip is required");
  const states = new Map<string, string>();
  if (options.states !== undefined) {
    if (typeof options.states !== "object" || options.states === null || Array.isArray(options.states)) {
      throw new TypeError("Animation states are invalid");
    }
    for (const [state, clipId] of Object.entries(options.states)) {
      const validState = id(state, "Animation state");
      const validClip = id(clipId, "Animation state clip ID");
      if (!clips.has(validClip)) throw new TypeError(`Animation state references unknown clip: ${validClip}`);
      states.set(validState, validClip);
    }
  }
  const initialState = options.initialState === undefined
    ? null
    : id(options.initialState, "Initial animation state");
  if (initialState !== null && !states.has(initialState)) {
    throw new TypeError(`Unknown initial animation state: ${initialState}`);
  }

  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map<string, THREE.AnimationAction>();
  const listeners = new Set<(clipId: string) => void>();
  let activeAction: THREE.AnimationAction | null = null;
  let activeClipId: string | null = null;
  let activeState: string | null = null;
  let activeOneShotClipId: string | null = null;
  let elapsedSeconds = 0;
  let completedOneShotCount = 0;
  let disposed = false;

  function requireActive(): void {
    if (disposed) throw new Error("Animation runtime has been disposed");
  }

  function actionFor(clipId: string): THREE.AnimationAction {
    const clip = clips.get(id(clipId, "Animation clip ID"));
    if (clip === undefined) throw new RangeError(`Unknown animation clip: ${clipId}`);
    let action = actions.get(clipId);
    if (action === undefined) {
      action = mixer.clipAction(clip);
      actions.set(clipId, action);
    }
    return action;
  }

  function playInternal(clipId: string, rawOptions: AnimationPlayOptions | undefined): void {
    requireActive();
    const playOptions = exactOptions(rawOptions);
    const next = actionFor(clipId);
    const previous = activeAction;
    next.enabled = true;
    next.clampWhenFinished = playOptions.clampWhenFinished;
    next.setEffectiveTimeScale(playOptions.playbackRate);
    next.setLoop(playOptions.loop ? THREE.LoopRepeat : THREE.LoopOnce, playOptions.loop ? Infinity : 1);
    next.reset().play();
    if (previous !== null && previous !== next) {
      if (playOptions.crossFadeSeconds > 0) previous.crossFadeTo(next, playOptions.crossFadeSeconds, false);
      else previous.stop();
    }
    activeAction = next;
    activeClipId = clipId;
  }

  const finished = (event: { readonly action: THREE.AnimationAction }): void => {
    if (disposed) return;
    const entry = [...actions.entries()].find(([, action]) => action === event.action);
    if (entry === undefined) return;
    completedOneShotCount += 1;
    if (activeOneShotClipId === entry[0]) {
      activeOneShotClipId = null;
      if (activeState !== null) {
        const stateClipId = states.get(activeState);
        if (stateClipId !== undefined) playInternal(stateClipId, undefined);
      }
    }
    for (const listener of [...listeners]) listener(entry[0]);
  };
  mixer.addEventListener("finished", finished);

  const runtime: AnimationRuntime = Object.freeze({
    get disposed(): boolean { return disposed; },
    setState(rawState: string): void {
      requireActive();
      const state = id(rawState, "Animation state");
      if (state === activeState) return;
      const clipId = states.get(state);
      if (clipId === undefined) throw new RangeError(`Unknown animation state: ${state}`);
      activeState = state;
      if (activeOneShotClipId === null) playInternal(clipId, undefined);
    },
    play(clipId: string, playOptions?: AnimationPlayOptions): void {
      activeState = null;
      activeOneShotClipId = null;
      playInternal(clipId, playOptions);
    },
    playOneShot(clipId: string, playOptions?: Omit<AnimationPlayOptions, "loop">): void {
      playInternal(clipId, { ...playOptions, loop: false });
      activeOneShotClipId = id(clipId, "Animation clip ID");
    },
    update(seconds: number): void {
      requireActive();
      if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0 || seconds > 1) {
        throw new TypeError("Animation update must be in [0, 1] seconds");
      }
      mixer.update(seconds);
      elapsedSeconds += seconds;
    },
    onComplete(listener: (clipId: string) => void): () => void {
      requireActive();
      if (typeof listener !== "function") throw new TypeError("Animation completion listener is invalid");
      listeners.add(listener);
      let subscribed = true;
      return () => { if (subscribed) { subscribed = false; listeners.delete(listener); } };
    },
    inspect(): AnimationInspection {
      return Object.freeze({
        disposed,
        activeClipId,
        activeState,
        activeOneShotClipId,
        elapsedSeconds,
        completedOneShotCount,
        registeredClipIds: Object.freeze([...clips.keys()]),
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      mixer.removeEventListener("finished", finished);
      listeners.clear();
      mixer.stopAllAction();
      for (const [clipId, action] of actions) {
        const clip = clips.get(clipId);
        if (clip !== undefined) mixer.uncacheAction(clip, root);
        action.stop();
      }
      mixer.uncacheRoot(root);
      actions.clear();
      clips.clear();
      activeAction = null;
      activeClipId = null;
      activeState = null;
      activeOneShotClipId = null;
    },
  });

  if (initialState !== null) runtime.setState(initialState);
  return runtime;
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

export function createAnimationFeature(options: AnimationFeatureOptions): ClientFeatureDescriptor<EmptyConfiguration> {
  if (typeof options !== "object" || options === null || Array.isArray(options) ||
      Reflect.ownKeys(options).length !== 2 || typeof options.runtime !== "object" || options.runtime === null ||
      typeof options.runtime.setState !== "function" || typeof options.runtime.update !== "function" ||
      typeof options.runtime.dispose !== "function" || typeof options.readState !== "function") {
    throw new TypeError("Animation Feature options are invalid");
  }
  let active = false;
  let disposed = false;
  const contribution = Object.freeze({
    kind: "system" as const,
    id: "animation-update",
    domain: "client-simulation" as const,
    phase: "presentation-publish" as const,
    priority: 0,
    run({ dt }: { readonly dt: number }): void {
      if (!active || disposed) return;
      options.runtime.setState(options.readState());
      options.runtime.update(dt);
    },
  });
  return Object.freeze({
    id: "animation",
    description: "Advances a deterministic Three.js animation state machine",
    runtimeContributions: Object.freeze([contribution]),
    requires: Object.freeze([]),
    conflicts: Object.freeze([]),
    configuration: EMPTY_CONFIGURATION,
    setup({ ledger }: ClientFeatureSetupContext<EmptyConfiguration>): void {
      if (disposed) throw new Error("Animation Feature has been disposed");
      active = true;
      try { ledger.activateSystem(contribution.id); } catch (error) { active = false; throw error; }
    },
    dispose(): void {
      if (disposed) return;
      active = false;
      disposed = true;
      options.runtime.dispose();
    },
  });
}
