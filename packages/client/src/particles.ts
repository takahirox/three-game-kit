import * as THREE from "three";
import { defineFeatureConfiguration, type ClientFeatureDescriptor, type ClientFeatureSetupContext } from "@three-game-kit/core";

export * from "./particle-internals/types.js";
export { defineParticleEffect, createParticleEffect, createParticleSystem } from "./particle-internals/effect.js";
export type { ParticleEffectDefinition, ParticleEffect, ParticleEffectOptions, ParticleSystem, ParticleSystemOptions } from "./particle-internals/effect.js";
import type { ParticleCamera, ParticleTexture, ParticleVector2, ParticleForceField, ParticleCollisionOptions, ParticleCurve, ParticleEmission, ParticleEmitter, ParticleEmitterOptions, ParticleInspection, ParticleParameters, ParticleEvent, ParticleSceneParent, ParticleVector3, ParticleTrigger } from "./particle-internals/types.js";
import { emitterAccess } from "./particle-internals/access.js";
import { createRecordedEmitter } from "./particle-internals/recording.js";
import { createShape } from "./particle-internals/shapes.js";
import { createSchedule } from "./particle-internals/schedule.js";
import { createMotion } from "./particle-internals/motion.js";
import { createVariation, colorDistribution } from "./particle-internals/variation.js";
import { createRuntime } from "./particle-internals/runtime.js";
import { createRenderer } from "./particle-internals/renderer.js";
import { number, integer, record, vector, range, curve, distribution } from "./particle-internals/validation.js";

const LIMIT = 65536;
const MAX_TIME = 1e12;
const MAX_VALUE = 1e6;
function addCount(a: number, b: number): number { return Math.min(Number.MAX_SAFE_INTEGER, a + b); }
const flat: ParticleCurve = [{ time: 0, value: 1 }, { time: 1, value: 1 }];
const fade: ParticleCurve = [{ time: 0, value: 1 }, { time: 1, value: 0 }];
const zero = { x: 0, y: 0, z: 0 };

/** Seeded, fixed-capacity simulation with optional motion, collision, renderer and trail modules. */
export function createParticleEmitter(parent: ParticleSceneParent, options: ParticleEmitterOptions = {}): ParticleEmitter {
    if (!(parent instanceof THREE.Object3D)) throw new TypeError("Particle parent must be a Three.js Object3D");
    if (options.recording !== undefined) return createRecordedEmitter(parent, options, createParticleEmitter);
    record(options, ["capacity", "seed", "rate", "durationMs", "bursts", "position", "rotation", "shape", "simulationSpace", "lifetimeMs", "speed", "acceleration", "drag", "size", "angle", "angularVelocity", "color", "sizeOverLife", "opacityOverLife", "colorOverLife", "blending", "depthTest", "texture", "spriteSheet", "loop", "startDelayMs", "prewarmMs", "timeScale", "rateOverDistance", "velocity", "inheritVelocity", "velocityOverLife", "forceOverLife", "noise", "forceFields", "collision", "simulationStepMs", "maxSubSteps", "renderer", "trails", "events", "eventCapacity", "rateOverTime", "triggers", "limitVelocity", "sizeAxes", "rotation3D", "angularVelocity3D", "angularVelocityOverLife", "sizeBySpeed", "colorBySpeed", "rotationBySpeed", "startColors", "lighting", "customAttributes", "runtime", "inheritVelocityMode", "inheritVelocityOverLife", "orbitalVelocity", "orbitalOffset", "radialVelocity", "speedModifier", "sizeAxesOverLife", "angularVelocityAxesOverLife", "sizeAxesBySpeed", "angularVelocityAxesBySpeed", "castShadow", "receiveShadow", "recording"], "Particle options");
    if (options.runtime !== undefined) record(options.runtime, ["update", "meshPositions", "material", "trailTexture", "softParticles", "onComplete"], "runtime");
    options = { ...options, ...(options.runtime ? { runtime: { ...options.runtime, ...(options.runtime.softParticles ? { softParticles: { ...options.runtime.softParticles } } : {}) } } : {}) };
    const meshShape = options.shape?.kind === "mesh", renderKind = options.renderer?.kind;
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
    let baseColor = integer(options.color ?? 0xffffff, 0, 0xffffff, "color");
    let paletteEnabled = true;
    let emissionScale = 1, sizeScale = 1, speedScale = 1, densityRemainder = 0;
    let timeScale = number(options.timeScale ?? 1, 0, 100, "timeScale"), paused = false;
    const delay = number(options.startDelayMs ?? 0, 0, MAX_TIME, "startDelayMs");
    const initialPrewarm = number(options.prewarmMs ?? 0, 0, MAX_VALUE, "prewarmMs");
    const distanceRate = number(options.rateOverDistance ?? 0, 0, MAX_VALUE, "rateOverDistance");
    const inheritVelocity = number(options.inheritVelocity ?? 0, 0, 1, "inheritVelocity");
    const inheritMode = options.inheritVelocityMode ?? "initial";
    if (inheritMode !== "initial" && inheritMode !== "current") throw new TypeError("Invalid inheritVelocityMode");
    const inheritCurve = distribution(options.inheritVelocityOverLife ?? flat, -1e6, 1e6, "inheritVelocityOverLife");
    const changingInherit = inheritMode === "current" || !!options.inheritVelocityOverLife;
    const inheritedAtBirth = new Float64Array(changingInherit ? capacity * 3 : 0), inheritedApplied = new Float64Array(changingInherit ? capacity * 3 : 0);
    const initialVelocity = options.velocity === undefined ? undefined : vector(options.velocity, "velocity");
    if (options.loop !== undefined && typeof options.loop !== "boolean") throw new TypeError("loop must be boolean");
    if (options.loop && (options.durationMs === undefined || duration < 1)) throw new TypeError("loop requires durationMs >= 1");
    if (options.events !== undefined && typeof options.events !== "boolean") throw new TypeError("events must be boolean");
    const eventCapacity = integer(options.eventCapacity ?? Math.min(capacity * 4, 65536), 1, 65536, "eventCapacity");
    let motion = createMotion(options);
    const runtime = createRuntime(options, capacity);
    let fieldConfig = options.forceFields ? structuredClone(options.forceFields) : [], collisionConfig = options.collision ? structuredClone(options.collision) : { colliders: [] };
    const motionOptions = { ...options, ...(options.velocityOverLife ? { velocityOverLife: structuredClone(options.velocityOverLife) } : {}), ...(options.forceOverLife ? { forceOverLife: structuredClone(options.forceOverLife) } : {}), ...(options.noise ? { noise: structuredClone(options.noise) } : {}), ...(options.orbitalVelocity ? { orbitalVelocity: structuredClone(options.orbitalVelocity) } : {}), ...(options.radialVelocity ? { radialVelocity: structuredClone(options.radialVelocity) } : {}), ...(options.speedModifier ? { speedModifier: structuredClone(options.speedModifier) } : {}), ...(options.orbitalOffset ? { orbitalOffset: { ...options.orbitalOffset } } : {}) };
    const emitEvents = options.events ?? false, loop = options.loop ?? false;
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
    const sizeKeys = distribution(options.sizeOverLife ?? flat, 0, MAX_VALUE, "sizeOverLife");
    const opacityKeys = distribution(options.opacityOverLife ?? fade, 0, 1, "opacityOverLife");
    const colorSample = options.colorOverLife === undefined ? undefined : colorDistribution(options.colorOverLife, "colorOverLife");
    const sheet = options.spriteSheet ?? { columns: 1, rows: 1 };
    record(sheet, ["columns", "rows", "cycles", "startFrame", "fps", "row", "blend"], "spriteSheet");
    const columns = integer(sheet.columns, 1, 256, "columns");
    const rows = integer(sheet.rows, 1, 256, "rows");
    number(sheet.cycles ?? 1, 0.001, MAX_VALUE, "cycles");
    const variation = createVariation(options, capacity, columns, rows);
    let sampleShape = createShape(options.shape ?? { kind: "point" });
    const meshTemplate = options.shape?.kind === "mesh" ? structuredClone(options.shape) : undefined;
    function setMeshPositions(positions: readonly number[]): void {
        live(); if (!meshShape) throw new TypeError("setMeshPositions requires a mesh emission shape");
        sampleShape = createShape({ ...meshTemplate!, kind: "mesh", positions });
    }
    const rateKeys = options.rateOverTime === undefined ? undefined : curve(options.rateOverTime, 0, MAX_VALUE, "rateOverTime");
    if (rateKeys && (options.durationMs === undefined || duration <= 0)) throw new TypeError("rateOverTime requires a positive durationMs");
    if (options.bursts !== undefined && (!Array.isArray(options.bursts) || options.bursts.length > 64)) throw new TypeError("bursts requires at most 64 entries");
    const bursts = Array.from(options.bursts ?? [], burst => {
        record(burst, ["timeMs", "count", "cycles", "intervalMs", "probability"], "burst");
        const counts = range(burst.count, 1, LIMIT, "burst count"); counts.forEach(c => integer(c, 1, LIMIT, "burst count"));
        const cycles = integer(burst.cycles ?? 1, 1, 65536, "burst cycles");
        if (cycles > 1 && burst.intervalMs === undefined) throw new TypeError("repeated bursts require intervalMs");
        return { timeMs: number(burst.timeMs, 0, MAX_TIME, "burst timeMs"), count: counts, cycles,
            intervalMs: number(burst.intervalMs ?? 1, 0.001, MAX_TIME, "burst intervalMs"), probability: number(burst.probability ?? 1, 0, 1, "burst probability") };
    }).sort((a, b) => a.timeMs - b.timeMs);

    // Dense active prefix. Swap-removal touches only one particle, never allocates.
    const born = new Float64Array(capacity), lifetime = new Float64Array(capacity), lifeEnd = new Float64Array(capacity);
    const positions = new Float64Array(capacity * 3), velocities = new Float64Array(capacity * 3);
    const sizes = new Float64Array(capacity), angles = new Float64Array(capacity), spins = new Float64Array(capacity);
    const particleColors = new Float32Array(capacity * 3);
    const renderer = createRenderer(sceneParent, options, capacity, columns, rows);
    const { geometry, mesh, centers, appearances, dimensions, attributes } = renderer;
    const schedule = createSchedule(rate, duration, delay, options.loop ?? false, bursts, rateKeys, seed);
    const ages = new Float64Array(capacity), ids = new Float64Array(capacity), noiseSeeds = new Uint32Array(capacity);
    let evaluatedDeathTime = 0;
    let skippedBurstCount = 0;
    let nextId = 0, droppedSimulationMs = 0, droppedEventCount = 0;
    let events: ParticleEvent[] = [];
    const previousWorldOrigin = new THREE.Vector3(), worldOrigin = new THREE.Vector3(), inheritMatrix = new THREE.Matrix3();
    const previousOrigin = new THREE.Vector3(), observedOrigin = new THREE.Vector3(), inherited = new THREE.Vector3(), distancePosition = new THREE.Vector3(), inverseParent = new THREE.Matrix4();
    let hasPreviousOrigin = false, distanceRemainder = 0;
    const p = new THREE.Vector3(), v = new THREE.Vector3(), tint = new THREE.Color(), eventTint = new THREE.Color(), eventVelocity = new THREE.Vector3();
    const worldMatrix = new THREE.Matrix4(), eventBasis = new THREE.Matrix4();
    const eventQuaternion = new THREE.Quaternion(), eventSpin = new THREE.Quaternion(), eventEuler = new THREE.Euler(0, 0, 0, "ZYX"), eventUp = new THREE.Vector3(), eventRight = new THREE.Vector3(), eventForward = new THREE.Vector3(), eventAxis = new THREE.Vector3();
    let sortScratch: { order: Uint32Array; depths: Float64Array; attributes: Float32Array[] } | undefined;
    const sortMatrix = new THREE.Matrix4();
    let active = 0, disposed = false, emitting = true, completed = false, inCallback = false;
    let presentationTimeMs: number | null = null, elapsed = 0;
    let sequence = 0;
    let emitted = 0, dropped = 0, expired = 0;
    function live(): void { if (inCallback) throw new Error("Particle callbacks cannot reenter the emitter"); if (disposed) throw new Error("Particle emitter has been disposed"); }
    let randomState = 0;
    function random(): number { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; }
    const scalarArrays = [born, lifetime, lifeEnd, sizes, angles, spins, ages, ids, noiseSeeds];
    const vectorArrays = [positions, velocities, particleColors, ...(changingInherit ? [inheritedAtBirth, inheritedApplied] : [])];
    function remove(index: number, time = elapsed): void {
        active--; renderer.remove(index, active, time, p); variation.remove(index, active); runtime.remove(index, active);
        for (const array of scalarArrays) array[index] = array[active]!;
        for (const array of vectorArrays) {
            for (let j = 0; j < 3; j++) array[index * 3 + j] = array[active * 3 + j]!;
        }
    }
    function event(kind: ParticleEvent["kind"], i: number, time: number, position = p, triggerId?: string): void {
        if (!emitEvents) return;
        if (events.length === eventCapacity) { droppedEventCount = addCount(droppedEventCount, 1); return; }
        const age = Math.max(0, time - born[i]!), progress = age / lifetime[i]!, r = noiseSeeds[i]! / 4294967296;
        eventVelocity.copy(v); motion.reportVelocity(eventVelocity, p, age, lifetime[i]!, noiseSeeds[i]!);
        const speedNow = eventVelocity.length(), j = i * 3;
        eventTint.setRGB(particleColors[j]!, particleColors[j + 1]!, particleColors[j + 2]!); colorSample?.(eventTint, progress, r); variation.color(eventTint, speedNow, r);
        if (renderer.scales && renderer.rotations) variation.axes(i, progress, lifetime[i]!, r, renderer.scales, renderer.rotations, speedNow, Math.max(0, age - ages[i]!), p);
        eventQuaternion.setFromEuler(eventEuler.set(renderer.rotations?.getX(i) ?? 0, renderer.rotations?.getY(i) ?? 0, renderer.rotations?.getZ(i) ?? 0, "ZYX"));
        const meshParticle = renderKind === "mesh";
        eventAxis.set(0, meshParticle ? 1 : 0, meshParticle ? 0 : 1);
        eventQuaternion.premultiply(eventSpin.setFromAxisAngle(eventAxis, (meshParticle ? -1 : 1) * (angles[i]! + variation.angle(age / 1000, progress, lifetime[i]!, speedNow, r, spins[i]!))));
        if (meshParticle && !variation.hasAxes) {
            eventUp.copy(eventVelocity); if (eventUp.lengthSq() < 1e-10) eventUp.set(0, 1, 0); else eventUp.normalize();
            eventAxis.set(Math.abs(eventUp.z) < 0.99 ? 0 : 1, 0, Math.abs(eventUp.z) < 0.99 ? 1 : 0);
            eventRight.crossVectors(eventUp, eventAxis).normalize(); eventForward.crossVectors(eventRight, eventUp);
            eventQuaternion.premultiply(eventSpin.setFromRotationMatrix(eventBasis.makeBasis(eventRight, eventUp, eventForward)));
        }
        eventEuler.setFromQuaternion(eventQuaternion, "ZYX");
        const rotation = { x: eventEuler.x, y: eventEuler.y, z: eventEuler.z };
        events.push(Object.freeze({ kind, ...(triggerId === undefined ? {} : { triggerId }), particleId: ids[i]!, timeMs: time,
            color: eventTint.getHex(), size: sizes[i]! * sizeKeys.sample(progress, r) * variation.size(speedNow, r), rotation: Object.freeze(rotation), sizeAxes: Object.freeze({ x: renderer.scales?.getX(i) ?? 1, y: renderer.scales?.getY(i) ?? 1, z: renderer.scales?.getZ(i) ?? 1 }), lifetimeMs: lifetime[i]!, remainingLifetimeMs: Math.max(0, lifeEnd[i]! - age),
            ...(kind === "collision" ? { colliderId: motion.colliderId, normal: Object.freeze({ x: motion.contactNormal.x, y: motion.contactNormal.y, z: motion.contactNormal.z }) } : {}),
            position: Object.freeze({ x: position.x, y: position.y, z: position.z }), velocity: Object.freeze({ x: eventVelocity.x, y: eventVelocity.y, z: eventVelocity.z }) }));
    }
    let runtimeIndex = 0, runtimeAge = 0;
    function triggerEvent(kind: ParticleEvent["kind"], triggerId: string): void { event(kind, runtimeIndex, born[runtimeIndex]! + runtimeAge, p, triggerId); }
    function birthEvent(): void { event("birth", runtimeIndex, born[runtimeIndex]!); }
    function customStep(i: number, age: number, dt: number, birth = false): void {
        if (!runtime.enabled) { if (birth) event("birth", i, born[i]!); return; }
        runtimeIndex = i; runtimeAge = age;
        inCallback = true;
        try { runtime.step(i, ids[i]!, age, lifetime[i]!, dt, p, v, triggerEvent, birth ? birthEvent : undefined); }
        finally { inCallback = false; }
    }
    function checkComplete(): void {
        const done = active === 0 && renderer.activeTrailCount === 0 && (!emitting || (schedule.exhausted() && (distanceRate === 0 || (!loop && elapsed >= delay + duration))));
        if (!done) { completed = false; return; }
        if (!completed) { completed = true; runtime.onComplete?.(); }
    }
    function updateInherited(i: number, age: number, commit: boolean) {
        if (!changingInherit) return;
        const factor = inheritVelocity * inheritCurve.sample(age / lifetime[i]!, noiseSeeds[i]! / 4294967296);
        for (let k = 0; k < 3; k++) {
            const index = i * 3 + k, next = (inheritMode === "current" ? inherited.getComponent(k) : inheritedAtBirth[index]!) * factor;
            v.setComponent(k, v.getComponent(k) + next - inheritedApplied[index]!);
            if (commit) inheritedApplied[index] = next;
        }
    }
    function collisionStep(flags: number, i: number, age: number): boolean {
        if (flags & 1) { lifeEnd[i] = Math.max(age, lifeEnd[i]! - lifetime[i]! * motion.lifetimeLoss); event("collision", i, born[i]! + age, motion.contact); }
        if ((flags & 2) || age >= lifeEnd[i]!) { evaluatedDeathTime = born[i]! + age; event("death", i, evaluatedDeathTime); return false; }
        return true;
    }
    function evaluate(i: number, time: number, terminal = false): boolean {
        const age = Math.max(0, Math.min(time - born[i]!, lifeEnd[i]!)), j = i * 3;
        evaluatedDeathTime = born[i]! + age;
        p.fromArray(positions, j); v.fromArray(velocities, j);
        if (!motion.enabled) {
            const seconds = age / 1000, decay = drag === 0 ? seconds : -Math.expm1(-drag * seconds) / drag;
            const x = drag * seconds;
            const force = x < 0.001 ? seconds * seconds * (0.5 - x / 6 + x * x / 24 - x * x * x / 120) : (seconds - decay) / drag;
            p.addScaledVector(v, decay).addScaledVector(acceleration, force);
            v.multiplyScalar(Math.exp(-drag * seconds)).addScaledVector(acceleration, decay);
            return true;
        }
        let current = ages[i]!;
        let steps = Math.floor((age - current + 1e-8) / motion.stepMs);
        if (steps > motion.maxSteps) {
            const skipped = (steps - motion.maxSteps) * motion.stepMs; current += skipped;
            droppedSimulationMs = Math.min(Number.MAX_SAFE_INTEGER, droppedSimulationMs + skipped); steps = motion.maxSteps;
        }
        for (let n = 0; n < steps; n++) {
            updateInherited(i, current, true);
            if (variation.integrated) { motion.reportVelocity(eventVelocity.copy(v), p, current, lifetime[i]!, noiseSeeds[i]!); variation.step(i, current, lifetime[i]!, motion.stepMs, eventVelocity.length(), noiseSeeds[i]! / 4294967296); }
            const flags = motion.step(p, v, motion.stepMs, current, lifetime[i]!, noiseSeeds[i]!, acceleration, drag);
            current += motion.stepMs; ages[i] = current;
            customStep(i, current, motion.stepMs);
            renderer.sample(i, p, born[i]! + current);
            if (!collisionStep(flags, i, current)) return false;
        }
        ages[i] = current; p.toArray(positions, j); v.toArray(velocities, j);
        const remainder = Math.max(0, age - current);
        if (remainder > 1e-8) {
            updateInherited(i, current, terminal);
            if (terminal && variation.integrated) { motion.reportVelocity(eventVelocity.copy(v), p, current, lifetime[i]!, noiseSeeds[i]!); variation.step(i, current, lifetime[i]!, remainder, eventVelocity.length(), noiseSeeds[i]! / 4294967296); }
            const flags = motion.step(p, v, remainder, current, lifetime[i]!, noiseSeeds[i]!, acceleration, drag);
            if (terminal) { ages[i] = age; customStep(i, age, remainder); }
            if (terminal && !collisionStep(flags, i, age)) return false;
        }
        return true;
    }
    function expireAt(time: number): void {
        for (let i = active - 1; i >= 0; i--) if (time - born[i]! >= lifeEnd[i]!) {
            if (evaluate(i, born[i]! + lifeEnd[i]!, true)) event("death", i, born[i]! + lifeEnd[i]!);
            remove(i, evaluatedDeathTime); expired = addCount(expired, 1);
        }
    }
    function spawn(count: number, time: number, location: THREE.Vector3, lifetimeRange: readonly [number, number], speedRange: readonly [number, number], sizeRange: readonly [number, number], color: number, localSeed: number, sequenceBase = sequence, velocityOverride = initialVelocity, usePalette = paletteEnabled, rotationOverride?: ParticleVector3, scaleOverride?: ParticleVector3): number {
        const attempts = Math.min(count, capacity - active); let accepted = 0;
        if (attempts && runtime.meshPositions) { inCallback = true; let vertices: readonly number[]; try { vertices = runtime.meshPositions(); } finally { inCallback = false; } setMeshPositions(vertices); }
        if (attempts) completed = false;
        if (space === "world") { sceneParent.updateWorldMatrix(true, false); worldMatrix.copy(sceneParent.matrixWorld); }
        for (let n = 0; n < attempts; n++) {
            randomState = (localSeed ^ Math.imul(sequenceBase + n, 0x9e3779b1)) >>> 0;
            if (!sampleShape(p, v, random, time)) continue;
            accepted++;
            p.applyQuaternion(orientation).add(location);
            const sampledSpeed = speedRange[0] + random() * (speedRange[1] - speedRange[0]);
            if (velocityOverride) v.copy(velocityOverride); else v.multiplyScalar(sampledSpeed);
            v.applyQuaternion(orientation).multiplyScalar(speedScale);
            if (space === "world") {
                p.applyMatrix4(worldMatrix);
                const e = worldMatrix.elements, x = v.x, y = v.y, z = v.z;
                v.set(e[0]! * x + e[4]! * y + e[8]! * z, e[1]! * x + e[5]! * y + e[9]! * z, e[2]! * x + e[6]! * y + e[10]! * z);
            }
            v.addScaledVector(inherited, inheritVelocity * inheritCurve.sample(0, ((localSeed ^ Math.imul(sequenceBase + n, 0x9e3779b1)) >>> 0) / 4294967296));
            motion.initialVelocity(v, ((localSeed ^ Math.imul(sequenceBase + n, 0x9e3779b1)) >>> 0) / 4294967296);
            const i = active++;
            if (changingInherit) { inherited.toArray(inheritedAtBirth, i * 3); for (let k = 0; k < 3; k++) inheritedApplied[i * 3 + k] = inherited.getComponent(k) * inheritVelocity * inheritCurve.sample(0, ((localSeed ^ Math.imul(sequenceBase + n, 0x9e3779b1)) >>> 0) / 4294967296); }
            ages[i] = 0; ids[i] = nextId++; noiseSeeds[i] = (localSeed ^ Math.imul(sequenceBase + n, 0x9e3779b1)) >>> 0;

            positions[i * 3] = p.x; positions[i * 3 + 1] = p.y; positions[i * 3 + 2] = p.z;
            velocities[i * 3] = v.x; velocities[i * 3 + 1] = v.y; velocities[i * 3 + 2] = v.z;
            born[i] = time;
            lifetime[i] = lifetimeRange[0] + random() * (lifetimeRange[1] - lifetimeRange[0]);
            lifeEnd[i] = lifetime[i]!;
            sizes[i] = (sizeRange[0] + random() * (sizeRange[1] - sizeRange[0])) * sizeScale;
            angles[i] = angle[0] + random() * (angle[1] - angle[0]);
            spins[i] = spin[0] + random() * (spin[1] - spin[0]);
            tint.setHex(color); variation.birth(i, random, tint, usePalette, rotationOverride, scaleOverride); runtime.birth(i);
            p.toArray(positions, i * 3); v.toArray(velocities, i * 3);
            particleColors[i * 3] = tint.r; particleColors[i * 3 + 1] = tint.g; particleColors[i * 3 + 2] = tint.b;
            customStep(i, 0, 0, true); p.toArray(positions, i * 3); v.toArray(velocities, i * 3);
            renderer.birth(i, p, time); renderer.appearance(i, tint, 1);
        }
        sequence = (sequence + count) >>> 0;
        emitted = addCount(emitted, accepted); dropped = addCount(dropped, count - accepted);
        return accepted;
    }
    function upload(): void {
        for (let i = 0; i < active; i++) {
            const seconds = (elapsed - born[i]!) / 1000, progress = (elapsed - born[i]!) / lifetime[i]!;
            if (!evaluate(i, elapsed)) { remove(i--, evaluatedDeathTime); expired = addCount(expired, 1); continue; }
            motion.reportVelocity(v, p, elapsed - born[i]!, lifetime[i]!, noiseSeeds[i]!);
            centers.setXYZ(i, p.x, p.y, p.z); renderer.velocities?.setXYZ(i, v.x, v.y, v.z);
            if (!motion.enabled) renderer.sample(i, p, elapsed);
            const j = i * 3;
            tint.setRGB(particleColors[j]!, particleColors[j + 1]!, particleColors[j + 2]!);
            const r = noiseSeeds[i]! / 4294967296, speedNow = variation.needsSpeed ? v.length() : 0;
            colorSample?.(tint, progress, r);
            variation.color(tint, speedNow, r);
            appearances.setXYZW(i, tint.r, tint.g, tint.b, opacityKeys.sample(progress, r));
            renderer.appearance(i, tint, appearances.getW(i));
            const frame = variation.frame(i, seconds, progress, renderer.atlas);
            dimensions.setXYZ(i, sizes[i]! * sizeKeys.sample(progress, r) * variation.size(speedNow, r), angles[i]! + variation.angle(seconds, progress, lifetime[i]!, speedNow, r, spins[i]!), frame);
            if (renderer.scales && renderer.rotations) variation.axes(i, progress, lifetime[i]!, r, renderer.scales, renderer.rotations, speedNow, Math.max(0, elapsed - born[i]! - ages[i]!), p);
            runtime.upload(i, renderer.customAttributes);
        }
        renderer.upload(active, elapsed);
    }
    function skip(count: number, bursts = 0): void { skippedBurstCount = addCount(skippedBurstCount, bursts); sequence = (sequence + count) >>> 0; dropped = addCount(dropped, count); }
    function scaledBirth(count: number, time: number, location: THREE.Vector3): void {
        const density = count * emissionScale + densityRemainder;
        const requested = Math.floor(density); densityRemainder = density - requested;
        spawn(requested, time, location, life, speed, size, baseColor, seed);
    }
    function advance(deltaMs: number): void {
        elapsed += deltaMs;
        expireAt(elapsed);
        schedule.advance(elapsed, life[1], emitting ? capacity : 0, (count, time) => scaledBirth(count, time, origin), skip);
        expireAt(elapsed); upload();
    }
    function observeOrigin(): void {
        observedOrigin.copy(origin);
        if (space === "world") { sceneParent.updateWorldMatrix(true, false); observedOrigin.applyMatrix4(sceneParent.matrixWorld); }
    }
    function emitInternal(count: number, overrides: ParticleEmission = {}, ageMs = 0): number {
            live(); integer(count, 0, LIMIT, "count");
            record(overrides, ["position", "lifetimeMs", "speed", "size", "color", "seed", "velocity", "rotation3D", "sizeAxes"], "emission");
            if (overrides.sizeAxes && (!variation.hasAxes || Math.min(overrides.sizeAxes.x, overrides.sizeAxes.y, overrides.sizeAxes.z) < 0)) throw new TypeError("sizeAxes emission requires nonnegative scales and axis modules");
            if (overrides.rotation3D && !variation.hasAxes) throw new TypeError("rotation3D emission requires rotation3D or axis modules on the emitter");
            const location = overrides.position === undefined ? origin : vector(overrides.position, "position");
            const l = overrides.lifetimeMs === undefined ? life : range(overrides.lifetimeMs, 0.001, MAX_VALUE, "lifetimeMs");
            const s = overrides.speed === undefined ? speed : range(overrides.speed, 0, MAX_VALUE, "speed");
            const z = overrides.size === undefined ? size : range(overrides.size, 0, MAX_VALUE, "size");
            const c = integer(overrides.color ?? baseColor, 0, 0xffffff, "color");
            const r = integer(overrides.seed ?? seed, 0, 0xffffffff, "seed");
            const velocity = overrides.velocity === undefined ? initialVelocity : vector(overrides.velocity, "velocity");
            const accepted = spawn(count, elapsed - ageMs, location, l, s, z, c, r, overrides.seed === undefined ? sequence : 0, velocity, paletteEnabled && overrides.color === undefined, overrides.rotation3D === undefined ? undefined : vector(overrides.rotation3D, "rotation3D"), overrides.sizeAxes === undefined ? undefined : vector(overrides.sizeAxes, "sizeAxes")); return accepted;
    }
    function reset(): void {
        completed = false; renderer.clear(); active = 0; elapsed = 0; schedule.reset(); sequence = 0; nextId = 0;
        densityRemainder = 0; distanceRemainder = 0; hasPreviousOrigin = false; inherited.set(0, 0, 0); events = []; emitting = true;
    }
    function replaceMotion(next: ReturnType<typeof createMotion>): void {
        for (let i = active - 1; i >= 0; i--) {
            if (!evaluate(i, elapsed)) { remove(i, evaluatedDeathTime); expired = addCount(expired, 1); continue; }
            const age = elapsed - born[i]!;
            if (motion.enabled && age > ages[i]!) customStep(i, age, age - ages[i]!);
            p.toArray(positions, i * 3); v.toArray(velocities, i * 3); ages[i] = age;
        }
        next.enabled = true; motion = next; upload();
    }
    const api: ParticleEmitter = Object.freeze({
        present(timestampMs: number): void {
            live(); number(timestampMs, 0, Number.MAX_SAFE_INTEGER, "presentation time");
            if (presentationTimeMs !== null && timestampMs < presentationTimeMs) throw new TypeError("Particle presentation time must be monotonic");
            const deltaMs = presentationTimeMs === null ? 0 : (timestampMs - presentationTimeMs) * timeScale;
            presentationTimeMs = timestampMs;
            observeOrigin(); inherited.set(0, 0, 0);
            sceneParent.updateWorldMatrix(true, false); worldOrigin.copy(origin).applyMatrix4(sceneParent.matrixWorld);
            if (hasPreviousOrigin && deltaMs > 0 && !paused) {
                inherited.copy(worldOrigin).sub(previousWorldOrigin).multiplyScalar(1000 / deltaMs);
                if (space === "local") inherited.applyMatrix3(inheritMatrix.setFromMatrix4(inverseParent.copy(sceneParent.matrixWorld).invert()));
            }
            if (!paused) {
                const previousElapsed = elapsed;
                advance(deltaMs);
                if (distanceRate > 0 && hasPreviousOrigin && emitting && deltaMs > 0) {
                    const distance = observedOrigin.distanceTo(previousOrigin);
                    // Only the portion inside the emission interval contributes distance.
                    const a = Math.max(0, Math.min(1, (delay - previousElapsed) / deltaMs));
                    const b = loop ? 1 : Math.max(0, Math.min(1, (delay + duration - previousElapsed) / deltaMs));
                    const density = distance * distanceRate * emissionScale * Math.max(0, b - a);
                    const total = density + distanceRemainder, count = Math.floor(total), attempts = Math.min(count, capacity);
                    if (space === "world") inverseParent.copy(sceneParent.matrixWorld).invert();
                    for (let n = 0; n < attempts; n++) {
                        const t = a + (b - a) * (n + 1 - distanceRemainder) / density;
                        distancePosition.copy(previousOrigin).lerp(observedOrigin, t);
                        if (space === "world") distancePosition.applyMatrix4(inverseParent);
                        spawn(1, previousElapsed + deltaMs * t, distancePosition, life, speed, size, baseColor, seed);
                    }
                    distanceRemainder = total - count; skip(count - attempts); expireAt(elapsed); upload();
                }
            }
            if (paused) upload();
            previousOrigin.copy(observedOrigin); previousWorldOrigin.copy(worldOrigin); hasPreviousOrigin = true; checkComplete();
        },
        emit(count: number, overrides: ParticleEmission = {}): number { const accepted = emitInternal(count, overrides); expireAt(elapsed); upload(); return accepted; },
        setTransform(position: ParticleVector3, rotation: ParticleVector3 = zero): void {
            live(); const next = vector(position, "position"), r = vector(rotation, "rotation");
            origin = next; orientation.setFromEuler(new THREE.Euler(r.x, r.y, r.z));
        },
        setEmitting(value: boolean): void { live(); if (typeof value !== "boolean") throw new TypeError("emitting must be boolean"); emitting = value; },
        pause(): void { live(); paused = true; },
        play(): void { live(); paused = false; },
        setTimeScale(value: number): void { live(); timeScale = number(value, 0, 100, "timeScale"); },
        setParameters(parameters: ParticleParameters): void {
            live(); record(parameters, ["emissionScale", "sizeScale", "speedScale", "color"], "parameters");
            const e = number(parameters.emissionScale ?? emissionScale, 0, 1, "emissionScale");
            const z = number(parameters.sizeScale ?? sizeScale, 0, 100, "sizeScale");
            const s = number(parameters.speedScale ?? speedScale, 0, 100, "speedScale");
            const c = integer(parameters.color ?? baseColor, 0, 0xffffff, "color");
            emissionScale = e; sizeScale = z; speedScale = s; baseColor = c; if (parameters.color !== undefined) paletteEnabled = false;
        },
        prewarm(durationMs: number): void { live(); advance(number(durationMs, 0, MAX_VALUE, "prewarmMs")); checkComplete(); },
        seek(timeMs: number, mode: "automatic" | "recorded" = "automatic"): void {
            if (mode !== "automatic") throw new TypeError("recorded seek requires recording");
            live(); number(timeMs, 0, MAX_VALUE, "seek timeMs");
            // Fixed replay steps make motion, trails and child-module state reproducible.
            const wasPaused = paused; reset(); advance(0);
            for (let t = 0; t < timeMs;) { const dt = Math.min(1000 / 60, timeMs - t); advance(dt); t += dt; }
            paused = wasPaused; events = []; checkComplete();
        },
        setForceFields(fields: readonly ParticleForceField[]) { live(); const next = createMotion({ ...motionOptions, forceFields: fields, ...(collisionConfig ? { collision: collisionConfig } : {}) }); fieldConfig = structuredClone(fields); replaceMotion(next); },
        setCollision(collision: ParticleCollisionOptions) { live(); const next = createMotion({ ...motionOptions, collision, ...(fieldConfig ? { forceFields: fieldConfig } : {}) }); collisionConfig = structuredClone(collision); replaceMotion(next); },
        setTriggers(triggers: readonly ParticleTrigger[]) { live(); runtime.setTriggers(triggers); replaceMotion(createMotion({ ...motionOptions, forceFields: fieldConfig, collision: collisionConfig, triggers })); },
        setMeshPositions,
        setDepthSource(texture: ParticleTexture, width: number, height: number, origin?: ParticleVector2) { live(); renderer.setDepthSource(texture as THREE.Texture, width, height, origin); },
        drainEvents(): readonly ParticleEvent[] { live(); const result = events; events = []; return result; },
        cull(camera: ParticleCamera): boolean { live(); if (!(camera instanceof THREE.Camera)) throw new TypeError("cull camera must be a Three.js Camera"); return renderer.cull(camera); },
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
        clear(): void { live(); active = 0; renderer.clear(); upload(); checkComplete(); },
        restart(): void { live(); reset(); paused = false; upload(); if (initialPrewarm) advance(initialPrewarm); },
        inspect(): ParticleInspection {
            return Object.freeze({ disposed, completed, activeTrailCount: disposed ? 0 : renderer.activeTrailCount, paused, timeScale, elapsedMs: elapsed, culled: renderer.culled, droppedSimulationMs, droppedEventCount, skippedBurstCount, emitting: !disposed && emitting, presentationTimeMs, activeParticleCount: active, capacity,
                emittedParticleCount: emitted, droppedParticleCount: dropped, expiredParticleCount: expired,
                liveResourceCounts: Object.freeze({ objects: disposed ? 0 : renderer.resourceCount, geometries: disposed ? 0 : renderer.resourceCount, materials: disposed ? 0 : renderer.materialCount }) });
        },
        dispose(): void {
            if (inCallback) throw new Error("Particle callbacks cannot reenter the emitter");
            if (disposed) return;
            disposed = true; active = 0; geometry.instanceCount = 0; mesh.visible = false;
            renderer.dispose(); sortScratch = undefined; events = [];
        },
    });
    emitterAccess.set(api, {
        emit: emitInternal,
        flush() { live(); expireAt(elapsed); upload(); },
        refresh() { live(); upload(); },
        reset() { live(); reset(); advance(0); },
        complete() { live(); checkComplete(); },
    });
    try { if (initialPrewarm) advance(initialPrewarm); } catch (error) { api.dispose(); throw error; }
    return api;
}

/** Owns a fixed set of emitters in the client presentation schedule. */
export function createParticleFeature(options: { readonly emitters: readonly Pick<ParticleEmitter, "present" | "dispose">[] }): ClientFeatureDescriptor<Readonly<Record<string, never>>> {
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
