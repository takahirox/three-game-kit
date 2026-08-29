import {
  ticksFromSeconds,
  type CoreRunFeature,
  type StepContext,
} from "../feature.js";
import type { CoreRunState, RoundPhase } from "../state.js";

export const COUNTDOWN_SECONDS = 3;
export const ROUND_SECONDS = 30;
export const TIME_UP_SECONDS = 1;

export function setPhase(
  state: CoreRunState,
  to: RoundPhase,
  context: StepContext,
): void {
  const from = state.round.phase;
  if (from === to) return;
  state.round.phase = to;
  context.emit({ kind: "phaseChanged", tick: context.tick, from, to });
}

/** Begins the 3-2-1-GO countdown; the caller has already reset the state. */
export function beginCountdown(
  state: CoreRunState,
  context: StepContext,
): void {
  state.round.countdownTicks = ticksFromSeconds(COUNTDOWN_SECONDS, context.dt);
  setPhase(state, "countdown", context);
  context.emit({
    kind: "countdown",
    tick: context.tick,
    value: COUNTDOWN_SECONDS,
  });
}

export function countdownValue(
  state: CoreRunState,
  dt: number,
): number | null {
  if (state.round.phase !== "countdown") return null;
  return Math.ceil(state.round.countdownTicks / ticksFromSeconds(1, dt));
}

export function remainingSeconds(state: CoreRunState, dt: number): number {
  return state.round.roundTicks / ticksFromSeconds(1, dt);
}

/** title -> countdown 3-2-1-GO -> running (exactly 30 s) -> timeUp -> results. */
export function createRoundTimerFeature(): CoreRunFeature {
  return {
    id: "core-run.round-timer",
    reset(state, dt) {
      state.round = {
        phase: "title",
        countdownTicks: 0,
        roundTicks: ticksFromSeconds(ROUND_SECONDS, dt),
        timeUpTicks: 0,
      };
    },
    step(state, context) {
      const round = state.round;
      const perSecond = ticksFromSeconds(1, context.dt);
      if (round.phase === "countdown") {
        const before = Math.ceil(round.countdownTicks / perSecond);
        round.countdownTicks -= 1;
        const after = Math.ceil(round.countdownTicks / perSecond);
        if (after !== before) {
          context.emit({
            kind: "countdown",
            tick: context.tick,
            value: after === 0 ? "go" : after,
          });
        }
        if (round.countdownTicks <= 0) {
          round.countdownTicks = 0;
          round.roundTicks = ticksFromSeconds(ROUND_SECONDS, context.dt);
          setPhase(state, "running", context);
        }
      } else if (round.phase === "running") {
        round.roundTicks -= 1;
        if (round.roundTicks <= 0) {
          round.roundTicks = 0;
          round.timeUpTicks = ticksFromSeconds(TIME_UP_SECONDS, context.dt);
          setPhase(state, "timeUp", context);
        }
      } else if (round.phase === "timeUp") {
        round.timeUpTicks -= 1;
        if (round.timeUpTicks <= 0) setPhase(state, "results", context);
      }
    },
  };
}
