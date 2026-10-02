import { Runtime } from "@three-game-kit/client";
import {
  createInputFeature,
  createMovementInput,
  createSemanticActionInput,
} from "@three-game-kit/client/input";
import {
  createCharacterController,
  createCharacterControllerFeature,
} from "@three-game-kit/client/character-controller";
import { createRapierCollisionAdapter } from "@three-game-kit/client/collision";
import {
  createAnimationCharacterSet,
  createAnimationFeature,
  createThreeAnimationRuntime,
} from "@three-game-kit/client/animation";
import {
  createAssetManagerFeature,
  type AssetManager,
} from "@three-game-kit/client/asset-manager";
import { createCameraFeature } from "@three-game-kit/client/camera";
import { createRenderingFeature } from "@three-game-kit/client/rendering";
import {
  createHudFeature,
  type HudAdapter,
} from "@three-game-kit/client/gameplay";
import {
  createHudStateStore,
  createTriggerAreaRuntime,
} from "@three-game-kit/shared/gameplay";
import {
  createDeterministicPresentationFrameSource,
  defineFeatureConfiguration,
  type ClientFeatureDescriptor,
} from "@three-game-kit/core";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { CourtRenderer } from "./renderer.js";
import {
  COLLISION_SCENE,
  DT,
  FOOT_OFFSET,
  LANTERN,
  SPAWN,
  type Action,
  type Locomotion,
} from "./world.js";

export async function createCourtGame(
  assets: AssetManager,
  visitor: GLTF,
  renderer: CourtRenderer,
  hudAdapter: HudAdapter,
) {
  const input = createMovementInput(),
    actions = createSemanticActionInput(["jump", "interact"] as const);
  const controller = createCharacterController({
    collision: createRapierCollisionAdapter(COLLISION_SCENE),
    initialPosition: SPAWN,
    configuration: {
      walkSpeed: 2.4,
      runSpeed: 4.8,
      gravity: 18,
      jumpSpeed: 6,
      maximumFallSpeed: 20,
    },
  });

  const proximity = createTriggerAreaRuntime([
    {
      id: LANTERN.entityId,
      shape: "sphere",
      center: LANTERN.position,
      radius: LANTERN.range,
    },
  ]);
  const hud = createHudStateStore();
  const frames = createDeterministicPresentationFrameSource();
  let phase: "title" | "playing" | "disposed" = "title",
    yaw = 0,
    facing = Math.PI,
    run = false,
    jump = false;
  let move = { x: 0, z: 0 },
    interactionRequests = 0,
    active = false,
    nearby = false,
    toggles = 0,
    rejected = 0;
  let locomotion: Locomotion = "idle",
    accumulator = 0,
    timeMs = 0,
    resetTick = 0;
  let disposal: Promise<void> | undefined;
  const characters = createAnimationCharacterSet();
  function attachAnimation() {
    characters.add(
      "visitor",
      createThreeAnimationRuntime({
        root: visitor.scene,
        clips: visitor.animations.map((clip) => ({ id: clip.name, clip })),
        states: {
          idle: { clip: "idle", crossFadeSeconds: 0.18 },
          walk: { clip: "walk", crossFadeSeconds: 0.18 },
          run: { clip: "run", crossFadeSeconds: 0.18 },
        },
        initialState: "idle",
      }),
      () => locomotion,
    );
  }
  attachAnimation();
  const empty = defineFeatureConfiguration<Readonly<Record<string, never>>>({
    defaultValue: () => Object.freeze({}),
    parse: (v) =>
      typeof v === "object" && v !== null && Reflect.ownKeys(v).length === 0
        ? { ok: true, value: Object.freeze({}) }
        : { ok: false, issues: [{ path: [], code: "empty-object-required" }] },
  });
  const contribution = {
    kind: "system" as const,
    id: "metaverse.rules.publish",
    domain: "client-simulation" as const,
    phase: "presentation-publish" as const,
    priority: -100,
    run() {
      const state = controller.inspect();
      nearby = proximity
        .step(state.tick, [{ id: "visitor", position: state.position }])
        .some((e) => e.kind !== "exit");
      if (interactionRequests > 0 && phase === "playing") {
        if (nearby) {
          if (interactionRequests % 2 === 1) active = !active;
          toggles += interactionRequests;
        } else rejected += interactionRequests;
      }
      interactionRequests = 0;
      const speed = Math.hypot(state.velocity.x, state.velocity.z);
      locomotion =
        phase === "playing" && speed > 0.05 ? (run ? "run" : "walk") : "idle";
      if (speed > 0.05) facing = Math.atan2(state.velocity.x, state.velocity.z);
      renderer.prepare(state.position, facing, active);
      publishHud();
    },
  };
  const rules: ClientFeatureDescriptor<Readonly<Record<string, never>>> = {
    id: "metaverse.rules",
    description: "Local visitor and lantern rules",
    requires: [],
    conflicts: [],
    configuration: empty,
    runtimeContributions: [contribution],
    setup({ ledger }) {
      ledger.activateSystem(contribution.id);
    },
    dispose() {
      input.dispose();
      actions.dispose();
      proximity.dispose();
    },
  };
  const runtime = new Runtime({
    driver: "exact",
    frameSource: frames,
    features: [
      createInputFeature({
        input,
        actions,
        publish: (command) => {
          move = { x: command.x, z: command.z };
        },
        publishAction: (a) => {
          if (phase === "playing") {
            if (a === "jump") jump = true;
            if (a === "interact") interactionRequests++;
          }
        },
      }),
      createAssetManagerFeature(assets),
      rules,
      createCharacterControllerFeature({
        controller,
        readInput() {
          const c = Math.cos(yaw),
            s = Math.sin(yaw);
          const isPlaying = phase === "playing";
          const result = {
            x: isPlaying ? move.x * c - move.z * s : 0,
            z: isPlaying ? move.x * s + move.z * c : 0,
            run,
            jump: isPlaying && jump,
          };
          jump = false;
          return result;
        },
        publish: () => {},
      }),
      createAnimationFeature({ characters }),
      createCameraFeature({
        readTarget: () => {
          const p = controller.inspect().position;
          return { x: p.x, y: p.y - FOOT_OFFSET, z: p.z };
        },
        readConfiguration: () => ({
          distance: 6.5,
          height: 3.8,
          lookAtHeight: 1.2,
          yawRadians: yaw,
        }),
        publish: (t) => renderer.setCamera(t),
      }),
      createHudFeature({ store: hud, adapter: hudAdapter }),
      createRenderingFeature({ renderer }),
    ],
  });
  function publishHud() {
    hud.update({
      screen: phase,
      extras: {
        prompt: nearby
          ? `${active ? "Extinguish" : "Light"} the courtyard lantern`
          : "Find the lantern in the central mosaic",
        movement: locomotion,
        lantern: active ? "The court is glowing." : "A quiet place to meet.",
        profile: "Visitor · Lantern Court",
      },
    });
  }
  publishHud();
  const boot = await runtime.start();
  if (boot.state !== "running") {
    await runtime.shutdown();
    throw new Error(`Court runtime boot failed: ${boot.state}`);
  }
  const presentation = runtime.startPresentation();
  if (!presentation.ok) {
    await runtime.shutdown();
    throw new Error("Court presentation failed to start");
  }
  function present() {
    if (phase !== "disposed") {
      timeMs += DT * 1000;
      frames.deliver(timeMs);
    }
  }
  renderer.prepare(controller.inspect().position, facing, active);
  present();
  return {
    start() {
      if (phase === "title") {
        phase = "playing";
        publishHud();
        present();
      }
    },
    reset() {
      if (phase === "disposed") return;
      phase = "playing";
      input.reset();
      actions.reset();
      controller.teleport(SPAWN);
      run = false;
      jump = false;
      move = { x: 0, z: 0 };
      interactionRequests = 0;
      active = false;
      nearby = false;
      toggles = 0;
      rejected = 0;
      locomotion = "idle";
      yaw = 0;
      facing = Math.PI;
      accumulator = 0;
      resetTick = controller.inspect().tick;
      characters.remove("visitor");
      attachAnimation();
      renderer.prepare(SPAWN, facing, false);
      publishHud();
      present();
    },
    setMove(x: number, z: number, running = false) {
      if (phase !== "disposed") {
        input.setMovement(x, z);
        run = running;
      }
    },
    setLook(radians: number) {
      if (!Number.isFinite(radians))
        throw new TypeError("Camera yaw must be finite");
      if (phase !== "disposed") yaw = radians;
    },
    press(action: Action) {
      if (phase !== "disposed") actions.press(action);
    },
    advance(seconds: number) {
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 20)
        throw new RangeError("Advance seconds must be in [0,20]");
      if (phase === "disposed") return 0;
      accumulator += seconds;
      let steps = 0;
      while (accumulator >= DT - 1e-9) {
        const result = runtime.stepExact(1);
        if (!result.ok) throw new Error("Court simulation failed");
        accumulator -= DT;
        steps++;
      }
      present();
      return steps;
    },
    snapshot() {
      const c = controller.inspect();
      return Object.freeze({
        phase,
        tick: c.tick - resetTick,
        avatar: Object.freeze({
          entityId: "visitor",
          profile: Object.freeze({
            name: "Visitor",
            appearanceId: "court-visitor-v1",
          }),
          position: c.position,
          velocity: c.velocity,
          grounded: c.grounded,
          collided: c.collided,
          facing,
          locomotion,
        }),
        interaction: Object.freeze({
          ...LANTERN,
          active,
          nearby,
          toggles,
          rejected,
        }),
        camera: Object.freeze({ yaw }),
      });
    },
    inspectAnimation: () => characters.get("visitor")?.inspect() ?? null,
    inspectRuntime: () => runtime.inspectLifecycle(),
    inspectAssets: () => assets.inspect(),
    errors: () => runtime.snapshotTelemetry().structuredRuntimeErrors,
    inspectLeaks: () => ({
      phase,
      controllerDisposed: controller.disposed,
      animationDisposed: characters.disposed,
      proximityDisposed: proximity.disposed,
      assetsDisposed: assets.disposed,
      hudDisposed: hud.disposed,
      renderer: renderer.inspect(),
      lifecycle: runtime.state,
    }),
    dispose() {
      if (!disposal) {
        phase = "disposed";
        disposal = runtime.shutdown().then(() => undefined);
      }
      return disposal;
    },
  };
}
export type CourtGame = Awaited<ReturnType<typeof createCourtGame>>;
