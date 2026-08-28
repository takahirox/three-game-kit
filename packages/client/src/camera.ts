import {
  defineFeatureConfiguration,
  type ClientFeatureDescriptor,
  type ClientFeatureSetupContext,
} from "@three-game-kit/core";

export interface CameraVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ThirdPersonCameraConfiguration {
  readonly distance: number;
  readonly height: number;
  readonly lookAtHeight: number;
  readonly yawRadians: number;
}

export interface ThirdPersonCameraTransform {
  readonly target: CameraVector3;
  readonly position: CameraVector3;
  readonly lookAt: CameraVector3;
}

export interface CameraFeatureOptions {
  readonly readTarget: () => CameraVector3;
  readonly configuration: ThirdPersonCameraConfiguration;
  readonly publish: (transform: ThirdPersonCameraTransform) => void;
}

function hasExactlyKeys(value: object, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => keys.includes(key))
  );
}

function copyVector3(value: CameraVector3, label: string): CameraVector3 {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !hasExactlyKeys(value, ["x", "y", "z"])
  ) {
    throw new TypeError(`${label} must contain exactly x, y, and z`);
  }

  const x = value.x;
  const y = value.y;
  const z = value.z;
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    typeof y !== "number" ||
    !Number.isFinite(y) ||
    typeof z !== "number" ||
    !Number.isFinite(z)
  ) {
    throw new TypeError(`${label} components must be finite numbers`);
  }

  return Object.freeze({ x, y, z });
}

function copyConfiguration(
  configuration: ThirdPersonCameraConfiguration,
): ThirdPersonCameraConfiguration {
  if (
    typeof configuration !== "object" ||
    configuration === null ||
    Array.isArray(configuration) ||
    !hasExactlyKeys(configuration, [
      "distance",
      "height",
      "lookAtHeight",
      "yawRadians",
    ])
  ) {
    throw new TypeError(
      "Third-person camera configuration must contain exactly distance, height, lookAtHeight, and yawRadians",
    );
  }

  const { distance, height, lookAtHeight, yawRadians } = configuration;
  if (
    typeof distance !== "number" ||
    !Number.isFinite(distance) ||
    distance <= 0
  ) {
    throw new TypeError("Camera distance must be a positive finite number");
  }
  if (
    typeof height !== "number" ||
    !Number.isFinite(height) ||
    typeof lookAtHeight !== "number" ||
    !Number.isFinite(lookAtHeight) ||
    typeof yawRadians !== "number" ||
    !Number.isFinite(yawRadians)
  ) {
    throw new TypeError(
      "Camera height, lookAtHeight, and yawRadians must be finite numbers",
    );
  }

  return Object.freeze({ distance, height, lookAtHeight, yawRadians });
}

export function createThirdPersonCameraTransform(
  target: CameraVector3,
  configuration: ThirdPersonCameraConfiguration,
): ThirdPersonCameraTransform {
  const copiedTarget = copyVector3(target, "Camera target");
  const copiedConfiguration = copyConfiguration(configuration);
  const position = copyVector3(
    {
      x:
        copiedTarget.x -
        Math.sin(copiedConfiguration.yawRadians) *
          copiedConfiguration.distance,
      y: copiedTarget.y + copiedConfiguration.height,
      z:
        copiedTarget.z +
        Math.cos(copiedConfiguration.yawRadians) *
          copiedConfiguration.distance,
    },
    "Camera position",
  );
  const lookAt = copyVector3(
    {
      x: copiedTarget.x,
      y: copiedTarget.y + copiedConfiguration.lookAtHeight,
      z: copiedTarget.z,
    },
    "Camera lookAt",
  );

  return Object.freeze({ target: copiedTarget, position, lookAt });
}

type CameraFeatureConfiguration = Readonly<Record<string, never>>;

const CAMERA_FEATURE_CONFIGURATION =
  defineFeatureConfiguration<CameraFeatureConfiguration>({
    defaultValue: () => Object.freeze({}),
    parse(input: unknown) {
      if (
        typeof input === "object" &&
        input !== null &&
        !Array.isArray(input) &&
        hasExactlyKeys(input, [])
      ) {
        return {
          ok: true,
          value: Object.freeze({}) as CameraFeatureConfiguration,
        };
      }
      return {
        ok: false,
        issues: [{ path: [], code: "empty-object-required" }],
      };
    },
  });

export function createCameraFeature(
  options: CameraFeatureOptions,
): ClientFeatureDescriptor<CameraFeatureConfiguration> {
  if (
    typeof options !== "object" ||
    options === null ||
    Array.isArray(options) ||
    !hasExactlyKeys(options, ["readTarget", "configuration", "publish"]) ||
    typeof options.readTarget !== "function" ||
    typeof options.publish !== "function"
  ) {
    throw new TypeError("Camera feature options are invalid");
  }

  const readTarget = options.readTarget;
  const publish = options.publish;
  const configuration = copyConfiguration(options.configuration);
  let active = false;

  const contribution = Object.freeze({
    kind: "system" as const,
    id: "third-person-camera-view",
    domain: "client-presentation" as const,
    phase: "camera-view" as const,
    priority: 0,
    run(): void {
      if (!active) return;
      const target = readTarget();
      if (!active) return;
      const transform = createThirdPersonCameraTransform(
        target,
        configuration,
      );
      if (!active) return;
      publish(transform);
    },
  });

  return Object.freeze({
    id: "third-person-camera",
    description: "Publishes one third-person camera transform per presentation frame",
    runtimeContributions: Object.freeze([contribution]),
    requires: Object.freeze([]),
    conflicts: Object.freeze([]),
    configuration: CAMERA_FEATURE_CONFIGURATION,
    setup({ ledger }: ClientFeatureSetupContext<CameraFeatureConfiguration>): void {
      active = true;
      try {
        ledger.activateSystem(contribution.id);
      } catch (error) {
        active = false;
        throw error;
      }
    },
    dispose(): void {
      active = false;
    },
  });
}
