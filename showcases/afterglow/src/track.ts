import type { GateKind, Vec3 } from "./state.js";

/**
 * Meridian Descent: the single authored Afterglow sprint.
 *
 * The track is a Catmull-Rom spline sampled into an arc-length table. Gameplay
 * runs in track space (distance `s`, lateral `x`, height `h`) so the rules stay
 * deterministic and vendor-neutral; the renderer converts to world space.
 */

export interface TrackFrame {
  readonly position: Vec3;
  readonly forward: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
  readonly heading: number;
  readonly bank: number;
}

export interface GapHazard { readonly id: string; readonly kind: "gap"; readonly s0: number; readonly s1: number; }
export interface GateHazard { readonly id: string; readonly kind: "gate"; readonly s: number; readonly gate: GateKind; }
export interface BoostPad { readonly id: string; readonly kind: "boost"; readonly s0: number; readonly s1: number; }
export interface PillarHazard { readonly id: string; readonly kind: "pillar"; readonly s: number; readonly x: number; }
export interface Checkpoint { readonly id: string; readonly kind: "checkpoint"; readonly s: number; readonly index: number; }
export interface FinishLine { readonly id: string; readonly kind: "finish"; readonly s: number; }
export type TrackFeature = GapHazard | GateHazard | BoostPad | PillarHazard | Checkpoint | FinishLine;

export interface Track {
  readonly name: string;
  readonly length: number;
  readonly halfWidth: number;
  readonly finish: FinishLine;
  readonly gaps: readonly GapHazard[];
  readonly gates: readonly GateHazard[];
  readonly boosts: readonly BoostPad[];
  readonly pillars: readonly PillarHazard[];
  readonly checkpoints: readonly Checkpoint[];
  readonly features: readonly TrackFeature[];
  frame(s: number): TrackFrame;
  worldPosition(s: number, x: number, h: number): Vec3;
  roadExists(s: number): boolean;
  gapAt(s: number): GapHazard | undefined;
}

const WORLD_UP: Vec3 = Object.freeze({ x: 0, y: 1, z: 0 });
const HALF_WIDTH = 6;
const SAMPLE_SPACING = 1.25;
const BANK_WINDOW = 14;
const BANK_GAIN = 30;
const BANK_LIMIT = 0.36;

const CONTROL_POINTS: readonly Vec3[] = Object.freeze([
  v(0, 30, 60), v(0, 30, 0), v(0, 30, -110), v(30, 31, -220), v(100, 30, -300), v(160, 27, -400), v(150, 22, -520),
  v(90, 12, -600), v(30, -8, -690), v(0, -28, -800), v(-40, -34, -910), v(-120, -30, -990), v(-200, -28, -1070),
  v(-245, -26, -1190), v(-245, -24, -1330), v(-245, -24, -1440), v(-245, -24, -1520),
]);

function v(x: number, y: number, z: number): Vec3 { return Object.freeze({ x, y, z }); }
function sub(a: Vec3, b: Vec3): Vec3 { return v(a.x - b.x, a.y - b.y, a.z - b.z); }
function add(a: Vec3, b: Vec3): Vec3 { return v(a.x + b.x, a.y + b.y, a.z + b.z); }
function scale(a: Vec3, k: number): Vec3 { return v(a.x * k, a.y * k, a.z * k); }
function cross(a: Vec3, b: Vec3): Vec3 { return v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
function length(a: Vec3): number { return Math.hypot(a.x, a.y, a.z); }
function normalize(a: Vec3): Vec3 { const l = length(a); return l === 0 ? v(0, 0, 1) : scale(a, 1 / l); }
function lerp(a: Vec3, b: Vec3, t: number): Vec3 { return v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t); }
function wrapAngle(angle: number): number { return Math.atan2(Math.sin(angle), Math.cos(angle)); }

function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const c0 = -0.5 * t3 + t2 - 0.5 * t;
  const c1 = 1.5 * t3 - 2.5 * t2 + 1;
  const c2 = -1.5 * t3 + 2 * t2 + 0.5 * t;
  const c3 = 0.5 * t3 - 0.5 * t2;
  return v(
    p0.x * c0 + p1.x * c1 + p2.x * c2 + p3.x * c3,
    p0.y * c0 + p1.y * c1 + p2.y * c2 + p3.y * c3,
    p0.z * c0 + p1.z * c1 + p2.z * c2 + p3.z * c3,
  );
}

interface SampleRow { readonly s: number; readonly frame: TrackFrame; }

function buildSamples(points: readonly Vec3[]): readonly SampleRow[] {
  const positions: Vec3[] = [];
  for (let index = 1; index < points.length - 2; index += 1) {
    const p0 = points[index - 1]!;
    const p1 = points[index]!;
    const p2 = points[index + 1]!;
    const p3 = points[index + 2]!;
    const chord = length(sub(p2, p1));
    const steps = Math.max(8, Math.ceil(chord / SAMPLE_SPACING));
    for (let step = 0; step < steps; step += 1) positions.push(catmullRom(p0, p1, p2, p3, step / steps));
  }
  positions.push(points[points.length - 2]!);

  const cumulative: number[] = [0];
  for (let index = 1; index < positions.length; index += 1) cumulative.push(cumulative[index - 1]! + length(sub(positions[index]!, positions[index - 1]!)));

  const forwards: Vec3[] = positions.map((_, index) => {
    const previous = positions[Math.max(0, index - 1)]!;
    const next = positions[Math.min(positions.length - 1, index + 1)]!;
    return normalize(sub(next, previous));
  });
  const headings = forwards.map((forward) => Math.atan2(forward.x, -forward.z));
  const turnRates = headings.map((_, index) => {
    const before = Math.max(0, index - 1);
    const after = Math.min(headings.length - 1, index + 1);
    const ds = cumulative[after]! - cumulative[before]!;
    return ds === 0 ? 0 : wrapAngle(headings[after]! - headings[before]!) / ds;
  });
  const banks = turnRates.map((_, index) => {
    let total = 0;
    let count = 0;
    for (let offset = -BANK_WINDOW; offset <= BANK_WINDOW; offset += 1) {
      const at = index + offset;
      if (at < 0 || at >= turnRates.length) continue;
      total += turnRates[at]!;
      count += 1;
    }
    const smoothed = count === 0 ? 0 : total / count;
    return Math.max(-BANK_LIMIT, Math.min(BANK_LIMIT, -smoothed * BANK_GAIN));
  });

  return positions.map((position, index) => {
    const forward = forwards[index]!;
    const flatRight = normalize(cross(forward, WORLD_UP));
    const flatUp = normalize(cross(flatRight, forward));
    const bank = banks[index]!;
    const right = normalize(add(scale(flatRight, Math.cos(bank)), scale(flatUp, Math.sin(bank))));
    const up = normalize(sub(scale(flatUp, Math.cos(bank)), scale(flatRight, Math.sin(bank))));
    return Object.freeze({ s: cumulative[index]!, frame: Object.freeze({ position, forward, right, up, heading: headings[index]!, bank }) });
  });
}

function interpolateFrame(a: TrackFrame, b: TrackFrame, t: number): TrackFrame {
  const forward = normalize(lerp(a.forward, b.forward, t));
  const right = normalize(lerp(a.right, b.right, t));
  const up = normalize(cross(right, forward));
  return Object.freeze({
    position: lerp(a.position, b.position, t),
    forward,
    right: normalize(cross(forward, up)),
    up,
    heading: a.heading + wrapAngle(b.heading - a.heading) * t,
    bank: a.bank + (b.bank - a.bank) * t,
  });
}

function createGaps(): readonly GapHazard[] {
  return Object.freeze([
    { id: "gap-1", kind: "gap", s0: 420, s1: 436 },
    { id: "gap-2", kind: "gap", s0: 800, s1: 824 },
    { id: "gap-3", kind: "gap", s0: 1080, s1: 1100 },
  ] as const);
}

function createGates(): readonly GateHazard[] {
  return Object.freeze([
    { id: "gate-1", kind: "gate", s: 300, gate: "low" },
    { id: "gate-2", kind: "gate", s: 500, gate: "left" },
    { id: "gate-3", kind: "gate", s: 540, gate: "right" },
    { id: "gate-4", kind: "gate", s: 700, gate: "center" },
    { id: "gate-5", kind: "gate", s: 1000, gate: "low" },
    { id: "gate-6", kind: "gate", s: 1160, gate: "left" },
    { id: "gate-7", kind: "gate", s: 1190, gate: "right" },
    { id: "gate-8", kind: "gate", s: 1220, gate: "low" },
  ] as const);
}

function createBoosts(): readonly BoostPad[] {
  return Object.freeze([
    { id: "boost-1", kind: "boost", s0: 130, s1: 140 },
    { id: "boost-2", kind: "boost", s0: 380, s1: 390 },
    { id: "boost-3", kind: "boost", s0: 620, s1: 630 },
    { id: "boost-4", kind: "boost", s0: 1040, s1: 1050 },
    { id: "boost-5", kind: "boost", s0: 1280, s1: 1290 },
  ] as const);
}

function createPillars(): readonly PillarHazard[] {
  return Object.freeze([
    { id: "pillar-1", kind: "pillar", s: 205, x: -3 },
    { id: "pillar-2", kind: "pillar", s: 235, x: 3 },
    { id: "pillar-3", kind: "pillar", s: 890, x: -3 },
    { id: "pillar-4", kind: "pillar", s: 915, x: 3 },
    { id: "pillar-5", kind: "pillar", s: 940, x: -3 },
  ] as const);
}

function createCheckpoints(): readonly Checkpoint[] {
  return Object.freeze([
    { id: "checkpoint-1", kind: "checkpoint", s: 360, index: 1 },
    { id: "checkpoint-2", kind: "checkpoint", s: 600, index: 2 },
    { id: "checkpoint-3", kind: "checkpoint", s: 860, index: 3 },
    { id: "checkpoint-4", kind: "checkpoint", s: 1140, index: 4 },
  ] as const);
}

export function createMeridianDescent(): Track {
  const samples = buildSamples(CONTROL_POINTS);
  const total = samples[samples.length - 1]!.s;
  const finish: FinishLine = Object.freeze({ id: "finish", kind: "finish", s: 1350 });
  if (total < finish.s + 60) throw new Error(`Meridian Descent spline is too short: ${total.toFixed(1)} m`);
  const gaps = createGaps();
  const gates = createGates();
  const boosts = createBoosts();
  const pillars = createPillars();
  const checkpoints = createCheckpoints();
  const features: readonly TrackFeature[] = Object.freeze(
    [...gaps, ...gates, ...boosts, ...pillars, ...checkpoints, finish].sort((a, b) => featureStart(a) - featureStart(b)),
  );

  function frame(rawS: number): TrackFrame {
    const s = Math.max(0, Math.min(total, Number.isFinite(rawS) ? rawS : 0));
    let low = 0;
    let high = samples.length - 1;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (samples[middle]!.s <= s) low = middle; else high = middle;
    }
    const a = samples[low]!;
    const b = samples[high]!;
    const span = b.s - a.s;
    return span <= 0 ? a.frame : interpolateFrame(a.frame, b.frame, (s - a.s) / span);
  }

  return Object.freeze({
    name: "Meridian Descent",
    length: total,
    halfWidth: HALF_WIDTH,
    finish,
    gaps,
    gates,
    boosts,
    pillars,
    checkpoints,
    features,
    frame,
    worldPosition(s: number, x: number, h: number): Vec3 {
      const at = frame(s);
      return v(
        at.position.x + at.right.x * x + at.up.x * h,
        at.position.y + at.right.y * x + at.up.y * h,
        at.position.z + at.right.z * x + at.up.z * h,
      );
    },
    roadExists(s: number): boolean {
      return s >= 0 && s <= total && gaps.every((gap) => s < gap.s0 || s > gap.s1);
    },
    gapAt(s: number): GapHazard | undefined {
      return gaps.find((gap) => s >= gap.s0 && s <= gap.s1);
    },
  });
}

export function featureStart(feature: TrackFeature): number {
  return feature.kind === "gap" || feature.kind === "boost" ? feature.s0 : feature.s;
}

export function featureEnd(feature: TrackFeature): number {
  return feature.kind === "gap" || feature.kind === "boost" ? feature.s1 : feature.s;
}
