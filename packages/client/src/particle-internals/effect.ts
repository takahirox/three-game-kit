import * as THREE from "three";
import { createParticleEmitter } from "../particles.js";
import type { ParticleCamera, ParticleEmission, ParticleEmitter, ParticleEmitterOptions, ParticleEvent, ParticleParameters, ParticleSceneParent, ParticleTexture, ParticleVector3 } from "./types.js";
import { integer, number, record, vector } from "./validation.js";
import { emitterAccess } from "./access.js";
import { createBatches } from "./batch.js";

export interface ParticleEffectDefinition {
    readonly emitters: readonly { readonly id: string; readonly options: Omit<ParticleEmitterOptions, "texture"> & { readonly texture?: string } }[];
    /** Acyclic graph. Child events are delivered in topological order in the same presentation. */
    readonly subEmitters?: readonly {
        readonly source: string; readonly target: string; readonly event: ParticleEvent["kind"];
        readonly count: number; readonly inheritVelocity?: number;
    }[];
}
export interface ParticleEffect {
    present(timestampMs: number): void;
    emit(id: string, count: number, overrides?: ParticleEmission): number;
    pause(): void;
    play(): void;
    setEmitting(value: boolean): void;
    setTimeScale(scale: number): void;
    setParameters(parameters: ParticleParameters): void;
    setTransform(position: ParticleVector3, rotation?: ParticleVector3): void;
    prewarm(durationMs: number): void;
    clear(): void;
    restart(): void;
    /** Only affects draws; simulation and sub-emitter events continue. */
    cull(camera: ParticleCamera): void;
    sort(camera: ParticleCamera): void;
    inspect(): { readonly disposed: boolean; readonly capacity: number; readonly activeParticleCount: number; readonly drawSavings: number; readonly droppedSubEmitterCount: number; readonly emitters: readonly { readonly id: string; readonly state: ReturnType<ParticleEmitter["inspect"]> }[] };
    dispose(): void;
}
export interface ParticleEffectOptions {
    readonly textures?: Readonly<Record<string, ParticleTexture>>;
    /** Maximum reserved capacity, including all sub-emitters. */
    readonly maxParticles?: number;
    /** Compatible additive emitters share draws; alpha layers retain their ordering. */
    readonly batch?: boolean;
}

function cloneData(value: unknown, depth = 0): unknown {
    if (depth > 20) throw new TypeError("effect definition is too deeply nested");
    if (typeof value === "number") return number(value, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "definition number");
    if (typeof value === "string" || typeof value === "boolean") return value;
    if (Array.isArray(value)) {
        if (value.length > 196608) throw new TypeError("definition array is too large");
        return Object.freeze(Array.from(value, v => cloneData(v, depth + 1)));
    }
    if (value && Object.getPrototypeOf(value) === Object.prototype) {
        if (Object.getOwnPropertySymbols(value).length) throw new TypeError("effect definitions cannot contain symbol keys");
        return Object.freeze(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cloneData(v, depth + 1)])));
    }
    throw new TypeError("effect definitions must contain plain JSON data without null");
}

/** Copies a serializable preset. Emitter options are validated when the effect is instantiated. */
export function defineParticleEffect(input: ParticleEffectDefinition): ParticleEffectDefinition {
    record(input, ["emitters", "subEmitters"], "effect definition");
    if (!Array.isArray(input.emitters) || input.emitters.length < 1 || input.emitters.length > 64) throw new TypeError("effect requires 1–64 emitters");
    const ids = new Set<string>();
    for (const e of input.emitters) {
        record(e, ["id", "options"], "effect emitter");
        if (typeof e.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(e.id) || ids.has(e.id)) throw new TypeError("effect emitter IDs must be unique identifiers");
        ids.add(e.id);
        if (!e.options || typeof e.options !== "object") throw new TypeError("effect emitter options required");
    }
    if (input.subEmitters !== undefined && (!Array.isArray(input.subEmitters) || input.subEmitters.length > 64)) throw new TypeError("effect requires at most 64 sub-emitter links");
    for (const link of input.subEmitters ?? []) {
        record(link, ["source", "target", "event", "count", "inheritVelocity"], "sub-emitter link");
        if (!ids.has(link.source) || !ids.has(link.target)) throw new TypeError("sub-emitter source and target must exist");
        if (!["birth", "death", "collision"].includes(link.event)) throw new TypeError("Invalid sub-emitter event");
        integer(link.count, 1, 65536, "sub-emitter count"); number(link.inheritVelocity ?? 0, 0, 1, "sub-emitter inheritVelocity");
    }
    const visited = new Set<string>(), visiting = new Set<string>();
    function visit(id: string) {
        if (visiting.has(id)) throw new TypeError("sub-emitter graph must be acyclic");
        if (visited.has(id)) return;
        visiting.add(id); for (const link of input.subEmitters ?? []) if (link.source === id) visit(link.target);
        visiting.delete(id); visited.add(id);
    }
    for (const id of ids) visit(id);
    return cloneData(input) as ParticleEffectDefinition;
}

export function createParticleEffect(parent: ParticleSceneParent, input: ParticleEffectDefinition, options: ParticleEffectOptions = {}): ParticleEffect {
    if (!(parent instanceof THREE.Object3D)) throw new TypeError("effect parent must be a Three.js Object3D");
    record(options, ["textures", "maxParticles", "batch"], "effect options");
    if (options.batch !== undefined && typeof options.batch !== "boolean") throw new TypeError("batch must be boolean");
    const definition = defineParticleEffect(input);
    const capacity = definition.emitters.reduce((sum, e) => sum + integer(e.options.capacity ?? 1024, 1, 65536, "capacity"), 0);
    if (capacity > integer(options.maxParticles ?? 1048576, 1, 1048576, "maxParticles")) throw new RangeError("effect exceeds particle capacity budget");
    const group = new THREE.Group(); group.name = "three-game-kit-particle-effect"; parent.add(group);
    const emitters = new Map<string, ParticleEmitter>();
    const links = definition.subEmitters ?? [];
    const configs = new Map(definition.emitters.map(e => [e.id, e]));
    const outgoing = new Map(definition.emitters.map(e => [e.id, links.filter(l => l.source === e.id)]));
    const ordered: string[] = [], visited = new Set<string>();
    function order(id: string) { if (visited.has(id)) return; visited.add(id); for (const link of links) if (link.source === id) order(link.target); ordered.unshift(id); }
    for (const e of definition.emitters) order(e.id);
    let batches: ReturnType<typeof createBatches> | undefined;
    try {
        for (const e of definition.emitters) {
            const { texture: textureId, ...config } = e.options;
            const texture = textureId === undefined ? undefined : options.textures?.[textureId];
            if (textureId !== undefined && !texture) throw new TypeError(`Missing particle texture: ${textureId}`);
            emitters.set(e.id, createParticleEmitter(group, { ...config, ...(texture ? { texture } : {}), ...(links.some(l => l.source === e.id) ? { events: true } : {}) }));
        }
        if (options.batch ?? true) batches = createBatches(group);
    } catch (error) { for (const e of emitters.values()) e.dispose(); group.removeFromParent(); throw error; }
    let disposed = false, droppedSubEmitterCount = 0;
    const routed = new Map<string, number>();
    const sourcePosition = new THREE.Vector3(), sourceVelocity = new THREE.Vector3(), inverse = new THREE.Matrix4(), normalMatrix = new THREE.Matrix3(), rotation = new THREE.Quaternion(), euler = new THREE.Euler();
    function live() { if (disposed) throw new Error("Particle effect has been disposed"); }
    function route(id: string) {
        const source = configs.get(id)!, sourceEmitter = emitters.get(id)!;
        const events = sourceEmitter.drainEvents(), sourceLinks = outgoing.get(id)!;
        if (!sourceLinks.length || !events.length) return;
        const sourceTime = sourceEmitter.inspect().elapsedMs;
        group.updateWorldMatrix(true, false); inverse.copy(group.matrixWorld).invert(); normalMatrix.setFromMatrix4(inverse);
        for (const event of events) for (const link of sourceLinks) if (link.event === event.kind) {
            const target = configs.get(link.target)!;
            const targetEmitter = emitters.get(link.target)!;
            const remaining = (target.options.capacity ?? 1024) - (routed.get(link.target) ?? 0), count = Math.min(link.count, remaining);
            droppedSubEmitterCount = Math.min(Number.MAX_SAFE_INTEGER, droppedSubEmitterCount + link.count - count);
            if (!count) continue;
            routed.set(link.target, (routed.get(link.target) ?? 0) + count);
            const ageMs = Math.max(0, sourceTime - event.timeMs);
            sourcePosition.copy(event.position); sourceVelocity.copy(event.velocity);
            // emit() expects parent-local birth coordinates, even for a world-space target.
            if (source.options.simulationSpace === "world") sourcePosition.applyMatrix4(inverse);
            const sourceWorld = source.options.simulationSpace === "world";
            // An explicit target velocity is transformed into simulation space by its emitter.
            if (sourceWorld) sourceVelocity.applyMatrix3(normalMatrix);
            if (link.inheritVelocity) {
                const r = target.options.rotation;
                rotation.setFromEuler(euler.set(r?.x ?? 0, r?.y ?? 0, r?.z ?? 0)).invert();
                sourceVelocity.applyQuaternion(rotation).multiplyScalar(link.inheritVelocity);
                emitterAccess.get(targetEmitter)!.emit(count, { position: sourcePosition, velocity: sourceVelocity }, ageMs);
            } else emitterAccess.get(targetEmitter)!.emit(count, { position: sourcePosition }, ageMs);
        }
    }
    function refresh() { for (const e of emitters.values()) emitterAccess.get(e)!.refresh(); batches?.update(); }
    function routeAll() {
        routed.clear();
        for (const id of ordered) { emitterAccess.get(emitters.get(id)!)!.flush(); route(id); }
    }
    const effect: ParticleEffect = Object.freeze({
        present(timestampMs: number) {
            live();
            // Advance every clock first, then route the DAG so downstream emit() uses this frame's time.
            for (const e of emitters.values()) e.present(timestampMs);
            routeAll();
            batches?.update();
        },
        emit(id: string, count: number, overrides?: ParticleEmission) { live(); const e = emitters.get(id); if (!e) throw new TypeError(`Unknown emitter: ${id}`); const accepted = e.emit(count, overrides); refresh(); return accepted; },
        pause() { live(); for (const e of emitters.values()) e.pause(); },
        play() { live(); for (const e of emitters.values()) e.play(); },
        setEmitting(value: boolean) { live(); if (typeof value !== "boolean") throw new TypeError("emitting must be boolean"); for (const e of emitters.values()) e.setEmitting(value); },
        setTimeScale(scale: number) { live(); number(scale, 0, 100, "timeScale"); for (const e of emitters.values()) e.setTimeScale(scale); },
        setParameters(parameters: ParticleParameters) { live(); for (const e of emitters.values()) e.setParameters(parameters); },
        setTransform(position: ParticleVector3, r: ParticleVector3 = { x: 0, y: 0, z: 0 }) { live(); const p = vector(position, "position"), rotation = vector(r, "rotation"); group.position.copy(p); group.rotation.set(rotation.x, rotation.y, rotation.z); },
        prewarm(durationMs: number) { live(); number(durationMs, 0, 1e6, "prewarmMs"); for (const e of emitters.values()) e.prewarm(durationMs); routeAll(); batches?.update(); },
        clear() { live(); for (const e of emitters.values()) { e.clear(); e.drainEvents(); } batches?.update(); },
        restart() { live(); for (const e of emitters.values()) e.restart(); batches?.update(); },
        cull(camera: ParticleCamera) { live(); if (!(camera instanceof THREE.Camera)) throw new TypeError("cull camera must be a Three.js Camera"); for (const e of emitters.values()) e.cull(camera); batches?.update(); },
        sort(camera: ParticleCamera) { live(); if (!(camera instanceof THREE.Camera)) throw new TypeError("sort camera must be a Three.js Camera"); for (const e of emitters.values()) { emitterAccess.get(e)!.refresh(); e.sort(camera); } batches?.update(); },
        inspect() { return Object.freeze({ disposed, capacity, activeParticleCount: [...emitters.values()].reduce((n, e) => n + e.inspect().activeParticleCount, 0), drawSavings: batches?.drawSavings ?? 0, droppedSubEmitterCount, emitters: [...emitters].map(([id, e]) => ({ id, state: e.inspect() })) }); },
        dispose() { if (disposed) return; disposed = true; batches?.dispose(); for (const e of emitters.values()) e.dispose(); group.removeFromParent(); },
    });
    batches?.update();
    return effect;
}

export interface ParticleSystemOptions extends ParticleEffectOptions {
    readonly camera?: ParticleCamera;
    readonly cull?: boolean;
    /** Distance bands in world units; density is 0–1. Last matching band wins. */
    readonly lod?: readonly { readonly distance: number; readonly emissionScale: number }[];
}
export interface ParticleSystem {
    createEffect(definition: ParticleEffectDefinition): ParticleEffect;
    present(timestampMs: number): void;
    pause(): void;
    play(): void;
    setTimeScale(scale: number): void;
    clear(): void;
    inspect(): { readonly disposed: boolean; readonly effectCount: number; readonly reservedParticles: number; readonly activeParticleCount: number; readonly maxParticles: number };
    dispose(): void;
}

/** Owns effects with a hard aggregate capacity budget, optional culling and distance LOD. */
export function createParticleSystem(parent: ParticleSceneParent, options: ParticleSystemOptions = {}): ParticleSystem {
    if (!(parent instanceof THREE.Object3D)) throw new TypeError("system parent must be a Three.js Object3D");
    record(options, ["textures", "maxParticles", "batch", "camera", "cull", "lod"], "system options");
    const maxParticles = integer(options.maxParticles ?? 65536, 1, 1048576, "maxParticles");
    const camera = options.camera as THREE.Camera | undefined, culling = options.cull ?? false, batch = options.batch ?? true;
    const textures = options.textures === undefined ? undefined : { ...options.textures };
    if (typeof batch !== "boolean") throw new TypeError("batch must be boolean");
    if (options.camera !== undefined && !(options.camera instanceof THREE.Camera)) throw new TypeError("system camera must be a Three.js Camera");
    if (options.cull !== undefined && typeof options.cull !== "boolean") throw new TypeError("cull must be boolean");
    if ((options.cull || options.lod) && !options.camera) throw new TypeError("culling and LOD require a camera");
    if (options.lod !== undefined && (!Array.isArray(options.lod) || options.lod.length > 16)) throw new TypeError("LOD requires at most 16 bands");
    let previousDistance = -1;
    const lod = Array.from(options.lod ?? [], l => { record(l, ["distance", "emissionScale"], "LOD"); const distance = number(l.distance, 0, 1e6, "LOD distance"); if (distance <= previousDistance) throw new TypeError("LOD distances must increase"); previousDistance = distance; return { distance, emissionScale: number(l.emissionScale, 0, 1, "LOD emissionScale") }; });
    const effects = new Map<ParticleEffect, THREE.Group>();
    let disposed = false, reserved = 0, lastTime: number | null = null, paused = false, scale = 1;
    const cameraPosition = new THREE.Vector3(), effectPosition = new THREE.Vector3();
    function live() { if (disposed) throw new Error("Particle system has been disposed"); }
    return Object.freeze({
        createEffect(definition: ParticleEffectDefinition) {
            live(); const host = new THREE.Group(); parent.add(host);
            let effect: ParticleEffect;
            try { effect = createParticleEffect(host, definition, { ...(textures ? { textures } : {}), batch, maxParticles: Math.max(1, maxParticles - reserved) }); }
            catch (error) { host.removeFromParent(); throw error; }
            const capacity = effect.inspect().capacity;
            if (reserved + capacity > maxParticles) { effect.dispose(); host.removeFromParent(); throw new RangeError("system exceeds particle capacity budget"); }
            reserved += capacity;
            effect.setTimeScale(scale); if (paused) effect.pause();
            if (lastTime !== null) effect.present(lastTime);
            const handle: ParticleEffect = Object.freeze({ ...effect, dispose() { if (!effects.delete(handle)) return; reserved -= capacity; effect.dispose(); host.removeFromParent(); } });
            effects.set(handle, host); return handle;
        },
        present(timestampMs: number) {
            live(); number(timestampMs, 0, Number.MAX_SAFE_INTEGER, "presentation time"); if (lastTime !== null && timestampMs < lastTime) throw new TypeError("Particle system time must be monotonic"); lastTime = timestampMs;
            if (camera) camera.getWorldPosition(cameraPosition);
            for (const [effect, host] of effects) {
                if (lod.length) {
                    host.children[0]!.getWorldPosition(effectPosition); const distance = cameraPosition.distanceTo(effectPosition);
                    let density = 1; for (const band of lod) if (distance >= band.distance) density = band.emissionScale;
                    effect.setParameters({ emissionScale: density });
                }
                effect.present(timestampMs); if (camera && culling) effect.cull(camera);
            }
        },
        pause() { live(); paused = true; for (const e of effects.keys()) e.pause(); },
        play() { live(); paused = false; for (const e of effects.keys()) e.play(); },
        setTimeScale(value: number) { live(); scale = number(value, 0, 100, "timeScale"); for (const e of effects.keys()) e.setTimeScale(scale); },
        clear() { live(); for (const e of effects.keys()) e.clear(); },
        inspect() { return Object.freeze({ disposed, effectCount: effects.size, reservedParticles: reserved, maxParticles, activeParticleCount: [...effects.keys()].reduce((n, e) => n + e.inspect().activeParticleCount, 0) }); },
        dispose() { if (disposed) return; disposed = true; for (const e of effects.keys()) e.dispose(); },
    });
}
