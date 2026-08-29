import type { CoreRunFeature } from "../feature.js";
import {
  distance,
  vec3,
  type CoreKind,
  type CoreState,
  type Vec3,
} from "../state.js";

export const CORE_VALUES: Readonly<Record<CoreKind, number>> = Object.freeze({
  blue: 1,
  gold: 3,
  red: 5,
});
export const PICKUP_RADIUS = 1.25;

export interface CorePlacement {
  readonly kind: CoreKind;
  readonly position: Vec3;
}

function place(kind: CoreKind, x: number, y: number, z: number): CorePlacement {
  return Object.freeze({ kind, position: vec3(x, y, z) });
}

/** Exactly 12 fixed placements: 6 blue, 4 gold, 2 red. */
export const CORE_PLACEMENTS: readonly CorePlacement[] = Object.freeze([
  place("blue", 4, 0, 4),
  place("blue", -4, 0, 4),
  place("blue", 4, 0, -4),
  place("blue", -4, 0, -4),
  place("blue", 8, 0, 0),
  place("blue", -8, 0, 0),
  place("gold", 10, 0, 8),
  place("gold", -10, 0, 8),
  place("gold", 10, 0, -8),
  place("gold", -10, 0, -8),
  place("red", 0, 2.5, -12),
  place("red", 14, 3, 0),
]);

/** Fixed Energy Core placement, interact-to-pick-up, and single-core carry. */
export function createCoresFeature(): CoreRunFeature {
  return {
    id: "core-run.cores",
    reset(state) {
      state.cores = CORE_PLACEMENTS.map((placement, index) => ({
        id: index,
        kind: placement.kind,
        value: CORE_VALUES[placement.kind],
        position: placement.position,
        collected: false,
      }));
      state.carry = { coreId: null, lastDepositTick: -1 };
    },
    step(state, context) {
      if (
        state.round.phase !== "running" ||
        !context.pressed.has("interact") ||
        state.carry.coreId !== null ||
        state.carry.lastDepositTick === context.tick
      ) {
        return;
      }
      let nearest: CoreState | null = null;
      let best = PICKUP_RADIUS;
      for (const core of state.cores) {
        if (core.collected) continue;
        const gap = distance(core.position, state.player.position);
        if (gap <= best) {
          best = gap;
          nearest = core;
        }
      }
      if (nearest === null) return;
      nearest.collected = true;
      state.carry.coreId = nearest.id;
      context.emit({
        kind: "corePickedUp",
        tick: context.tick,
        coreId: nearest.id,
        coreKind: nearest.kind,
      });
    },
  };
}
