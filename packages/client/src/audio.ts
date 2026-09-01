import {
  defineFeatureConfiguration,
  type ClientFeatureDescriptor,
} from "@three-game-kit/core";

export type AudioBusId = "master" | "music" | "effects" | (string & {});

export interface AudioPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface AudioPlayOptions {
  readonly bus?: AudioBusId;
  readonly loop?: boolean;
  readonly volume?: number;
  readonly playbackRate?: number;
  readonly position?: AudioPosition;
}

export interface AudioVoice {
  readonly stopped: boolean;
  setVolume(volume: number): void;
  stop(): void;
}

export interface AudioDriver {
  readonly available: boolean;
  unlock(): Promise<void>;
  play(buffer: unknown, options: Required<Omit<AudioPlayOptions, "position">> & { readonly position: AudioPosition | null }): AudioVoice;
  dispose(): void;
}

export interface AudioPlayFailure {
  readonly code: "unknown-clip" | "disposed-resource" | "play-failed";
  readonly message: string;
}

export type AudioPlayOutcome =
  | Readonly<{ readonly ok: true; readonly value: AudioVoice }>
  | Readonly<{ readonly ok: false; readonly failure: AudioPlayFailure }>;

export interface AudioInspection {
  readonly disposed: boolean;
  readonly available: boolean;
  readonly unlocked: boolean;
  readonly muted: boolean;
  readonly registeredClipIds: readonly string[];
  readonly activeVoiceCount: number;
  readonly busVolumes: Readonly<Record<string, number>>;
}

export interface AudioRuntime {
  readonly disposed: boolean;
  registerClip(id: string, buffer: unknown): void;
  unlock(): Promise<Readonly<{ readonly ok: true }> | Readonly<{ readonly ok: false; readonly message: string }>>;
  play(id: string, options?: AudioPlayOptions): AudioPlayOutcome;
  playEffect(id: string, options?: Omit<AudioPlayOptions, "bus">): AudioPlayOutcome;
  playMusic(id: string, options?: Omit<AudioPlayOptions, "bus" | "loop">): AudioPlayOutcome;
  setBusVolume(bus: AudioBusId, volume: number): void;
  setMuted(muted: boolean): void;
  stopAll(bus?: AudioBusId): void;
  inspect(): AudioInspection;
  dispose(): void;
}

function stableId(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || value.trim() !== value) {
    throw new TypeError(`${label} must be a trimmed non-empty string of at most 128 characters`);
  }
  return value;
}

function volume(value: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${label} must be a finite number in [0, 1]`);
  }
  return value;
}

function finitePositive(value: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive finite number`);
  }
  return value;
}

function position(value: AudioPosition | undefined): AudioPosition | null {
  if (value === undefined) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      Reflect.ownKeys(value).sort().join("|") !== "x|y|z" ||
      ![value.x, value.y, value.z].every((component) => typeof component === "number" && Number.isFinite(component))) {
    throw new TypeError("Audio position must contain exactly finite x, y, and z values");
  }
  return Object.freeze({ x: value.x, y: value.y, z: value.z });
}

function playOptions(value: AudioPlayOptions | undefined): Required<Omit<AudioPlayOptions, "position">> & { readonly position: AudioPosition | null } {
  if (value !== undefined && (typeof value !== "object" || value === null || Array.isArray(value) ||
      !Reflect.ownKeys(value).every((key) => typeof key === "string" && ["bus", "loop", "volume", "playbackRate", "position"].includes(key)))) {
    throw new TypeError("Audio play options are invalid");
  }
  return Object.freeze({
    bus: stableId(value?.bus ?? "effects", "Audio bus ID") as AudioBusId,
    loop: value?.loop ?? false,
    volume: volume(value?.volume ?? 1, "Audio voice volume"),
    playbackRate: finitePositive(value?.playbackRate ?? 1, "Audio playbackRate"),
    position: position(value?.position),
  });
}

function message(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "Audio operation failed";
  return [...raw].slice(0, 256).join("") || "Audio operation failed";
}

export function createSilentAudioDriver(): AudioDriver {
  let disposed = false;
  return Object.freeze({
    available: false,
    async unlock(): Promise<void> { if (disposed) throw new Error("Audio driver has been disposed"); },
    play(): AudioVoice {
      if (disposed) throw new Error("Audio driver has been disposed");
      let stopped = false;
      return Object.freeze({
        get stopped(): boolean { return stopped; },
        setVolume(value: number): void { volume(value, "Audio voice volume"); },
        stop(): void { stopped = true; },
      });
    },
    dispose(): void { disposed = true; },
  });
}

export function createWebAudioDriver(context: unknown): AudioDriver {
  if (!(typeof AudioContext !== "undefined" && context instanceof AudioContext) &&
      !(typeof OfflineAudioContext !== "undefined" && context instanceof OfflineAudioContext)) {
    throw new TypeError("Web Audio context is invalid");
  }
  const audioContext = context;
  const voices = new Set<AudioVoice>();
  let disposed = false;
  return Object.freeze({
    available: true,
    async unlock(): Promise<void> {
      if (disposed) throw new Error("Audio driver has been disposed");
      if ("resume" in audioContext && typeof audioContext.resume === "function") await audioContext.resume();
    },
    play(buffer: unknown, options: Required<Omit<AudioPlayOptions, "position">> & { readonly position: AudioPosition | null }): AudioVoice {
      if (disposed) throw new Error("Audio driver has been disposed");
      if (!(buffer instanceof AudioBuffer)) throw new TypeError("Web Audio clip must be an AudioBuffer");
      const source = audioContext.createBufferSource();
      const gain = audioContext.createGain();
      source.buffer = buffer;
      source.loop = options.loop;
      source.playbackRate.value = options.playbackRate;
      gain.gain.value = options.volume;
      let output: AudioNode = gain;
      let panner: PannerNode | null = null;
      if (options.position !== null) {
        panner = audioContext.createPanner();
        panner.positionX.value = options.position.x;
        panner.positionY.value = options.position.y;
        panner.positionZ.value = options.position.z;
        gain.connect(panner);
        output = panner;
      }
      output.connect(audioContext.destination);
      source.connect(gain);
      let stopped = false;
      let voice: AudioVoice;
      const stop = (): void => {
        if (stopped) return;
        stopped = true;
        try { source.stop(); } catch {}
        source.disconnect();
        gain.disconnect();
        panner?.disconnect();
        voices.delete(voice);
      };
      voice = Object.freeze({
        get stopped(): boolean { return stopped; },
        setVolume(value: number): void { if (!stopped) gain.gain.value = volume(value, "Audio voice volume"); },
        stop,
      });
      source.addEventListener("ended", stop, { once: true });
      source.start();
      voices.add(voice);
      return voice;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const voice of [...voices]) voice.stop();
      voices.clear();
    },
  });
}

export function createAudioRuntime(driver: AudioDriver = createSilentAudioDriver()): AudioRuntime {
  if (typeof driver !== "object" || driver === null || typeof driver.unlock !== "function" ||
      typeof driver.play !== "function" || typeof driver.dispose !== "function") {
    throw new TypeError("Audio driver is invalid");
  }
  const clips = new Map<string, unknown>();
  const voices = new Map<AudioVoice, { readonly bus: AudioBusId; readonly baseVolume: number }>();
  const buses = new Map<AudioBusId, number>([["master", 1], ["music", 1], ["effects", 1]]);
  let music: AudioVoice | null = null;
  let unlocked = false;
  let muted = false;
  let disposed = false;

  function effective(bus: AudioBusId, base: number): number {
    if (muted) return 0;
    return base * (buses.get("master") ?? 1) * (bus === "master" ? 1 : (buses.get(bus) ?? 1));
  }

  function refresh(): void {
    for (const [voice, state] of voices) {
      if (voice.stopped) voices.delete(voice);
      else voice.setVolume(effective(state.bus, state.baseVolume));
    }
  }

  function requireActive(): void { if (disposed) throw new Error("Audio runtime has been disposed"); }

  const runtime: AudioRuntime = Object.freeze({
    get disposed(): boolean { return disposed; },
    registerClip(rawId: string, buffer: unknown): void {
      requireActive();
      const clipId = stableId(rawId, "Audio clip ID");
      if (buffer === undefined || buffer === null) throw new TypeError("Audio clip buffer is required");
      if (clips.has(clipId)) throw new TypeError(`Duplicate audio clip ID: ${clipId}`);
      clips.set(clipId, buffer);
    },
    async unlock() {
      requireActive();
      try { await driver.unlock(); unlocked = true; return Object.freeze({ ok: true as const }); }
      catch (cause) { return Object.freeze({ ok: false as const, message: message(cause) }); }
    },
    play(rawId: string, rawOptions?: AudioPlayOptions): AudioPlayOutcome {
      if (disposed) return Object.freeze({ ok: false, failure: Object.freeze({ code: "disposed-resource", message: "Audio runtime has been disposed" }) });
      const clipId = stableId(rawId, "Audio clip ID");
      const buffer = clips.get(clipId);
      if (buffer === undefined) return Object.freeze({ ok: false, failure: Object.freeze({ code: "unknown-clip", message: `Unknown audio clip: ${clipId}` }) });
      const options = playOptions(rawOptions);
      try {
        const voice = driver.play(buffer, { ...options, volume: effective(options.bus, options.volume) });
        voices.set(voice, { bus: options.bus, baseVolume: options.volume });
        return Object.freeze({ ok: true, value: voice });
      } catch (cause) {
        return Object.freeze({ ok: false, failure: Object.freeze({ code: "play-failed", message: message(cause) }) });
      }
    },
    playEffect(rawId: string, rawOptions = {}): AudioPlayOutcome {
      return runtime.play(rawId, { ...rawOptions, bus: "effects" });
    },
    playMusic(rawId: string, rawOptions = {}): AudioPlayOutcome {
      music?.stop();
      const outcome = runtime.play(rawId, { ...rawOptions, bus: "music", loop: true });
      if (outcome.ok) music = outcome.value;
      return outcome;
    },
    setBusVolume(rawBus: AudioBusId, rawVolume: number): void {
      requireActive();
      buses.set(stableId(rawBus, "Audio bus ID") as AudioBusId, volume(rawVolume, "Audio bus volume"));
      refresh();
    },
    setMuted(value: boolean): void {
      requireActive();
      if (typeof value !== "boolean") throw new TypeError("Audio muted state must be boolean");
      muted = value;
      refresh();
    },
    stopAll(bus?: AudioBusId): void {
      requireActive();
      const selected = bus === undefined ? null : stableId(bus, "Audio bus ID");
      for (const [voice, state] of [...voices]) {
        if (selected === null || state.bus === selected) { voice.stop(); voices.delete(voice); }
      }
      if (music?.stopped === true) music = null;
    },
    inspect(): AudioInspection {
      refresh();
      return Object.freeze({
        disposed,
        available: driver.available,
        unlocked,
        muted,
        registeredClipIds: Object.freeze([...clips.keys()]),
        activeVoiceCount: voices.size,
        busVolumes: Object.freeze(Object.fromEntries(buses)),
      });
    },
    dispose(): void {
      if (disposed) return;
      for (const voice of voices.keys()) voice.stop();
      voices.clear();
      clips.clear();
      music = null;
      disposed = true;
      driver.dispose();
    },
  });
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

export function createAudioFeature(runtime: AudioRuntime): ClientFeatureDescriptor<EmptyConfiguration> {
  if (typeof runtime !== "object" || runtime === null || typeof runtime.play !== "function" || typeof runtime.dispose !== "function") {
    throw new TypeError("Audio Feature runtime is invalid");
  }
  let disposed = false;
  return Object.freeze({
    id: "audio",
    description: "Owns browser audio playback, buses, unlock, fallback, and cleanup",
    runtimeContributions: Object.freeze([]),
    requires: Object.freeze([]),
    conflicts: Object.freeze([]),
    configuration: EMPTY_CONFIGURATION,
    setup(): void { if (disposed) throw new Error("Audio Feature has been disposed"); },
    dispose(): void { if (!disposed) { disposed = true; runtime.dispose(); } },
  });
}
