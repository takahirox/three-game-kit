import type { ParticleRendererOptions, ParticleMeshData } from "./types.js";
import { triangles } from "./shapes.js";
import { number, record } from "./validation.js";

/** Validate all borrowed mesh data before allocating GPU resources. @internal */
export function meshVariants(render: Extract<ParticleRendererOptions, { kind: "mesh" }>, capacity: number) {
    const entries: readonly (ParticleMeshData & { weight?: number })[] = "meshes" in render ? render.meshes : [render];
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 8 || entries.length * capacity > 262144) throw new TypeError("mesh variants require 1–8 meshes and at most 262144 instance slots");
    if ("meshes" in render && ["positions", "indices", "uvs", "normals"].some(k => k in render)) throw new TypeError("mesh variants cannot include singular mesh data");
    let vertices = 0, indices = 0;
    const result = entries.map(entry => {
        if ("meshes" in render) record(entry, ["positions", "indices", "uvs", "normals", "weight"], "mesh variant");
        const data = triangles(entry.positions, entry.indices);
        vertices += data.positions.length / 3; indices += data.indices.length;
        const read = (value: readonly number[] | undefined, size: number, name: string) => {
            if (value === undefined) return undefined;
            if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== data.positions.length / 3 * size) throw new TypeError(`${name} must match mesh vertex count`);
            return Array.from(value, v => number(v, -1e12, 1e12, name));
        };
        const uvs = read(entry.uvs, 2, "mesh uvs") ?? data.positions.flatMap((_, i) => i % 3 ? [] : [data.positions[i]! + 0.5, data.positions[i + 1]! + 0.5]);
        const normals = read(entry.normals, 3, "mesh normals");
        let radius = 0;
        for (let i = 0; i < data.positions.length; i += 3) {
            radius = Math.max(radius, Math.hypot(data.positions[i]!, data.positions[i + 1]!, data.positions[i + 2]!));
            if (normals) { const length = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!); if (!length) throw new TypeError("mesh normals cannot be zero"); for (let j = 0; j < 3; j++) normals[i + j] = normals[i + j]! / length; }
        }
        return { data, uvs, normals, radius, weight: number(entry.weight ?? 1, 0, 1e6, "mesh weight") };
    });
    if (vertices > 65536 || indices > 196608 || !result.some(m => m.weight > 0)) throw new TypeError("mesh variant budget exceeded or all weights are zero");
    return result;
}
