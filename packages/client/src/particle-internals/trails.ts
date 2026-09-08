import * as THREE from "three";
import type { ParticleEmitterOptions } from "./types.js";
import { curve, integer, number, record, sample } from "./validation.js";
import { tintCurve } from "./variation.js";

/** @internal */
export function createTrails(options: ParticleEmitterOptions, capacity: number) {
    const config = options.trails;
    if (!config) return undefined;
    record(config, ["mode", "ribbonCount", "segments", "intervalMs", "width", "widthOverTrail", "colorOverTrail", "opacityOverTrail", "persistMs", "textureMode", "tileLength"], "trails");
    const ribbon = config.mode === "ribbon";
    if (config.mode !== undefined && !["particle", "ribbon"].includes(config.mode)) throw new TypeError("Invalid trail mode");
    const ribbonCount = integer(config.ribbonCount ?? 1, 1, 16, "ribbonCount");
    if (!ribbon && config.ribbonCount !== undefined) throw new TypeError("ribbonCount requires ribbon mode");
    const segments = ribbon ? 1 : integer(config.segments ?? 12, 2, 64, "trail segments"), persist = number(config.persistMs ?? 0, 0, 1e6, "trail persistMs");
    const slots = capacity * (persist ? 2 : 1), limit = slots * segments;
    if (limit > 1048576) throw new TypeError("trail sample capacity must not exceed 1048576");
    const interval = number(config.intervalMs ?? 32, 1, 1e6, "trail intervalMs"), width = number(config.width ?? 0.04, 0, 1e6, "trail width");
    const widthKeys = curve(config.widthOverTrail ?? [{ time: 0, value: 1 }, { time: 1, value: 1 }], 0, 1e6, "widthOverTrail");
    const opacity = curve(config.opacityOverTrail ?? [{ time: 0, value: 1 }, { time: 1, value: 0 }], 0, 1, "opacityOverTrail");
    const colorKeys = config.colorOverTrail ? curve(config.colorOverTrail, 0, 0xffffff, "colorOverTrail", true) : undefined;
    const colors = colorKeys?.map(k => new THREE.Color(k.value)), tint = new THREE.Color();
    if (config.textureMode !== undefined && config.textureMode !== "stretch" && config.textureMode !== "tile") throw new TypeError("Invalid trail textureMode");
    const textureMode = config.textureMode;
    const tileLength = number(config.tileLength ?? 1, 0.000001, 1e6, "trail tileLength");
    const history = new Float32Array(slots * segments * 3), counts = new Uint8Array(slots), heads = new Uint8Array(slots), lastSample = new Float64Array(slots);
    const identities = new Float64Array(slots);
    const order = new Uint32Array(slots);
    let orderDirty = true;
    const liveColors = new Float32Array(capacity * 4);
    const ends = new Float32Array(capacity * 3), savedColors = new Float32Array(capacity * 4), death = new Float64Array(capacity);
    let retained = 0, activeTrailCount = 0;
    const g = new THREE.InstancedBufferGeometry(); g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute("position", new THREE.Float32BufferAttribute([0, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, 0, 0.5, 0], 3));
    const attr = (name: string, size: number) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(limit * size), size).setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    const starts = attr("segmentStart", 3), finishes = attr("segmentEnd", 3), colorA = attr("segmentColorA", 4), colorB = attr("segmentColorB", 4), widths = attr("segmentWidths", 2), uvs = attr("segmentUv", 2);
    const world = options.simulationSpace === "world";
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: options.depthTest ?? true, blending: options.blending === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide,
        uniforms: { particleMap: { value: options.runtime?.trailTexture ?? null } }, defines: { ...(world ? { WORLD_SPACE: 1 } : {}), ...(options.runtime?.trailTexture ? { PARTICLE_TEXTURE: 1 } : {}) },
        vertexShader: `
            attribute vec3 segmentStart, segmentEnd;
            attribute vec4 segmentColorA, segmentColorB;
            attribute vec2 segmentWidths, segmentUv;
            varying vec2 vUv; varying vec4 vColor;
            void main() {
                #ifdef WORLD_SPACE
                    vec4 a = viewMatrix * vec4(segmentStart, 1.0), b = viewMatrix * vec4(segmentEnd, 1.0);
                    float scale = 1.0;
                #else
                    vec4 a = modelViewMatrix * vec4(segmentStart, 1.0), b = modelViewMatrix * vec4(segmentEnd, 1.0);
                    float scale = length(modelMatrix[0].xyz);
                #endif
                vec2 d = b.xy - a.xy;
                vec2 side = length(d) > 0.00001 ? normalize(vec2(-d.y, d.x)) : vec2(1.0, 0.0);
                vec4 center = mix(a, b, position.x);
                center.xy += side * position.y * mix(segmentWidths.x, segmentWidths.y, position.x) * scale;
                gl_Position = projectionMatrix * center;
                vUv = vec2(mix(segmentUv.x, segmentUv.y, position.x), position.y + 0.5);
                vColor = mix(segmentColorA, segmentColorB, position.x);
            }`,
        fragmentShader: `uniform sampler2D particleMap; varying vec2 vUv; varying vec4 vColor;
            void main() { vec4 color = vColor;
                #ifdef PARTICLE_TEXTURE
                    color *= texture2D(particleMap, vUv);
                #endif
                if (color.a <= 0.001) discard; gl_FragColor = color;
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
    });
    g.instanceCount = 0;
    const mesh = new THREE.Mesh(g, m); mesh.name = "three-game-kit-particle-trails"; mesh.frustumCulled = false; mesh.visible = false;
    function copy(from: number, to: number) { orderDirty = true; identities[to] = identities[from]!; counts[to] = counts[from]!; heads[to] = heads[from]!; lastSample[to] = lastSample[from]!; history.copyWithin(to * segments * 3, from * segments * 3, (from + 1) * segments * 3); }
    const point = new THREE.Vector3();
    return {
        mesh, starts, finishes, maxWidth: width * Math.max(...widthKeys.map(k => k.value)),
        get activeTrailCount() { return activeTrailCount; },
        clear() { orderDirty = true; retained = 0; activeTrailCount = 0; counts.fill(0); g.instanceCount = 0; mesh.visible = false; },
        birth(i: number, p: THREE.Vector3, time: number, id: number) { orderDirty = true; identities[i] = id; counts[i] = 1; heads[i] = 0; lastSample[i] = time; p.toArray(history, i * segments * 3); },
        appearance(i: number, color: THREE.Color, alpha: number) { liveColors[i * 4] = color.r; liveColors[i * 4 + 1] = color.g; liveColors[i * 4 + 2] = color.b; liveColors[i * 4 + 3] = alpha; },
        remove(i: number, last: number, time: number, endpoint: THREE.Vector3) {
            orderDirty = true;
            if (persist && (ribbon || counts[i]! > 1)) {
                let slot = retained;
                if (retained < capacity) retained++;
                else { slot = 0; for (let k = 1; k < retained; k++) if (death[k]! < death[slot]!) slot = k; }
                copy(i, capacity + slot); death[slot] = time;
                endpoint.toArray(ends, slot * 3);
                for (let k = 0; k < 4; k++) savedColors[slot * 4 + k] = liveColors[i * 4 + k]!;
            }
            if (i !== last) { copy(last, i); liveColors.copyWithin(i * 4, last * 4, last * 4 + 4); }
        },
        sample(i: number, p: THREE.Vector3, time: number) {
            if (ribbon || time - lastSample[i]! < interval) return;
            const head = (heads[i]! + 1) % segments; heads[i] = head; counts[i] = Math.min(segments, counts[i]! + 1); lastSample[i] = time;
            p.toArray(history, (i * segments + head) * 3);
        },
        upload(active: number, time: number, centers: THREE.InstancedBufferAttribute) {
            for (let i = retained - 1; i >= 0; i--) if (time >= death[i]! + persist) {
                retained--; copy(capacity + retained, capacity + i); death[i] = death[retained]!;
                ends.copyWithin(i * 3, retained * 3, retained * 3 + 3); savedColors.copyWithin(i * 4, retained * 4, retained * 4 + 4);
            }
            let n = 0; activeTrailCount = 0;
            if (ribbon) {
                const total = active + retained;
                const sorted = order.subarray(0, total);
                if (orderDirty) { for (let i = 0; i < total; i++) order[i] = i < active ? i : capacity + i - active; sorted.sort((a, b) => identities[b]! - identities[a]!); orderDirty = false; }
                const position = (i: number, a: THREE.InstancedBufferAttribute, target: number) => { if (i < capacity) a.setXYZ(target, centers.getX(i), centers.getY(i), centers.getZ(i)); else { const j = (i - capacity) * 3; a.setXYZ(target, ends[j]!, ends[j + 1]!, ends[j + 2]!); } };
                const color = (i: number, a: THREE.InstancedBufferAttribute, target: number, t: number) => {
                    const orphan = i >= capacity, j = (orphan ? i - capacity : i) * 4, source = orphan ? savedColors : liveColors;
                    tint.setRGB(source[j]!, source[j + 1]!, source[j + 2]!); if (colorKeys && colors) tintCurve(tint, colorKeys, colors, t);
                    a.setXYZW(target, tint.r, tint.g, tint.b, source[j + 3]! * sample(opacity, t) * (orphan ? Math.max(0, 1 - (time - death[i - capacity]!) / persist) : 1));
                };
                for (let group = 0; group < ribbonCount; group++) {
                    let count = 0; for (const i of sorted) if (identities[i]! % ribbonCount === group) count++;
                    if (count < 2) continue;
                    let previous = -1, index = 0, distance = 0; const before = n;
                    for (const i of sorted) if (identities[i]! % ribbonCount === group) {
                        if (previous >= 0) {
                            const a = index / (count - 1), b = (index - 1) / (count - 1);
                            position(i, starts, n); position(previous, finishes, n);
                            const length = Math.hypot(starts.getX(n) - finishes.getX(n), starts.getY(n) - finishes.getY(n), starts.getZ(n) - finishes.getZ(n));
                            color(i, colorA, n, a); color(previous, colorB, n, b);
                            widths.setXY(n, width * sample(widthKeys, a), width * sample(widthKeys, b));
                            uvs.setXY(n, textureMode === "tile" ? (distance + length) / tileLength : a, textureMode === "tile" ? distance / tileLength : b);
                            distance += length; n++;
                        }
                        previous = i; index++;
                    }
                    if (before !== n) activeTrailCount++;
                }
            } else for (let item = 0; item < active + retained; item++) {
                const orphan = item >= active, slot = item - active, i = orphan ? capacity + slot : item;
                let x = orphan ? ends[slot * 3]! : centers.getX(i), y = orphan ? ends[slot * 3 + 1]! : centers.getY(i), z = orphan ? ends[slot * 3 + 2]! : centers.getZ(i);
                const red = orphan ? savedColors[slot * 4]! : liveColors[i * 4]!, green = orphan ? savedColors[slot * 4 + 1]! : liveColors[i * 4 + 1]!, blue = orphan ? savedColors[slot * 4 + 2]! : liveColors[i * 4 + 2]!;
                const alpha = orphan ? savedColors[slot * 4 + 3]! * Math.max(0, 1 - (time - death[slot]!) / persist) : liveColors[i * 4 + 3]!;
                let distance = 0; const before = n;
                for (let k = 0; k < counts[i]!; k++) {
                    const j = (i * segments + (heads[i]! - k + segments) % segments) * 3;
                    const nx = history[j]!, ny = history[j + 1]!, nz = history[j + 2]!, length = Math.hypot(x - nx, y - ny, z - nz);
                    if (length > 1e-8) {
                        const a = (k + 1) / counts[i]!, b = k / counts[i]!;
                        starts.setXYZ(n, nx, ny, nz); finishes.setXYZ(n, x, y, z);
                        tint.setRGB(red, green, blue); if (colorKeys && colors) tintCurve(tint, colorKeys, colors, a);
                        colorA.setXYZW(n, tint.r, tint.g, tint.b, alpha * sample(opacity, a));
                        tint.setRGB(red, green, blue); if (colorKeys && colors) tintCurve(tint, colorKeys, colors, b);
                        colorB.setXYZW(n, tint.r, tint.g, tint.b, alpha * sample(opacity, b));
                        widths.setXY(n, width * sample(widthKeys, a), width * sample(widthKeys, b));
                        uvs.setXY(n, textureMode === "tile" ? (distance + length) / tileLength : a, textureMode === "tile" ? distance / tileLength : b); n++;
                    }
                    distance += length; x = nx; y = ny; z = nz;
                }
                if (before !== n) activeTrailCount++;
            }
            g.instanceCount = n; mesh.visible = n > 0;
            for (const a of [starts, finishes, colorA, colorB, widths, uvs]) { a.clearUpdateRanges(); if (n) { a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; } }
        },
        expand(bounds: THREE.Box3) { for (let i = 0; i < g.instanceCount; i++) { bounds.expandByPoint(point.fromBufferAttribute(starts, i)); bounds.expandByPoint(point.fromBufferAttribute(finishes, i)); } },
        dispose() { mesh.removeFromParent(); g.dispose(); m.dispose(); m.uniforms.particleMap!.value = null; },
    };
}
