import * as THREE from "three";
import type { ParticleEmitterOptions, ParticleEvent, ParticleUpdateContext, ParticleTrigger } from "./types.js";
import { integer, number, record, vector } from "./validation.js";
import { createMotion } from "./motion.js";

/** @internal */
export function createRuntime(options: ParticleEmitterOptions, capacity: number) {
    const input = options.runtime ?? {};
    record(input, ["update", "meshPositions", "material", "trailTexture", "softParticles", "onComplete", "customSimulationSpace", "captureState", "restoreState"], "runtime");
    if ((input.captureState === undefined) !== (input.restoreState === undefined)) throw new TypeError("captureState and restoreState must be paired");
    for (const fn of [input.update, input.meshPositions, input.onComplete, input.captureState, input.restoreState]) if (fn !== undefined && typeof fn !== "function") throw new TypeError("runtime callbacks must be functions");
    if (input.meshPositions && options.shape?.kind !== "mesh") throw new TypeError("meshPositions requires a mesh emission shape");
    if (input.material !== undefined && !(input.material instanceof THREE.ShaderMaterial || input.material instanceof THREE.MeshStandardMaterial)) throw new TypeError("runtime material must be a ShaderMaterial or MeshStandardMaterial");
    if (input.trailTexture !== undefined && !(input.trailTexture instanceof THREE.Texture)) throw new TypeError("trailTexture must be a Texture");
    const soft = input.softParticles;
    if (soft) {
        record(soft, ["depthTexture", "camera", "width", "height", "origin", "fadeDistance"], "softParticles");
        if (!(soft.depthTexture instanceof THREE.Texture) || !(soft.camera instanceof THREE.PerspectiveCamera || soft.camera instanceof THREE.OrthographicCamera)) throw new TypeError("softParticles requires a depth texture and perspective/orthographic camera");
        if (soft.origin) { record(soft.origin, ["x", "y"], "depth origin"); number(soft.origin.x, -65536, 65536, "depth origin x"); number(soft.origin.y, -65536, 65536, "depth origin y"); }
        number(soft.width, 1, 65536, "depth width"); number(soft.height, 1, 65536, "depth height"); number(soft.fadeDistance ?? 0.5, 0.000001, 1e6, "fadeDistance");
    }
    if (options.customAttributes !== undefined && (!Array.isArray(options.customAttributes) || options.customAttributes.length > 16)) throw new TypeError("customAttributes requires at most 16 attributes");
    const names = new Set<string>(); let stride = 0;
    const attributes = Array.from(options.customAttributes ?? [], a => {
        record(a, ["name", "size", "value"], "custom attribute");
        if (typeof a.name !== "string" || !/^custom[A-Z][A-Za-z0-9_]{0,48}$/.test(a.name) || names.has(a.name)) throw new TypeError("custom attribute names must be unique and start with custom followed by an uppercase letter");
        names.add(a.name); const size = integer(a.size, 1, 4, "attribute size");
        if (a.value !== undefined && (!Array.isArray(a.value) || a.value.length !== size)) throw new TypeError("custom attribute default size mismatch");
        const value = Array.from(a.value ?? new Array<number>(size).fill(0), (v: number) => number(v, -1e6, 1e6, "custom attribute value"));
        const offset = stride; stride += size;
        return { name: a.name, size, value, offset };
    });
    const data = new Float32Array(capacity * stride), scratch = new Float32Array(stride);
    function parseTriggers(input: readonly ParticleTrigger[]) {
    if (input !== undefined && (!Array.isArray(input) || input.length > 32)) throw new TypeError("triggers requires up to 32 unique volumes");
    const triggers = Array.from(input ?? [], t => {
        record(t, ["id", "volume"], "trigger");
        if (typeof t.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(t.id)) throw new TypeError("Invalid trigger id");
        createMotion({ collision: { colliders: [t.volume] } }); // Same volume validation as solid colliders.
        const c = t.volume;
        if (c.kind === "sphere") { const center = vector(c.center, "trigger center"), radius = c.radius; return { id: t.id, contains: (p: THREE.Vector3) => p.distanceToSquared(center) <= radius * radius }; }
        if (c.kind === "box") { const box = new THREE.Box3(vector(c.min, "trigger min"), vector(c.max, "trigger max")); return { id: t.id, contains: (p: THREE.Vector3) => box.containsPoint(p) }; }
        const normal = vector(c.normal, "trigger normal"), offset = c.offset;
        return { id: t.id, contains: (p: THREE.Vector3) => p.dot(normal) <= offset };
    });
    if (!Array.isArray(input ?? []) || triggers.length > 32 || new Set(triggers.map(t => t.id)).size !== triggers.length) throw new TypeError("triggers requires up to 32 unique volumes");
    return triggers;
    }
    let triggers = parseTriggers(options.triggers ?? []);
    let masks = new Uint32Array(triggers.length ? capacity : 0);
    const context = { particleId: 0, ageMs: 0, lifetimeMs: 0, deltaMs: 0, position: new THREE.Vector3(), velocity: new THREE.Vector3(), attributes: scratch };
    const update = input.update, meshPositions = input.meshPositions, onComplete = input.onComplete;
    return {
        attributes, meshPositions, onComplete, get enabled() { return !!(update || triggers.length); },
        setTriggers(input: readonly ParticleTrigger[]) { const next = parseTriggers(input); if (next.length && !masks.length) masks = new Uint32Array(capacity); triggers = next; masks.fill(0); },
        birth(i: number) { if (triggers.length) masks[i] = 0; for (const a of attributes) data.set(a.value, i * stride + a.offset); },
        remove(i: number, last: number) { if (stride) data.copyWithin(i * stride, last * stride, (last + 1) * stride); if (triggers.length) masks[i] = masks[last]!; },
        step(i: number, id: number, age: number, lifetime: number, dt: number, p: THREE.Vector3, v: THREE.Vector3, emit: (kind: ParticleEvent["kind"], triggerId: string) => void, birth?: () => void) {
            if (update) {
                context.particleId = id; context.ageMs = age; context.lifetimeMs = lifetime; context.deltaMs = dt;
                context.position.copy(p); context.velocity.copy(v); for (let k = 0; k < stride; k++) scratch[k] = data[i * stride + k]!;
                update(context satisfies ParticleUpdateContext);
                for (let k = 0; k < 3; k++) { number(context.position.getComponent(k), -1e12, 1e12, "custom position"); number(context.velocity.getComponent(k), -1e12, 1e12, "custom velocity"); }
                for (let k = 0; k < scratch.length; k++) number(scratch[k]!, -1e12, 1e12, "custom attribute");
                p.copy(context.position); v.copy(context.velocity); data.set(scratch, i * stride);
            }
            birth?.();
            let mask = 0;
            for (let k = 0; k < triggers.length; k++) {
                const inside = triggers[k]!.contains(p), wasInside = !!(masks[i]! & (1 << k));
                if (inside !== wasInside) emit(inside ? "enter" : "exit", triggers[k]!.id);
                if (inside) mask |= 1 << k;
            }
            if (triggers.length) masks[i] = mask;
        },
        upload(i: number, buffers: THREE.InstancedBufferAttribute[]) { for (let k = 0; k < attributes.length; k++) { const a = attributes[k]!; for (let j = 0; j < a.size; j++) buffers[k]!.array[i * a.size + j] = data[i * stride + a.offset + j]!; } },
    };
}
