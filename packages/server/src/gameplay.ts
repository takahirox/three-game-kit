import {
  defineFeatureConfiguration,
  type FeatureDescriptor,
  type FeatureSetupContext,
  type ServerRuntimeContribution,
} from "@three-game-kit/core";
import type {
  GameFlowRuntime,
  HealthEvent,
  HealthRuntime,
  SpawnPrefabRuntime,
  TriggerActor,
  TriggerAreaEvent,
  TriggerAreaRuntime,
} from "@three-game-kit/shared/gameplay";

type EmptyConfiguration = Readonly<Record<string, never>>;

const EMPTY_CONFIGURATION = defineFeatureConfiguration<EmptyConfiguration>({
  defaultValue: () => Object.freeze({}),
  parse(value: unknown) {
    return typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Reflect.ownKeys(value).length === 0
      ? { ok: true as const, value: Object.freeze({}) as EmptyConfiguration }
      : {
          ok: false as const,
          issues: [{ path: [], code: "empty-object-required" }],
        };
  },
});

function exactObject(value: unknown, keys: readonly string[]): value is object {
  const ownKeys =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? Reflect.ownKeys(value)
      : [];
  return (
    ownKeys.length === keys.length &&
    keys.every((key) => ownKeys.includes(key))
  );
}

export interface TriggerAreaServerFeatureOptions {
  readonly runtime: TriggerAreaRuntime;
  readActors(): readonly TriggerActor[];
  publish(events: readonly TriggerAreaEvent[]): void;
}

export function createTriggerAreaServerFeature(
  options: TriggerAreaServerFeatureOptions,
): FeatureDescriptor<EmptyConfiguration, ServerRuntimeContribution> {
  if (
    !exactObject(options, ["runtime", "readActors", "publish"]) ||
    typeof options.runtime.step !== "function" ||
    typeof options.runtime.dispose !== "function" ||
    typeof options.readActors !== "function" ||
    typeof options.publish !== "function"
  ) {
    throw new TypeError("Trigger Area server Feature options are invalid");
  }

  let active = false;
  let disposed = false;
  const contribution = Object.freeze({
    kind: "system" as const,
    id: "trigger-area-server-evaluate",
    domain: "server-simulation" as const,
    phase: "gameplay" as const,
    priority: 100,
    run({ tick }: { readonly tick: number }): void {
      if (active && !disposed) {
        options.publish(options.runtime.step(tick, options.readActors()));
      }
    },
  });

  return Object.freeze({
    id: "trigger-area.server",
    description: "Evaluates authoritative server Trigger Areas",
    runtimeContributions: Object.freeze([contribution]),
    requires: Object.freeze([]),
    conflicts: Object.freeze([]),
    configuration: EMPTY_CONFIGURATION,
    setup({ ledger }: FeatureSetupContext<EmptyConfiguration>): void {
      if (disposed) throw new Error("Trigger Area server Feature has been disposed");
      active = true;
      try {
        ledger.activateSystem(contribution.id);
      } catch (error) {
        active = false;
        throw error;
      }
    },
    dispose(): void {
      if (!disposed) {
        disposed = true;
        active = false;
        options.runtime.dispose();
      }
    },
  });
}

export interface HealthServerFeatureOptions {
  readonly runtime: HealthRuntime;
  publish(events: readonly HealthEvent[]): void;
}

export function createHealthServerFeature(
  options: HealthServerFeatureOptions,
): FeatureDescriptor<EmptyConfiguration, ServerRuntimeContribution> {
  if (
    !exactObject(options, ["runtime", "publish"]) ||
    typeof options.runtime.step !== "function" ||
    typeof options.runtime.dispose !== "function" ||
    typeof options.publish !== "function"
  ) {
    throw new TypeError("Health server Feature options are invalid");
  }

  let active = false;
  let disposed = false;
  const contribution = Object.freeze({
    kind: "system" as const,
    id: "health-damage-server-apply",
    domain: "server-simulation" as const,
    phase: "gameplay" as const,
    priority: 200,
    run({ tick }: { readonly tick: number }): void {
      if (active && !disposed) options.publish(options.runtime.step(tick));
    },
  });

  return Object.freeze({
    id: "health-damage.server",
    description: "Applies authoritative server health requests",
    runtimeContributions: Object.freeze([contribution]),
    requires: Object.freeze([]),
    conflicts: Object.freeze([]),
    configuration: EMPTY_CONFIGURATION,
    setup({ ledger }: FeatureSetupContext<EmptyConfiguration>): void {
      if (disposed) throw new Error("Health server Feature has been disposed");
      active = true;
      try {
        ledger.activateSystem(contribution.id);
      } catch (error) {
        active = false;
        throw error;
      }
    },
    dispose(): void {
      if (!disposed) {
        disposed = true;
        active = false;
        options.runtime.dispose();
      }
    },
  });
}

function ownedPassiveFeature(
  id: string,
  description: string,
  runtime: SpawnPrefabRuntime | GameFlowRuntime,
): FeatureDescriptor<EmptyConfiguration, ServerRuntimeContribution> {
  let disposed = false;
  return Object.freeze({
    id,
    description,
    runtimeContributions: Object.freeze([]),
    requires: Object.freeze([]),
    conflicts: Object.freeze([]),
    configuration: EMPTY_CONFIGURATION,
    setup(): void {
      if (disposed) throw new Error(`${id} Feature has been disposed`);
    },
    dispose(): void {
      if (!disposed) {
        disposed = true;
        runtime.dispose();
      }
    },
  });
}

export function createSpawnPrefabServerFeature(
  runtime: SpawnPrefabRuntime,
): FeatureDescriptor<EmptyConfiguration, ServerRuntimeContribution> {
  if (
    typeof runtime !== "object" ||
    runtime === null ||
    typeof runtime.spawn !== "function" ||
    typeof runtime.dispose !== "function"
  ) {
    throw new TypeError("Spawn Prefab server runtime is invalid");
  }
  return ownedPassiveFeature(
    "spawn-prefab.server",
    "Owns authoritative server prefab instances",
    runtime,
  );
}

export function createGameFlowServerFeature(
  runtime: GameFlowRuntime,
): FeatureDescriptor<EmptyConfiguration, ServerRuntimeContribution> {
  if (
    typeof runtime !== "object" ||
    runtime === null ||
    typeof runtime.transition !== "function" ||
    typeof runtime.dispose !== "function"
  ) {
    throw new TypeError("Game Flow server runtime is invalid");
  }
  return ownedPassiveFeature(
    "game-flow.server",
    "Owns authoritative server game flow",
    runtime,
  );
}
