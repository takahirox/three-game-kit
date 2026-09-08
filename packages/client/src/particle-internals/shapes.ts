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
export function createShape(input: ParticleShape): (p: THREE.Vector3, v: THREE.Vector3, random: () => number) => void {
    record(input, ["kind", "radius", "surface", "halfExtents", "angle", "innerRadius", "start", "end", "positions", "indices"], "shape");
    let radius = 0, inner = 0, angle = 0, surface = false;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3();
    let mesh: ReturnType<typeof triangles> | undefined, areas: Float64Array | undefined, totalArea = 0;
    const kind = input.kind;
    switch (input.kind) {
        case "point": record(input, ["kind"], "shape"); break;
        case "sphere":
            record(input, ["kind", "radius", "surface"], "shape");
            radius = number(input.radius, 0, 1e6, "radius");
            if (input.surface !== undefined && typeof input.surface !== "boolean") throw new TypeError("surface must be boolean");
            surface = input.surface ?? false; break;
        case "box":
            record(input, ["kind", "halfExtents"], "shape"); a.copy(vector(input.halfExtents, "halfExtents"));
            if (Math.min(a.x, a.y, a.z) < 0) throw new TypeError("halfExtents must be non-negative"); break;
        case "cone":
            record(input, ["kind", "radius", "angle"], "shape"); radius = number(input.radius, 0, 1e6, "radius");
            angle = number(input.angle, 0, Math.PI, "cone angle"); break;
        case "circle": case "ring":
            record(input, input.kind === "ring" ? ["kind", "radius", "innerRadius"] : ["kind", "radius"], "shape");
            radius = number(input.radius, 0, 1e6, "radius");
            inner = input.kind === "ring" ? number(input.innerRadius ?? radius, 0, radius, "innerRadius") : 0; break;
        case "line": record(input, ["kind", "start", "end"], "shape"); a.copy(vector(input.start, "start")); b.copy(vector(input.end, "end")); break;
        case "mesh":
            record(input, ["kind", "positions", "indices"], "shape"); mesh = triangles(input.positions, input.indices);
            areas = new Float64Array(mesh.indices.length / 3);
            for (let i = 0; i < areas.length; i++) {
                a.fromArray(mesh.positions, mesh.indices[i * 3]! * 3); b.fromArray(mesh.positions, mesh.indices[i * 3 + 1]! * 3); c.fromArray(mesh.positions, mesh.indices[i * 3 + 2]! * 3);
                totalArea += b.sub(a).cross(c.sub(a)).length() / 2; areas[i] = totalArea;
            }
            if (totalArea === 0) throw new TypeError("mesh shape requires non-degenerate triangles"); break;
        default: throw new TypeError("Invalid particle shape");
    }
    return (p, v, random) => {
        const azimuth = random() * Math.PI * 2;
        const y = kind === "cone" ? 1 - random() * (1 - Math.cos(angle)) : 2 * random() - 1;
        const radial = Math.sqrt(Math.max(0, 1 - y * y));
        v.set(Math.cos(azimuth) * radial, y, Math.sin(azimuth) * radial); p.set(0, 0, 0);
        if (kind === "sphere") p.copy(v).multiplyScalar(radius * (surface ? 1 : Math.cbrt(random())));
        else if (kind === "box") p.set((random() * 2 - 1) * a.x, (random() * 2 - 1) * a.y, (random() * 2 - 1) * a.z);
        else if (kind === "cone" || kind === "circle" || kind === "ring") {
            const r = Math.sqrt(inner * inner + random() * (radius * radius - inner * inner)), t = random() * Math.PI * 2;
            p.set(r * Math.cos(t), 0, r * Math.sin(t));
            if (kind !== "cone") v.set(0, 1, 0);
        } else if (kind === "line") p.copy(a).lerp(b, random());
        else if (mesh && areas) {
            const target = random() * totalArea;
            let lo = 0, hi = areas.length - 1;
            while (lo < hi) { const mid = (lo + hi) >>> 1; if (target < areas[mid]!) hi = mid; else lo = mid + 1; }
            a.fromArray(mesh.positions, mesh.indices[lo * 3]! * 3); b.fromArray(mesh.positions, mesh.indices[lo * 3 + 1]! * 3); c.fromArray(mesh.positions, mesh.indices[lo * 3 + 2]! * 3);
            normal.copy(b).sub(a).cross(v.copy(c).sub(a)).normalize();
            const u = Math.sqrt(random()), w = random();
            p.copy(a).multiplyScalar(1 - u).addScaledVector(b, u * (1 - w)).addScaledVector(c, u * w); v.copy(normal);
        }
    };
}
