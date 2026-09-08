import * as THREE from "three";
import type { ParticleVector3, ParticleRange, ParticleCurve } from "./types.js";
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
        record(key, ["time", "value"], label);
        const time = number(key.time, 0, 1, label);
        if (time <= previous) throw new TypeError(`${label} times must strictly increase`);
        previous = time;
        return { time, value: color ? integer(key.value, min, max, label) : number(key.value, min, max, label) };
    });
    if (copied[0]!.time !== 0 || copied[copied.length - 1]!.time !== 1) throw new TypeError(`${label} must cover 0 to 1`);
    return copied;
}
/** @internal */
export function sample(keys: ParticleCurve, t: number): number {
    for (let i = 1; i < keys.length; i++) {
        const a = keys[i - 1]!, b = keys[i]!;
        if (t <= b.time) return a.value + (b.value - a.value) * (t - a.time) / (b.time - a.time);
    }
    return keys[keys.length - 1]!.value;
}
