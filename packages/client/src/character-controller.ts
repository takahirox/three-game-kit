import {
  defineFeatureConfiguration,
  type ClientFeatureDescriptor,
  type ClientFeatureSetupContext,
} from "@three-game-kit/core";
import type { MovementVector } from "@three-game-kit/shared";
import type { ClientCollisionAdapter } from "./collision.js";

export interface CharacterControllerInput {
  readonly x: number;
  readonly z: number;
  readonly run: boolean;
  readonly jump: boolean;
  readonly platformVelocity?: MovementVector;
}

export interface CharacterControllerConfiguration {
  readonly walkSpeed: number;
  readonly runSpeed: number;
  readonly gravity: number;
  readonly jumpSpeed: number;
  readonly maximumFallSpeed: number;
}

export interface CharacterControllerState {
  readonly position: MovementVector;
  readonly velocity: MovementVector;
  readonly grounded: boolean;
  readonly collided: boolean;
  readonly tick: number;
}

export interface CharacterController {
  readonly disposed: boolean;
  step(seconds: number, input: CharacterControllerInput): CharacterControllerState;
  applyImpulse(impulse: MovementVector): void;
  setVelocity(velocity: MovementVector): void;
  teleport(position: MovementVector): CharacterControllerState;
  inspect(): CharacterControllerState;
  dispose(): void;
}

export interface CharacterControllerFeatureOptions {
  readonly controller: CharacterController;
  readInput(): CharacterControllerInput;
  publish(state: CharacterControllerState): void;
}

const MAX_INPUT_MAGNITUDE = 1;

function exactKeys(value: object, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.every((key) => typeof key === "string" && (required.includes(key) || optional.includes(key))) &&
    required.every((key) => keys.includes(key));
}

function vector(value: MovementVector, label: string): MovementVector {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !exactKeys(value, ["x", "y", "z"])) {
    throw new TypeError(`${label} must contain exactly x, y, and z`);
  }
  if (![value.x, value.y, value.z].every((component) => typeof component === "number" && Number.isFinite(component))) {
    throw new TypeError(`${label} components must be finite numbers`);
  }
  return Object.freeze({ x: value.x, y: value.y, z: value.z });
}

function positive(value: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive finite number`);
  }
  return value;
}

function configuration(value: CharacterControllerConfiguration): CharacterControllerConfiguration {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      !exactKeys(value, ["walkSpeed", "runSpeed", "gravity", "jumpSpeed", "maximumFallSpeed"])) {
    throw new TypeError("Character controller configuration is invalid");
  }
  const copied = Object.freeze({
    walkSpeed: positive(value.walkSpeed, "walkSpeed"),
    runSpeed: positive(value.runSpeed, "runSpeed"),
    gravity: positive(value.gravity, "gravity"),
    jumpSpeed: positive(value.jumpSpeed, "jumpSpeed"),
    maximumFallSpeed: positive(value.maximumFallSpeed, "maximumFallSpeed"),
  });
  if (copied.runSpeed < copied.walkSpeed) {
    throw new TypeError("runSpeed must be greater than or equal to walkSpeed");
  }
  return copied;
}

function input(value: CharacterControllerInput): CharacterControllerInput {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      !exactKeys(value, ["x", "z", "run", "jump"], ["platformVelocity"])) {
    throw new TypeError("Character controller input is invalid");
  }
  if (!Number.isFinite(value.x) || !Number.isFinite(value.z) ||
      Math.abs(value.x) > MAX_INPUT_MAGNITUDE || Math.abs(value.z) > MAX_INPUT_MAGNITUDE ||
      typeof value.run !== "boolean" || typeof value.jump !== "boolean") {
    throw new TypeError("Character controller input values are invalid");
  }
  return Object.freeze({
    x: value.x,
    z: value.z,
    run: value.run,
    jump: value.jump,
    ...(value.platformVelocity === undefined ? {} : { platformVelocity: vector(value.platformVelocity, "Platform velocity") }),
  });
}

function snapshot(position: MovementVector, velocity: MovementVector, grounded: boolean, collided: boolean, tick: number): CharacterControllerState {
  return Object.freeze({
    position: vector(position, "Character position"),
    velocity: vector(velocity, "Character velocity"),
    grounded,
    collided,
    tick,
  });
}

export function createCharacterController(options: {
  readonly collision: ClientCollisionAdapter;
  readonly initialPosition: MovementVector;
  readonly configuration: CharacterControllerConfiguration;
}): CharacterController {
  if (typeof options !== "object" || options === null || Array.isArray(options) ||
      !exactKeys(options, ["collision", "initialPosition", "configuration"]) ||
      typeof options.collision !== "object" || options.collision === null ||
      typeof options.collision.move !== "function" || typeof options.collision.dispose !== "function") {
    throw new TypeError("Character controller options are invalid");
  }
  const collision = options.collision;
  const config = configuration(options.configuration);
  let position = vector(options.initialPosition, "Initial position");
  let velocity: MovementVector = Object.freeze({ x: 0, y: 0, z: 0 });
  let verticalVelocity = 0;
  let externalHorizontal: Readonly<{ x: number; z: number }> = Object.freeze({ x: 0, z: 0 });
  let grounded = false;
  let collided = false;
  let tick = 0;
  let disposed = false;

  function current(): CharacterControllerState {
    return snapshot(position, velocity, grounded, collided, tick);
  }

  return Object.freeze({
    get disposed(): boolean { return disposed; },
    step(seconds: number, rawInput: CharacterControllerInput): CharacterControllerState {
      if (disposed) throw new Error("Character controller has been disposed");
      if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0 || seconds > 1) {
        throw new TypeError("Character controller step must be in (0, 1] seconds");
      }
      const command = input(rawInput);
      const magnitude = Math.hypot(command.x, command.z);
      const scale = magnitude > 1 ? 1 / magnitude : 1;
      const speed = command.run ? config.runSpeed : config.walkSpeed;
      const platform = command.platformVelocity ?? { x: 0, y: 0, z: 0 };
      let vertical = verticalVelocity;
      if (command.jump && grounded) {
        vertical = config.jumpSpeed;
        grounded = false;
      } else if (!grounded) {
        vertical = Math.max(vertical - config.gravity * seconds, -config.maximumFallSpeed);
      } else if (vertical < 0) {
        vertical = 0;
      }
      verticalVelocity = vertical;
      velocity = Object.freeze({
        x: command.x * scale * speed + platform.x + externalHorizontal.x,
        y: vertical + platform.y,
        z: command.z * scale * speed + platform.z + externalHorizontal.z,
      });
      const outcome = collision.move(position, {
        x: velocity.x * seconds,
        y: velocity.y * seconds,
        z: velocity.z * seconds,
      });
      if (!outcome.ok) throw new Error(`Character collision failed: ${outcome.failure.code}`);
      position = outcome.value.position;
      grounded = outcome.value.grounded;
      collided = outcome.value.collided;
      if (grounded && verticalVelocity < 0) {
        verticalVelocity = 0;
        velocity = Object.freeze({ x: velocity.x, y: platform.y, z: velocity.z });
      }
      tick += 1;
      return current();
    },
    applyImpulse(rawImpulse: MovementVector): void {
      if (disposed) throw new Error("Character controller has been disposed");
      const impulse = vector(rawImpulse, "Character impulse");
      externalHorizontal = Object.freeze({ x: externalHorizontal.x + impulse.x, z: externalHorizontal.z + impulse.z });
      verticalVelocity += impulse.y;
      velocity = Object.freeze({ x: velocity.x + impulse.x, y: velocity.y + impulse.y, z: velocity.z + impulse.z });
      if (impulse.y > 0) grounded = false;
    },
    setVelocity(rawVelocity: MovementVector): void {
      if (disposed) throw new Error("Character controller has been disposed");
      const next = vector(rawVelocity, "Character velocity");
      externalHorizontal = Object.freeze({ x: next.x, z: next.z });
      verticalVelocity = next.y;
      velocity = next;
      if (next.y > 0) grounded = false;
    },
    teleport(rawPosition: MovementVector): CharacterControllerState {
      if (disposed) throw new Error("Character controller has been disposed");
      position = vector(rawPosition, "Character teleport position");
      velocity = Object.freeze({ x: 0, y: 0, z: 0 });
      verticalVelocity = 0;
      externalHorizontal = Object.freeze({ x: 0, z: 0 });
      grounded = false;
      collided = false;
      return current();
    },
    inspect(): CharacterControllerState { return current(); },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      collision.dispose();
    },
  });
}

type EmptyConfiguration = Readonly<Record<string, never>>;
const EMPTY_CONFIGURATION = defineFeatureConfiguration<EmptyConfiguration>({
  defaultValue: () => Object.freeze({}),
  parse(value: unknown) {
    return typeof value === "object" && value !== null && !Array.isArray(value) && Reflect.ownKeys(value).length === 0
      ? { ok: true as const, value: Object.freeze({}) as EmptyConfiguration }
      : { ok: false as const, issues: [{ path: [], code: "empty-object-required" }] };
  },
});

export function createCharacterControllerFeature(options: CharacterControllerFeatureOptions): ClientFeatureDescriptor<EmptyConfiguration> {
  if (typeof options !== "object" || options === null || Array.isArray(options) ||
      !exactKeys(options, ["controller", "readInput", "publish"]) ||
      typeof options.controller !== "object" || options.controller === null ||
      typeof options.controller.step !== "function" || typeof options.controller.dispose !== "function" ||
      typeof options.readInput !== "function" || typeof options.publish !== "function") {
    throw new TypeError("Character controller Feature options are invalid");
  }
  const controller = options.controller;
  let active = false;
  let disposed = false;
  const contribution = Object.freeze({
    kind: "system" as const,
    id: "character-controller-predict",
    domain: "client-simulation" as const,
    phase: "predictive-collision" as const,
    priority: 0,
    run({ dt }: { readonly dt: number }): void {
      if (active && !disposed) options.publish(controller.step(dt, options.readInput()));
    },
  });
  return Object.freeze({
    id: "character-controller",
    description: "Applies deterministic character locomotion above the public collision adapter",
    runtimeContributions: Object.freeze([contribution]),
    requires: Object.freeze([]),
    conflicts: Object.freeze(["collision"]),
    configuration: EMPTY_CONFIGURATION,
    setup({ ledger }: ClientFeatureSetupContext<EmptyConfiguration>): void {
      if (disposed) throw new Error("Character controller Feature has been disposed");
      active = true;
      try { ledger.activateSystem(contribution.id); } catch (error) { active = false; throw error; }
    },
    dispose(): void {
      if (disposed) return;
      active = false;
      disposed = true;
      controller.dispose();
    },
  });
}
