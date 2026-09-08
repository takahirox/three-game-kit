import * as THREE from "three";
import type { ParticleVector3, ParticleRange, ParticleCurve, ParticleCurveRange } from "./types.js";
const MAX_VALUE = 1e6;
/** @internal */
export function number(value: number, min: number, max: number, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
        throw new TypeError(`${label} must be finite and between ${min} and ${max}`);
    return value;
}
/** @internal */
export function integer(value: number, min: number, max: number, label: string): number {
    number(value, min, max, label);
    if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be an integer`);
    return value;
}
/** @internal */
export function record(value: object, keys: readonly string[], label: string): void {
    if (typeof value !== "object" || value === null || Array.isArray(value) ||
        !Reflect.ownKeys(value).every(key => typeof key === "string" && keys.includes(key) && (value as Record<string, unknown>)[key] !== null))
        throw new TypeError(`${label} has invalid fields`);
}
/** @internal */
export function vector(value: ParticleVector3, label: string): THREE.Vector3 {
    record(value, ["x", "y", "z"], label);
    return new THREE.Vector3(number(value.x, -MAX_VALUE, MAX_VALUE, label), number(value.y, -MAX_VALUE, MAX_VALUE, label), number(value.z, -MAX_VALUE, MAX_VALUE, label));
}
/** @internal */
export function range(value: ParticleRange, min: number, max: number, label: string): readonly [number, number] {
    if (typeof value === "number") return [number(value, min, max, label), value];
    if (!Array.isArray(value) || value.length !== 2) throw new TypeError(`${label} must be a number or [min, max]`);
    return [number(value[0], min, max, label), number(value[1], value[0], max, label)];
}
/** @internal */
export function curve(value: ParticleCurve, min: number, max: number, label: string, color = false): ParticleCurve {
    if (!Array.isArray(value) || value.length < 2 || value.length > 16) throw new TypeError(`${label} requires 2 to 16 keys`);
    let previous = -1;
    const copied = Array.from(value, key => {
        record(key, ["time", "value", "interpolation", "inTangent", "outTangent", "inControl", "outControl"], label);
        for (const field of ["inTangent", "outTangent", "inControl", "outControl"] as const) if (key[field] !== undefined) number(key[field]!, -1e6, 1e6, `${label} ${field}`);
        if (key.interpolation !== undefined && key.interpolation !== "linear" && key.interpolation !== "smooth" && key.interpolation !== "hermite" && key.interpolation !== "bezier") throw new TypeError(`${label} interpolation is invalid`);
        const time = number(key.time, 0, 1, label);
        if (time <= previous) throw new TypeError(`${label} times must strictly increase`);
        previous = time;
        if (color && (key.interpolation === "hermite" || key.interpolation === "bezier")) throw new TypeError("Color gradients use linear or smooth interpolation");
        return { ...key, time, value: color ? integer(key.value, min, max, label) : number(key.value, min, max, label), ...(key.interpolation ? { interpolation: key.interpolation } : {}) };
    });
    if (copied[0]!.time !== 0 || copied[copied.length - 1]!.time !== 1) throw new TypeError(`${label} must cover 0 to 1`);
    for (let i = 1; i < copied.length; i++) {
        const c = coefficients(copied[i - 1]!, copied[i]!);
        const roots: number[] = [];
        const d = 4 * c[2] * c[2] - 12 * c[3] * c[1];
        if (Math.abs(c[3]) < 1e-15) { if (c[2]) roots.push(-c[1] / (2 * c[2])); }
        else if (d >= 0) { roots.push((-2 * c[2] + Math.sqrt(d)) / (6 * c[3]), (-2 * c[2] - Math.sqrt(d)) / (6 * c[3])); }
        for (const u of roots) if (u > 0 && u < 1) number(c[0] + u * (c[1] + u * (c[2] + u * c[3])), min, max, `${label} curve extrema`);
    }
    return copied;
}
type Cubic = readonly [number, number, number, number];
const compiled = new WeakMap<ParticleCurve, readonly Cubic[]>();
function coefficients(a: ParticleCurve[number], b: ParticleCurve[number]): Cubic {
    const span = b.time - a.time, delta = b.value - a.value;
    if (a.interpolation === "smooth") return [a.value, 0, 3 * delta, -2 * delta];
    if (a.interpolation === "hermite") {
        const m0 = (a.outTangent ?? delta / span) * span, m1 = (b.inTangent ?? delta / span) * span;
        return [a.value, m0, 3 * delta - 2 * m0 - m1, -2 * delta + m0 + m1];
    }
    if (a.interpolation === "bezier") {
        const p = a.outControl ?? a.value + delta / 3, q = b.inControl ?? a.value + 2 * delta / 3;
        return [a.value, 3 * (p - a.value), 3 * (a.value - 2 * p + q), b.value - a.value + 3 * (p - q)];
    }
    return [a.value, delta, 0, 0];
}
function cubics(keys: ParticleCurve) {
    let values = compiled.get(keys);
    if (!values) { values = keys.slice(1).map((b, i) => coefficients(keys[i]!, b)); compiled.set(keys, values); }
    return values;
}
/** @internal */
export function sample(keys: ParticleCurve, t: number): number {
    const cs = cubics(keys);
    for (let i = 1; i < keys.length; i++) {
        const a = keys[i - 1]!, b = keys[i]!;
        if (t <= b.time) { const u = Math.max(0, (t - a.time) / (b.time - a.time)), c = cs[i - 1]!; return c[0] + u * (c[1] + u * (c[2] + u * c[3])); }
    }
    return keys[keys.length - 1]!.value;
}
/** @internal */
export function integral(keys: ParticleCurve, t: number): number {
    let result = 0; const cs = cubics(keys);
    for (let i = 1; i < keys.length; i++) {
        const a = keys[i - 1]!, b = keys[i]!, span = b.time - a.time, c = cs[i - 1]!;
        const u = Math.max(0, Math.min(1, (t - a.time) / span));
        result += span * u * (c[0] + u * (c[1] / 2 + u * (c[2] / 3 + u * c[3] / 4)));
        if (t <= b.time) break;
    }
    return result;
}
/** @internal */
export function vectorDistribution(input: import("./types.js").ParticleVectorCurve | undefined, fallback: number, min = -1e6) {
    if (input !== undefined) record(input, ["x", "y", "z"], "vector curves");
    return [input?.x, input?.y, input?.z].map(c => distribution(c ?? [{ time: 0, value: fallback }, { time: 1, value: fallback }], min, 1e6, "vector curve"));
}
/** @internal */
export function distribution(value: ParticleCurveRange, min: number, max: number, label: string) {
    if (Array.isArray(value)) { const keys = curve(value, min, max, label); return { sample: (t: number, _r: number) => sample(keys, t), integral: (t: number, _r: number) => integral(keys, t) }; }
    const pair = value as { readonly min: ParticleCurve; readonly max: ParticleCurve };
    record(pair, ["min", "max"], label);
    const a = curve(pair.min, min, max, label), b = curve(pair.max, min, max, label);
    return { sample: (t: number, r: number) => sample(a, t) * (1 - r) + sample(b, t) * r, integral: (t: number, r: number) => integral(a, t) * (1 - r) + integral(b, t) * r };
}
