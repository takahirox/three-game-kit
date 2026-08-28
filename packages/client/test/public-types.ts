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
  type InputFeatureOptions,
  type MovementCommandSource,
  type MovementInput,
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
  type RendererCameraTransform,
  type RendererVector3,
  type RenderingSnapshot,
} from "@three-game-kit/client/rendering";
import {
  createGltfAvatarLoader,
  type AssetCause,
  type GltfAvatarAsset,
  type GltfAvatarLoadFailure,
  type GltfAvatarLoadOutcome,
  type GltfAvatarLoader,
} from "@three-game-kit/client/assets";
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
  type ClientMoveIntent,
  type ClientPresentationState,
  type ClientReplicationEngine,
  type ClientReplicationInspection,
  type ClientReplicationLiveResourceCounts,
  type ClientReplicationOptions,
  type ClientReplicationOutcome,
  type ClientReplicationState,
} from "@three-game-kit/client/replication";

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
  const inputFeature = createInputFeature(inputOptions);

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
  void collisionOutcome;
  void collisionFailure;
  void collisionFeature;
  void renderingSnapshot;
  void renderingFeature;
  void loadOutcome;
  void pendingLoad;
}
void exerciseM2ClientSubpaths;

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
  void replicationStep;
  void replicationFrame;
  void replicationState;
  void replicationLiveResourceCounts;
  void decodedInboxTicks;
  void decodedInboxCount;
  void replicationShutdown;
}
void exerciseM3ClientSubpaths;
