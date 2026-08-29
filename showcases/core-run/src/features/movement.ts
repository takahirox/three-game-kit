import { ticksFromSeconds, type CoreRunFeature } from "../feature.js";
import { createPlayerState, vec3, type Vec3 } from "../state.js";

export const MAX_SPEED = 8;
export const ACCELERATION = 40;
export const DECELERATION = 60;
export const GRAVITY = 30;
export const JUMP_SPEED = 10;
export const DASH_SPEED = 20;
export const DASH_SECONDS = 0.15;
export const DASH_COOLDOWN_SECONDS = 1;
export const GROUND_HEIGHT = 0;

function clampAxis(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

function approach(current: number, target: number, rate: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= rate) return target;
  return current + Math.sign(delta) * rate;
}

/** Camera-relative wish direction on the XZ plane (yaw 0 faces -Z). */
export function cameraRelativeDirection(
  moveX: number,
  moveY: number,
  cameraYaw: number,
): Vec3 {
  const x = clampAxis(moveX);
  const y = clampAxis(moveY);
  const sin = Math.sin(cameraYaw);
  const cos = Math.cos(cameraYaw);
  let dx = x * cos - y * sin;
  let dz = -x * sin - y * cos;
  const length = Math.hypot(dx, dz);
  if (length > 1) {
    dx /= length;
    dz /= length;
  }
  return vec3(dx, 0, dz);
}

/** Acceleration/deceleration, jump, gravity, ground contact, and dash. */
export function createMovementFeature(): CoreRunFeature {
  return {
    id: "core-run.movement",
    reset(state) {
      state.player = createPlayerState();
    },
    step(state, context) {
      const player = state.player;
      const { dt, pressed } = context;
      const running = state.round.phase === "running";
      const input = state.input;
      const wish = running
        ? cameraRelativeDirection(input.moveX, input.moveY, input.cameraYaw)
        : vec3(0, 0, 0);
      const wishLength = Math.hypot(wish.x, wish.z);
      if (wishLength > 0) {
        player.facing = vec3(wish.x / wishLength, 0, wish.z / wishLength);
      }
      if (player.dashCooldownTicks > 0) player.dashCooldownTicks -= 1;
      if (
        running &&
        pressed.has("dash") &&
        player.dashCooldownTicks === 0 &&
        player.dashTicks === 0
      ) {
        player.dashTicks = ticksFromSeconds(DASH_SECONDS, dt);
        player.dashCooldownTicks = ticksFromSeconds(DASH_COOLDOWN_SECONDS, dt);
        context.emit({ kind: "dash", tick: context.tick });
      }
      let vx: number;
      let vz: number;
      if (player.dashTicks > 0) {
        player.dashTicks -= 1;
        vx = player.facing.x * DASH_SPEED;
        vz = player.facing.z * DASH_SPEED;
      } else {
        const speed = MAX_SPEED * player.speedMultiplier;
        const rate = (wishLength > 0 ? ACCELERATION : DECELERATION) * dt;
        vx = approach(player.velocity.x, wish.x * speed, rate);
        vz = approach(player.velocity.z, wish.z * speed, rate);
      }
      let vy = player.velocity.y;
      if (running && pressed.has("jump") && player.grounded) {
        vy = JUMP_SPEED;
        context.emit({ kind: "jump", tick: context.tick });
      }
      vy -= GRAVITY * dt;
      let y = player.position.y + vy * dt;
      let grounded = false;
      if (y <= GROUND_HEIGHT) {
        y = GROUND_HEIGHT;
        vy = 0;
        grounded = true;
      }
      player.position = vec3(
        player.position.x + vx * dt,
        y,
        player.position.z + vz * dt,
      );
      player.velocity = vec3(vx, vy, vz);
      player.grounded = grounded;
    },
  };
}
