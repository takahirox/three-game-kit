import * as THREE from "three";
import type { ParticleNoise } from "./types.js";
import { curve, integer, number, record, sample, vector } from "./validation.js";
function hash(x: number, y: number, z: number, seed: number) {
    let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177) ^ seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 2147483647.5 - 1;
}
const fade = (v: number) => v * v * v * (v * (v * 6 - 15) + 10);
function noise(x: number, y: number, z: number, seed: number) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const u = fade(x - ix), v = fade(y - iy), w = fade(z - iz);
    let result = 0;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) result += hash(ix + a, iy + b, iz + c, seed) * (a ? u : 1 - u) * (b ? v : 1 - v) * (c ? w : 1 - w);
    return result;
}
/** @internal */
export function createNoise(input: ParticleNoise | undefined) {
    if (input === undefined) return undefined;
    record(input, ["strength", "frequency", "scrollSpeed", "octaves", "octaveMultiplier", "octaveScale", "strengthAxes", "remap", "positionAmount", "rotationAmount", "sizeAmount"], "noise");
    const strength = number(input.strength, 0, 1e6, "noise strength"), frequency = number(input.frequency ?? 1, 0, 1e6, "noise frequency"), scroll = number(input.scrollSpeed ?? 1, -1e6, 1e6, "noise scrollSpeed");
    const octaves = integer(input.octaves ?? 1, 1, 8, "noise octaves"), multiplier = number(input.octaveMultiplier ?? 0.5, 0, 1, "noise octaveMultiplier"), scale = number(input.octaveScale ?? 2, 1, 8, "noise octaveScale");
    const axes = vector(input.strengthAxes ?? { x: 1, y: 1, z: 1 }, "noise strengthAxes");
    const remap = input.remap ? curve(input.remap, -1, 1, "noise remap") : undefined;
    const positionAmount = number(input.positionAmount ?? 1, 0, 1e6, "positionAmount"), rotationAmount = number(input.rotationAmount ?? 0, 0, 1e6, "rotationAmount"), sizeAmount = number(input.sizeAmount ?? 0, 0, 1e6, "sizeAmount");
    return { positionAmount, rotationAmount, sizeAmount,
        sample(p: THREE.Vector3, ageMs: number, seed: number, out: THREE.Vector3) {
            const time = ageMs / 1000 * scroll;
            for (let axis = 0; axis < 3; axis++) {
                let amplitude = 1, f = frequency, sum = 0, weight = 0;
                for (let k = 0; k < octaves; k++) { sum += amplitude * noise(p.x * f + time, p.y * f + time * 0.73, p.z * f - time * 0.41, seed ^ Math.imul(axis + 1, 0x9e3779b1)); weight += amplitude; amplitude *= multiplier; f *= scale; }
                const n = sum / weight;
                out.setComponent(axis, (remap ? sample(remap, (n + 1) / 2) : n) * strength * axes.getComponent(axis));
            }
        },
    };
}
