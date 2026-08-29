import type { CoreRunFeature } from "../feature.js";
import { vec3, type Vec3 } from "../state.js";

export const PLATFORM_CENTER: Vec3 = vec3(0, 2, -12);
export const PLATFORM_AMPLITUDE = 4;
export const PLATFORM_PERIOD_SECONDS = 6;
export const PLATFORM_HALF_WIDTH = 2;
export const PLATFORM_HALF_DEPTH = 2;
export const PLATFORM_SNAP_TOLERANCE = 0.35;

/** Platform position is a pure function of simulation time (sinusoidal on X). */
export function platformPosition(time: number): Vec3 {
  const angle = (2 * Math.PI * time) / PLATFORM_PERIOD_SECONDS;
  return vec3(
    PLATFORM_CENTER.x + PLATFORM_AMPLITUDE * Math.sin(angle),
    PLATFORM_CENTER.y,
    PLATFORM_CENTER.z,
  );
}

/** Sinusoidal moving platform that carries a player standing on it. */
export function createMovingPlatformFeature(): CoreRunFeature {
  return {
    id: "core-run.moving-platform",
    reset(state) {
      state.platform = { position: platformPosition(0) };
      state.player.onPlatform = false;
    },
    step(state, context) {
      const previous = platformPosition(context.time - context.dt);
      const current = platformPosition(context.time);
      state.platform.position = current;
      const player = state.player;
      let { x, y, z } = player.position;
      if (player.onPlatform) {
        x += current.x - previous.x;
        z += current.z - previous.z;
      }
      const inside =
        Math.abs(x - current.x) <= PLATFORM_HALF_WIDTH &&
        Math.abs(z - current.z) <= PLATFORM_HALF_DEPTH;
      const landing =
        inside &&
        player.velocity.y <= 0 &&
        Math.abs(y - current.y) <= PLATFORM_SNAP_TOLERANCE;
      if (landing) {
        y = current.y;
        player.velocity = vec3(player.velocity.x, 0, player.velocity.z);
        player.grounded = true;
      }
      player.onPlatform = landing;
      player.position = vec3(x, y, z);
    },
  };
}
