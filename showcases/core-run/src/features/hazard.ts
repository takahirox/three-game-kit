import type { CoreRunFeature } from "../feature.js";
import { vec3, type Vec3 } from "../state.js";

export const HAZARD_MIN: Vec3 = vec3(-6, 0, -6);
export const HAZARD_MAX: Vec3 = vec3(-2, 2, -2);
export const HAZARD_SPEED_MULTIPLIER = 0.4;

export function isInsideHazard(position: Vec3): boolean {
  return (
    position.x >= HAZARD_MIN.x &&
    position.x <= HAZARD_MAX.x &&
    position.y >= HAZARD_MIN.y &&
    position.y <= HAZARD_MAX.y &&
    position.z >= HAZARD_MIN.z &&
    position.z <= HAZARD_MAX.z
  );
}

/** Slow zone: applies a movement multiplier while the player is inside. */
export function createHazardFeature(): CoreRunFeature {
  return {
    id: "core-run.hazard",
    reset(state) {
      state.player.speedMultiplier = 1;
      state.player.inHazard = false;
    },
    step(state, context) {
      const player = state.player;
      const inside = isInsideHazard(player.position);
      player.speedMultiplier = inside ? HAZARD_SPEED_MULTIPLIER : 1;
      if (inside !== player.inHazard) {
        player.inHazard = inside;
        context.emit({
          kind: inside ? "hazardEntered" : "hazardExited",
          tick: context.tick,
        });
      }
    },
  };
}
