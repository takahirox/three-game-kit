/// <reference lib="dom" />
import { BASE_POSITION, BASE_RADIUS } from "./features/deposit.js";
import { HAZARD_MAX, HAZARD_MIN } from "./features/hazard.js";
import { JUMP_PAD_POSITION, JUMP_PAD_RADIUS } from "./features/jump-pad.js";
import {
  PLATFORM_HALF_DEPTH,
  PLATFORM_HALF_WIDTH,
} from "./features/moving-platform.js";
import type {
  CoreKind,
  CoreRunSnapshot,
  TelemetryEvent,
  Vec3,
} from "./state.js";

/*
 * Core Run renderer: a dependency-free Canvas2D, third-person 2.5D neon view.
 *
 * - All motion derives from `snapshot.time`; no wall clocks are consulted.
 * - Particles/popups are fixed-capacity rings seeded from telemetry events
 *   with a deterministic LCG; `Math.random` is never used.
 * - The renderer owns no DOM listeners; the host calls `resize()`.
 */

export const RENDER_WIDTH = 960;
export const RENDER_HEIGHT = 540;
export const MAX_DEVICE_PIXEL_RATIO = 2;
export const PARTICLE_CAPACITY = 256;
export const POPUP_CAPACITY = 16;
export const TRAIL_CAPACITY = 24;
export const ARENA_HALF_EXTENT = 18;

export interface RendererCounters {
  readonly frames: number;
  readonly drawCalls: number;
  readonly activeParticles: number;
  readonly activePopups: number;
  readonly eventsConsumed: number;
}

export interface CoreRunRenderer {
  render(
    snapshot: CoreRunSnapshot,
    events: readonly TelemetryEvent[],
    cameraYaw: number,
    debugCamera: boolean,
  ): void;
  resize(): void;
  dispose(): void;
  readonly disposed: boolean;
  /** True once at least one full frame has been drawn. */
  readonly screenshotReady: boolean;
  counters(): RendererCounters;
}

export interface CoreRunRendererOptions {
  /** Override the host pixel ratio (tests / headless). Capped at 2. */
  readonly devicePixelRatio?: number;
}

/* ----------------------------- deterministic PRNG ----------------------------- */

/** 32-bit FNV-1a style mix of integers into a seed. */
export function hashSeed(...values: readonly number[]): number {
  let h = 0x811c9dc5;
  for (const value of values) {
    const v = Math.trunc(Number.isFinite(value) ? value * 1000 : 0) | 0;
    h ^= v & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 16) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 24) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Minimal LCG returning floats in [0, 1). */
export function createLcg(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/* --------------------------------- palette --------------------------------- */

const CORE_COLORS: Readonly<Record<CoreKind, string>> = Object.freeze({
  blue: "#4cc9ff",
  gold: "#ffd166",
  red: "#ff4d6d",
});
const COLOR_CYAN = "#38f0ff";
const COLOR_MAGENTA = "#ff3df5";
const COLOR_PLAYER = "#9dff57";
const COLOR_GRID = "rgba(72, 200, 255, 0.16)";
const COLOR_ROUTE = "rgba(255, 255, 255, 0.10)";

/* ---------------------------------- camera ---------------------------------- */

interface Camera {
  readonly yaw: number;
  readonly pitch: number;
  readonly scale: number;
  readonly cx: number;
  readonly cy: number;
  readonly focusX: number;
  readonly focusZ: number;
}

interface Projected {
  readonly sx: number;
  readonly sy: number;
  /** Larger = nearer to the viewer; used for painter's sort. */
  readonly depth: number;
}

function makeCamera(
  snapshot: CoreRunSnapshot,
  yaw: number,
  debug: boolean,
): Camera {
  const safeYaw = Number.isFinite(yaw) ? yaw : 0;
  if (debug) {
    return {
      yaw: safeYaw,
      pitch: 0.95,
      scale: 12,
      cx: RENDER_WIDTH / 2,
      cy: RENDER_HEIGHT / 2 + 10,
      focusX: 0,
      focusZ: 0,
    };
  }
  const p = snapshot.player.position;
  return {
    yaw: safeYaw,
    pitch: 0.62,
    scale: 22,
    cx: RENDER_WIDTH / 2,
    cy: RENDER_HEIGHT * 0.58,
    focusX: p.x * 0.65,
    focusZ: p.z * 0.65,
  };
}

function project(cam: Camera, x: number, y: number, z: number): Projected {
  const dx = x - cam.focusX;
  const dz = z - cam.focusZ;
  const cos = Math.cos(cam.yaw);
  const sin = Math.sin(cam.yaw);
  // Yaw 0 looks toward -Z (matches movement.cameraRelativeDirection).
  const rx = dx * cos - dz * sin;
  const rz = dx * sin + dz * cos;
  const sy = cam.cy + (rz * Math.sin(cam.pitch) - y * Math.cos(cam.pitch)) * cam.scale;
  return { sx: cam.cx + rx * cam.scale, sy, depth: rz };
}

/* ------------------------------ bounded effects ------------------------------ */

interface Particle {
  active: boolean;
  born: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  color: string;
  size: number;
}

interface Popup {
  active: boolean;
  born: number;
  x: number;
  y: number;
  z: number;
  text: string;
  color: string;
}

interface TrailPoint {
  active: boolean;
  born: number;
  x: number;
  y: number;
  z: number;
}

const PARTICLE_LIFE = 0.8;
const POPUP_LIFE = 1.1;
const TRAIL_LIFE = 0.35;

function blankParticle(): Particle {
  return {
    active: false,
    born: 0,
    life: PARTICLE_LIFE,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    color: "#fff",
    size: 2,
  };
}

/* ----------------------------- draw primitives ----------------------------- */

type Ctx = CanvasRenderingContext2D;

interface DrawItem {
  readonly depth: number;
  readonly draw: (ctx: Ctx) => void;
}

function glowCircle(
  ctx: Ctx,
  x: number,
  y: number,
  r: number,
  color: string,
  blur: number,
): void {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function groundEllipse(
  ctx: Ctx,
  cam: Camera,
  x: number,
  y: number,
  z: number,
  radius: number,
  stroke: string,
  fill: string | null,
  width = 1.5,
): void {
  const c = project(cam, x, y, z);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(
    c.sx,
    c.sy,
    radius * cam.scale,
    radius * cam.scale * Math.sin(cam.pitch),
    0,
    0,
    Math.PI * 2,
  );
  if (fill !== null) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}

function groundQuad(
  ctx: Ctx,
  cam: Camera,
  minX: number,
  maxX: number,
  y: number,
  minZ: number,
  maxZ: number,
  stroke: string,
  fill: string | null,
  width = 1.5,
): void {
  const a = project(cam, minX, y, minZ);
  const b = project(cam, maxX, y, minZ);
  const c = project(cam, maxX, y, maxZ);
  const d = project(cam, minX, y, maxZ);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(a.sx, a.sy);
  ctx.lineTo(b.sx, b.sy);
  ctx.lineTo(c.sx, c.sy);
  ctx.lineTo(d.sx, d.sy);
  ctx.closePath();
  if (fill !== null) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}

function line3(
  ctx: Ctx,
  cam: Camera,
  a: Vec3,
  b: Vec3,
  stroke: string,
  width = 1,
): void {
  const pa = project(cam, a.x, a.y, a.z);
  const pb = project(cam, b.x, b.y, b.z);
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(pa.sx, pa.sy);
  ctx.lineTo(pb.sx, pb.sy);
  ctx.stroke();
  ctx.restore();
}

function starPositions(): readonly (readonly [number, number, number])[] {
  const rand = createLcg(hashSeed(9127, 4421));
  const stars: (readonly [number, number, number])[] = [];
  for (let i = 0; i < 90; i += 1) {
    stars.push([rand(), rand() * 0.55, 0.6 + rand() * 1.4]);
  }
  return Object.freeze(stars);
}
const STARS = starPositions();

/* ---------------------------------- renderer --------------------------------- */

class CoreRunRendererImplementation implements CoreRunRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: Ctx;
  private readonly pixelRatioOverride: number | null;
  private readonly particles: Particle[] = [];
  private readonly popups: Popup[] = [];
  private readonly trail: TrailPoint[] = [];
  private particleCursor = 0;
  private popupCursor = 0;
  private trailCursor = 0;
  private lastTrailTime = -1;
  private frames = 0;
  private drawCalls = 0;
  private eventsConsumed = 0;
  private isDisposed = false;
  private ready = false;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement, options: CoreRunRendererOptions) {
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      throw new Error("Core Run renderer requires a 2D canvas context");
    }
    this.canvas = canvas;
    this.ctx = ctx;
    this.pixelRatioOverride =
      options.devicePixelRatio !== undefined &&
      Number.isFinite(options.devicePixelRatio)
        ? options.devicePixelRatio
        : null;
    for (let i = 0; i < PARTICLE_CAPACITY; i += 1) this.particles.push(blankParticle());
    for (let i = 0; i < POPUP_CAPACITY; i += 1) {
      this.popups.push({ active: false, born: 0, x: 0, y: 0, z: 0, text: "", color: "#fff" });
    }
    for (let i = 0; i < TRAIL_CAPACITY; i += 1) {
      this.trail.push({ active: false, born: 0, x: 0, y: 0, z: 0 });
    }
    this.resize();
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  get screenshotReady(): boolean {
    return this.ready && !this.isDisposed;
  }

  counters(): RendererCounters {
    return Object.freeze({
      frames: this.frames,
      drawCalls: this.drawCalls,
      activeParticles: this.particles.filter((p) => p.active).length,
      activePopups: this.popups.filter((p) => p.active).length,
      eventsConsumed: this.eventsConsumed,
    });
  }

  resize(): void {
    if (this.isDisposed) return;
    const hostRatio =
      this.pixelRatioOverride ??
      (typeof globalThis.devicePixelRatio === "number" &&
      Number.isFinite(globalThis.devicePixelRatio)
        ? globalThis.devicePixelRatio
        : 1);
    this.dpr = Math.max(1, Math.min(MAX_DEVICE_PIXEL_RATIO, hostRatio));
    const width = Math.round(RENDER_WIDTH * this.dpr);
    const height = Math.round(RENDER_HEIGHT * this.dpr);
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    for (const p of this.particles) p.active = false;
    for (const p of this.popups) p.active = false;
    for (const t of this.trail) t.active = false;
  }

  render(
    snapshot: CoreRunSnapshot,
    events: readonly TelemetryEvent[],
    cameraYaw: number,
    debugCamera: boolean,
  ): void {
    if (this.isDisposed) return;
    const time = Number.isFinite(snapshot.time) ? snapshot.time : 0;
    this.consumeEvents(snapshot, events, time);
    this.recordTrail(snapshot, time);

    const ctx = this.ctx;
    const cam = makeCamera(snapshot, cameraYaw, debugCamera);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawCalls = 0;

    this.drawSky(ctx, time);
    this.drawFloor(ctx, cam, time);
    this.drawRoutes(ctx, cam);
    this.drawHazard(ctx, cam, time);
    this.drawJumpPad(ctx, cam, time);
    this.drawBase(ctx, cam, time, snapshot);
    this.drawPylons(ctx, cam, time);

    const items: DrawItem[] = [];
    this.collectPlatform(items, cam, snapshot, time);
    this.collectCores(items, cam, snapshot, time);
    this.collectPlayer(items, cam, snapshot, time);
    this.collectParticles(items, cam, time);
    items.sort((a, b) => a.depth - b.depth);
    for (const item of items) {
      item.draw(ctx);
      this.drawCalls += 1;
    }

    this.drawPopups(ctx, cam, time);
    if (debugCamera) this.drawDebug(ctx, cam, snapshot);

    this.frames += 1;
    this.ready = true;
  }

  /* -------------------------------- events -------------------------------- */

  private consumeEvents(
    snapshot: CoreRunSnapshot,
    events: readonly TelemetryEvent[],
    time: number,
  ): void {
    const p = snapshot.player.position;
    for (const event of events) {
      this.eventsConsumed += 1;
      switch (event.kind) {
        case "corePickedUp": {
          const core = snapshot.cores[event.coreId];
          const at = core?.position ?? p;
          const color = CORE_COLORS[event.coreKind];
          this.burst(hashSeed(event.tick, 1, event.coreId), at, 18, color, 3, time);
          this.popup(at, `${event.coreKind.toUpperCase()} +${core?.value ?? ""}`, color, time);
          break;
        }
        case "coreDeposited": {
          const at = BASE_POSITION;
          this.burst(hashSeed(event.tick, 2, event.coreId), at, 36, COLOR_CYAN, 4.5, time);
          const label = event.combo > 1 ? `+${event.points}  x${event.combo}` : `+${event.points}`;
          this.popup({ x: at.x, y: at.y + 1.5, z: at.z }, label, "#ffffff", time);
          break;
        }
        case "dash":
          this.burst(hashSeed(event.tick, 3), p, 12, COLOR_PLAYER, 2.5, time);
          break;
        case "jumpPad":
          this.burst(hashSeed(event.tick, 4), JUMP_PAD_POSITION, 24, COLOR_CYAN, 8, time);
          this.popup(JUMP_PAD_POSITION, "BOOST", COLOR_CYAN, time);
          break;
        case "hazardEntered":
          this.burst(hashSeed(event.tick, 5), p, 10, COLOR_MAGENTA, 1.5, time);
          this.popup(p, "SLOW", COLOR_MAGENTA, time);
          break;
        default:
          break;
      }
    }
  }

  private burst(
    seed: number,
    at: Vec3,
    count: number,
    color: string,
    speed: number,
    time: number,
  ): void {
    const rand = createLcg(seed);
    const n = Math.min(count, PARTICLE_CAPACITY);
    for (let i = 0; i < n; i += 1) {
      const part = this.particles[this.particleCursor];
      this.particleCursor = (this.particleCursor + 1) % PARTICLE_CAPACITY;
      if (part === undefined) continue;
      const theta = rand() * Math.PI * 2;
      const up = rand();
      const mag = speed * (0.4 + rand() * 0.6);
      part.active = true;
      part.born = time;
      part.life = PARTICLE_LIFE * (0.6 + rand() * 0.6);
      part.x = at.x;
      part.y = at.y + 0.4;
      part.z = at.z;
      part.vx = Math.cos(theta) * mag;
      part.vz = Math.sin(theta) * mag;
      part.vy = mag * (0.5 + up);
      part.color = color;
      part.size = 1.5 + rand() * 2.5;
    }
  }

  private popup(at: Vec3, text: string, color: string, time: number): void {
    const slot = this.popups[this.popupCursor];
    this.popupCursor = (this.popupCursor + 1) % POPUP_CAPACITY;
    if (slot === undefined) return;
    slot.active = true;
    slot.born = time;
    slot.x = at.x;
    slot.y = at.y + 1.2;
    slot.z = at.z;
    slot.text = text;
    slot.color = color;
  }

  private recordTrail(snapshot: CoreRunSnapshot, time: number): void {
    const player = snapshot.player;
    const moving = Math.hypot(player.velocity.x, player.velocity.z) > 0.5;
    if (!moving || time === this.lastTrailTime) return;
    this.lastTrailTime = time;
    const slot = this.trail[this.trailCursor];
    this.trailCursor = (this.trailCursor + 1) % TRAIL_CAPACITY;
    if (slot === undefined) return;
    slot.active = true;
    slot.born = time;
    slot.x = player.position.x;
    slot.y = player.position.y;
    slot.z = player.position.z;
  }

  /* ------------------------------ static layers ----------------------------- */

  private drawSky(ctx: Ctx, time: number): void {
    const sky = ctx.createLinearGradient(0, 0, 0, RENDER_HEIGHT);
    sky.addColorStop(0, "#05020f");
    sky.addColorStop(0.55, "#140a33");
    sky.addColorStop(1, "#2a0b4a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, RENDER_WIDTH, RENDER_HEIGHT);
    ctx.save();
    for (const [u, v, s] of STARS) {
      const twinkle = 0.55 + 0.45 * Math.sin(time * 2 + u * 40);
      ctx.globalAlpha = twinkle;
      ctx.fillStyle = "#dff4ff";
      ctx.fillRect(u * RENDER_WIDTH, v * RENDER_HEIGHT, s, s);
    }
    ctx.restore();
    const horizon = ctx.createLinearGradient(0, RENDER_HEIGHT * 0.42, 0, RENDER_HEIGHT * 0.6);
    horizon.addColorStop(0, "rgba(255, 61, 245, 0)");
    horizon.addColorStop(1, "rgba(255, 61, 245, 0.18)");
    ctx.fillStyle = horizon;
    ctx.fillRect(0, RENDER_HEIGHT * 0.42, RENDER_WIDTH, RENDER_HEIGHT * 0.18);
    this.drawCalls += 3;
  }

  private drawFloor(ctx: Ctx, cam: Camera, time: number): void {
    const e = ARENA_HALF_EXTENT;
    groundQuad(ctx, cam, -e, e, 0, -e, e, "rgba(56, 240, 255, 0.55)", "rgba(20, 12, 50, 0.85)", 2.5);
    const step = 2;
    const pulse = (time * 2) % step;
    ctx.save();
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1;
    for (let i = -e; i <= e; i += step) {
      line3(ctx, cam, { x: i, y: 0, z: -e }, { x: i, y: 0, z: e }, COLOR_GRID);
      line3(ctx, cam, { x: -e, y: 0, z: i }, { x: e, y: 0, z: i }, COLOR_GRID);
    }
    const sweep = -e + pulse;
    line3(ctx, cam, { x: -e, y: 0.01, z: sweep }, { x: e, y: 0.01, z: sweep }, "rgba(56, 240, 255, 0.35)", 2);
    ctx.restore();
    this.drawCalls += 2;
  }

  private drawRoutes(ctx: Ctx, cam: Camera): void {
    const landmarks: readonly Vec3[] = [JUMP_PAD_POSITION, { x: 0, y: 0, z: -12 }, { x: -4, y: 0, z: -4 }];
    for (const target of landmarks) {
      line3(ctx, cam, BASE_POSITION, target, COLOR_ROUTE, 1);
    }
    this.drawCalls += 1;
  }

  private drawHazard(ctx: Ctx, cam: Camera, time: number): void {
    const alpha = 0.18 + 0.1 * Math.sin(time * 5);
    groundQuad(
      ctx,
      cam,
      HAZARD_MIN.x,
      HAZARD_MAX.x,
      0.02,
      HAZARD_MIN.z,
      HAZARD_MAX.z,
      COLOR_MAGENTA,
      `rgba(255, 61, 245, ${alpha.toFixed(3)})`,
      2,
    );
    const c = project(cam, (HAZARD_MIN.x + HAZARD_MAX.x) / 2, 0.05, (HAZARD_MIN.z + HAZARD_MAX.z) / 2);
    ctx.save();
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = COLOR_MAGENTA;
    ctx.fillText("HAZARD", c.sx, c.sy);
    ctx.restore();
    this.drawCalls += 2;
  }

  private drawJumpPad(ctx: Ctx, cam: Camera, time: number): void {
    const ring = (time * 1.5) % 1;
    groundEllipse(ctx, cam, JUMP_PAD_POSITION.x, 0.02, JUMP_PAD_POSITION.z, JUMP_PAD_RADIUS, COLOR_CYAN, "rgba(56, 240, 255, 0.35)", 2);
    groundEllipse(ctx, cam, JUMP_PAD_POSITION.x, 0.02, JUMP_PAD_POSITION.z, JUMP_PAD_RADIUS * (1 + ring), `rgba(56, 240, 255, ${(1 - ring).toFixed(3)})`, null, 1.5);
    this.drawCalls += 2;
  }

  private drawBase(ctx: Ctx, cam: Camera, time: number, snapshot: CoreRunSnapshot): void {
    const active = snapshot.carry.coreId !== null;
    const glow = active ? 0.35 + 0.15 * Math.sin(time * 6) : 0.18;
    groundEllipse(ctx, cam, BASE_POSITION.x, 0.03, BASE_POSITION.z, BASE_RADIUS, "#ffffff", `rgba(255, 255, 255, ${glow.toFixed(3)})`, 2.5);
    groundEllipse(ctx, cam, BASE_POSITION.x, 0.03, BASE_POSITION.z, BASE_RADIUS * 0.5, COLOR_CYAN, null, 1.5);
    const top = project(cam, BASE_POSITION.x, 3.5, BASE_POSITION.z);
    const bottom = project(cam, BASE_POSITION.x, 0, BASE_POSITION.z);
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 3;
    ctx.shadowColor = COLOR_CYAN;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(bottom.sx, bottom.sy);
    ctx.lineTo(top.sx, top.sy);
    ctx.stroke();
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.fillText("BASE", top.sx, top.sy - 8);
    ctx.restore();
    this.drawCalls += 3;
  }

  private drawPylons(ctx: Ctx, cam: Camera, time: number): void {
    const e = ARENA_HALF_EXTENT;
    const corners: readonly Vec3[] = [
      { x: -e, y: 0, z: -e },
      { x: e, y: 0, z: -e },
      { x: e, y: 0, z: e },
      { x: -e, y: 0, z: e },
    ];
    corners.forEach((corner, index) => {
      const height = 6;
      line3(ctx, cam, corner, { x: corner.x, y: height, z: corner.z }, "rgba(56, 240, 255, 0.6)", 3);
      const ringY = (time * 1.2 + index * 0.25) % height;
      groundEllipse(ctx, cam, corner.x, ringY, corner.z, 0.8, COLOR_CYAN, null, 1.5);
      const tip = project(cam, corner.x, height, corner.z);
      glowCircle(ctx, tip.sx, tip.sy, 3, COLOR_CYAN, 12);
    });
    this.drawCalls += 3;
  }

  /* ---------------------------- depth-sorted items --------------------------- */

  private collectPlatform(items: DrawItem[], cam: Camera, snapshot: CoreRunSnapshot, time: number): void {
    const p = snapshot.platform.position;
    const c = project(cam, p.x, p.y, p.z);
    items.push({
      depth: c.depth,
      draw: (ctx) => {
        groundEllipse(ctx, cam, p.x, 0.02, p.z, PLATFORM_HALF_WIDTH * 0.9, "rgba(0,0,0,0)", "rgba(0, 0, 0, 0.35)");
        for (let y = 0; y < p.y; y += 0.5) {
          groundEllipse(ctx, cam, p.x, y, p.z, 0.15, "rgba(56, 240, 255, 0.25)", null, 1);
        }
        const glow = 0.25 + 0.1 * Math.sin(time * 3);
        groundQuad(ctx, cam, p.x - PLATFORM_HALF_WIDTH, p.x + PLATFORM_HALF_WIDTH, p.y, p.z - PLATFORM_HALF_DEPTH, p.z + PLATFORM_HALF_DEPTH, COLOR_CYAN, `rgba(56, 240, 255, ${glow.toFixed(3)})`, 2);
      },
    });
  }

  private collectCores(items: DrawItem[], cam: Camera, snapshot: CoreRunSnapshot, time: number): void {
    for (const core of snapshot.cores) {
      if (core.collected) continue;
      const bob = 0.6 + 0.2 * Math.sin(time * 3 + core.id);
      const pos = core.position;
      const c = project(cam, pos.x, pos.y + bob, pos.z);
      const color = CORE_COLORS[core.kind];
      const radius = 5 + core.value * 1.2;
      items.push({
        depth: c.depth,
        draw: (ctx) => {
          groundEllipse(ctx, cam, pos.x, pos.y + 0.02, pos.z, 0.5, "rgba(0,0,0,0)", "rgba(0, 0, 0, 0.35)");
          groundEllipse(ctx, cam, pos.x, pos.y + 0.02, pos.z, 0.9 + 0.15 * Math.sin(time * 4 + core.id), color, null, 1);
          glowCircle(ctx, c.sx, c.sy, radius, color, 18);
          ctx.save();
          ctx.font = "bold 12px monospace";
          ctx.textAlign = "center";
          ctx.fillStyle = "#ffffff";
          ctx.fillText(`+${core.value}`, c.sx, c.sy - radius - 4);
          ctx.restore();
        },
      });
    }
  }

  private collectPlayer(items: DrawItem[], cam: Camera, snapshot: CoreRunSnapshot, time: number): void {
    const player = snapshot.player;
    const pos = player.position;
    const c = project(cam, pos.x, pos.y, pos.z);
    const dashing = player.dashTicks > 0;
    const carried = snapshot.carry.coreId === null ? null : (snapshot.cores[snapshot.carry.coreId] ?? null);
    for (const t of this.trail) {
      if (!t.active) continue;
      const age = time - t.born;
      if (age > TRAIL_LIFE || age < 0) {
        t.active = false;
        continue;
      }
      const tp = project(cam, t.x, t.y, t.z);
      const alpha = (1 - age / TRAIL_LIFE) * (dashing ? 0.9 : 0.35);
      items.push({
        depth: tp.depth - 0.01,
        draw: (ctx) => {
          ctx.save();
          ctx.globalAlpha = alpha;
          glowCircle(ctx, tp.sx, tp.sy - 6, dashing ? 7 : 4, COLOR_PLAYER, 10);
          ctx.restore();
        },
      });
    }
    items.push({
      depth: c.depth,
      draw: (ctx) => {
        groundEllipse(ctx, cam, pos.x, 0.02, pos.z, 0.6, "rgba(0,0,0,0)", "rgba(0, 0, 0, 0.45)");
        const f = player.facing;
        const nose = project(cam, pos.x + f.x * 0.9, pos.y + 0.4, pos.z + f.z * 0.9);
        const left = project(cam, pos.x - f.z * 0.55 - f.x * 0.5, pos.y + 0.3, pos.z + f.x * 0.55 - f.z * 0.5);
        const right = project(cam, pos.x + f.z * 0.55 - f.x * 0.5, pos.y + 0.3, pos.z - f.x * 0.55 - f.z * 0.5);
        ctx.save();
        ctx.shadowColor = player.inHazard ? COLOR_MAGENTA : COLOR_PLAYER;
        ctx.shadowBlur = dashing ? 24 : 14;
        ctx.fillStyle = player.inHazard ? "#ffb3f7" : COLOR_PLAYER;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(nose.sx, nose.sy);
        ctx.lineTo(left.sx, left.sy);
        ctx.lineTo(right.sx, right.sy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        const head = project(cam, pos.x, pos.y + 0.9, pos.z);
        glowCircle(ctx, head.sx, head.sy, 6, "#ffffff", 8);
        if (carried !== null) {
          const hover = 1.9 + 0.15 * Math.sin(time * 5);
          const cc = project(cam, pos.x, pos.y + hover, pos.z);
          const color = CORE_COLORS[carried.kind];
          glowCircle(ctx, cc.sx, cc.sy, 5 + carried.value, color, 16);
          ctx.save();
          ctx.font = "bold 11px monospace";
          ctx.textAlign = "center";
          ctx.fillStyle = "#ffffff";
          ctx.fillText(`+${carried.value}`, cc.sx, cc.sy - 12);
          ctx.restore();
        }
      },
    });
  }

  private collectParticles(items: DrawItem[], cam: Camera, time: number): void {
    for (const part of this.particles) {
      if (!part.active) continue;
      const age = time - part.born;
      if (age > part.life || age < 0) {
        part.active = false;
        continue;
      }
      const x = part.x + part.vx * age;
      const y = Math.max(0, part.y + part.vy * age - 12 * age * age);
      const z = part.z + part.vz * age;
      const p = project(cam, x, y, z);
      const alpha = 1 - age / part.life;
      items.push({
        depth: p.depth,
        draw: (ctx) => {
          ctx.save();
          ctx.globalAlpha = alpha;
          glowCircle(ctx, p.sx, p.sy, part.size, part.color, 8);
          ctx.restore();
        },
      });
    }
  }

  private drawPopups(ctx: Ctx, cam: Camera, time: number): void {
    ctx.save();
    ctx.font = "bold 18px monospace";
    ctx.textAlign = "center";
    for (const pop of this.popups) {
      if (!pop.active) continue;
      const age = time - pop.born;
      if (age > POPUP_LIFE || age < 0) {
        pop.active = false;
        continue;
      }
      const p = project(cam, pop.x, pop.y + age * 1.5, pop.z);
      ctx.globalAlpha = 1 - age / POPUP_LIFE;
      ctx.shadowColor = pop.color;
      ctx.shadowBlur = 10;
      ctx.fillStyle = pop.color;
      ctx.fillText(pop.text, p.sx, p.sy);
      this.drawCalls += 1;
    }
    ctx.restore();
  }

  private drawDebug(ctx: Ctx, cam: Camera, snapshot: CoreRunSnapshot): void {
    line3(ctx, cam, { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, "#ff4d6d", 2);
    line3(ctx, cam, { x: 0, y: 0, z: 0 }, { x: 0, y: 4, z: 0 }, COLOR_PLAYER, 2);
    line3(ctx, cam, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 4 }, "#4cc9ff", 2);
    const p = snapshot.player.position;
    ctx.save();
    ctx.font = "12px monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    const lines = [
      `DEBUG CAMERA yaw=${cam.yaw.toFixed(2)} pitch=${cam.pitch.toFixed(2)}`,
      `tick=${snapshot.tick} time=${snapshot.time.toFixed(2)} phase=${snapshot.phase}`,
      `player=(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) grounded=${snapshot.player.grounded} onPlatform=${snapshot.player.onPlatform}`,
      `frames=${this.frames} particles=${this.particles.filter((q) => q.active).length}`,
    ];
    lines.forEach((text, index) => ctx.fillText(text, 12, RENDER_HEIGHT - 60 + index * 14));
    ctx.restore();
    this.drawCalls += 1;
  }
}

/** Creates a Canvas2D renderer bound to the 960x540 Core Run canvas. */
export function createCoreRunRenderer(
  canvas: HTMLCanvasElement,
  options: CoreRunRendererOptions = {},
): CoreRunRenderer {
  return new CoreRunRendererImplementation(canvas, options);
}
