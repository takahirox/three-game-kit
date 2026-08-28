import RAPIER from "@dimforge/rapier3d";
import {
  defineFeatureConfiguration,
  type ClientFeatureDescriptor,
} from "@three-game-kit/core";
import {
  createStaticSceneDescriptor,
  type CollisionMoveResult,
  type MovementVector,
  type StaticSceneDescriptor,
} from "@three-game-kit/shared";

export interface CollisionMoveFailure {
  readonly code: "disposed-resource";
}

export type CollisionMoveOutcome =
  | Readonly<{ readonly ok: true; readonly value: CollisionMoveResult }>
  | Readonly<{
      readonly ok: false;
      readonly failure: CollisionMoveFailure;
    }>;

export interface ClientCollisionAdapter {
  readonly disposed: boolean;
  move(
    startPosition: MovementVector,
    desiredTranslation: MovementVector,
  ): CollisionMoveOutcome;
  dispose(): void;
}

export interface CollisionFeatureOptions {
  readonly adapter: ClientCollisionAdapter;
  readStartPosition(): MovementVector;
  readDesiredTranslation(): MovementVector;
  publish(result: CollisionMoveResult): void;
}

const DISPOSED_FAILURE: CollisionMoveFailure = Object.freeze({
  code: "disposed-resource",
});
const DISPOSED_OUTCOME: CollisionMoveOutcome = Object.freeze({
  ok: false,
  failure: DISPOSED_FAILURE,
});

function hasExactlyVectorKeys(value: object): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === 3 &&
    keys.includes("x") &&
    keys.includes("y") &&
    keys.includes("z")
  );
}

function copyFiniteVector(
  value: MovementVector,
  label: string,
): MovementVector {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !hasExactlyVectorKeys(value)
  ) {
    throw new TypeError(label + " must contain exactly x, y, and z");
  }

  const { x, y, z } = value;
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    typeof y !== "number" ||
    !Number.isFinite(y) ||
    typeof z !== "number" ||
    !Number.isFinite(z)
  ) {
    throw new TypeError(label + " components must be finite numbers");
  }

  return Object.freeze({ x, y, z });
}

export function createRapierCollisionAdapter(
  scene: StaticSceneDescriptor,
): ClientCollisionAdapter {
  const descriptor = createStaticSceneDescriptor(scene);
  let world: RAPIER.World | undefined;
  let controller: RAPIER.KinematicCharacterController | undefined;
  let capsule: RAPIER.Collider | undefined;
  const staticColliders: RAPIER.Collider[] = [];
  let disposed = false;

  function releaseOwnedResources(): void {
    const ownedWorld = world;
    const ownedController = controller;
    const ownedCapsule = capsule;
    const ownedStaticColliders = staticColliders.splice(0);
    world = undefined;
    controller = undefined;
    capsule = undefined;

    if (ownedWorld === undefined) return;

    let cleanupFailed = false;
    let firstCleanupError: unknown;
    const attempt = (operation: () => void): void => {
      try {
        operation();
      } catch (error) {
        if (!cleanupFailed) {
          cleanupFailed = true;
          firstCleanupError = error;
        }
      }
    };

    if (ownedController !== undefined) {
      attempt(() => ownedWorld.removeCharacterController(ownedController));
    }
    if (ownedCapsule !== undefined) {
      attempt(() => ownedWorld.removeCollider(ownedCapsule, false));
    }
    for (let index = ownedStaticColliders.length - 1; index >= 0; index -= 1) {
      const collider = ownedStaticColliders[index];
      if (collider !== undefined) {
        attempt(() => ownedWorld.removeCollider(collider, false));
      }
    }
    attempt(() => ownedWorld.free());

    if (cleanupFailed) throw firstCleanupError;
  }

  try {
    world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    for (const box of descriptor.boxes) {
      staticColliders.push(
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(
            box.halfExtents.x,
            box.halfExtents.y,
            box.halfExtents.z,
          ).setTranslation(box.center.x, box.center.y, box.center.z),
        ),
      );
    }
    capsule = world.createCollider(
      RAPIER.ColliderDesc.capsule(
        descriptor.capsuleHalfHeight,
        descriptor.capsuleRadius,
      ),
    );
    controller = world.createCharacterController(descriptor.controllerOffset);
    controller.setSlideEnabled(true);
    controller.disableAutostep();
    controller.disableSnapToGround();
    world.step();
  } catch (setupError) {
    try {
      releaseOwnedResources();
    } catch {}
    throw setupError;
  }

  return Object.freeze({
    get disposed(): boolean {
      return disposed;
    },
    move(
      startPosition: MovementVector,
      desiredTranslation: MovementVector,
    ): CollisionMoveOutcome {
      if (disposed) return DISPOSED_OUTCOME;

      const start = copyFiniteVector(startPosition, "Collision start position");
      const desired = copyFiniteVector(
        desiredTranslation,
        "Collision desired translation",
      );
      const activeController = controller;
      const activeCapsule = capsule;
      if (activeController === undefined || activeCapsule === undefined) {
        throw new Error("Client collision adapter resources are unavailable");
      }

      activeCapsule.setTranslation(start);
      activeController.computeColliderMovement(activeCapsule, desired);
      const effective = copyFiniteVector(
        activeController.computedMovement(),
        "Collision effective translation",
      );
      const grounded = activeController.computedGrounded();
      const collisionCount = activeController.numComputedCollisions();
      if (typeof grounded !== "boolean") {
        throw new TypeError("Collision grounded state must be boolean");
      }
      if (!Number.isSafeInteger(collisionCount) || collisionCount < 0) {
        throw new TypeError(
          "Collision count must be a non-negative safe integer",
        );
      }

      const position = copyFiniteVector(
        {
          x: start.x + effective.x,
          y: start.y + effective.y,
          z: start.z + effective.z,
        },
        "Collision result position",
      );
      const value: CollisionMoveResult = Object.freeze({
        startPosition: start,
        desiredTranslation: desired,
        effectiveTranslation: effective,
        position,
        grounded,
        collided: collisionCount > 0,
        collisionCount,
      });
      activeCapsule.setTranslation(position);
      return Object.freeze({ ok: true, value });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      releaseOwnedResources();
    },
  });
}

type CollisionFeatureConfiguration = Readonly<Record<string, never>>;

const COLLISION_FEATURE_CONFIGURATION =
  defineFeatureConfiguration<CollisionFeatureConfiguration>({
    defaultValue: () => Object.freeze({}),
    parse(input: unknown) {
      if (
        typeof input === "object" &&
        input !== null &&
        !Array.isArray(input) &&
        Reflect.ownKeys(input).length === 0
      ) {
        return {
          ok: true,
          value: Object.freeze({}) as CollisionFeatureConfiguration,
        };
      }
      return {
        ok: false,
        issues: [{ path: [], code: "empty-object-required" }],
      };
    },
  });

export function createCollisionFeature(
  options: CollisionFeatureOptions,
): ClientFeatureDescriptor<CollisionFeatureConfiguration> {
  if (
    typeof options !== "object" ||
    options === null ||
    Array.isArray(options)
  ) {
    throw new TypeError("Collision feature options are invalid");
  }

  const optionKeys = Reflect.ownKeys(options);
  if (
    optionKeys.length !== 4 ||
    !optionKeys.includes("adapter") ||
    !optionKeys.includes("readStartPosition") ||
    !optionKeys.includes("readDesiredTranslation") ||
    !optionKeys.includes("publish") ||
    typeof options.adapter !== "object" ||
    options.adapter === null ||
    Array.isArray(options.adapter) ||
    typeof options.adapter.move !== "function" ||
    typeof options.adapter.dispose !== "function" ||
    typeof options.readStartPosition !== "function" ||
    typeof options.readDesiredTranslation !== "function" ||
    typeof options.publish !== "function"
  ) {
    throw new TypeError("Collision feature options are invalid");
  }

  const adapter = options.adapter;
  const readStartPosition = options.readStartPosition;
  const readDesiredTranslation = options.readDesiredTranslation;
  const publish = options.publish;
  let active = false;
  let disposed = false;

  const contribution = Object.freeze({
    kind: "system" as const,
    id: "collision-shared-predict",
    domain: "client-simulation" as const,
    phase: "shared-predict" as const,
    priority: 0,
    run(): void {
      if (disposed) {
        throw new Error("Collision move failed: disposed-resource");
      }
      if (!active) return;
      const outcome = adapter.move(
        readStartPosition(),
        readDesiredTranslation(),
      );
      if (!outcome.ok) {
        throw new Error(`Collision move failed: ${outcome.failure.code}`);
      }
      publish(outcome.value);
    },
  });

  const feature: ClientFeatureDescriptor<CollisionFeatureConfiguration> = {
    id: "collision",
    description: "Computes and publishes one collision move per prediction tick",
    runtimeContributions: Object.freeze([contribution]),
    requires: Object.freeze([]),
    conflicts: Object.freeze([]),
    configuration: COLLISION_FEATURE_CONFIGURATION,
    setup({ ledger }): void {
      if (disposed) {
        throw new Error("Collision feature failed: disposed-resource");
      }
      active = true;
      try {
        ledger.activateSystem(contribution.id);
      } catch (error) {
        active = false;
        throw error;
      }
    },
    dispose(): void {
      if (disposed) return;
      active = false;
      disposed = true;
      adapter.dispose();
    },
  };

  return Object.freeze(feature);
}
