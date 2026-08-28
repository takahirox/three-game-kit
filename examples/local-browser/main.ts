import {
  SIMULATION_DT_SECONDS,
  createDeterministicPresentationFrameSource,
  defineComponent,
  defineFeatureConfiguration,
  type ClientFeatureDescriptor,
  type EntityId,
  type OperationResult,
} from "@three-game-kit/core";
import {
  computeDesiredMovementTranslation,
  type CollisionMoveResult,
  type MovementCommand,
  type MovementVector,
} from "@three-game-kit/shared";
import { Runtime } from "@three-game-kit/client";
import {
  createKeyboardMovementAdapter,
  createInputFeature,
  createMovementInput,
  type KeyboardMovementEventType,
  type KeyboardMovementListener,
  type KeyboardMovementListenerSource,
} from "@three-game-kit/client/input";
import {
  createCollisionFeature,
  createRapierCollisionAdapter,
} from "@three-game-kit/client/collision";
import {
  createCameraFeature,
  type ThirdPersonCameraTransform,
} from "@three-game-kit/client/camera";
import {
  createRenderingFeature,
  createThreeRenderer,
} from "@three-game-kit/client/rendering";
import {
  createGltfAvatarLoader,
  type GltfAvatarAsset,
} from "@three-game-kit/client/assets";

type JsonReport = Record<string, unknown>;

declare global {
  interface Window {
    __THREE_GAME_KIT_M2__?: JsonReport;
  }
}

const TOLERANCE_METERS = 0.02;
const SPEED_METERS_PER_SECOND = 3;
const INITIAL_POSITION: MovementVector = Object.freeze({
  x: -3,
  y: 1.01,
  z: 0,
});
const PUBLIC_MODULES = Object.freeze([
  "@three-game-kit/core",
  "@three-game-kit/shared",
  "@three-game-kit/client",
  "@three-game-kit/client/input",
  "@three-game-kit/client/collision",
  "@three-game-kit/client/camera",
  "@three-game-kit/client/rendering",
  "@three-game-kit/client/assets",
]);

interface MutableEntityPosition {
  x: number;
  y: number;
  z: number;
}

type EmptyConfiguration = Readonly<Record<string, never>>;

const POSITION_COMPONENT =
  defineComponent<MutableEntityPosition>("m2-browser-position");
const EMPTY_CONFIGURATION = defineFeatureConfiguration<EmptyConfiguration>({
  defaultValue: () => Object.freeze({}),
  parse(input: unknown) {
    if (
      typeof input === "object" &&
      input !== null &&
      !Array.isArray(input) &&
      Reflect.ownKeys(input).length === 0
    ) {
      return {
        ok: true as const,
        value: Object.freeze({}) as EmptyConfiguration,
      };
    }
    return {
      ok: false as const,
      issues: [{ path: [], code: "empty-object-required" }],
    };
  },
});

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing required element: ${selector}`);
  return element;
}

function requireOperation<T>(result: OperationResult<T>, label: string): T {
  if (!result.ok) throw new Error(`${label} failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

function requiredAt<T>(values: readonly T[], index: number, label: string): T {
  const value = values[index];
  if (value === undefined) throw new Error(`${label} is unavailable`);
  return value;
}

function finiteVector(value: Readonly<{ x: number; y: number; z: number }>): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function jsonSafe(value: unknown): boolean {
  try {
    return JSON.stringify(value) !== undefined;
  } catch {
    return false;
  }
}

function summarizeFailure(cause: unknown): string {
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
}

function createTrackedKeyboardSource() {
  const bindings: Record<
    KeyboardMovementEventType,
    Map<KeyboardMovementListener, EventListener>
  > = {
    keydown: new Map(),
    keyup: new Map(),
  };
  const counts = { added: 0, removed: 0, active: 0 };
  const source: KeyboardMovementListenerSource = {
    addListener(type, listener): void {
      const browserListener: EventListener = (event) => {
        listener({ code: event instanceof KeyboardEvent ? event.code : "" });
      };
      bindings[type].set(listener, browserListener);
      window.addEventListener(type, browserListener);
      counts.added += 1;
      counts.active += 1;
    },
    removeListener(type, listener): void {
      const browserListener = bindings[type].get(listener);
      if (browserListener === undefined) return;
      window.removeEventListener(type, browserListener);
      bindings[type].delete(listener);
      counts.removed += 1;
      counts.active -= 1;
    },
  };
  return { source, counts };
}

function createEntityFeature(readPosition: () => MovementVector) {
  let entity: EntityId | null = null;
  const contribution = Object.freeze({
    kind: "system" as const,
    id: "m2-entity-observation",
    domain: "client-simulation" as const,
    phase: "presentation-publish" as const,
    priority: 0,
    run({ world }: { world: Parameters<ClientFeatureDescriptor["setup"]>[0] extends never ? never : import("@three-game-kit/core").World }): void {
      const position = readPosition();
      if (entity === null) {
        entity = world.createEntity();
        world.addComponent(entity, POSITION_COMPONENT, { ...position });
        return;
      }
      const stored = world.getComponent(entity, POSITION_COMPONENT);
      if (stored !== undefined) {
        stored.x = position.x;
        stored.y = position.y;
        stored.z = position.z;
      }
    },
  });
  const feature: ClientFeatureDescriptor<EmptyConfiguration> = {
    id: "m2-entity",
    description: "Mirrors the browser avatar into the public Core World",
    runtimeContributions: [contribution],
    requires: [],
    conflicts: [],
    configuration: EMPTY_CONFIGURATION,
    setup({ ledger }): void {
      ledger.activateSystem(contribution.id);
    },
    dispose(): void {
      entity = null;
    },
  };
  return feature;
}

async function runRollbackProbe() {
  const counts = {
    firstSetup: 0,
    firstDispose: 0,
    firstRelease: 0,
    secondSetup: 0,
    secondDispose: 0,
  };
  const first: ClientFeatureDescriptor<EmptyConfiguration> = {
    id: "rollback-first",
    description: "Owns one rollback probe listener",
    runtimeContributions: [],
    requires: [],
    conflicts: [],
    configuration: EMPTY_CONFIGURATION,
    setup({ ledger }): void {
      counts.firstSetup += 1;
      ledger.acquire({
        resourceId: "rollback-listener",
        kind: "listeners",
        value: Object.freeze({}),
        release(): void {
          counts.firstRelease += 1;
        },
      });
    },
    dispose(): void {
      counts.firstDispose += 1;
    },
  };
  const second: ClientFeatureDescriptor<EmptyConfiguration> = {
    id: "rollback-second",
    description: "Fails setup after the first Feature is committed",
    runtimeContributions: [],
    requires: [first.id],
    conflicts: [],
    configuration: EMPTY_CONFIGURATION,
    setup(): void {
      counts.secondSetup += 1;
      throw new Error("intentional M2 rollback probe");
    },
    dispose(): void {
      counts.secondDispose += 1;
    },
  };
  const runtime = new Runtime({
    features: [first, second],
    frameSource: createDeterministicPresentationFrameSource(),
  });
  const boot = await runtime.start();
  const telemetry = runtime.snapshotTelemetry();
  return {
    state: boot.state,
    reason: boot.state === "stopped" ? boot.reason : null,
    disposedOrder: boot.state === "stopped" ? boot.disposedOrder : [],
    failureCodes:
      boot.state === "stopped" ? boot.failures.map(({ code }) => code) : [],
    counts,
    liveResourceTotal: Object.values(telemetry.liveResources).reduce(
      (total, count) => total + count,
      0,
    ),
  };
}

async function run(): Promise<void> {
  const canvas = requireElement<HTMLCanvasElement>("#game");
  const status = requireElement<HTMLParagraphElement>("#status");
  const renderer = createThreeRenderer(canvas, { antialias: true });
  const loader = createGltfAvatarLoader();
  const successfulLoad = await loader.load(
    new URL("./avatar.gltf", import.meta.url).href,
  );
  const failedLoad = await loader.load(
    new URL("./missing-avatar.gltf", import.meta.url).href,
  );
  let avatarAsset: GltfAvatarAsset | null = null;
  if (successfulLoad.ok) {
    avatarAsset = successfulLoad.value;
    renderer.attachAvatarAsset(avatarAsset);
  }

  const keyboard = createTrackedKeyboardSource();
  const keyboardAdapter = createKeyboardMovementAdapter(keyboard.source);
  const movementInput = createMovementInput();
  const collisionAdapter = createRapierCollisionAdapter({
    capsuleRadius: 0.5,
    capsuleHalfHeight: 0.5,
    controllerOffset: 0.01,
    boxes: [
      {
        id: "floor",
        center: { x: 0, y: -0.1, z: 0 },
        halfExtents: { x: 20, y: 0.1, z: 20 },
      },
      {
        id: "obstacle",
        center: { x: 0, y: 1, z: -3 },
        halfExtents: { x: 1, y: 1, z: 1 },
      },
    ],
  });
  const frameSource = createDeterministicPresentationFrameSource();
  const semanticCommands: MovementCommand[] = [];
  const desiredTranslations: MovementVector[] = [];
  const collisionResults: CollisionMoveResult[] = [];
  const cameraTransforms: ThirdPersonCameraTransform[] = [];
  let position = INITIAL_POSITION;
  let desiredTranslation: MovementVector = Object.freeze({ x: 0, y: -0.001, z: 0 });

  const inputFeature = createInputFeature({
    input: movementInput,
    publish(command): void {
      semanticCommands.push(command);
      desiredTranslation = computeDesiredMovementTranslation(command, {
        speedMetersPerSecond: SPEED_METERS_PER_SECOND,
        dtSeconds: SIMULATION_DT_SECONDS,
        downwardMetersPerTick: 0.001,
      });
      desiredTranslations.push(desiredTranslation);
    },
  });
  const collisionFeature = createCollisionFeature({
    adapter: collisionAdapter,
    readStartPosition: () => position,
    readDesiredTranslation: () => desiredTranslation,
    publish(result): void {
      position = result.position;
      collisionResults.push(result);
      renderer.setAvatarPosition(position);
    },
  });
  const cameraFeature = createCameraFeature({
    readTarget: () => position,
    configuration: {
      distance: 5,
      height: 2.5,
      lookAtHeight: 1,
      yawRadians: 0,
    },
    publish(transform): void {
      cameraTransforms.push(transform);
      renderer.setCameraTransform({
        position: transform.position,
        lookAt: transform.lookAt,
      });
    },
  });
  const renderingFeature = createRenderingFeature({ renderer });
  const entityFeature = createEntityFeature(() => position);
  let observationSeconds = 0;
  const runtime = new Runtime({
    features: [
      inputFeature,
      collisionFeature,
      cameraFeature,
      renderingFeature,
      entityFeature,
    ],
    frameSource,
    observationClock(): number {
      const sample = observationSeconds;
      observationSeconds += 0.002;
      return sample;
    },
  });

  const boot = await runtime.start();
  if (boot.state !== "running") throw new Error(`Main runtime stopped: ${boot.reason}`);

  const resizeCounts = { added: 0, removed: 0 };
  const resizeTarget = { width: 640, height: 360, pixelRatio: 1 };
  const resizeListener = (): void => {
    renderer.resize(
      resizeTarget.width,
      resizeTarget.height,
      resizeTarget.pixelRatio,
    );
  };
  window.addEventListener("resize", resizeListener);
  resizeCounts.added += 1;
  resizeListener();
  resizeTarget.width = 800;
  resizeTarget.height = 450;
  resizeTarget.pixelRatio = 1.25;
  window.dispatchEvent(new Event("resize"));

  const programmedCommands: string[] = [];
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
  const keyboardRightMovement = keyboardAdapter.sample();
  window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD" }));
  const keyboardIdleMovement = keyboardAdapter.sample();
  const keyboardMapping =
    keyboardRightMovement.x === 1 &&
    keyboardRightMovement.z === 0 &&
    keyboardIdleMovement.x === 0 &&
    keyboardIdleMovement.z === 0;
  movementInput.setMovement(1, 0);
  programmedCommands.push("move(1,0)");
  const firstTick = requireOperation(runtime.stepExact(60), "first exact step");
  movementInput.setMovement(0, -1);
  programmedCommands.push("move(0,-1)");
  const finalTick = requireOperation(runtime.stepExact(60), "second exact step");
  movementInput.reset();
  programmedCommands.push("reset");

  const tickBeforeFrames = runtime.tick;
  const presentationStarted = requireOperation(
    runtime.startPresentation(),
    "presentation start",
  );
  for (let frame = 1; frame <= 75; frame += 1) {
    if (!frameSource.deliver(frame * 8)) {
      throw new Error(`Presentation frame ${frame} was not delivered`);
    }
  }
  const tickAfterFrames = runtime.tick;
  const outstandingBeforeShutdown = frameSource.outstandingRequestCount;
  const rendering = renderer.snapshot();
  const telemetry = runtime.snapshotTelemetry();
  const lifecycle = runtime.inspectLifecycle();
  const afterFloor = requiredAt(collisionResults, 59, "level-floor result");
  const obstacleResult = requiredAt(collisionResults, 119, "obstacle result");
  const expectedObstacleZ = -3 + 1 + 0.5 + 0.01;
  const floorHorizontalDistanceMeters =
    afterFloor.position.x - INITIAL_POSITION.x;
  const floorVerticalErrorMeters = Math.abs(
    afterFloor.position.y - INITIAL_POSITION.y,
  );
  const obstacleErrorMeters = Math.abs(
    obstacleResult.position.z - expectedObstacleZ,
  );
  const transformsFinite =
    collisionResults.every((result) =>
      [
        result.startPosition,
        result.desiredTranslation,
        result.effectiveTranslation,
        result.position,
      ].every(finiteVector),
    ) &&
    cameraTransforms.every((transform) =>
      [transform.target, transform.position, transform.lookAt].every(finiteVector),
    ) &&
    finiteVector(rendering.avatarPosition) &&
    finiteVector(rendering.cameraTransform.position) &&
    finiteVector(rendering.cameraTransform.lookAt);
  const rollback = await runRollbackProbe();

  const shutdownOne = runtime.shutdown();
  const shutdownTwo = runtime.shutdown();
  const sameShutdownPromise = shutdownOne === shutdownTwo;
  const [stoppedOne, stoppedTwo] = await Promise.all([shutdownOne, shutdownTwo]);
  const sameShutdownResult = stoppedOne === stoppedTwo;
  let rendererRejectedAfterShutdown = false;
  try {
    renderer.snapshot();
  } catch {
    rendererRejectedAfterShutdown = true;
  }
  movementInput.dispose();
  keyboardAdapter.dispose();
  window.removeEventListener("resize", resizeListener);
  resizeCounts.removed += 1;
  loader.dispose();
  const cleanupTelemetry = runtime.snapshotTelemetry();
  const cleanupLiveResourceTotal = Object.values(cleanupTelemetry.liveResources).reduce(
    (total, count) => total + count,
    0,
  );

  const assertions = {
    publicApiComposition: PUBLIC_MODULES.length === 8,
    keyboardMapping,
    programmableSemanticInput:
      semanticCommands.length === 120 &&
      semanticCommands.slice(0, 60).every(({ x, z }) => x === 1 && z === 0) &&
      semanticCommands.slice(60).every(({ x, z }) => x === 0 && z === -1),
    desiredMovementTranslation:
      desiredTranslations.length === 120 &&
      desiredTranslations.every(finiteVector) &&
      desiredTranslations.every(({ y }) => y === -0.001),
    exactSimulationTicks:
      firstTick === 60 && finalTick === 120 && telemetry.simulationTick === 120,
    exactIndependentPresentationFrames:
      presentationStarted &&
      tickBeforeFrames === 120 &&
      tickAfterFrames === 120 &&
      telemetry.presentationFrameCount === 75 &&
      rendering.renderCount === 75,
    finiteTransforms: transformsFinite,
    levelFloorMovement:
      afterFloor.grounded &&
      floorHorizontalDistanceMeters >= 2.5 &&
      floorVerticalErrorMeters <= TOLERANCE_METERS,
    headOnObstacleBound:
      obstacleResult.collided &&
      obstacleResult.collisionCount > 0 &&
      obstacleErrorMeters <= TOLERANCE_METERS,
    successfulGltf:
      successfulLoad.ok && avatarAsset !== null && avatarAsset.clipCount <= 1,
    failedGltf: !failedLoad.ok && failedLoad.failure.code === "load-failed",
    resizedRenderer:
      rendering.width === 800 &&
      rendering.height === 450 &&
      rendering.pixelRatio === 1.25,
    pendingFrameCancelled:
      outstandingBeforeShutdown === 1 &&
      frameSource.outstandingRequestCount === 0 &&
      frameSource.cancellationCount === 1,
    setupRollback:
      rollback.state === "stopped" &&
      rollback.reason === "setup-failed" &&
      rollback.disposedOrder.join(",") === "rollback-first" &&
      rollback.counts.firstDispose === 1 &&
      rollback.counts.firstRelease === 1 &&
      rollback.counts.secondDispose === 0 &&
      rollback.liveResourceTotal === 0,
    listenerCleanup:
      keyboard.counts.added === 2 &&
      keyboard.counts.removed === 2 &&
      keyboard.counts.active === 0 &&
      resizeCounts.added === 1 &&
      resizeCounts.removed === 1,
    idempotentShutdown:
      sameShutdownPromise &&
      sameShutdownResult &&
      stoppedOne.clean &&
      stoppedOne.reason === "shutdown",
    cleanup:
      cleanupLiveResourceTotal === 0 &&
      rendererRejectedAfterShutdown &&
      collisionAdapter.disposed &&
      loader.disposed &&
      avatarAsset?.disposed === true,
    telemetry:
      Number.isFinite(telemetry.clientFrameDurationSeconds) &&
      (telemetry.clientFrameDurationSeconds ?? 0) > 0 &&
      telemetry.entityCount === 1 &&
      telemetry.installedFeatureIds.length === 5 &&
      telemetry.structuredRuntimeErrors.length === 0,
  };

  const evidence = {
    composedExports: PUBLIC_MODULES,
    programmedCommands,
    keyboardMapping,
    simulation: {
      firstTick,
      finalTick,
      tickBeforeFrames,
      tickAfterFrames,
      semanticCommandCount: semanticCommands.length,
      desiredTranslationCount: desiredTranslations.length,
      collisionResultCount: collisionResults.length,
    },
    presentation: {
      requested: frameSource.requestCount,
      delivered: frameSource.deliveryCount,
      cancelled: frameSource.cancellationCount,
      outstandingBeforeShutdown,
      outstandingAfterShutdown: frameSource.outstandingRequestCount,
      cameraTransformCount: cameraTransforms.length,
      renderCount: rendering.renderCount,
    },
    floor: {
      start: INITIAL_POSITION,
      afterSixtyTicks: afterFloor.position,
      horizontalDistanceMeters: floorHorizontalDistanceMeters,
      verticalErrorMeters: floorVerticalErrorMeters,
      grounded: afterFloor.grounded,
    },
    obstacle: {
      finalPosition: obstacleResult.position,
      expectedAvatarCenterZ: expectedObstacleZ,
      errorMeters: obstacleErrorMeters,
      toleranceMeters: TOLERANCE_METERS,
      toleranceDocumentation:
        "Absolute avatar-center distance from the Rapier controller's expected obstacle bound; pass when <= 0.02 meters.",
      collided: obstacleResult.collided,
      collisionCount: obstacleResult.collisionCount,
    },
    transforms: {
      finite: transformsFinite,
      avatar: rendering.avatarPosition,
      camera: rendering.cameraTransform,
    },
    assets: {
      successful: successfulLoad.ok,
      failed: !failedLoad.ok,
      successfulClipCount: successfulLoad.ok ? successfulLoad.value.clipCount : null,
      failureCode: failedLoad.ok ? null : failedLoad.failure.code,
      attachedToRenderer: successfulLoad.ok && avatarAsset !== null,
    },
    resize: {
      width: rendering.width,
      height: rendering.height,
      pixelRatio: rendering.pixelRatio,
    },
    rollback,
    shutdown: {
      calls: 2,
      samePromise: sameShutdownPromise,
      sameResult: sameShutdownResult,
      clean: stoppedOne.clean,
      disposedOrder: stoppedOne.disposedOrder,
    },
  };
  const preliminaryReport = {
    ready: true,
    assertions,
    evidence,
    telemetry: {
      frameDurationSeconds: telemetry.clientFrameDurationSeconds,
      entityCount: telemetry.entityCount,
      installedFeatureIds: lifecycle.installedFeatureIds,
      simulationTick: telemetry.simulationTick,
      presentationFrameCount: telemetry.presentationFrameCount,
      errors: telemetry.structuredRuntimeErrors,
    },
    cleanup: {
      keyboardListeners: keyboard.counts,
      resizeListeners: resizeCounts,
      liveResources: cleanupTelemetry.liveResources,
      liveResourceTotal: cleanupLiveResourceTotal,
      rendererDisposed: rendererRejectedAfterShutdown,
      collisionDisposed: collisionAdapter.disposed,
      loaderDisposed: loader.disposed,
      avatarDisposed: avatarAsset?.disposed === true,
    },
  };
  const report = {
    ...preliminaryReport,
    assertions: {
      ...assertions,
      jsonSafeReport: jsonSafe(preliminaryReport),
    },
  };
  window.__THREE_GAME_KIT_M2__ = JSON.parse(JSON.stringify(report)) as JsonReport;
  const passed = Object.values(report.assertions).every(Boolean);
  status.dataset.passed = String(passed);
  status.textContent = passed
    ? "M2 deterministic browser evidence passed."
    : "M2 browser evidence completed with failed assertions.";
}

void run().catch((cause: unknown) => {
  const status = document.querySelector<HTMLParagraphElement>("#status");
  const report = {
    ready: false,
    assertions: {},
    evidence: {},
    telemetry: {
      frameDurationSeconds: null,
      entityCount: 0,
      installedFeatureIds: [],
      simulationTick: 0,
      presentationFrameCount: 0,
      errors: [summarizeFailure(cause)],
    },
    cleanup: {},
  };
  window.__THREE_GAME_KIT_M2__ = report;
  if (status !== null) {
    status.dataset.passed = "false";
    status.textContent = summarizeFailure(cause);
  }
});
