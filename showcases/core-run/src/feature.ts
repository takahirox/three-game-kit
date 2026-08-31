import {
  defineFeatureConfiguration,
  type ClientFeatureDescriptor,
  type ClientFeatureSetupContext,
} from "@three-game-kit/core";
import type { CoreRunState, OneShotAction, TelemetryEvent } from "./state.js";

export const CORE_RUN_STANDARD_FEATURE_ID = "core-run.standard-tick";

/** Per-step context handed to every Core Run Feature. */
export interface StepContext {
  readonly tick: number;
  readonly dt: number;
  readonly time: number;
  readonly pressed: ReadonlySet<OneShotAction>;
  readonly emit: (event: TelemetryEvent) => void;
}

/**
 * A game-specific Feature: an isolated, deterministic slice of the rules.
 * Each Feature owns a slice of CoreRunState, restores it on `reset`, and
 * advances it on `step`. Features never touch the DOM, timers, or clocks.
 */
export interface CoreRunFeature {
  readonly id: string;
  reset(state: CoreRunState, dt: number): void;
  step(state: CoreRunState, context: StepContext): void;
}

export interface CoreRunFeatureBindings {
  readonly state: () => CoreRunState;
  readonly context: () => StepContext;
  readonly capture: (featureId: string, operation: string, cause: unknown) => void;
}

const EMPTY_CONFIGURATION = defineFeatureConfiguration<
  Readonly<Record<string, never>>
>({
  defaultValue: () => Object.freeze({}),
  parse(input) {
    return typeof input === "object" && input !== null &&
        !Array.isArray(input) && Object.keys(input).length === 0
      ? { ok: true as const, value: Object.freeze({}) }
      : {
          ok: false as const,
          issues: Object.freeze([{ path: Object.freeze([]), code: "empty-object-required" }]),
        };
  },
});

/** Adapts one Core Run rule slice to the public Client Feature boundary. */
export function createClientFeatureDescriptor(
  feature: CoreRunFeature,
  requires: readonly string[],
  priority: number,
  bindings: CoreRunFeatureBindings,
): ClientFeatureDescriptor<Readonly<Record<string, never>>> {
  let active = false;
  const contribution = Object.freeze({
    kind: "system" as const,
    id: `${feature.id}.step`,
    domain: "client-simulation" as const,
    phase: "shared-predict" as const,
    priority,
    run(): void {
      if (!active) return;
      try {
        feature.step(bindings.state(), bindings.context());
      } catch (cause) {
        bindings.capture(feature.id, "core-run-step", cause);
      }
    },
  });
  return Object.freeze({
    id: feature.id,
    description: `Core Run deterministic rule: ${feature.id}`,
    runtimeContributions: Object.freeze([contribution]),
    requires: Object.freeze([...requires]),
    conflicts: Object.freeze([]),
    configuration: EMPTY_CONFIGURATION,
    setup({ ledger }: ClientFeatureSetupContext<Readonly<Record<string, never>>>): void {
      active = true;
      ledger.activateSystem(contribution.id);
    },
    dispose(): void {
      active = false;
    },
  });
}

export function createStandardTickFeature(
  advanceTick: () => void,
): ClientFeatureDescriptor<Readonly<Record<string, never>>> {
  const contribution = Object.freeze({
    kind: "system" as const,
    id: `${CORE_RUN_STANDARD_FEATURE_ID}.step`,
    domain: "client-simulation" as const,
    phase: "shared-predict" as const,
    priority: -100,
    run: advanceTick,
  });
  return Object.freeze({
    id: CORE_RUN_STANDARD_FEATURE_ID,
    description: "Advances the Core Run game tick through the public scheduler",
    runtimeContributions: Object.freeze([contribution]),
    requires: Object.freeze([]),
    conflicts: Object.freeze([]),
    configuration: EMPTY_CONFIGURATION,
    setup({ ledger }: ClientFeatureSetupContext<Readonly<Record<string, never>>>): void {
      ledger.activateSystem(contribution.id);
    },
    dispose(): void {},
  });
}

export function ticksFromSeconds(seconds: number, dt: number): number {
  return Math.round(seconds / dt);
}
