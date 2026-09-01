import {
  SIMULATION_DT_SECONDS,
  defineFeatureConfiguration,
  type ClientFeatureBootResult,
  type ClientFeatureDescriptor,
  type PresentationFrameSource,
} from "@three-game-kit/core";
import {
  Runtime,
  createBrowserPresentationFrameSource,
  createClientRuntime,
  createRuntime,
  type ClientRuntime,
  type RuntimeOptions,
} from "@three-game-kit/client";
import {
  createInputFeature,
  createMovementInput,
  createSemanticActionInput,
  type InputFeatureOptions,
  type MovementCommandSource,
  type MovementInput,
  type SemanticActionInput,
  type SemanticActionSource,
} from "@three-game-kit/client/input";
import {
  createCameraFeature,
  createThirdPersonCameraTransform,
  type CameraFeatureOptions,
  type CameraVector3,
  type ThirdPersonCameraConfiguration,
  type ThirdPersonCameraTransform,
} from "@three-game-kit/client/camera";
import {
  createCollisionFeature,
  createRapierCollisionAdapter,
  type ClientCollisionAdapter,
  type CollisionFeatureOptions,
  type CollisionMoveFailure,
  type CollisionMoveOutcome,
} from "@three-game-kit/client/collision";
import {
  createRenderingFeature,
  createThreeRenderer,
  type ClientRendererAdapter,
  type RenderingFeatureAdapter,
  type RendererCameraTransform,
  type RendererVector3,
  type RenderingSnapshot,
} from "@three-game-kit/client/rendering";
import {
  createVfxFeature,
  createVfxRuntime,
  type VfxBurstCommand,
  type VfxCommand,
  type VfxInspection,
  type VfxRuntime,
  type VfxRuntimeOptions,
  type VfxSceneParent,
} from "@three-game-kit/client/vfx";
import {
  createGltfAvatarLoader,
  type AssetCause,
  type GltfAvatarAsset,
  type GltfAvatarLoadFailure,
  type GltfAvatarLoadOutcome,
  type GltfAvatarLoader,
} from "@three-game-kit/client/assets";
import {
  createAudioFeature,
  createAudioRuntime,
  createSilentAudioDriver,
  type AudioInspection,
  type AudioPlayOutcome,
  type AudioRuntime,
} from "@three-game-kit/client/audio";
import {
  createAssetManager,
  createAssetManagerFeature,
  createThreeAssetBackend,
  type AssetBackend,
  type AssetManager,
  type AssetManagerOutcome,
  type AssetManifestEntry,
} from "@three-game-kit/client/asset-manager";
import {
  createAnimationFeature,
  createThreeAnimationRuntime,
  type AnimationClipRegistration,
  type AnimationInspection,
  type AnimationRuntime,
} from "@three-game-kit/client/animation";
import {
  createCharacterController,
  createCharacterControllerFeature,
  type CharacterController,
  type CharacterControllerInput,
  type CharacterControllerState,
} from "@three-game-kit/client/character-controller";
import {
  createNativeClientTransport,
  type Binding as NativeClientTransportBinding,
  type ErrorCounts as NativeClientTransportErrorCounts,
  type Inspection as NativeClientTransportInspection,
  type LiveResourceCounts as NativeClientTransportLiveResourceCounts,
  type NativeClientTransport,
  type NativeClientTransportState,
  type OutboundMessage as NativeClientTransportOutboundMessage,
  type Options as NativeClientTransportOptions,
  type Outcome as NativeClientTransportOutcome,
} from "@three-game-kit/client/networking";
import {
  createClientReplicationEngine,
  type ClientActionIntent,
  type ClientInteractablePresentationInspection,
  type ClientInteractIntent,
  type ClientMoveIntent,
  type ClientPresentationState,
  type ClientReplicationEngine,
  type ClientReplicationInspection,
  type ClientReplicationLiveResourceCounts,
  type ClientReplicationOptions,
  type ClientReplicationOutcome,
  type ClientReplicationState,
} from "@three-game-kit/client/replication";
import {
  createGameFlowClientFeature,
  createHealthClientFeature,
  createHudFeature,
  createSpawnPrefabClientFeature,
  createTriggerAreaClientFeature,
  type HudAdapter,
} from "@three-game-kit/client/gameplay";
import {
  createGameFlowRuntime,
  createHealthRuntime,
  createHudStateStore,
  createSpawnPrefabRuntime,
  createTriggerAreaRuntime,
} from "@three-game-kit/shared/gameplay";

const gameplayTrigger = createTriggerAreaRuntime([]);
const gameplayHealth = createHealthRuntime();
const gameplaySpawn = createSpawnPrefabRuntime([{ id: "entity" }], {
  create: () => ({}), reuse() {}, release() {},
});
const gameplayFlow = createGameFlowRuntime({ states: [{ id: "boot", allowedTo: [] }], initialState: "boot" });
const gameplayHud = createHudStateStore();
const gameplayHudAdapter: HudAdapter = {
  disposed: false,
  render() {},
  inspect: () => ({ disposed: false, renderCount: 0, lastRevision: null, listenerActive: false }),
  dispose() {},
};
const gameplayFeatures: readonly ClientFeatureDescriptor<unknown>[] = [
  createTriggerAreaClientFeature({ runtime: gameplayTrigger, readActors: () => [], publish() {} }),
  createHealthClientFeature({ runtime: gameplayHealth, publish() {} }),
  createSpawnPrefabClientFeature(gameplaySpawn),
  createGameFlowClientFeature(gameplayFlow),
  createHudFeature({ store: gameplayHud, adapter: gameplayHudAdapter }),
];
void gameplayFeatures;

const configuration = defineFeatureConfiguration({
  defaultValue: () => ({ enabled: true }),
  parse: (input: unknown) =>
    typeof input === "object" &&
    input !== null &&
    "enabled" in input &&
    typeof input.enabled === "boolean"
      ? { ok: true as const, value: { enabled: input.enabled } }
      : {
          ok: false as const,
          issues: [{ path: ["enabled"], code: "boolean-required" }],
        },
});

const feature: ClientFeatureDescriptor<{ enabled: boolean }> = {
  id: "typed-client-feature",
  description: "Exercises the public Client Runtime boundary",
  runtimeContributions: [
    {
      kind: "system",
      id: "typed-client-system",
      domain: "client-simulation",
      phase: "shared-predict",
      priority: 0,
      run: ({ dt }) => {
        const exactDt: typeof SIMULATION_DT_SECONDS = dt;
        void exactDt;
      },
    },
  ],
  requires: [],
  conflicts: [],
  configuration,
  setup({ configuration: received, ledger }) {
    if (received.enabled) ledger.activateSystem("typed-client-system");
  },
  dispose() {},
};

const frameSource: PresentationFrameSource =
  createBrowserPresentationFrameSource(
    (callback: (timestampMs: number) => void): number => {
      void callback;
      return 1;
    },
    (request: number) => {
      void request;
    },
  );
const options: RuntimeOptions = { features: [feature], frameSource };
const fromConstructor: ClientRuntime = new Runtime(options);
const fromFactory: ClientRuntime = createClientRuntime(options);
const fromAlias: ClientRuntime = createRuntime(options);
const boot: Promise<ClientFeatureBootResult> = fromFactory.start();
void fromConstructor;
void fromAlias;
void boot;

function exerciseM2ClientSubpaths(canvas: unknown): void {
  const movementInput: MovementInput = createMovementInput({
    kind: "move",
    x: 0,
    z: 0,
  });
  const movementSource: MovementCommandSource = movementInput;
  const inputOptions: InputFeatureOptions = {
    input: movementSource,
    publish(command) {
      movementInput.setMovement(command);
    },
  };
  const actions: SemanticActionInput<"jump" | "dash"> =
    createSemanticActionInput(["jump", "dash"]);
  const actionSource: SemanticActionSource<"jump" | "dash"> = actions;
  const actionInputOptions: InputFeatureOptions = {
    ...inputOptions,
    actions: actionSource,
    publishAction(action) {
      const semanticAction: string = action;
      void semanticAction;
    },
  };
  const inputFeature = createInputFeature(actionInputOptions);

  const cameraTarget: CameraVector3 = { x: 0, y: 1, z: 0 };
  const cameraConfiguration: ThirdPersonCameraConfiguration = {
    distance: 6,
    height: 3,
    lookAtHeight: 1,
    yawRadians: 0,
  };
  const cameraTransform: ThirdPersonCameraTransform =
    createThirdPersonCameraTransform(cameraTarget, cameraConfiguration);
  const cameraOptions: CameraFeatureOptions = {
    readTarget: () => cameraTarget,
    configuration: cameraConfiguration,
    publish(transform) {
      const position: CameraVector3 = transform.position;
      void position;
    },
  };
  const cameraFeature = createCameraFeature(cameraOptions);
  const dynamicCameraOptions: CameraFeatureOptions = {
    readTarget: () => cameraTarget,
    readConfiguration: () => cameraConfiguration,
    publish(transform) {
      void transform;
    },
  };
  const dynamicCameraFeature = createCameraFeature(dynamicCameraOptions);

  const collisionAdapter: ClientCollisionAdapter =
    createRapierCollisionAdapter({
      capsuleRadius: 0.5,
      capsuleHalfHeight: 0.5,
      controllerOffset: 0.01,
      boxes: [],
    });
  const collisionOutcome: CollisionMoveOutcome = collisionAdapter.move(
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 0 },
  );
  const collisionFailure: CollisionMoveFailure = {
    code: "disposed-resource",
  };
  const collisionOptions: CollisionFeatureOptions = {
    adapter: collisionAdapter,
    readStartPosition: () => ({ x: 0, y: 1, z: 0 }),
    readDesiredTranslation: () => ({ x: 0, y: 0, z: 0 }),
    publish(result) {
      const collided: boolean = result.collided;
      void collided;
    },
  };
  const collisionFeature = createCollisionFeature(collisionOptions);

  const rendererVector: RendererVector3 = { x: 0, y: 1, z: 0 };
  const rendererCameraTransform: RendererCameraTransform = {
    position: { x: 4, y: 3, z: 6 },
    lookAt: rendererVector,
  };
  const renderer: ClientRendererAdapter = createThreeRenderer(canvas);
  renderer.setAvatarPosition(rendererVector);
  renderer.setCameraTransform(rendererCameraTransform);
  const renderingSnapshot: RenderingSnapshot = renderer.snapshot();
  const renderingFeature = createRenderingFeature({ renderer });
  const renderingAdapter: RenderingFeatureAdapter = {
    render() {},
    dispose() {},
  };
  const customRenderingFeature = createRenderingFeature({
    renderer: renderingAdapter,
  });

  const assetCause: AssetCause = {
    name: "Error",
    code: null,
    message: "load failed",
  };
  const loadFailure: GltfAvatarLoadFailure = {
    code: "load-failed",
    cause: assetCause,
  };
  const avatarAsset: GltfAvatarAsset = {
    source: "/avatar.gltf",
    clipCount: 0,
    disposed: false,
    advance(seconds) {
      void seconds;
    },
    dispose() {},
  };
  const loadOutcome: GltfAvatarLoadOutcome = {
    ok: false,
    failure: loadFailure,
  };
  const loader: GltfAvatarLoader = createGltfAvatarLoader();
  const pendingLoad: Promise<GltfAvatarLoadOutcome> =
    loader.load("/avatar.gltf");
  renderer.attachAvatarAsset(avatarAsset);

  void inputFeature;
  void cameraTransform;
  void cameraFeature;
  void dynamicCameraFeature;
  void collisionOutcome;
  void collisionFailure;
  void collisionFeature;
  void renderingSnapshot;
  void renderingFeature;
  void customRenderingFeature;
  void loadOutcome;
  void pendingLoad;
}
void exerciseM2ClientSubpaths;

function exerciseVfx(parent: VfxSceneParent): void {
  const options: VfxRuntimeOptions = {
    commandCapacity: 32,
    burstEffectCapacity: 4,
    trailEffectCapacity: 8,
    popupEffectCapacity: 4,
    maxBurstParticles: 64,
  };
  const runtime: VfxRuntime = createVfxRuntime(parent, options);
  const burst: VfxBurstCommand = {
    kind: "burst",
    position: { x: 0, y: 1, z: 0 },
    count: 12,
    color: 0x38f0ff,
    speed: 3,
    lifetimeMs: 800,
    seed: 42,
  };
  const command: VfxCommand = burst;
  runtime.enqueue(command);
  runtime.present(0);
  const inspection: VfxInspection = runtime.inspect();
  const feature: ClientFeatureDescriptor<unknown> = createVfxFeature({ runtime });

  // @ts-expect-error VFX commands are readonly.
  burst.seed = 7;
  // @ts-expect-error VFX inspection counters are readonly.
  inspection.counters.submittedCommandCount = 0;

  void feature;
}
void exerciseVfx;

function exercisePrioritySFeatures(collision: ClientCollisionAdapter): void {
  const audio: AudioRuntime = createAudioRuntime(createSilentAudioDriver());
  audio.registerClip("click", {});
  const audioOutcome: AudioPlayOutcome = audio.playEffect("click");
  const audioInspection: AudioInspection = audio.inspect();
  const audioFeature: ClientFeatureDescriptor<unknown> = createAudioFeature(audio);

  const manifest: readonly AssetManifestEntry[] = [{
    id: "hero",
    kind: "gltf",
    source: "/hero.gltf",
    groups: ["boot"],
  }];
  const backend: AssetBackend = createThreeAssetBackend();
  const assets: AssetManager = createAssetManager(manifest, backend);
  const assetOutcome: Promise<AssetManagerOutcome> = assets.load("hero");
  const assetFeature: ClientFeatureDescriptor<unknown> = createAssetManagerFeature(assets);

  const input: CharacterControllerInput = { x: 0, z: 0, run: false, jump: false };
  const controller: CharacterController = createCharacterController({
    collision,
    initialPosition: { x: 0, y: 1, z: 0 },
    configuration: { walkSpeed: 3, runSpeed: 6, gravity: 9.8, jumpSpeed: 5, maximumFallSpeed: 30 },
  });
  const state: CharacterControllerState = controller.inspect();
  const controllerFeature: ClientFeatureDescriptor<unknown> = createCharacterControllerFeature({
    controller,
    readInput: () => input,
    publish(value) { void value; },
  });

  const registrations: readonly AnimationClipRegistration[] = [];
  const animationFactory: typeof createThreeAnimationRuntime = createThreeAnimationRuntime;
  const animationFeatureFactory: typeof createAnimationFeature = createAnimationFeature;
  const animationRuntime: AnimationRuntime | null = null;
  const animationInspection: AnimationInspection | null = animationRuntime;

  // @ts-expect-error Public audio inspection is readonly.
  audioInspection.muted = false;
  // @ts-expect-error Public Character Controller state is readonly.
  state.grounded = true;

  void audioOutcome;
  void audioFeature;
  void assetOutcome;
  void assetFeature;
  void controllerFeature;
  void registrations;
  void animationFactory;
  void animationFeatureFactory;
  void animationInspection;
}
void exercisePrioritySFeatures;

function exerciseM3ClientSubpaths(): void {
  const networkingOptions: NativeClientTransportOptions = {
    url: "wss://example.invalid/game",
    receive(message) {
      void message;
    },
  };
  const outboundMessage: NativeClientTransportOutboundMessage = {
    direction: "c2s",
    routeOrdinal: 1,
    messageOrdinal: 1,
    operation: "command",
    text: "encoded",
  };
  const gatedNetworkingOptions: NativeClientTransportOptions = {
    url: "ws://localhost:3000",
    receive(message) {
      void message;
    },
    routeOrdinal: 1,
    outboundGate(metadata) {
      const typed: NativeClientTransportOutboundMessage = metadata;
      return Promise.resolve().then(() => {
        void typed.text;
      });
    },
  };
  // @ts-expect-error Public outbound metadata is readonly.
  outboundMessage.text = "replacement";
  const invalidOutboundDirection: NativeClientTransportOutboundMessage = {
    ...outboundMessage,
    // @ts-expect-error Outbound direction is fixed to Client-to-Server.
    direction: "s2c",
  };
  const nativeTransport: NativeClientTransport =
    createNativeClientTransport(networkingOptions);
  const networkingConnectOutcome: NativeClientTransportOutcome =
    nativeTransport.connect();
  const networkingJoinOutcome: NativeClientTransportOutcome =
    nativeTransport.join();
  const networkingState: NativeClientTransportState = nativeTransport.state;
  const networkingBinding: NativeClientTransportBinding | null =
    nativeTransport.binding;
  const networkingInspection: NativeClientTransportInspection =
    nativeTransport.inspect();
  const networkingErrorCounts: NativeClientTransportErrorCounts =
    networkingInspection.errorCounts;
  const networkingLiveResourceCounts: NativeClientTransportLiveResourceCounts =
    networkingInspection.liveResourceCounts;
  const networkingShutdown: Promise<NativeClientTransportOutcome> =
    nativeTransport.shutdown();

  if (networkingBinding !== null) {
    // @ts-expect-error Public transport bindings are readonly.
    networkingBinding.playerId = "replacement";
  }
  // @ts-expect-error Public transport inspection data is readonly.
  networkingInspection.errorCounts["invalid-state"] = 1;

  const replicationCollisionAdapter: ClientCollisionAdapter = {
    disposed: false,
    move(startPosition, desiredTranslation) {
      return {
        ok: true as const,
        value: {
          startPosition,
          desiredTranslation,
          effectiveTranslation: desiredTranslation,
          position: startPosition,
          grounded: false,
          collided: false,
          collisionCount: 0,
        },
      };
    },
    dispose() {},
  };
  const replicationOptions: ClientReplicationOptions = {
    movementSpeedMetersPerSecond: 6,
    initialPosition: { x: 0, y: 1, z: 0 },
    collisionAdapter: replicationCollisionAdapter,
    emit(message) {
      void message;
    },
  };
  const replicationEngine: ClientReplicationEngine =
    createClientReplicationEngine(replicationOptions);
  const replicationBeginJoin: ClientReplicationOutcome =
    replicationEngine.beginJoin();
  const replicationReceive: ClientReplicationOutcome =
    replicationEngine.receive({
      protocolVersion: 1,
      kind: "joined",
      connectionId: "connection_1",
      playerId: "player_1",
      ownedEntityId: "avatar_1",
      serverTick: 0,
    });
  const moveIntent: ClientMoveIntent = { kind: "move", x: 0, z: 0 };
  const replicationQueueMove: ClientReplicationOutcome =
    replicationEngine.queueMove(moveIntent);
  const interactIntent: ClientInteractIntent = {
    kind: "interact",
    targetEntityId: "target_1",
  };
  const actionIntent: ClientActionIntent = interactIntent;
  const replicationQueueInteract: ClientReplicationOutcome =
    replicationEngine.queueInteract(interactIntent);
  const replicationQueueInteractById: ClientReplicationOutcome =
    replicationEngine.queueInteract("target_1");
  const replicationStep: ClientReplicationOutcome<number> =
    replicationEngine.stepExact(1);
  const replicationFrame: ClientReplicationOutcome<ClientPresentationState> =
    replicationEngine.frame(0);
  const replicationState: ClientReplicationState = replicationEngine.state;
  const replicationInspection: ClientReplicationInspection =
    replicationEngine.inspect();
  const replicationLiveResourceCounts: ClientReplicationLiveResourceCounts =
    replicationInspection.liveResourceCounts;
  const decodedInboxTicks: readonly number[] =
    replicationInspection.decodedInboxTicks;
  const decodedInboxCount: number = replicationInspection.decodedInboxCount;
  const presentedInteractables:
    readonly ClientInteractablePresentationInspection[] =
      replicationFrame.ok ? replicationFrame.value.interactables : [];
  const inspectedInteractables:
    readonly ClientInteractablePresentationInspection[] =
      replicationInspection.interactables;
  const liveInteractableCount: number =
    replicationLiveResourceCounts.interactables;
  const replicationShutdown: ClientReplicationOutcome =
    replicationEngine.shutdown();

  // @ts-expect-error Public replication inspection arrays are readonly.
  replicationInspection.stateTrace.push("closed");
  // @ts-expect-error Public replication inspection counters are readonly.
  replicationInspection.counters.frameCount = 1;
  // @ts-expect-error Decoded inbox tick inspection arrays are readonly.
  decodedInboxTicks.push(1);
  // @ts-expect-error Decoded inbox counts are readonly.
  replicationInspection.decodedInboxCount = 0;
  // @ts-expect-error Interaction intents are readonly.
  interactIntent.targetEntityId = "replacement";
  // @ts-expect-error Presented interactable collections are readonly.
  presentedInteractables.push(inspectedInteractables[0]);
  if (inspectedInteractables[0] !== undefined) {
    // @ts-expect-error Presented interactable positions are readonly.
    inspectedInteractables[0].position.x = 1;
  }
  // @ts-expect-error Live interactable counts are readonly.
  replicationLiveResourceCounts.interactables = 0;

  void networkingConnectOutcome;
  void networkingJoinOutcome;
  void networkingState;
  void networkingErrorCounts;
  void networkingLiveResourceCounts;
  void networkingShutdown;
  void outboundMessage;
  void gatedNetworkingOptions;
  void invalidOutboundDirection;
  void replicationBeginJoin;
  void replicationReceive;
  void replicationQueueMove;
  void actionIntent;
  void replicationQueueInteract;
  void replicationQueueInteractById;
  void replicationStep;
  void replicationFrame;
  void replicationState;
  void replicationLiveResourceCounts;
  void presentedInteractables;
  void inspectedInteractables;
  void liveInteractableCount;
  void decodedInboxTicks;
  void decodedInboxCount;
  void replicationShutdown;
}
void exerciseM3ClientSubpaths;

import { createGeneralPhysicsClientFeature, createInventoryClientFeature, createSaveLoadClientFeature, createBrowserStorageSaveAdapter } from "@three-game-kit/client/genre";
import { createGeneralPhysicsRuntime as createGenrePhysics, createInventoryRuntime as createGenreInventory, createSaveLoadRuntime as createGenreSave } from "@three-game-kit/shared/genre";
const typedBrowserStorage = { getItem: (_key: string): string | null => null, setItem(_key: string, _value: string) {}, removeItem(_key: string) {} };
const typedGenreClientFeatures: readonly ClientFeatureDescriptor<unknown>[] = [
  createGeneralPhysicsClientFeature(createGenrePhysics()),
  createInventoryClientFeature(createGenreInventory([])),
  createSaveLoadClientFeature(createGenreSave({ currentVersion: 1, capture: () => null, restore() {}, adapter: createBrowserStorageSaveAdapter(typedBrowserStorage) })),
];
void typedGenreClientFeatures;

import { createCameraEffectsRuntime, createCameraExtensionsFeature, createDebugDevToolsClientFeature, createDialogueClientFeature, createInputExperienceFeature, createInputExperienceRuntime, createPostProcessingFeature, createPostProcessingRuntime, createVehiclesClientFeature } from "@three-game-kit/client/advanced";
import { createDebugDevToolsRuntime as createAdvancedDebug, createDialogueRuntime as createAdvancedDialogue, createVehicleRuntime as createAdvancedVehicle } from "@three-game-kit/shared/advanced";
const advancedDialogue = createAdvancedDialogue([{ id: "d", startNodeId: "n", nodes: [{ id: "n", lineId: "line" }] }]);
const advancedVehicle = createAdvancedVehicle([{ id: "v", seats: [{ id: "driver", role: "driver" }], acceleration: 1, braking: 1, steering: 1 }]);
const advancedDebug = createAdvancedDebug();
const advancedInput = createInputExperienceRuntime({ contexts: { gameplay: { jump: ["A"] } }, initialContext: "gameplay" });
const advancedPost = createPostProcessingRuntime({ addPass() {}, removePass() {}, setPassEnabled() {}, resize() {}, render() {}, dispose() {} });
const advancedCamera = createCameraEffectsRuntime({ kind: "first-person", eyeHeight: 1, lookDistance: 1 });
const typedAdvancedClientFeatures: readonly ClientFeatureDescriptor<unknown>[] = [createDialogueClientFeature(advancedDialogue), createVehiclesClientFeature(advancedVehicle), createDebugDevToolsClientFeature(advancedDebug), createInputExperienceFeature({ runtime: advancedInput, publishMovement() {}, publishAction() {} }), createPostProcessingFeature(advancedPost), createCameraExtensionsFeature({ runtime: advancedCamera, readTarget: () => ({ x: 0, y: 0, z: 0 }), readTick: () => 0, publish() {} })];
void typedAdvancedClientFeatures;
