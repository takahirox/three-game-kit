import type { CoreRunSnapshot, RoundPhase } from "../state.js";
import { ROUND_SECONDS } from "./round-timer.js";

export const GO_LABEL_SECONDS = 0.5;

/** A pure, DOM-free view model that a Canvas/UI layer can render directly. */
export interface HudViewModel {
  readonly phase: RoundPhase;
  readonly title: string | null;
  readonly countdownLabel: string | null;
  readonly timerLabel: string;
  readonly score: number;
  readonly comboLabel: string | null;
  readonly carryLabel: string | null;
  readonly coresRemaining: number;
  readonly dashReady: boolean;
  readonly prompt: string | null;
}

export function createHudViewModel(snapshot: CoreRunSnapshot): HudViewModel {
  const { phase } = snapshot;
  const carried =
    snapshot.carry.coreId === null
      ? null
      : (snapshot.cores[snapshot.carry.coreId] ?? null);
  const countdownLabel =
    snapshot.countdownValue !== null
      ? String(snapshot.countdownValue)
      : phase === "running" &&
          snapshot.remainingSeconds > ROUND_SECONDS - GO_LABEL_SECONDS
        ? "GO"
        : null;
  return Object.freeze({
    phase,
    title: phase === "title" ? "CORE RUN" : null,
    countdownLabel,
    timerLabel: snapshot.remainingSeconds.toFixed(1),
    score: snapshot.score.score,
    comboLabel: snapshot.combo.count > 0 ? `x${snapshot.combo.count}` : null,
    carryLabel:
      carried === null
        ? null
        : `${carried.kind.toUpperCase()} core (+${carried.value})`,
    coresRemaining: snapshot.cores.filter((core) => !core.collected).length,
    dashReady: snapshot.player.dashCooldownTicks === 0,
    prompt:
      phase === "title"
        ? "Press Start"
        : phase === "results"
          ? `Final score ${snapshot.score.score} - Retry?`
          : phase === "timeUp"
            ? "TIME UP"
            : null,
  });
}
