import * as THREE from "three";
import type { ParticleCurve, ParticleCurveRange, ParticleEmitterOptions, ParticleSpeedCurve, ParticleVectorRange, ParticleVectorSpeedCurve, ParticleVector3 } from "./types.js";
import { curve, distribution, integer, number, range, record, vectorDistribution } from "./validation.js";

import { createNoise } from "./noise.js";

function axes(input: ParticleVectorRange | undefined, fallback: number, min: number) {
    if (input !== undefined) record(input, ["x", "y", "z"], "particle axes");
    return [input?.x, input?.y, input?.z].map(v => range(v ?? fallback, min, 1e6, "particle axis"));
}
function speedCurve(input: ParticleSpeedCurve | undefined, color = false) {
    if (!input) return undefined;
    record(input, ["range", "curve"], "speed curve");
    const limits = range(input.range, 0, 1e6, "speed range");
    if (limits[0] === limits[1]) throw new TypeError("speed range must have positive span");
    if (color) {
        return { limits, color: colorDistribution(input.curve, "colorBySpeed") };
    }
    return { limits, values: distribution(input.curve, -1e6, 1e6, "speed curve") };
}
/** @internal */
export function tintCurve(target: THREE.Color, keys: ReturnType<typeof curve>, colors: THREE.Color[], t: number) {
    for (let k = 1; k < keys.length; k++) if (t <= keys[k]!.time) {
        const a = keys[k - 1]!, b = keys[k]!;
        let u = Math.max(0, (t - a.time) / (b.time - a.time)); if (a.interpolation === "smooth") u = u * u * (3 - 2 * u);
        const ca = colors[k - 1]!, cb = colors[k]!;
        target.setRGB(target.r * (ca.r + (cb.r - ca.r) * u), target.g * (ca.g + (cb.g - ca.g) * u), target.b * (ca.b + (cb.b - ca.b) * u)); return;
    }
}
/** @internal */
export function colorDistribution(input: ParticleCurveRange, label: string) {
    if (Array.isArray(input)) {
        const keys = curve(input, 0, 0xffffff, label, true), colors = keys.map(k => new THREE.Color(k.value));
        return (tint: THREE.Color, t: number, _r: number) => tintCurve(tint, keys, colors, t);
    }
    const pair = input as { min: ParticleCurve; max: ParticleCurve };
    record(pair, ["min", "max"], label);
    const a = curve(pair.min, 0, 0xffffff, label, true), b = curve(pair.max, 0, 0xffffff, label, true);
    const ca = a.map(k => new THREE.Color(k.value)), cb = b.map(k => new THREE.Color(k.value)), left = new THREE.Color(), right = new THREE.Color();
    return (tint: THREE.Color, t: number, r: number) => { left.copy(tint); right.copy(tint); tintCurve(left, a, ca, t); tintCurve(right, b, cb, t); tint.copy(left).lerp(right, r); };
}
/** @internal */
export function usesAxes(options: ParticleEmitterOptions) { return !!(options.sizeAxes || options.rotation3D || options.angularVelocity3D || options.sizeAxesOverLife || options.angularVelocityAxesOverLife || options.sizeAxesBySpeed || options.angularVelocityAxesBySpeed || options.noise?.rotationAmount || options.noise?.sizeAmount); }
function vectorSpeed(input: ParticleVectorSpeedCurve | undefined, min: number) {
    if (!input) return undefined;
    record(input, ["range", "curves"], "vector speed curve");
    const limits = range(input.range, 0, 1e6, "speed range");
    if (limits[0] === limits[1]) throw new TypeError("speed range must have positive span");
    return { limits, curves: vectorDistribution(input.curves, 1, min) };
}
/** @internal */
export function createVariation(options: ParticleEmitterOptions, capacity: number, columns: number, rows: number) {
    const size = axes(options.sizeAxes, 1, 0), rotation = axes(options.rotation3D, 0, -1e6), spin = axes(options.angularVelocity3D, 0, -1e6);
    const axisRanges = [size, rotation, spin];
    const hasAxes = usesAxes(options);
    const axisLife = vectorDistribution(options.sizeAxesOverLife, 1, 0), spinLife = vectorDistribution(options.angularVelocityAxesOverLife, 1);
    const axisSpeed = vectorSpeed(options.sizeAxesBySpeed, 0), spinSpeed = vectorSpeed(options.angularVelocityAxesBySpeed, -1e6);
    const integrated = !!(options.angularVelocityAxesOverLife || spinSpeed), turns = new Float64Array(integrated ? capacity * 3 : 0);
    const noise = createNoise(options.noise), noiseValue = new THREE.Vector3();
    const values = new Float64Array(hasAxes ? capacity * 9 : 0);
    const angular = options.angularVelocityOverLife === undefined ? undefined : distribution(options.angularVelocityOverLife, -1e6, 1e6, "angularVelocityOverLife");
    const sizeSpeed = speedCurve(options.sizeBySpeed), rotationSpeed = speedCurve(options.rotationBySpeed), colorSpeed = speedCurve(options.colorBySpeed, true);
    const sheet = options.spriteSheet ? { ...options.spriteSheet } : undefined;
    const start = range(sheet?.startFrame ?? 0, 0, columns * rows - 1, "startFrame");
    const fps = sheet?.fps === undefined ? undefined : number(sheet.fps, 0, 1e6, "fps");
    if (sheet?.row !== undefined && sheet.row !== "random") integer(sheet.row, 0, rows - 1, "sprite row");
    if (sheet?.blend !== undefined && typeof sheet.blend !== "boolean") throw new TypeError("sprite blend must be boolean");
    const frames = new Float64Array(sheet ? capacity * 2 : 0);
    if (options.startColors !== undefined && (!Array.isArray(options.startColors) || !options.startColors.length || options.startColors.length > 256)) throw new TypeError("startColors requires 1–256 colors");
    const palette = options.startColors === undefined ? undefined : Array.from(options.startColors, c => integer(c, 0, 0xffffff, "startColors"));
    const cycles = sheet?.cycles ?? 1;
    function speedT(s: { limits: readonly [number, number] }, speed: number) { return Math.max(0, Math.min(1, (speed - s.limits[0]) / (s.limits[1] - s.limits[0]))); }
    return {
        hasAxes, integrated, needsSpeed: !!(sizeSpeed || rotationSpeed || colorSpeed || axisSpeed || spinSpeed),
        birth(i: number, random: () => number, tint: THREE.Color, usePalette: boolean, override?: ParticleVector3, scaleOverride?: ParticleVector3) {
            if (palette && usePalette) tint.setHex(palette[Math.floor(random() * palette.length)]!);
            if (hasAxes) for (let k = 0; k < 3; k++) for (let n = 0; n < 3; n++) {
                const r = axisRanges[k]![n]!; values[i * 9 + k * 3 + n] = r[0] + random() * (r[1] - r[0]);
            }
            if (scaleOverride) for (let k = 0; k < 3; k++) values[i * 9 + k] = [scaleOverride.x, scaleOverride.y, scaleOverride.z][k]!;
            if (override) for (let k = 0; k < 3; k++) values[i * 9 + 3 + k] = [override.x, override.y, override.z][k]!;
            if (integrated) turns.fill(0, i * 3, i * 3 + 3);
            if (sheet) { frames[i * 2] = start[0] + random() * (start[1] - start[0]); frames[i * 2 + 1] = sheet.row === "random" ? Math.floor(random() * rows) : sheet.row ?? -1; }
        },
        remove(i: number, last: number) { if (integrated) turns.copyWithin(i * 3, last * 3, last * 3 + 3); if (hasAxes) values.copyWithin(i * 9, last * 9, last * 9 + 9); if (sheet) frames.copyWithin(i * 2, last * 2, last * 2 + 2); },
        size(speed: number, r: number) { return Math.max(0, sizeSpeed?.values?.sample(speedT(sizeSpeed, speed), r) ?? 1); },
        angle(seconds: number, progress: number, lifetime: number, speed: number, r: number, spin: number) {
            return spin * (angular ? angular.integral(progress, r) * lifetime / 1000 : seconds) + (rotationSpeed?.values?.sample(speedT(rotationSpeed, speed), r) ?? 0);
        },
        color(tint: THREE.Color, speed: number, r: number) { colorSpeed?.color?.(tint, speedT(colorSpeed, speed), r); },
        step(i: number, age: number, lifetime: number, dt: number, speed: number, r: number) {
            if (!integrated) return;
            const t = (age + dt / 2) / lifetime;
            for (let k = 0; k < 3; k++) turns[i * 3 + k] = turns[i * 3 + k]! + values[i * 9 + 6 + k]! * dt / 1000 * spinLife[k]!.sample(t, r) * (angular?.sample(t, r) ?? 1) * (spinSpeed?.curves[k]!.sample(speedT(spinSpeed, speed), r) ?? 1);
        },
        axes(i: number, progress: number, lifetime: number, r: number, scales: THREE.InstancedBufferAttribute, rotations: THREE.InstancedBufferAttribute, speed = 0, previewMs = 0, position = noiseValue) {
            const t = (angular ? angular.integral(progress, r) : progress) * lifetime / 1000;
            if (noise && (noise.rotationAmount || noise.sizeAmount)) noise.sample(position, progress * lifetime, Math.floor(r * 4294967296), noiseValue); else noiseValue.set(0, 0, 0);
            for (let k = 0; k < 3; k++) {
                scales.setComponent(i, k, values[i * 9 + k]! * axisLife[k]!.sample(progress, r) * (axisSpeed?.curves[k]!.sample(speedT(axisSpeed, speed), r) ?? 1) * Math.max(0, 1 + noiseValue.getComponent(k) * (noise?.sizeAmount ?? 0)));
                const preview = previewMs / 1000 * spinLife[k]!.sample(progress - previewMs / (2 * lifetime), r) * (angular?.sample(progress - previewMs / (2 * lifetime), r) ?? 1) * (spinSpeed?.curves[k]!.sample(speedT(spinSpeed, speed), r) ?? 1);
                rotations.setComponent(i, k, values[i * 9 + 3 + k]! + (integrated ? turns[i * 3 + k]! + values[i * 9 + 6 + k]! * preview : values[i * 9 + 6 + k]! * t) + noiseValue.getComponent(k) * (noise?.rotationAmount ?? 0));
            }
        },
        frame(i: number, seconds: number, progress: number, atlas?: THREE.InstancedBufferAttribute) {
            const row = sheet ? frames[i * 2 + 1]! : -1, count = row < 0 ? columns * rows : columns, offset = row < 0 ? 0 : row * columns;
            const value = ((sheet ? frames[i * 2]! : 0) + (fps === undefined ? progress * cycles * count : seconds * fps)) % count;
            const frame = Math.floor(value);
            atlas?.setXYZ(i, offset + (frame + 1) % count, sheet?.blend ? value - frame : 0, 0);
            return offset + frame;
        },
    };
}
