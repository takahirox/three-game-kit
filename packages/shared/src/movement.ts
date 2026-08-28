export interface MovementCommand {
  readonly kind: "move";
  readonly x: number;
  readonly z: number;
}

export interface MovementVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CollisionMoveResult {
  readonly startPosition: MovementVector;
  readonly desiredTranslation: MovementVector;
  readonly effectiveTranslation: MovementVector;
  readonly position: MovementVector;
  readonly grounded: boolean;
  readonly collided: boolean;
  readonly collisionCount: number;
}

export interface StaticBoxDescriptor {
  readonly id: string;
  readonly center: MovementVector;
  readonly halfExtents: MovementVector;
}

export interface StaticSceneDescriptor {
  readonly capsuleRadius: number;
  readonly capsuleHalfHeight: number;
  readonly controllerOffset: number;
  readonly boxes: readonly StaticBoxDescriptor[];
}

export interface MovementState {
  readonly position: MovementVector;
}

export interface MovementStepOptions {
  readonly speedMetersPerSecond: number;
  readonly dtSeconds: number;
}

export interface DesiredMovementTranslationOptions {
  readonly speedMetersPerSecond: number;
  readonly dtSeconds: number;
  readonly downwardMetersPerTick?: number;
}

export interface HeadlessMovementCommandSource {
  readonly commandCount: number;
  commandForTick(tick: number): MovementCommand;
}

export const IDLE_MOVEMENT_COMMAND: MovementCommand = Object.freeze({
  kind: "move",
  x: 0,
  z: 0,
});

const ORIGIN: MovementVector = Object.freeze({ x: 0, y: 0, z: 0 });

function requireFinite(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
  return value;
}

function requirePositiveFinite(value: number, name: string): number {
  const finite = requireFinite(value, name);
  if (finite <= 0) {
    throw new RangeError(`${name} must be positive`);
  }
  return finite;
}

function copyStaticVector(
  vector: MovementVector,
  name: string,
  positive = false,
): MovementVector {
  if (typeof vector !== "object" || vector === null) {
    throw new TypeError(`${name} must be an object`);
  }
  const copy = {
    x: requireFinite(vector.x, `${name} x`),
    y: requireFinite(vector.y, `${name} y`),
    z: requireFinite(vector.z, `${name} z`),
  };
  if (positive && (copy.x <= 0 || copy.y <= 0 || copy.z <= 0)) {
    throw new RangeError(`${name} must contain positive dimensions`);
  }
  return Object.freeze(copy);
}

function copyStaticBox(
  box: StaticBoxDescriptor,
  ids: Set<string>,
): StaticBoxDescriptor {
  if (typeof box !== "object" || box === null) {
    throw new TypeError("Static boxes must be objects");
  }
  if (typeof box.id !== "string" || box.id.length === 0) {
    throw new TypeError("Static box IDs must be non-empty strings");
  }
  if (ids.has(box.id)) {
    throw new RangeError("Static box IDs must be unique");
  }
  ids.add(box.id);
  return Object.freeze({
    id: box.id,
    center: copyStaticVector(box.center, "Static box center"),
    halfExtents: copyStaticVector(
      box.halfExtents,
      "Static box half-extents",
      true,
    ),
  });
}

function copyCommand(command: MovementCommand): MovementCommand {
  if (
    typeof command !== "object" ||
    command === null ||
    command.kind !== "move"
  ) {
    throw new TypeError("Movement commands must have kind move");
  }
  const x = requireFinite(command.x, "Movement x");
  const z = requireFinite(command.z, "Movement z");
  if (x < -1 || x > 1 || z < -1 || z > 1 || x * x + z * z > 1) {
    throw new RangeError("Movement axes must be within the unit disc");
  }
  if (x === 0 && z === 0) return IDLE_MOVEMENT_COMMAND;
  return Object.freeze({ kind: "move", x, z });
}

function copyVector(vector: MovementVector): MovementVector {
  if (typeof vector !== "object" || vector === null) {
    throw new TypeError("Movement positions must be objects");
  }
  return Object.freeze({
    x: requireFinite(vector.x, "Position x"),
    y: requireFinite(vector.y, "Position y"),
    z: requireFinite(vector.z, "Position z"),
  });
}

export function createMovementCommand(
  axes: Readonly<{ readonly x: number; readonly z: number }>,
): MovementCommand;
export function createMovementCommand(x: number, z: number): MovementCommand;
export function createMovementCommand(
  axesOrX: number | Readonly<{ readonly x: number; readonly z: number }>,
  z?: number,
): MovementCommand {
  return typeof axesOrX === "number"
    ? copyCommand({ kind: "move", x: axesOrX, z: z as number })
    : copyCommand({ kind: "move", x: axesOrX.x, z: axesOrX.z });
}

export function computeDesiredMovementTranslation(
  command: MovementCommand,
  options: DesiredMovementTranslationOptions,
): MovementVector {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Desired movement translation options must be an object");
  }
  const normalized = copyCommand(command);
  const speed = requirePositiveFinite(
    options.speedMetersPerSecond,
    "Movement speed",
  );
  const dt = requirePositiveFinite(options.dtSeconds, "Movement dt");
  const distance = requireFinite(speed * dt, "Movement distance");
  const downward = requireFinite(
    options.downwardMetersPerTick === undefined
      ? 0.001
      : options.downwardMetersPerTick,
    "Downward movement",
  );
  if (downward < 0) {
    throw new RangeError("Downward movement must be nonnegative");
  }
  if (downward > distance) {
    throw new RangeError("Downward movement must not exceed movement distance");
  }
  return Object.freeze({
    x: normalized.x * distance,
    y: -downward,
    z: normalized.z * distance,
  });
}

export function createMovementState(
  position: MovementVector = ORIGIN,
): MovementState {
  return Object.freeze({ position: copyVector(position) });
}

export function createStaticSceneDescriptor(
  input: StaticSceneDescriptor,
): StaticSceneDescriptor {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("Static scene descriptors must be objects");
  }
  if (!Array.isArray(input.boxes)) {
    throw new TypeError("Static scene boxes must be an array");
  }
  const capsuleRadius = requirePositiveFinite(
    input.capsuleRadius,
    "Capsule radius",
  );
  const capsuleHalfHeight = requirePositiveFinite(
    input.capsuleHalfHeight,
    "Capsule half-height",
  );
  const controllerOffset = requirePositiveFinite(
    input.controllerOffset,
    "Controller offset",
  );
  const ids = new Set<string>();
  const boxes = Object.freeze(
    Array.from(input.boxes, (box) => copyStaticBox(box, ids)),
  );
  return Object.freeze({
    capsuleRadius,
    capsuleHalfHeight,
    controllerOffset,
    boxes,
  });
}

export function applyMovementCommand(
  state: MovementState,
  command: MovementCommand,
  options: MovementStepOptions,
): MovementState {
  if (typeof state !== "object" || state === null) {
    throw new TypeError("Movement state must be an object");
  }
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Movement step options must be an object");
  }
  const normalized = copyCommand(command);
  const position = copyVector(state.position);
  const speed = requireFinite(
    options.speedMetersPerSecond,
    "Movement speed",
  );
  const dt = requireFinite(options.dtSeconds, "Movement dt");
  if (speed <= 0 || dt <= 0) {
    throw new RangeError("Movement speed and dt must be positive");
  }
  const distance = speed * dt;
  const next = {
    x: position.x + normalized.x * distance,
    y: position.y,
    z: position.z + normalized.z * distance,
  };
  return createMovementState(next);
}

export function createHeadlessMovementCommandSource(
  commands: readonly MovementCommand[],
): HeadlessMovementCommandSource {
  if (!Array.isArray(commands)) {
    throw new TypeError("Headless commands must be an array");
  }
  const snapshots = Object.freeze(commands.map((command) => copyCommand(command)));
  return Object.freeze({
    commandCount: snapshots.length,
    commandForTick(tick: number): MovementCommand {
      if (!Number.isSafeInteger(tick) || tick < 1) {
        throw new RangeError("Command ticks must be positive safe integers");
      }
      return snapshots[tick - 1] ?? IDLE_MOVEMENT_COMMAND;
    },
  });
}
