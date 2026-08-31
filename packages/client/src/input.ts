import {
  defineFeatureConfiguration,
  type ClientFeatureDescriptor,
  type ClientFeatureSetupContext,
} from "@three-game-kit/core";
import {
  IDLE_MOVEMENT_COMMAND,
  createMovementCommand,
  type MovementCommand,
} from "@three-game-kit/shared";

export const DEFAULT_SEMANTIC_ACTION_CAPACITY = 32;

export class MovementInputDisposedError extends Error {
  readonly code = "movement-input-disposed";

  constructor() {
    super("Movement input has been disposed");
    this.name = "MovementInputDisposedError";
  }
}

export class SemanticActionInputDisposedError extends Error {
  readonly code = "semantic-action-input-disposed";

  constructor() {
    super("Semantic action input has been disposed");
    this.name = "SemanticActionInputDisposedError";
  }
}

export interface MovementCommandSource {
  sample(): MovementCommand;
}

export interface MovementInput extends MovementCommandSource {
  setMovement(command: MovementCommand): void;
  setMovement(x: number, z: number): void;
  reset(): void;
  dispose(): void;
}

function immutableMovementCommand(command: MovementCommand): MovementCommand {
  if (
    typeof command !== "object" ||
    command === null ||
    command.kind !== "move"
  ) {
    throw new TypeError("Movement commands must have kind move");
  }
  return createMovementCommand(command.x, command.z);
}

function throwDisposed(): never {
  throw new MovementInputDisposedError();
}

export function createMovementInput(
  initial: MovementCommand = IDLE_MOVEMENT_COMMAND,
): MovementInput {
  let current = immutableMovementCommand(initial);
  let disposed = false;

  function requireActive(): void {
    if (disposed) throwDisposed();
  }

  function setMovement(command: MovementCommand): void;
  function setMovement(x: number, z: number): void;
  function setMovement(
    commandOrX: MovementCommand | number,
    z?: number,
  ): void {
    requireActive();
    current =
      typeof commandOrX === "number"
        ? createMovementCommand(commandOrX, z as number)
        : immutableMovementCommand(commandOrX);
  }

  return Object.freeze({
    setMovement,
    sample(): MovementCommand {
      requireActive();
      return current;
    },
    reset(): void {
      requireActive();
      current = IDLE_MOVEMENT_COMMAND;
    },
    dispose(): void {
      if (disposed) return;
      current = IDLE_MOVEMENT_COMMAND;
      disposed = true;
    },
  });
}

export interface SemanticActionSource<Action extends string = string> {
  drain(): readonly Action[];
}

export interface SemanticActionInput<Action extends string = string>
  extends SemanticActionSource<Action> {
  press(action: Action): boolean;
  reset(): void;
  dispose(): void;
}

export interface SemanticActionInputOptions {
  readonly capacity?: number;
}

export function createSemanticActionInput<const Action extends string>(
  allowedActions: readonly Action[],
  options: SemanticActionInputOptions = {},
): SemanticActionInput<Action> {
  if (!Array.isArray(allowedActions) || allowedActions.length === 0) {
    throw new TypeError("Semantic action names must be a non-empty array");
  }
  const allowed = new Set<string>();
  for (const action of allowedActions) {
    if (
      typeof action !== "string" ||
      action.length === 0 ||
      allowed.has(action)
    ) {
      throw new TypeError(
        "Semantic action names must be unique non-empty strings",
      );
    }
    allowed.add(action);
  }
  if (
    typeof options !== "object" ||
    options === null ||
    (options.capacity !== undefined &&
      (!Number.isInteger(options.capacity) || options.capacity <= 0))
  ) {
    throw new TypeError(
      "Semantic action input capacity must be a positive integer",
    );
  }

  const capacity = options.capacity ?? DEFAULT_SEMANTIC_ACTION_CAPACITY;
  const queued: Action[] = [];
  let disposed = false;

  function requireActive(): void {
    if (disposed) throw new SemanticActionInputDisposedError();
  }

  return Object.freeze({
    press(action: Action): boolean {
      requireActive();
      if (typeof action !== "string" || !allowed.has(action)) {
        throw new TypeError("Semantic action is not allowed");
      }
      if (queued.length === capacity) return false;
      queued.push(action);
      return true;
    },
    drain(): readonly Action[] {
      requireActive();
      return Object.freeze(queued.splice(0, queued.length));
    },
    reset(): void {
      if (disposed) return;
      queued.length = 0;
    },
    dispose(): void {
      if (disposed) return;
      queued.length = 0;
      disposed = true;
    },
  });
}

export interface KeyboardMovementEvent {
  readonly code: string;
}

export type KeyboardMovementListener = (
  event: KeyboardMovementEvent,
) => void;

export type KeyboardMovementEventType = "keydown" | "keyup";

export interface KeyboardMovementListenerSource {
  addListener(
    type: KeyboardMovementEventType,
    listener: KeyboardMovementListener,
  ): void;
  removeListener(
    type: KeyboardMovementEventType,
    listener: KeyboardMovementListener,
  ): void;
}

export interface KeyboardMovementAdapter extends MovementCommandSource {
  dispose(): void;
}

const MOVEMENT_KEY_CODES = Object.freeze([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowLeft",
  "ArrowDown",
  "ArrowRight",
] as const);

const DIAGONAL_AXIS = Math.sqrt(0.5 - Number.EPSILON);

function isMovementKeyCode(code: string): boolean {
  return (MOVEMENT_KEY_CODES as readonly string[]).includes(code);
}

function anyPressed(pressed: ReadonlySet<string>, ...codes: string[]): boolean {
  return codes.some((code) => pressed.has(code));
}

export function createKeyboardMovementAdapter(
  listeners: KeyboardMovementListenerSource,
): KeyboardMovementAdapter {
  if (
    typeof listeners !== "object" ||
    listeners === null ||
    typeof listeners.addListener !== "function" ||
    typeof listeners.removeListener !== "function"
  ) {
    throw new TypeError("Keyboard movement listener source is invalid");
  }

  const addListener = listeners.addListener;
  const removeListener = listeners.removeListener;
  const input = createMovementInput();
  const pressed = new Set<string>();
  let disposed = false;

  function updateMovement(): void {
    const left = anyPressed(pressed, "KeyA", "ArrowLeft");
    const right = anyPressed(pressed, "KeyD", "ArrowRight");
    const forward = anyPressed(pressed, "KeyW", "ArrowUp");
    const backward = anyPressed(pressed, "KeyS", "ArrowDown");
    const x = Number(right) - Number(left);
    const z = Number(backward) - Number(forward);
    const scale = x !== 0 && z !== 0 ? DIAGONAL_AXIS : 1;
    input.setMovement(x * scale, z * scale);
  }

  const keyDown: KeyboardMovementListener = (event) => {
    if (disposed || !isMovementKeyCode(event?.code)) return;
    pressed.add(event.code);
    updateMovement();
  };
  const keyUp: KeyboardMovementListener = (event) => {
    if (disposed || !isMovementKeyCode(event?.code)) return;
    pressed.delete(event.code);
    updateMovement();
  };

  addListener.call(listeners, "keydown", keyDown);
  try {
    addListener.call(listeners, "keyup", keyUp);
  } catch (error) {
    disposed = true;
    pressed.clear();
    input.dispose();
    try {
      removeListener.call(listeners, "keydown", keyDown);
    } catch {}
    throw error;
  }

  return Object.freeze({
    sample(): MovementCommand {
      if (disposed) throwDisposed();
      return input.sample();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      pressed.clear();
      input.dispose();

      let cleanupError: unknown;
      try {
        removeListener.call(listeners, "keydown", keyDown);
      } catch (error) {
        cleanupError = error;
      }
      try {
        removeListener.call(listeners, "keyup", keyUp);
      } catch (error) {
        cleanupError ??= error;
      }
      if (cleanupError !== undefined) throw cleanupError;
    },
  });
}

export interface InputFeatureOptions {
  readonly input: MovementCommandSource;
  readonly publish: (command: MovementCommand) => void;
  readonly actions?: SemanticActionSource;
  readonly publishAction?: (action: string) => void;
}

type InputFeatureConfiguration = Readonly<Record<string, never>>;

const INPUT_FEATURE_CONFIGURATION =
  defineFeatureConfiguration<InputFeatureConfiguration>({
    defaultValue: () => Object.freeze({}),
    parse(input: unknown) {
      if (
        typeof input === "object" &&
        input !== null &&
        !Array.isArray(input) &&
        Object.keys(input).length === 0
      ) {
        return {
          ok: true,
          value: Object.freeze({}) as InputFeatureConfiguration,
        };
      }
      return {
        ok: false,
        issues: [{ path: [], code: "empty-object-required" }],
      };
    },
  });

export function createInputFeature(
  options: InputFeatureOptions,
): ClientFeatureDescriptor<InputFeatureConfiguration> {
  if (
    typeof options !== "object" ||
    options === null ||
    typeof options.input !== "object" ||
    options.input === null ||
    typeof options.input.sample !== "function" ||
    typeof options.publish !== "function"
  ) {
    throw new TypeError("Input feature options are invalid");
  }
  const hasActions = options.actions !== undefined;
  const hasActionPublisher = options.publishAction !== undefined;
  if (
    hasActions !== hasActionPublisher ||
    (hasActions &&
      (typeof options.actions !== "object" ||
        options.actions === null ||
        typeof options.actions.drain !== "function" ||
        typeof options.publishAction !== "function"))
  ) {
    throw new TypeError("Input feature action options are invalid");
  }

  const input = options.input;
  const sample = input.sample;
  const publish = options.publish;
  const actions = options.actions;
  const drain = actions?.drain;
  const publishAction = options.publishAction;
  let active = false;

  const contribution = Object.freeze({
    kind: "system" as const,
    id: "movement-input-sample",
    domain: "client-simulation" as const,
    phase: "action-sample" as const,
    priority: 0,
    run(): void {
      if (!active) return;
      const command = immutableMovementCommand(sample.call(input));
      if (!active) return;
      publish(command);
      if (
        actions === undefined ||
        drain === undefined ||
        publishAction === undefined
      ) {
        return;
      }
      const drained = drain.call(actions);
      if (!Array.isArray(drained)) {
        throw new TypeError("Semantic action source must drain an array");
      }
      for (const action of drained) {
        if (typeof action !== "string") {
          throw new TypeError("Semantic actions must be strings");
        }
        if (!active) return;
        publishAction(action);
      }
    },
  });

  return Object.freeze({
    id: "movement-input",
    description: "Samples movement and optionally drains semantic actions per tick",
    runtimeContributions: Object.freeze([contribution]),
    requires: Object.freeze([]),
    conflicts: Object.freeze([]),
    configuration: INPUT_FEATURE_CONFIGURATION,
    setup({ ledger }: ClientFeatureSetupContext<InputFeatureConfiguration>): void {
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
