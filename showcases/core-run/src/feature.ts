import type { CoreRunState, OneShotAction, TelemetryEvent } from "./state.js";

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

export function ticksFromSeconds(seconds: number, dt: number): number {
  return Math.round(seconds / dt);
}
