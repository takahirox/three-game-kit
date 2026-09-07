import * as THREE from "three";
import { defineFeatureConfiguration, type ClientFeatureDescriptor, type ClientFeatureSetupContext } from "@three-game-kit/core";

export interface ParticleVector3 { readonly x: number; readonly y: number; readonly z: number }
export interface ParticleSceneParent { readonly isObject3D: true }
export interface ParticleCamera { readonly isCamera: boolean }
/** Borrowed Three.js texture; the emitter never disposes it. */
export interface ParticleTexture { readonly isTexture: true }
export type ParticleRange = number | readonly [number, number];
export interface ParticleKeyframe { readonly time: number; readonly value: number }
export type ParticleCurve = readonly ParticleKeyframe[];
export type ParticleShape =
    | { readonly kind: "point" }
    | { readonly kind: "sphere"; readonly radius: number; readonly surface?: boolean }
    | { readonly kind: "box"; readonly halfExtents: ParticleVector3 }
    | { readonly kind: "cone"; readonly radius: number; readonly angle: number };
export interface ParticleBurst { readonly timeMs: number; readonly count: number }
export interface ParticleEmitterOptions {
    readonly capacity?: number;
    readonly seed?: number;
    /** Particles per second. The first automatic particle is born after 1/rate seconds. */
    readonly rate?: number;
    /** Automatic emission stops at this elapsed time; existing particles finish normally. */
    readonly durationMs?: number;
    readonly bursts?: readonly ParticleBurst[];
    readonly position?: ParticleVector3;
    /** Rotation in radians, XYZ Euler order. Applies to shape and initial velocity. */
    readonly rotation?: ParticleVector3;
    readonly shape?: ParticleShape;
    readonly simulationSpace?: "local" | "world";
    readonly lifetimeMs?: ParticleRange;
    readonly speed?: ParticleRange;
    readonly acceleration?: ParticleVector3;
    /** Linear drag in inverse seconds; integrated analytically. */
    readonly drag?: number;
    readonly size?: ParticleRange;
    readonly angle?: ParticleRange;
    readonly angularVelocity?: ParticleRange;
    readonly color?: number;
    /** Size and opacity curves are multipliers; color values are sRGB hex colors. */
    readonly sizeOverLife?: ParticleCurve;
    readonly opacityOverLife?: ParticleCurve;
    readonly colorOverLife?: ParticleCurve;
    readonly blending?: "normal" | "additive";
    readonly depthTest?: boolean;
    readonly texture?: ParticleTexture;
    /** Sprite sheet cells run left-to-right, bottom-to-top over each particle's life. */
    readonly spriteSheet?: { readonly columns: number; readonly rows: number; readonly cycles?: number };
}
export interface ParticleEmission {
    readonly position?: ParticleVector3;
    readonly lifetimeMs?: ParticleRange;
    readonly speed?: ParticleRange;
    readonly size?: ParticleRange;
    readonly color?: number;
    readonly seed?: number;
}
export interface ParticleInspection {
    readonly disposed: boolean;
    readonly emitting: boolean;
    readonly presentationTimeMs: number | null;
    readonly activeParticleCount: number;
    readonly capacity: number;
    readonly emittedParticleCount: number;
    readonly droppedParticleCount: number;
    readonly expiredParticleCount: number;
    readonly liveResourceCounts: { readonly objects: number; readonly geometries: number; readonly materials: number };
}
export interface ParticleEmitter {
    /** Absolute monotonic milliseconds. First call establishes automatic emission time zero. */
    present(timestampMs: number): void;
    /** Immediately emits at the last presentation time (or time zero before the first present). Returns accepted count. */
    emit(count: number, overrides?: ParticleEmission): number;
    /** Affects future particles; local particles also follow the borrowed parent transform. */
    setTransform(position: ParticleVector3, rotation?: ParticleVector3): void;
    /** Stopped automatic emissions are skipped; live particles continue to age. */
    setEmitting(emitting: boolean): void;
    /** Optional back-to-front alpha sorting. Call after present/camera movement and before rendering. */
    sort(camera: ParticleCamera): void;
    /** Removes live particles without rewinding the clock, schedule, or random sequence. */
    clear(): void;
    /** Clears particles and restarts automatic emission and the seed sequence at the last presentation time. */
    restart(): void;
    inspect(): ParticleInspection;
    dispose(): void;
}

const LIMIT = 65536;
const MAX_TIME = 1e12;
const MAX_VALUE = 1e6;
function number(value: number, min: number, max: number, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
        throw new TypeError(`${label} must be finite and between ${min} and ${max}`);
    return value;
}
function integer(value: number, min: number, max: number, label: string): number {
    number(value, min, max, label);
    if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be an integer`);
    return value;
}
function record(value: object, keys: readonly string[], label: string): void {
    if (typeof value !== "object" || value === null || Array.isArray(value) ||
        !Reflect.ownKeys(value).every(key => typeof key === "string" && keys.includes(key) && (value as Record<string, unknown>)[key] !== null))
        throw new TypeError(`${label} has invalid fields`);
}
function vector(value: ParticleVector3, label: string): THREE.Vector3 {
    record(value, ["x", "y", "z"], label);
    return new THREE.Vector3(number(value.x, -MAX_VALUE, MAX_VALUE, label), number(value.y, -MAX_VALUE, MAX_VALUE, label), number(value.z, -MAX_VALUE, MAX_VALUE, label));
}
function range(value: ParticleRange, min: number, max: number, label: string): readonly [number, number] {
    if (typeof value === "number") return [number(value, min, max, label), value];
    if (!Array.isArray(value) || value.length !== 2) throw new TypeError(`${label} must be a number or [min, max]`);
    return [number(value[0], min, max, label), number(value[1], value[0], max, label)];
}
function curve(value: ParticleCurve, min: number, max: number, label: string, color = false): ParticleCurve {
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
function sample(keys: ParticleCurve, t: number): number {
    for (let i = 1; i < keys.length; i++) {
        const a = keys[i - 1]!, b = keys[i]!;
        if (t <= b.time) return a.value + (b.value - a.value) * (t - a.time) / (b.time - a.time);
    }
    return keys[keys.length - 1]!.value;
}
function addCount(a: number, b: number): number { return Math.min(Number.MAX_SAFE_INTEGER, a + b); }
const flat: ParticleCurve = [{ time: 0, value: 1 }, { time: 1, value: 1 }];
const fade: ParticleCurve = [{ time: 0, value: 1 }, { time: 1, value: 0 }];
const zero = { x: 0, y: 0, z: 0 };

/** Fixed-capacity CPU simulation and one instanced billboard draw per emitter. */
export function createParticleEmitter(parent: ParticleSceneParent, options: ParticleEmitterOptions = {}): ParticleEmitter {
    if (!(parent instanceof THREE.Object3D)) throw new TypeError("Particle parent must be a Three.js Object3D");
    record(options, ["capacity", "seed", "rate", "durationMs", "bursts", "position", "rotation", "shape", "simulationSpace", "lifetimeMs", "speed", "acceleration", "drag", "size", "angle", "angularVelocity", "color", "sizeOverLife", "opacityOverLife", "colorOverLife", "blending", "depthTest", "texture", "spriteSheet"], "Particle options");
    const sceneParent = parent;
    const capacity = integer(options.capacity ?? 1024, 1, LIMIT, "capacity");
    const seed = integer(options.seed ?? 1, 0, 0xffffffff, "seed");
    const rate = number(options.rate ?? 0, 0, MAX_VALUE, "rate");
    const duration = number(options.durationMs ?? MAX_TIME, 0, MAX_TIME, "durationMs");
    const life = range(options.lifetimeMs ?? 1000, 0.001, MAX_VALUE, "lifetimeMs");
    const speed = range(options.speed ?? 1, 0, MAX_VALUE, "speed");
    const size = range(options.size ?? 0.1, 0, MAX_VALUE, "size");
    const angle = range(options.angle ?? 0, -MAX_VALUE, MAX_VALUE, "angle");
    const spin = range(options.angularVelocity ?? 0, -MAX_VALUE, MAX_VALUE, "angularVelocity");
    const baseColor = integer(options.color ?? 0xffffff, 0, 0xffffff, "color");
    const acceleration = vector(options.acceleration ?? zero, "acceleration");
    const drag = number(options.drag ?? 0, 0, MAX_VALUE, "drag");
    let origin = vector(options.position ?? zero, "position");
    const initialRotation = vector(options.rotation ?? zero, "rotation");
    const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(initialRotation.x, initialRotation.y, initialRotation.z));
    const space = options.simulationSpace ?? "local";
    if (space !== "local" && space !== "world") throw new TypeError("Invalid simulationSpace");
    const blending = options.blending ?? "normal";
    if (blending !== "normal" && blending !== "additive") throw new TypeError("Invalid blending");
    if (options.depthTest !== undefined && typeof options.depthTest !== "boolean") throw new TypeError("depthTest must be boolean");
    if (options.texture !== undefined && !(options.texture instanceof THREE.Texture)) throw new TypeError("texture must be a Three.js Texture");
    const sizeKeys = curve(options.sizeOverLife ?? flat, 0, MAX_VALUE, "sizeOverLife");
    const opacityKeys = curve(options.opacityOverLife ?? fade, 0, 1, "opacityOverLife");
    const colorKeys = options.colorOverLife === undefined ? undefined : curve(options.colorOverLife, 0, 0xffffff, "colorOverLife", true);
    const colors = colorKeys?.map(key => new THREE.Color(key.value));
    const sheet = options.spriteSheet ?? { columns: 1, rows: 1 };
    record(sheet, ["columns", "rows", "cycles"], "spriteSheet");
    const columns = integer(sheet.columns, 1, 256, "columns");
    const rows = integer(sheet.rows, 1, 256, "rows");
    const cycles = number(sheet.cycles ?? 1, 0.001, MAX_VALUE, "cycles");
    const shape = options.shape ?? { kind: "point" };
    record(shape, ["kind", "radius", "surface", "halfExtents", "angle"], "shape");
    // Copy every mutable input before allocating scene resources.
    let radius = 0, coneAngle = 0, surface = false;
    const extents = new THREE.Vector3();
    switch (shape.kind) {
        case "point": record(shape, ["kind"], "shape"); break;
        case "sphere":
            record(shape, ["kind", "radius", "surface"], "shape");
            radius = number(shape.radius, 0, MAX_VALUE, "radius");
            if (shape.surface !== undefined && typeof shape.surface !== "boolean") throw new TypeError("surface must be boolean");
            surface = shape.surface ?? false; break;
        case "box":
            record(shape, ["kind", "halfExtents"], "shape");
            extents.copy(vector(shape.halfExtents, "halfExtents"));
            if (Math.min(extents.x, extents.y, extents.z) < 0) throw new TypeError("halfExtents must be non-negative");
            break;
        case "cone":
            record(shape, ["kind", "radius", "angle"], "shape");
            radius = number(shape.radius, 0, MAX_VALUE, "radius");
            coneAngle = number(shape.angle, 0, Math.PI, "cone angle"); break;
        default: throw new TypeError("Invalid particle shape");
    }
    const shapeKind = shape.kind;
    if (options.bursts !== undefined && (!Array.isArray(options.bursts) || options.bursts.length > 64)) throw new TypeError("bursts requires at most 64 entries");
    const bursts = Array.from(options.bursts ?? [], burst => {
        record(burst, ["timeMs", "count"], "burst");
        return { timeMs: number(burst.timeMs, 0, MAX_TIME, "burst timeMs"), count: integer(burst.count, 1, LIMIT, "burst count") };
    }).sort((a, b) => a.timeMs - b.timeMs);

    // Dense active prefix. Swap-removal touches only one particle, never allocates.
    const born = new Float64Array(capacity), lifetime = new Float64Array(capacity);
    const positions = new Float64Array(capacity * 3), velocities = new Float64Array(capacity * 3);
    const sizes = new Float64Array(capacity), angles = new Float64Array(capacity), spins = new Float64Array(capacity);
    const particleColors = new Float32Array(capacity * 3);
    const centers = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const appearances = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const dimensions = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.setAttribute("particleCenter", centers);
    geometry.setAttribute("particleAppearance", appearances);
    geometry.setAttribute("particleDimensions", dimensions);
    geometry.instanceCount = 0;
    const material = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, depthTest: options.depthTest ?? true,
        blending: blending === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: { particleMap: { value: options.texture ?? null }, sheet: { value: new THREE.Vector2(columns, rows) } },
        defines: { ...(options.texture ? { PARTICLE_TEXTURE: 1 } : {}), ...(space === "world" ? { WORLD_SPACE: 1 } : {}) },
        vertexShader: `
            attribute vec3 particleCenter;
            attribute vec4 particleAppearance;
            attribute vec3 particleDimensions;
            uniform vec2 sheet;
            varying vec2 vParticleUv;
            varying vec2 vQuadUv;
            varying vec4 vAppearance;
            void main() {
                float c = cos(particleDimensions.y), s = sin(particleDimensions.y);
                vec2 offset = mat2(c, s, -s, c) * position.xy * particleDimensions.x;
                #ifdef WORLD_SPACE
                    vec4 center = viewMatrix * vec4(particleCenter, 1.0);
                #else
                    vec4 center = modelViewMatrix * vec4(particleCenter, 1.0);
                    offset *= length(modelMatrix[0].xyz);
                #endif
                gl_Position = projectionMatrix * (center + vec4(offset, 0.0, 0.0));
                float frame = particleDimensions.z;
                vParticleUv = (uv + vec2(mod(frame, sheet.x), floor(frame / sheet.x))) / sheet;
                vQuadUv = uv;
                vAppearance = particleAppearance;
            }`,
        fragmentShader: `
            uniform sampler2D particleMap;
            varying vec2 vParticleUv;
            varying vec2 vQuadUv;
            varying vec4 vAppearance;
            void main() {
                vec4 color = vAppearance;
                #ifdef PARTICLE_TEXTURE
                    color *= texture2D(particleMap, vParticleUv);
                #else
                    float r = length(vQuadUv - 0.5) * 2.0;
                    color.a *= 1.0 - smoothstep(0.65, 1.0, r);
                #endif
                if (color.a <= 0.001) discard;
                gl_FragColor = color;
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "three-game-kit-particles";
    // Billboard offsets and world-space centers are shader generated, so CPU bounds are invalid.
    mesh.frustumCulled = false;
    mesh.visible = false;
    parent.add(mesh);
    const p = new THREE.Vector3(), v = new THREE.Vector3(), tint = new THREE.Color();
    const worldMatrix = new THREE.Matrix4();
    let sortScratch: { order: Uint32Array; depths: Float64Array; attributes: Float32Array[] } | undefined;
    const sortMatrix = new THREE.Matrix4();
    let active = 0, disposed = false, emitting = true;
    let presentationTimeMs: number | null = null, startTimeMs = 0, elapsed = 0;
    let rateIndex = 1, burstIndex = 0, sequence = 0;
    let emitted = 0, dropped = 0, expired = 0;
    function live(): void { if (disposed) throw new Error("Particle emitter has been disposed"); }
    let randomState = 0;
    function random(): number { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; }
    const scalarArrays = [born, lifetime, sizes, angles, spins];
    const vectorArrays = [positions, velocities, particleColors];
    const attributes = [centers, appearances, dimensions];
    function remove(index: number): void {
        active--;
        for (const array of scalarArrays) array[index] = array[active]!;
        for (const array of vectorArrays) {
            for (let j = 0; j < 3; j++) array[index * 3 + j] = array[active * 3 + j]!;
        }
    }
    function expireAt(time: number): void {
        for (let i = active - 1; i >= 0; i--) if (time - born[i]! >= lifetime[i]!) { remove(i); expired = addCount(expired, 1); }
    }
    function spawn(count: number, time: number, location: THREE.Vector3, lifetimeRange: readonly [number, number], speedRange: readonly [number, number], sizeRange: readonly [number, number], color: number, localSeed: number, sequenceBase = sequence): number {
        const accepted = Math.min(count, capacity - active);
        tint.setHex(color);
        if (space === "world") { sceneParent.updateWorldMatrix(true, false); worldMatrix.copy(sceneParent.matrixWorld); }
        for (let n = 0; n < accepted; n++) {
            randomState = (localSeed ^ Math.imul(sequenceBase + n, 0x9e3779b1)) >>> 0;
            const azimuth = random() * Math.PI * 2;
            const y = shapeKind === "cone" ? 1 - random() * (1 - Math.cos(coneAngle)) : 2 * random() - 1;
            const radial = Math.sqrt(Math.max(0, 1 - y * y));
            v.set(Math.cos(azimuth) * radial, y, Math.sin(azimuth) * radial);
            p.set(0, 0, 0);
            if (shapeKind === "sphere") p.copy(v).multiplyScalar(radius * (surface ? 1 : Math.cbrt(random())));
            else if (shapeKind === "box") p.set((random() * 2 - 1) * extents.x, (random() * 2 - 1) * extents.y, (random() * 2 - 1) * extents.z);
            else if (shapeKind === "cone") { const r = radius * Math.sqrt(random()), a = random() * Math.PI * 2; p.set(r * Math.cos(a), 0, r * Math.sin(a)); }
            p.applyQuaternion(orientation).add(location);
            v.applyQuaternion(orientation).multiplyScalar(speedRange[0] + random() * (speedRange[1] - speedRange[0]));
            if (space === "world") {
                p.applyMatrix4(worldMatrix);
                const e = worldMatrix.elements, x = v.x, y = v.y, z = v.z;
                v.set(e[0]! * x + e[4]! * y + e[8]! * z, e[1]! * x + e[5]! * y + e[9]! * z, e[2]! * x + e[6]! * y + e[10]! * z);
            }
            const i = active++;
            positions[i * 3] = p.x; positions[i * 3 + 1] = p.y; positions[i * 3 + 2] = p.z;
            velocities[i * 3] = v.x; velocities[i * 3 + 1] = v.y; velocities[i * 3 + 2] = v.z;
            born[i] = time;
            lifetime[i] = lifetimeRange[0] + random() * (lifetimeRange[1] - lifetimeRange[0]);
            sizes[i] = sizeRange[0] + random() * (sizeRange[1] - sizeRange[0]);
            angles[i] = angle[0] + random() * (angle[1] - angle[0]);
            spins[i] = spin[0] + random() * (spin[1] - spin[0]);
            particleColors[i * 3] = tint.r; particleColors[i * 3 + 1] = tint.g; particleColors[i * 3 + 2] = tint.b;
        }
        sequence = (sequence + count) >>> 0;
        emitted = addCount(emitted, accepted); dropped = addCount(dropped, count - accepted);
        return accepted;
    }
    function upload(): void {
        for (let i = 0; i < active; i++) {
            const seconds = (elapsed - born[i]!) / 1000, progress = (elapsed - born[i]!) / lifetime[i]!;
            const decay = drag === 0 ? seconds : -Math.expm1(-drag * seconds) / drag;
            const x = drag * seconds;
            const force = x < 0.001 ? seconds * seconds * (0.5 - x / 6 + x * x / 24 - x * x * x / 120) : (seconds - decay) / drag;
            const j = i * 3;
            centers.setXYZ(i, positions[j]! + velocities[j]! * decay + acceleration.x * force,
                positions[j + 1]! + velocities[j + 1]! * decay + acceleration.y * force,
                positions[j + 2]! + velocities[j + 2]! * decay + acceleration.z * force);
            tint.setRGB(particleColors[j]!, particleColors[j + 1]!, particleColors[j + 2]!);
            if (colorKeys && colors) {
                for (let k = 1; k < colorKeys.length; k++) if (progress <= colorKeys[k]!.time) {
                    const a = colorKeys[k - 1]!, b = colorKeys[k]!;
                    // Interpolate in linear working color space, then multiply by initial tint.
                    const t = (progress - a.time) / (b.time - a.time);
                    const ca = colors[k - 1]!, cb = colors[k]!;
                    tint.setRGB(particleColors[j]! * (ca.r + (cb.r - ca.r) * t), particleColors[j + 1]! * (ca.g + (cb.g - ca.g) * t), particleColors[j + 2]! * (ca.b + (cb.b - ca.b) * t));
                    break;
                }
            }
            appearances.setXYZW(i, tint.r, tint.g, tint.b, sample(opacityKeys, progress));
            const frame = Math.min(columns * rows - 1, Math.floor((progress * cycles % 1) * columns * rows));
            dimensions.setXYZ(i, sizes[i]! * sample(sizeKeys, progress), angles[i]! + spins[i]! * seconds, frame);
        }
        for (const attribute of attributes) {
            attribute.clearUpdateRanges();
            if (active > 0) { attribute.addUpdateRange(0, active * attribute.itemSize); attribute.needsUpdate = true; }
        }
        geometry.instanceCount = active; mesh.visible = active > 0;
    }
    return Object.freeze({
        present(timestampMs: number): void {
            live(); number(timestampMs, 0, Number.MAX_SAFE_INTEGER, "presentation time");
            if (presentationTimeMs !== null && timestampMs < presentationTimeMs) throw new TypeError("Particle presentation time must be monotonic");
            if (presentationTimeMs === null) startTimeMs = timestampMs;
            presentationTimeMs = timestampMs; elapsed = timestampMs - startTimeMs;
            const end = Math.min(elapsed, duration);
            const lastRateIndex = Math.floor(end * rate / 1000);
            // Skip births guaranteed dead at this presentation, arithmetically even after a long hitch.
            const deadRateIndex = Math.min(lastRateIndex, Math.floor((elapsed - life[1]) * rate / 1000));
            const skip = Math.max(0, deadRateIndex - rateIndex + 1);
            rateIndex += skip; sequence = (sequence + skip) >>> 0; dropped = addCount(dropped, skip);
            expireAt(elapsed);
            let budget = capacity;
            while (rateIndex <= lastRateIndex || (burstIndex < bursts.length && bursts[burstIndex]!.timeMs <= end)) {
                const burst = bursts[burstIndex];
                const rateTime = rateIndex <= lastRateIndex ? rateIndex * 1000 / rate : Infinity;
                const isBurst = burst !== undefined && burst.timeMs <= end && burst.timeMs <= rateTime;
                const time = isBurst ? burst!.timeMs : rateTime;
                const count = isBurst ? burst!.count : 1;
                if (isBurst) burstIndex++; else rateIndex++;
                if (emitting && budget > 0 && elapsed - time < life[1]) {
                    const attempts = Math.min(count, budget);
                    spawn(attempts, time, origin, life, speed, size, baseColor, seed);
                    sequence = (sequence + count - attempts) >>> 0;
                    dropped = addCount(dropped, count - attempts); budget -= attempts;
                } else { sequence = (sequence + count) >>> 0; dropped = addCount(dropped, count); }
                if (budget === 0 || !emitting) {
                    const remaining = Math.max(0, lastRateIndex - rateIndex + 1);
                    sequence = (sequence + remaining) >>> 0; dropped = addCount(dropped, remaining); rateIndex = lastRateIndex + 1;
                }
            }
            expireAt(elapsed); upload();
        },
        emit(count: number, overrides: ParticleEmission = {}): number {
            live(); integer(count, 0, LIMIT, "count");
            record(overrides, ["position", "lifetimeMs", "speed", "size", "color", "seed"], "emission");
            const location = overrides.position === undefined ? origin : vector(overrides.position, "position");
            const l = overrides.lifetimeMs === undefined ? life : range(overrides.lifetimeMs, 0.001, MAX_VALUE, "lifetimeMs");
            const s = overrides.speed === undefined ? speed : range(overrides.speed, 0, MAX_VALUE, "speed");
            const z = overrides.size === undefined ? size : range(overrides.size, 0, MAX_VALUE, "size");
            const c = integer(overrides.color ?? baseColor, 0, 0xffffff, "color");
            const r = integer(overrides.seed ?? seed, 0, 0xffffffff, "seed");
            const accepted = spawn(count, elapsed, location, l, s, z, c, r, overrides.seed === undefined ? sequence : 0); upload(); return accepted;
        },
        setTransform(position: ParticleVector3, rotation: ParticleVector3 = zero): void {
            live(); const next = vector(position, "position"), r = vector(rotation, "rotation");
            origin = next; orientation.setFromEuler(new THREE.Euler(r.x, r.y, r.z));
        },
        setEmitting(value: boolean): void { live(); if (typeof value !== "boolean") throw new TypeError("emitting must be boolean"); emitting = value; },
        sort(camera: ParticleCamera): void {
            live();
            if (!(camera instanceof THREE.Camera)) throw new TypeError("sort camera must be a Three.js Camera");
            if (active < 2) return;
            sortScratch ??= { order: new Uint32Array(capacity), depths: new Float64Array(capacity), attributes: attributes.map(a => new Float32Array(a.array.length)) };
            camera.updateWorldMatrix(true, false);
            sceneParent.updateWorldMatrix(true, false);
            sortMatrix.copy(camera.matrixWorldInverse);
            if (space === "local") sortMatrix.multiply(sceneParent.matrixWorld);
            const e = sortMatrix.elements, scratch = sortScratch;
            for (let i = 0; i < active; i++) {
                scratch.order[i] = i;
                scratch.depths[i] = e[2]! * centers.getX(i) + e[6]! * centers.getY(i) + e[10]! * centers.getZ(i) + e[14]!;
            }
            const order = scratch.order.subarray(0, active);
            order.sort((a, b) => scratch.depths[a]! - scratch.depths[b]! || a - b);
            for (let k = 0; k < attributes.length; k++) {
                const attribute = attributes[k]!, temporary = scratch.attributes[k]!;
                const components = attribute.itemSize;
                temporary.set(attribute.array.subarray(0, active * components));
                for (let i = 0; i < active; i++) for (let j = 0; j < components; j++) attribute.array[i * components + j] = temporary[order[i]! * components + j]!;
                attribute.clearUpdateRanges();
                attribute.addUpdateRange(0, active * components);
                attribute.needsUpdate = true;
            }
        },
        clear(): void { live(); active = 0; upload(); },
        restart(): void { live(); active = 0; elapsed = 0; startTimeMs = presentationTimeMs ?? 0; rateIndex = 1; burstIndex = 0; sequence = 0; emitting = true; upload(); },
        inspect(): ParticleInspection {
            return Object.freeze({ disposed, emitting: !disposed && emitting, presentationTimeMs, activeParticleCount: active, capacity,
                emittedParticleCount: emitted, droppedParticleCount: dropped, expiredParticleCount: expired,
                liveResourceCounts: Object.freeze({ objects: disposed ? 0 : 1, geometries: disposed ? 0 : 1, materials: disposed ? 0 : 1 }) });
        },
        dispose(): void {
            if (disposed) return;
            disposed = true; active = 0; geometry.instanceCount = 0; mesh.visible = false;
            mesh.removeFromParent(); geometry.dispose(); material.dispose(); material.uniforms.particleMap!.value = null; sortScratch = undefined;
        },
    });
}

/** Owns a fixed set of emitters in the client presentation schedule. */
export function createParticleFeature(options: { readonly emitters: readonly ParticleEmitter[] }): ClientFeatureDescriptor<Readonly<Record<string, never>>> {
    record(options, ["emitters"], "Particle feature options");
    if (!Array.isArray(options.emitters) || new Set(options.emitters).size !== options.emitters.length ||
        Array.from(options.emitters).some(e => !e || typeof e.present !== "function" || typeof e.dispose !== "function")) throw new TypeError("Invalid emitters");
    const emitters = [...options.emitters];
    let active = false, disposed = false;
    const contribution = Object.freeze({ kind: "system" as const, id: "particles-present", domain: "client-presentation" as const, phase: "render" as const, priority: -100,
        run({ timestampMs }: { readonly timestampMs: number }): void { if (active) for (const emitter of emitters) emitter.present(timestampMs); } });
    return Object.freeze({
        id: "particles", description: "Presents bounded instanced particle emitters", requires: [], conflicts: [], runtimeContributions: [contribution],
        configuration: defineFeatureConfiguration<Readonly<Record<string, never>>>({ defaultValue: () => Object.freeze({}), parse(input: unknown) {
            if (typeof input === "object" && input !== null && !Array.isArray(input) && Reflect.ownKeys(input).length === 0) return { ok: true, value: Object.freeze({}) };
            return { ok: false, issues: [{ path: [], code: "empty-object-required" }] };
        } }),
        setup({ ledger }: ClientFeatureSetupContext<Readonly<Record<string, never>>>): void {
            if (disposed) throw new Error("Particle feature has been disposed");
            for (let i = 0; i < emitters.length; i++) ledger.acquire({ resourceId: `particle-emitter-${i}`, kind: "renderResources", value: emitters[i]!, release: () => emitters[i]!.dispose() });
            ledger.activateSystem(contribution.id); active = true;
        },
        dispose(): void { if (disposed) return; active = false; disposed = true; for (const emitter of emitters) emitter.dispose(); },
    });
}
