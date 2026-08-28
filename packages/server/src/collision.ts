import RAPIER from "@dimforge/rapier3d-compat";

await RAPIER.init();
import {
  createStaticSceneDescriptor,
  type CollisionMoveResult,
  type MovementVector,
  type StaticSceneDescriptor,
} from "@three-game-kit/shared";

export interface ServerCollisionFailure {
  readonly code:
    | "duplicate-avatar"
    | "missing-avatar"
    | "disposed-resource";
}

export type ServerCollisionOutcome<Value = undefined> =
  | Readonly<{ readonly ok: true; readonly value: Value }>
  | Readonly<{
      readonly ok: false;
      readonly failure: ServerCollisionFailure;
    }>;

export interface ServerCollisionInspection {
  readonly disposed: boolean;
  readonly avatarCount: number;
  readonly avatars: readonly Readonly<{
    readonly avatarId: string;
    readonly position: MovementVector;
  }>[];
}

export interface ServerCollisionAdapter {
  readonly disposed: boolean;
  createAvatar(
    avatarId: string,
    initialPosition: MovementVector,
  ): ServerCollisionOutcome;
  removeAvatar(avatarId: string): ServerCollisionOutcome;
  setAvatarPosition(
    avatarId: string,
    position: MovementVector,
  ): ServerCollisionOutcome;
  moveAvatar(
    avatarId: string,
    startPosition: MovementVector,
    desiredTranslation: MovementVector,
  ): ServerCollisionOutcome<CollisionMoveResult>;
  inspect(): ServerCollisionInspection;
  dispose(): void;
}

interface AvatarRecord {
  readonly avatarId: string;
  readonly collider: RAPIER.Collider;
  position: MovementVector;
}

const DISPOSED_OUTCOME: ServerCollisionOutcome<never> = Object.freeze({
  ok: false,
  failure: Object.freeze({ code: "disposed-resource" }),
});
const DUPLICATE_OUTCOME: ServerCollisionOutcome<never> = Object.freeze({
  ok: false,
  failure: Object.freeze({ code: "duplicate-avatar" }),
});
const MISSING_OUTCOME: ServerCollisionOutcome<never> = Object.freeze({
  ok: false,
  failure: Object.freeze({ code: "missing-avatar" }),
});
const SUCCESS_OUTCOME: ServerCollisionOutcome = Object.freeze({
  ok: true,
  value: undefined,
});

function requireAvatarId(value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Server avatar ID must be a non-empty string");
  }
  return value;
}

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

export function createRapierServerCollisionAdapter(
  scene: StaticSceneDescriptor,
): ServerCollisionAdapter {
  let trustedScene: StaticSceneDescriptor | undefined =
    createStaticSceneDescriptor(scene);
  let world: RAPIER.World | undefined;
  let controller: RAPIER.KinematicCharacterController | undefined;
  const staticColliders: RAPIER.Collider[] = [];
  const avatars = new Map<string, AvatarRecord>();
  const avatarCreationOrder: AvatarRecord[] = [];
  let disposed = false;

  function releaseOwnedResources(): void {
    const ownedWorld = world;
    const ownedController = controller;
    const ownedStaticColliders = staticColliders.splice(0);
    const ownedAvatars = avatarCreationOrder.splice(0);
    world = undefined;
    controller = undefined;
    trustedScene = undefined;
    avatars.clear();

    if (ownedWorld === undefined) return;

    let firstCleanupError: unknown;
    let cleanupFailed = false;
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

    for (let index = ownedAvatars.length - 1; index >= 0; index -= 1) {
      const avatar = ownedAvatars[index];
      if (avatar !== undefined) {
        attempt(() => ownedWorld.removeCollider(avatar.collider, false));
      }
    }
    if (ownedController !== undefined) {
      attempt(() => ownedWorld.removeCharacterController(ownedController));
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
    const descriptor = trustedScene;
    if (descriptor === undefined) {
      throw new Error("Server collision scene is unavailable");
    }
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

    createAvatar(
      avatarId: string,
      initialPosition: MovementVector,
    ): ServerCollisionOutcome {
      if (disposed) return DISPOSED_OUTCOME;
      const id = requireAvatarId(avatarId);
      const position = copyFiniteVector(
        initialPosition,
        "Server avatar initial position",
      );
      if (avatars.has(id)) return DUPLICATE_OUTCOME;

      const activeWorld = world;
      const descriptor = trustedScene;
      if (activeWorld === undefined || descriptor === undefined) {
        throw new Error("Server collision adapter resources are unavailable");
      }
      const collider = activeWorld.createCollider(
        RAPIER.ColliderDesc.capsule(
          descriptor.capsuleHalfHeight,
          descriptor.capsuleRadius,
        ).setTranslation(position.x, position.y, position.z),
      );
      const record: AvatarRecord = { avatarId: id, collider, position };
      avatars.set(id, record);
      avatarCreationOrder.push(record);
      return SUCCESS_OUTCOME;
    },

    removeAvatar(avatarId: string): ServerCollisionOutcome {
      if (disposed) return DISPOSED_OUTCOME;
      const id = requireAvatarId(avatarId);
      const record = avatars.get(id);
      if (record === undefined) return MISSING_OUTCOME;

      const activeWorld = world;
      if (activeWorld === undefined) {
        throw new Error("Server collision adapter resources are unavailable");
      }
      activeWorld.removeCollider(record.collider, false);
      avatars.delete(id);
      const index = avatarCreationOrder.indexOf(record);
      if (index >= 0) avatarCreationOrder.splice(index, 1);
      return SUCCESS_OUTCOME;
    },

    setAvatarPosition(
      avatarId: string,
      position: MovementVector,
    ): ServerCollisionOutcome {
      if (disposed) return DISPOSED_OUTCOME;
      const id = requireAvatarId(avatarId);
      const nextPosition = copyFiniteVector(
        position,
        "Server avatar position",
      );
      const record = avatars.get(id);
      if (record === undefined) return MISSING_OUTCOME;

      if (world === undefined) {
        throw new Error("Server collision adapter resources are unavailable");
      }
      record.collider.setTranslation(nextPosition);
      record.position = nextPosition;
      return SUCCESS_OUTCOME;
    },

    moveAvatar(
      avatarId: string,
      startPosition: MovementVector,
      desiredTranslation: MovementVector,
    ): ServerCollisionOutcome<CollisionMoveResult> {
      if (disposed) return DISPOSED_OUTCOME;
      const id = requireAvatarId(avatarId);
      const start = copyFiniteVector(
        startPosition,
        "Server collision start position",
      );
      const desired = copyFiniteVector(
        desiredTranslation,
        "Server collision desired translation",
      );
      const record = avatars.get(id);
      if (record === undefined) return MISSING_OUTCOME;

      const activeController = controller;
      if (activeController === undefined) {
        throw new Error("Server collision adapter resources are unavailable");
      }
      record.collider.setTranslation(start);
      activeController.computeColliderMovement(record.collider, desired);
      const effective = copyFiniteVector(
        activeController.computedMovement(),
        "Server collision effective translation",
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
        "Server collision result position",
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
      record.collider.setTranslation(position);
      record.position = position;
      return Object.freeze({ ok: true, value });
    },

    inspect(): ServerCollisionInspection {
      const inspectedAvatars = avatarCreationOrder.map((record) =>
        Object.freeze({
          avatarId: record.avatarId,
          position: copyFiniteVector(
            record.position,
            "Server avatar inspection position",
          ),
        }),
      );
      return Object.freeze({
        disposed,
        avatarCount: inspectedAvatars.length,
        avatars: Object.freeze(inspectedAvatars),
      });
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      releaseOwnedResources();
    },
  });
}
