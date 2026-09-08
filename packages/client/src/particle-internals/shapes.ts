import * as THREE from "three";
import type { ParticleShape } from "./types.js";
import { integer, number, record, vector } from "./validation.js";

/** Copy and validate triangle data before allocating scene/GPU resources. */
/** @internal */
export function triangles(positions: readonly number[], indices?: readonly number[]): { positions: number[]; indices: number[] } {
    if (!Array.isArray(positions) || positions.length < 9 || positions.length % 3 || positions.length > 3 * 65536)
        throw new TypeError("mesh positions require 3–65536 finite vertices");
    const p = Array.from(positions, v => number(v, -1e6, 1e6, "mesh position"));
    if (indices !== undefined && (!Array.isArray(indices) || indices.length < 3 || indices.length % 3 || indices.length > 3 * 65536))
        throw new TypeError("mesh indices require complete triangles");
    const ix = indices === undefined ? Array.from({ length: p.length / 3 }, (_, i) => i) : Array.from(indices, v => integer(v, 0, p.length / 3 - 1, "mesh index"));
    if (ix.length % 3) throw new TypeError("non-indexed mesh requires complete triangles");
    return { positions: p, indices: ix };
}

/** @internal */
export function createShape(input: ParticleShape): (p: THREE.Vector3, v: THREE.Vector3, random: () => number, timeMs?: number) => boolean {
    record(input, ["kind", "radius", "surface", "hemisphere", "halfExtents", "angle", "innerRadius", "start", "end", "positions", "indices", "emitFrom", "uvs", "mask", "arc"], "shape");
    let radius = 0, inner = 0, angle = 0, surface = false, hemisphere = false, mode = "volume";
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3();
    let mesh: ReturnType<typeof triangles> | undefined, weights: number[] = [], entries: number[][] = [], total = 0, uvs: number[] | undefined;
    const kind = input.kind;
    switch (input.kind) {
        case "point": record(input, ["kind"], "shape"); break;
        case "sphere":
            record(input, ["kind", "radius", "surface", "hemisphere"], "shape");
            radius = number(input.radius, 0, 1e6, "radius");
            for (const flag of [input.surface, input.hemisphere]) if (flag !== undefined && typeof flag !== "boolean") throw new TypeError("sphere flags must be boolean");
            surface = input.surface ?? false; hemisphere = input.hemisphere ?? false; break;
        case "box":
            record(input, ["kind", "halfExtents", "emitFrom"], "shape"); a.copy(vector(input.halfExtents, "halfExtents"));
            if (Math.min(a.x, a.y, a.z) < 0) throw new TypeError("halfExtents must be non-negative");
            mode = input.emitFrom ?? "volume";
            if (!["volume", "surface", "edge"].includes(mode)) throw new TypeError("Invalid box emitFrom");
            for (let k = 0; k < 3; k++) { total += mode === "surface" ? a.getComponent((k + 1) % 3) * a.getComponent((k + 2) % 3) : a.getComponent(k); weights.push(total); }
            break;
        case "cone":
            record(input, ["kind", "radius", "angle", "arc"], "shape"); radius = number(input.radius, 0, 1e6, "radius");
            angle = number(input.angle, 0, Math.PI, "cone angle"); break;
        case "circle": case "ring":
            record(input, input.kind === "ring" ? ["kind", "radius", "innerRadius", "arc", "mask"] : ["kind", "radius", "arc", "mask"], "shape");
            radius = number(input.radius, 0, 1e6, "radius");
            inner = input.kind === "ring" ? number(input.innerRadius ?? radius, 0, radius, "innerRadius") : 0; break;
        case "line": record(input, ["kind", "start", "end"], "shape"); a.copy(vector(input.start, "start")); b.copy(vector(input.end, "end")); break;
        case "mesh": {
            record(input, ["kind", "positions", "indices", "emitFrom", "uvs", "mask"], "shape"); mesh = triangles(input.positions, input.indices);
            mode = input.emitFrom ?? "surface";
            if (!["surface", "edge", "vertex"].includes(mode)) throw new TypeError("Invalid mesh emitFrom");
            if (input.uvs !== undefined) {
                if (!Array.isArray(input.uvs) || input.uvs.length !== mesh.positions.length / 3 * 2) throw new TypeError("mesh uvs must match vertices");
                uvs = Array.from(input.uvs, n => number(n, 0, 1, "mesh uv"));
            }
            if (input.mask && !uvs) throw new TypeError("mesh mask requires uvs");
            const edges = new Set<string>();
            for (let i = 0; i < mesh.indices.length; i += 3) {
                const ix = mesh.indices.slice(i, i + 3);
                a.fromArray(mesh.positions, ix[0]! * 3); b.fromArray(mesh.positions, ix[1]! * 3); c.fromArray(mesh.positions, ix[2]! * 3);
                if (mode === "surface") { const area = b.sub(a).cross(c.sub(a)).length() / 2; if (area) { total += area; entries.push(ix); weights.push(total); } }
                else if (mode === "edge") for (let k = 0; k < 3; k++) {
                    const x = Math.min(ix[k]!, ix[(k + 1) % 3]!), y = Math.max(ix[k]!, ix[(k + 1) % 3]!), key = `${x}:${y}`;
                    if (edges.has(key)) continue; edges.add(key);
                    const length = a.fromArray(mesh.positions, x * 3).distanceTo(b.fromArray(mesh.positions, y * 3));
                    if (length) { total += length; entries.push([x, y]); weights.push(total); }
                }
            }
            if (mode === "vertex") for (let i = 0; i < mesh.positions.length / 3; i++) { entries.push([i]); weights.push(++total); }
            if (!total) throw new TypeError("mesh shape requires non-degenerate geometry"); break;
        }
        default: throw new TypeError("Invalid particle shape");
    }
    const arcInput = "arc" in input ? input.arc : undefined;
    if (arcInput !== undefined) record(arcInput, ["angle", "mode", "speed", "offset"], "arc");
    const arcAngle = number(arcInput?.angle ?? Math.PI * 2, 0, Math.PI * 2, "arc angle"), arcSpeed = number(arcInput?.speed ?? 1, -1e6, 1e6, "arc speed"), offset = number(arcInput?.offset ?? 0, -1e6, 1e6, "arc offset"), arcMode = arcInput?.mode ?? "random";
    if (!["random", "loop", "pingPong"].includes(arcMode)) throw new TypeError("Invalid arc mode");
    const maskInput = "mask" in input ? input.mask : undefined;
    let mask: number[] | undefined, width = 1, height = 1, threshold = 0, channel = "probability";
    if (maskInput !== undefined) {
        record(maskInput, ["width", "height", "values", "threshold", "channel"], "emission mask");
        width = integer(maskInput.width, 1, 1024, "mask width"); height = integer(maskInput.height, 1, 1024, "mask height");
        if (!Array.isArray(maskInput.values) || maskInput.values.length !== width * height) throw new TypeError("mask values must match dimensions");
        mask = Array.from(maskInput.values, n => number(n, 0, 1, "mask value")); threshold = number(maskInput.threshold ?? 0, 0, 1, "mask threshold");
        channel = maskInput.channel ?? "probability"; if (!["probability", "clip"].includes(channel)) throw new TypeError("Invalid mask channel");
    }
    function select(random: () => number) {
        const target = random() * total; let lo = 0, hi = weights.length - 1;
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (target < weights[mid]!) hi = mid; else lo = mid + 1; } return lo;
    }
    return (p, v, random, timeMs = 0) => {
        for (let attempt = 0; attempt < (mask ? 32 : 1); attempt++) {
            let azimuth = random() * Math.PI * 2;
            if (arcInput) { const phase = arcAngle ? ((timeMs / 1000 * arcSpeed) % (2 * arcAngle) + 2 * arcAngle) % (2 * arcAngle) : 0; azimuth = offset + (arcMode === "random" ? random() * arcAngle : arcMode === "loop" ? phase % (arcAngle || 1) : arcAngle - Math.abs(phase - arcAngle)); }
            const y = kind === "cone" ? 1 - random() * (1 - Math.cos(angle)) : hemisphere ? random() : 2 * random() - 1;
            const radial = Math.sqrt(Math.max(0, 1 - y * y));
            v.set(Math.cos(azimuth) * radial, y, Math.sin(azimuth) * radial); p.set(0, 0, 0);
            let uvX = 0.5, uvY = 0.5;
            if (kind === "sphere") p.copy(v).multiplyScalar(radius * (surface ? 1 : Math.cbrt(random())));
            else if (kind === "box") {
                p.set((random() * 2 - 1) * a.x, (random() * 2 - 1) * a.y, (random() * 2 - 1) * a.z);
                const axis = select(random);
                if (mode === "surface") p.setComponent(axis, (random() < 0.5 ? -1 : 1) * a.getComponent(axis));
                else if (mode === "edge") for (let k = 0; k < 3; k++) if (k !== axis) p.setComponent(k, (random() < 0.5 ? -1 : 1) * a.getComponent(k));
            } else if (kind === "cone" || kind === "circle" || kind === "ring") {
                const r = Math.sqrt(inner * inner + random() * (radius * radius - inner * inner)), t = arcInput ? azimuth : random() * Math.PI * 2;
                p.set(r * Math.cos(t), 0, r * Math.sin(t)); uvX = radius ? p.x / (2 * radius) + 0.5 : 0.5; uvY = radius ? p.z / (2 * radius) + 0.5 : 0.5;
                if (kind !== "cone") v.set(0, 1, 0);
            } else if (kind === "line") p.copy(a).lerp(b, random());
            else if (mesh) {
                const ix = entries[select(random)]!, u = ix.length === 3 ? Math.sqrt(random()) : random(), w = random();
                const wa = ix.length === 1 ? 1 : 1 - u, wb = ix.length === 3 ? u * (1 - w) : u, wc = ix.length === 3 ? u * w : 0;
                a.fromArray(mesh.positions, ix[0]! * 3); b.fromArray(mesh.positions, (ix[1] ?? ix[0])! * 3); c.fromArray(mesh.positions, (ix[2] ?? ix[0])! * 3);
                p.copy(a).multiplyScalar(wa).addScaledVector(b, ix.length === 1 ? 0 : wb).addScaledVector(c, wc);
                if (ix.length === 3) { normal.copy(b).sub(a).cross(v.copy(c).sub(a)).normalize(); v.copy(normal); }
                if (uvs) { uvX = 0; uvY = 0; for (let k = 0; k < ix.length; k++) { const weight = k === 0 ? wa : k === 1 ? wb : wc; uvX += uvs[ix[k]! * 2]! * weight; uvY += uvs[ix[k]! * 2 + 1]! * weight; } }
            }
            if (!mask) return true;
            const value = mask[Math.min(height - 1, Math.floor(uvY * height)) * width + Math.min(width - 1, Math.floor(uvX * width))]!;
            if (value > threshold && (channel === "clip" || random() < value)) return true;
        }
        return false;
    };
}
