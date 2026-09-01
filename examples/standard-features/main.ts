import * as THREE from "three";
import { createDeterministicPresentationFrameSource } from "@three-game-kit/core";
import { createClientRuntime } from "@three-game-kit/client";
import { createAssetManager, createAssetManagerFeature, createThreeAssetBackend } from "@three-game-kit/client/asset-manager";
import { createAudioFeature, createAudioRuntime, createWebAudioDriver } from "@three-game-kit/client/audio";
import { createAnimationFeature, createThreeAnimationRuntime } from "@three-game-kit/client/animation";
import { createCharacterController, createCharacterControllerFeature } from "@three-game-kit/client/character-controller";
import { createRapierCollisionAdapter } from "@three-game-kit/client/collision";

interface Report {
  readonly ready: boolean;
  readonly loaded: boolean;
  readonly audio: { readonly available: boolean; readonly unlocked: boolean; readonly disposed: boolean };
  readonly animation: { readonly state: string | null; readonly elapsedSeconds: number; readonly disposed: boolean };
  readonly character: { readonly ticks: number; readonly grounded: boolean; readonly disposed: boolean };
  readonly assets: { readonly completed: number; readonly disposed: boolean };
  readonly shutdown: { readonly clean: boolean; readonly disposedOrder: readonly string[] };
}

declare global { interface Window { __THREE_GAME_KIT_STANDARD__?: Report; } }

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing Standard Features element: ${selector}`);
  return element;
}

const button = requireElement<HTMLButtonElement>("#run");
const status = requireElement<HTMLElement>("#status");

button.addEventListener("click", () => { void run(); }, { once: true });

async function run(): Promise<void> {
  button.disabled = true;
  const audioContext = new AudioContext();
  const audio = createAudioRuntime(createWebAudioDriver(audioContext));
  audio.registerClip("click", audioContext.createBuffer(1, 128, audioContext.sampleRate));
  const unlock = await audio.unlock();
  if (!unlock.ok) throw new Error(unlock.message);
  if (!audio.playEffect("click", { volume: 0.1 }).ok) throw new Error("Audio playback failed");

  const assets = createAssetManager([
    { id: "avatar", kind: "gltf", source: new URL("../local-browser/avatar.gltf", import.meta.url).href, groups: ["boot"] },
    { id: "pixel", kind: "texture", source: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xz6mAAAAAElFTkSuQmCC", groups: ["boot"] },
    { id: "click", kind: "audio", source: "generated://click", groups: ["boot"] },
  ], createThreeAssetBackend({ loadAudio: async () => audioContext.createBuffer(1, 128, audioContext.sampleRate) }));
  const preload = await assets.preloadGroup("boot");
  const loaded = preload.length === 3 && preload.every((outcome) => outcome.ok);
  if (!loaded) throw new Error("Standard avatar preload failed");

  const root = new THREE.Object3D();
  const animation = createThreeAnimationRuntime({
    root,
    clips: [new THREE.AnimationClip("idle", 1, [])].map((clip) => ({ id: "idle", clip })),
    states: { idle: "idle" },
  });
  const collision = createRapierCollisionAdapter({
    capsuleRadius: 0.5,
    capsuleHalfHeight: 0.5,
    controllerOffset: 0.01,
    boxes: [{ id: "floor", center: { x: 0, y: -0.1, z: 0 }, halfExtents: { x: 10, y: 0.1, z: 10 } }],
  });
  const character = createCharacterController({
    collision,
    initialPosition: { x: 0, y: 1.01, z: 0 },
    configuration: { walkSpeed: 3, runSpeed: 6, gravity: 9.8, jumpSpeed: 5, maximumFallSpeed: 30 },
  });
  const published = [] as ReturnType<typeof character.inspect>[];
  const runtime = createClientRuntime({
    frameSource: createDeterministicPresentationFrameSource(),
    features: [
      createAssetManagerFeature(assets),
      createAudioFeature(audio),
      createAnimationFeature({ runtime: animation, readState: () => "idle" }),
      createCharacterControllerFeature({
        controller: character,
        readInput: () => ({ x: 1, z: 0, run: false, jump: false }),
        publish: (state) => published.push(state),
      }),
    ],
  });
  const boot = await runtime.boot();
  if (boot.state !== "running") throw new Error("Standard Feature runtime failed to boot");
  const stepped = runtime.stepExact(3);
  if (!stepped.ok) throw new Error("Standard Feature runtime failed to step");
  const beforeShutdown = {
    audio: audio.inspect(),
    animation: animation.inspect(),
    character: character.inspect(),
    assets: assets.inspect(),
  };
  const shutdown = await runtime.shutdown();
  await audioContext.close();

  const report: Report = Object.freeze({
    ready: true,
    loaded,
    audio: Object.freeze({ available: beforeShutdown.audio.available, unlocked: beforeShutdown.audio.unlocked, disposed: audio.disposed }),
    animation: Object.freeze({ state: beforeShutdown.animation.activeState, elapsedSeconds: beforeShutdown.animation.elapsedSeconds, disposed: animation.disposed }),
    character: Object.freeze({ ticks: published.length, grounded: beforeShutdown.character.grounded, disposed: character.disposed }),
    assets: Object.freeze({ completed: beforeShutdown.assets.progress.completed, disposed: assets.disposed }),
    shutdown: Object.freeze({ clean: shutdown.clean, disposedOrder: shutdown.disposedOrder }),
  });
  window.__THREE_GAME_KIT_STANDARD__ = report;
  status.textContent = JSON.stringify(report, null, 2);
}
