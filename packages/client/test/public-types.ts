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
