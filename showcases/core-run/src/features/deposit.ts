import { ticksFromSeconds, type CoreRunFeature } from "../feature.js";
import { PLAYER_SPAWN, distanceXZ, type Vec3 } from "../state.js";

export const BASE_POSITION: Vec3 = PLAYER_SPAWN;
export const BASE_RADIUS = 2;
export const COMBO_WINDOW_SECONDS = 5;

/** Deposit at the base for value x combo; combo expires after a fixed window. */
export function createDepositFeature(): CoreRunFeature {
  return {
    id: "core-run.deposit",
    reset(state) {
      state.score = { score: 0, deposits: 0 };
      state.combo = { count: 0, windowTicks: 0 };
    },
    step(state, context) {
      const combo = state.combo;
      if (combo.windowTicks > 0) {
        combo.windowTicks -= 1;
        if (combo.windowTicks === 0 && combo.count > 0) {
          const expired = combo.count;
          combo.count = 0;
          context.emit({ kind: "comboExpired", tick: context.tick, combo: expired });
        }
      }
      const coreId = state.carry.coreId;
      if (
        state.round.phase !== "running" ||
        coreId === null ||
        !context.pressed.has("interact") ||
        distanceXZ(state.player.position, BASE_POSITION) > BASE_RADIUS
      ) {
        return;
      }
      const core = state.cores[coreId];
      if (core === undefined) return;
      combo.count += 1;
      combo.windowTicks = ticksFromSeconds(COMBO_WINDOW_SECONDS, context.dt);
      const points = core.value * combo.count;
      state.score.score += points;
      state.score.deposits += 1;
      state.carry.coreId = null;
      state.carry.lastDepositTick = context.tick;
      context.emit({
        kind: "coreDeposited",
        tick: context.tick,
        coreId,
        value: core.value,
        combo: combo.count,
        points,
        score: state.score.score,
      });
    },
  };
}
