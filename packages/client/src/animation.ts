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

export interface AnimationStateDefinition {
  readonly clip: string;
  readonly loop?: boolean;
  readonly crossFadeSeconds?: number;
  readonly playbackRate?: number;
  readonly clampWhenFinished?: boolean;
}

export interface AnimationStateMap {
  readonly [state: string]: string | AnimationStateDefinition;
}

export interface AnimationPlayOptions {
  readonly loop?: boolean;
  readonly crossFadeSeconds?: number;
  readonly playbackRate?: number;
  readonly clampWhenFinished?: boolean;
}

/** A named point on a clip timeline that fires while playback crosses it. */
export interface AnimationClipEventDefinition {
  readonly clipId: string;
  readonly id: string;
  readonly seconds: number;
}

export interface AnimationClipEvent {
  readonly clipId: string;
  readonly id: string;
  readonly seconds: number;
  readonly elapsedSeconds: number;
}

export interface AnimationInspection {
  readonly disposed: boolean;
  readonly activeClipId: string | null;
  readonly activeState: string | null;
  readonly activeOneShotClipId: string | null;
  readonly activeClipSeconds: number;
  readonly activeClipDuration: number;
  readonly activePlaybackRate: number;
  readonly elapsedSeconds: number;
  readonly completedOneShotCount: number;
  readonly interruptedOneShotCount: number;
  readonly emittedEventCount: number;
  readonly registeredClipIds: readonly string[];
  readonly registeredEventIds: readonly string[];
}

export interface AnimationRuntime {
  readonly disposed: boolean;
  setState(state: string): void;
  play(clipId: string, options?: AnimationPlayOptions): void;
  playOneShot(clipId: string, options?: Omit<AnimationPlayOptions, "loop">): void;
  cancelOneShot(): boolean;
  setPlaybackRate(rate: number): void;
  update(seconds: number): void;
  onComplete(listener: (clipId: string) => void): () => void;
  onEvent(listener: (event: AnimationClipEvent) => void): () => void;
  inspect(): AnimationInspection;
  dispose(): void;
}

export interface AnimationCharacterInspection {
  readonly characterId: string;
  readonly animation: AnimationInspection;
}

export interface AnimationCharacterSetInspection {
  readonly disposed: boolean;
  readonly characters: readonly AnimationCharacterInspection[];
}

/**
 * Owns any number of animation runtimes that may be registered after boot
 * (for example once a glTF character finishes loading) under one Feature.
 */
export interface AnimationCharacterSet {
  readonly disposed: boolean;
  add(characterId: string, runtime: AnimationRuntime, readState: () => string): void;
  remove(characterId: string): boolean;
  get(characterId: string): AnimationRuntime | undefined;
  advance(seconds: number): void;
  inspect(): AnimationCharacterSetInspection;
  dispose(): void;
}

export interface AnimationFeatureOptions {
  readonly id?: string;
  readonly runtime: AnimationRuntime;
  readState(): string;
}

export interface AnimationCharacterSetFeatureOptions {
  readonly id?: string;
  readonly characters: AnimationCharacterSet;
}

function id(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || value.trim() !== value) {
    throw new TypeError(`${label} must be a trimmed non-empty string of at most 128 characters`);
  }
  return value;
}

const PLAY_OPTION_KEYS = ["loop", "crossFadeSeconds", "playbackRate", "clampWhenFinished"];

function exactOptions(value: AnimationPlayOptions | undefined): Required<AnimationPlayOptions> {
  if (value !== undefined && (typeof value !== "object" || value === null || Array.isArray(value) ||
      !Reflect.ownKeys(value).every((key) => typeof key === "string" && PLAY_OPTION_KEYS.includes(key)))) {
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

function stateDefinition(value: string | AnimationStateDefinition, label: string): Required<AnimationStateDefinition> {
  if (typeof value === "string") return Object.freeze({ clip: id(value, label), ...exactOptions(undefined) });
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      !Reflect.ownKeys(value).every((key) => typeof key === "string" && (key === "clip" || PLAY_OPTION_KEYS.includes(key)))) {
    throw new TypeError(`${label} is invalid`);
  }
  const { clip, ...options } = value;
  return Object.freeze({ clip: id(clip, label), ...exactOptions(options) });
}

export function createThreeAnimationRuntime(options: {
  readonly root: unknown;
  readonly clips: readonly AnimationClipRegistration[];
  readonly states?: AnimationStateMap;
  readonly initialState?: string;
  readonly events?: readonly AnimationClipEventDefinition[];
}): AnimationRuntime {
  if (typeof options !== "object" || options === null || Array.isArray(options) ||
      !Reflect.ownKeys(options).every((key) => typeof key === "string" && ["root", "clips", "states", "initialState", "events"].includes(key)) ||
      !(options.root instanceof THREE.Object3D) || !Array.isArray(options.clips) ||
      (options.events !== undefined && !Array.isArray(options.events))) {
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
  const states = new Map<string, Required<AnimationStateDefinition>>();
  if (options.states !== undefined) {
    if (typeof options.states !== "object" || options.states === null || Array.isArray(options.states)) {
      throw new TypeError("Animation states are invalid");
    }
    for (const [state, definition] of Object.entries(options.states)) {
      const validState = id(state, "Animation state");
      const resolved = stateDefinition(definition, "Animation state clip ID");
      if (!clips.has(resolved.clip)) throw new TypeError(`Animation state references unknown clip: ${resolved.clip}`);
      states.set(validState, resolved);
    }
  }
  const initialState = options.initialState === undefined
    ? null
    : id(options.initialState, "Initial animation state");
  if (initialState !== null && !states.has(initialState)) {
    throw new TypeError(`Unknown initial animation state: ${initialState}`);
  }
  const events = new Map<string, AnimationClipEventDefinition[]>();
  const eventIds: string[] = [];
  for (const definition of options.events ?? []) {
    if (typeof definition !== "object" || definition === null || Array.isArray(definition) ||
        Reflect.ownKeys(definition).sort().join("|") !== "clipId|id|seconds") {
      throw new TypeError("Animation clip event definition is invalid");
    }
    const clipId = id(definition.clipId, "Animation event clip ID");
    const clip = clips.get(clipId);
    if (clip === undefined) throw new TypeError(`Animation event references unknown clip: ${clipId}`);
    const eventId = id(definition.id, "Animation event ID");
    if (!Number.isFinite(definition.seconds) || definition.seconds < 0 || definition.seconds > clip.duration) {
      throw new TypeError(`Animation event ${eventId} must lie within clip ${clipId}`);
    }
    const key = `${clipId} ${eventId}`;
    if (eventIds.includes(key)) throw new TypeError(`Duplicate animation event ${eventId} on clip ${clipId}`);
    eventIds.push(key);
    const list = events.get(clipId) ?? [];
    list.push(Object.freeze({ clipId, id: eventId, seconds: definition.seconds }));
    list.sort((a, b) => a.seconds - b.seconds || (a.id < b.id ? -1 : 1));
    events.set(clipId, list);
  }

  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map<string, THREE.AnimationAction>();
  const listeners = new Set<(clipId: string) => void>();
  const eventListeners = new Set<(event: AnimationClipEvent) => void>();
  let activeAction: THREE.AnimationAction | null = null;
  let activeClipId: string | null = null;
  let activeState: string | null = null;
  let activeOneShotClipId: string | null = null;
  let activeRate = 1;
  let justStarted = false;
  let elapsedSeconds = 0;
  let completedOneShotCount = 0;
  let interruptedOneShotCount = 0;
  let emittedEventCount = 0;
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
    activeRate = playOptions.playbackRate;
    justStarted = true;
  }

  function playState(state: string): void {
    const definition = states.get(state);
    if (definition === undefined) throw new RangeError(`Unknown animation state: ${state}`);
    const { clip, ...playOptions } = definition;
    playInternal(clip, playOptions);
  }

  function interruptOneShot(): void {
    if (activeOneShotClipId !== null) {
      interruptedOneShotCount += 1;
      activeOneShotClipId = null;
    }
  }

  function emitEvents(clipId: string, before: number, after: number, started: boolean): void {
    const definitions = events.get(clipId);
    if (definitions === undefined) return;
    const duration = clips.get(clipId)?.duration ?? 0;
    const fire = (definition: AnimationClipEventDefinition): void => {
      emittedEventCount += 1;
      const event = Object.freeze({ clipId, id: definition.id, seconds: definition.seconds, elapsedSeconds });
      for (const listener of [...eventListeners]) listener(event);
    };
    if (after < before) {
      for (const definition of definitions) if (definition.seconds > before && definition.seconds <= duration) fire(definition);
      for (const definition of definitions) if (definition.seconds <= after) fire(definition);
      return;
    }
    for (const definition of definitions) {
      if ((started ? definition.seconds >= before : definition.seconds > before) && definition.seconds <= after) fire(definition);
    }
  }

  const finished = (event: { readonly action: THREE.AnimationAction }): void => {
    if (disposed || event.action !== activeAction) return;
    const entry = [...actions.entries()].find(([, action]) => action === event.action);
    if (entry === undefined) return;
    completedOneShotCount += 1;
    if (activeOneShotClipId === entry[0]) {
      activeOneShotClipId = null;
      if (activeState !== null) playState(activeState);
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
      if (!states.has(state)) throw new RangeError(`Unknown animation state: ${state}`);
      activeState = state;
      if (activeOneShotClipId === null) playState(state);
    },
    play(clipId: string, playOptions?: AnimationPlayOptions): void {
      requireActive();
      activeState = null;
      interruptOneShot();
      playInternal(clipId, playOptions);
    },
    playOneShot(clipId: string, playOptions?: Omit<AnimationPlayOptions, "loop">): void {
      requireActive();
      const validClipId = id(clipId, "Animation clip ID");
      interruptOneShot();
      playInternal(validClipId, { ...playOptions, loop: false });
      activeOneShotClipId = validClipId;
    },
    cancelOneShot(): boolean {
      requireActive();
      if (activeOneShotClipId === null) return false;
      interruptOneShot();
      if (activeState !== null) playState(activeState);
      else if (activeAction !== null) { activeAction.stop(); activeAction = null; activeClipId = null; }
      return true;
    },
    setPlaybackRate(rate: number): void {
      requireActive();
      if (!Number.isFinite(rate) || rate <= 0) throw new TypeError("Animation playback rate must be positive");
      activeRate = rate;
      activeAction?.setEffectiveTimeScale(rate);
    },
    update(seconds: number): void {
      requireActive();
      if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0 || seconds > 1) {
        throw new TypeError("Animation update must be in [0, 1] seconds");
      }
      const action = activeAction;
      const clipId = activeClipId;
      const before = action?.time ?? 0;
      const started = justStarted;
      justStarted = false;
      mixer.update(seconds);
      elapsedSeconds += seconds;
      if (action !== null && clipId !== null) emitEvents(clipId, before, action.time, started);
    },
    onComplete(listener: (clipId: string) => void): () => void {
      requireActive();
      if (typeof listener !== "function") throw new TypeError("Animation completion listener is invalid");
      listeners.add(listener);
      let subscribed = true;
      return () => { if (subscribed) { subscribed = false; listeners.delete(listener); } };
    },
    onEvent(listener: (event: AnimationClipEvent) => void): () => void {
      requireActive();
      if (typeof listener !== "function") throw new TypeError("Animation event listener is invalid");
      eventListeners.add(listener);
      let subscribed = true;
      return () => { if (subscribed) { subscribed = false; eventListeners.delete(listener); } };
    },
    inspect(): AnimationInspection {
      return Object.freeze({
        disposed,
        activeClipId,
        activeState,
        activeOneShotClipId,
        activeClipSeconds: activeAction?.time ?? 0,
        activeClipDuration: activeClipId === null ? 0 : clips.get(activeClipId)?.duration ?? 0,
        activePlaybackRate: activeRate,
        elapsedSeconds,
        completedOneShotCount,
        interruptedOneShotCount,
        emittedEventCount,
        registeredClipIds: Object.freeze([...clips.keys()]),
        registeredEventIds: Object.freeze(eventIds.map((key) => key.replace(" ", ":"))),
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      mixer.removeEventListener("finished", finished);
      listeners.clear();
      eventListeners.clear();
      mixer.stopAllAction();
      for (const [clipId, action] of actions) {
        const clip = clips.get(clipId);
        if (clip !== undefined) mixer.uncacheAction(clip, root);
        action.stop();
      }
      mixer.uncacheRoot(root);
      actions.clear();
      clips.clear();
      events.clear();
      eventIds.length = 0;
      activeAction = null;
      activeClipId = null;
      activeState = null;
      activeOneShotClipId = null;
    },
  });

  if (initialState !== null) runtime.setState(initialState);
  return runtime;
}

function isRuntime(value: unknown): value is AnimationRuntime {
  return typeof value === "object" && value !== null &&
    typeof (value as AnimationRuntime).setState === "function" &&
    typeof (value as AnimationRuntime).update === "function" &&
    typeof (value as AnimationRuntime).dispose === "function";
}

export function createAnimationCharacterSet(): AnimationCharacterSet {
  const characters = new Map<string, { readonly runtime: AnimationRuntime; readonly readState: () => string }>();
  let disposed = false;
  function requireActive(): void {
    if (disposed) throw new Error("Animation character set has been disposed");
  }
  return Object.freeze({
    get disposed(): boolean { return disposed; },
    add(rawId: string, runtime: AnimationRuntime, readState: () => string): void {
      requireActive();
      const characterId = id(rawId, "Animation character ID");
      if (!isRuntime(runtime) || typeof readState !== "function") throw new TypeError("Animation character registration is invalid");
      if (characters.has(characterId)) throw new TypeError(`Duplicate animation character ID: ${characterId}`);
      characters.set(characterId, Object.freeze({ runtime, readState }));
    },
    remove(rawId: string): boolean {
      requireActive();
      const characterId = id(rawId, "Animation character ID");
      const entry = characters.get(characterId);
      if (entry === undefined) return false;
      characters.delete(characterId);
      entry.runtime.dispose();
      return true;
    },
    get(rawId: string): AnimationRuntime | undefined {
      return characters.get(id(rawId, "Animation character ID"))?.runtime;
    },
    advance(seconds: number): void {
      requireActive();
      for (const [, entry] of [...characters].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        if (entry.runtime.disposed) continue;
        entry.runtime.setState(entry.readState());
        entry.runtime.update(seconds);
      }
    },
    inspect(): AnimationCharacterSetInspection {
      return Object.freeze({
        disposed,
        characters: Object.freeze([...characters].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([characterId, entry]) => Object.freeze({ characterId, animation: entry.runtime.inspect() }))),
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      let firstError: unknown;
      for (const entry of characters.values()) {
        try { entry.runtime.dispose(); } catch (error) { firstError ??= error; }
      }
      characters.clear();
      if (firstError !== undefined) throw firstError;
    },
  });
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

export function createAnimationFeature(options: AnimationFeatureOptions | AnimationCharacterSetFeatureOptions): ClientFeatureDescriptor<EmptyConfiguration> {
  if (typeof options !== "object" || options === null || Array.isArray(options)) throw new TypeError("Animation Feature options are invalid");
  const keys = Reflect.ownKeys(options);
  const single = "runtime" in options;
  const validKeys = single ? ["id", "runtime", "readState"] : ["id", "characters"];
  if (!keys.every((key) => typeof key === "string" && validKeys.includes(key)) ||
      (options.id !== undefined && typeof options.id !== "string") ||
      (single
        ? !isRuntime(options.runtime) || typeof options.readState !== "function"
        : typeof options.characters !== "object" || options.characters === null || typeof options.characters.advance !== "function" || typeof options.characters.dispose !== "function")) {
    throw new TypeError("Animation Feature options are invalid");
  }
  const featureId = options.id === undefined ? "animation" : id(options.id, "Animation Feature ID");
  const advance: (dt: number) => void = single
    ? (dt) => { options.runtime.setState(options.readState()); options.runtime.update(dt); }
    : (dt) => options.characters.advance(dt);
  const owned: { dispose(): void } = single ? options.runtime : options.characters;
  let active = false;
  let disposed = false;
  const contribution = Object.freeze({
    kind: "system" as const,
    id: `${featureId}-update`,
    domain: "client-simulation" as const,
    phase: "presentation-publish" as const,
    priority: 0,
    run({ dt }: { readonly dt: number }): void {
      if (!active || disposed) return;
      advance(dt);
    },
  });
  return Object.freeze({
    id: featureId,
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
      owned.dispose();
    },
  });
}
