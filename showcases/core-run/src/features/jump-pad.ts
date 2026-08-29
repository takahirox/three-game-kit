import type { CoreRunFeature } from "../feature.js";
import { distanceXZ, vec3, type Vec3 } from "../state.js";

export const JUMP_PAD_POSITION: Vec3 = vec3(14, 0, 0);
export const JUMP_PAD_RADIUS = 1;
export const JUMP_PAD_IMPULSE = 14;

/** Deterministic vertical impulse whenever a grounded player touches the pad. */
export function createJumpPadFeature(): CoreRunFeature {
  return {
    id: "core-run.jump-pad",
    reset() {},
    step(state, context) {
      const player = state.player;
      if (
        state.round.phase !== "running" ||
        !player.grounded ||
        player.position.y > JUMP_PAD_POSITION.y ||
        distanceXZ(player.position, JUMP_PAD_POSITION) > JUMP_PAD_RADIUS
      ) {
        return;
      }
      player.velocity = vec3(player.velocity.x, JUMP_PAD_IMPULSE, player.velocity.z);
      player.grounded = false;
      context.emit({ kind: "jumpPad", tick: context.tick });
    },
  };
}
