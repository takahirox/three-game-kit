import * as THREE from "three";
import type { ParticleCollider, ParticleEmitterOptions, ParticleVectorCurve } from "./types.js";
import { distribution, number, record, vector, integer } from "./validation.js";

function vectorCurve(input: ParticleVectorCurve | undefined) {
    if (!input) return undefined;
    record(input, ["x", "y", "z"], "vector curve");
    return [input.x, input.y, input.z].map(c => c === undefined ? undefined : distribution(c, -1e6, 1e6, "vector curve"));
}

/** @internal */
export function createMotion(options: ParticleEmitterOptions) {
    const velocity = vectorCurve(options.velocityOverLife), force = vectorCurve(options.forceOverLife);
    const noise = options.noise;
    let strength = 0, frequency = 1, scroll = 1;
    if (noise !== undefined) {
        record(noise, ["strength", "frequency", "scrollSpeed"], "noise");
        strength = number(noise.strength, 0, 1e6, "noise strength");
        frequency = number(noise.frequency ?? 1, 0, 1e6, "noise frequency");
        scroll = number(noise.scrollSpeed ?? 1, -1e6, 1e6, "noise scrollSpeed");
    }
    if (options.forceFields !== undefined && (!Array.isArray(options.forceFields) || options.forceFields.length > 16)) throw new TypeError("forceFields requires at most 16 fields");
    const fields = Array.from(options.forceFields ?? [], f => {
        record(f, f.kind === "vortex" ? ["kind", "position", "axis", "strength", "radius"] : ["kind", "position", "strength", "radius"], "force field");
        if (f.kind !== "attractor" && f.kind !== "vortex") throw new TypeError("Invalid force field");
        const axis = f.kind === "vortex" ? vector(f.axis, "vortex axis") : new THREE.Vector3();
        if (f.kind === "vortex" && axis.lengthSq() === 0) throw new TypeError("vortex axis cannot be zero");
        return { kind: f.kind, position: vector(f.position, "field position"), axis: axis.normalize(), strength: number(f.strength, -1e6, 1e6, "field strength"), radius: number(f.radius, 0.000001, 1e6, "field radius") };
    });
    const collision = options.collision;
    let bounce = 0.5, friction = 0, radius = 0, kill = false;
    const colliders: { kind: ParticleCollider["kind"]; a: THREE.Vector3; b: THREE.Vector3; radius: number; offset: number }[] = [];
    if (collision !== undefined) {
        record(collision, ["colliders", "bounce", "friction", "radius", "response"], "collision");
        bounce = number(collision.bounce ?? 0.5, 0, 1, "bounce"); friction = number(collision.friction ?? 0, 0, 1, "friction");
        radius = number(collision.radius ?? 0, 0, 1e6, "collision radius");
        if (collision.response !== undefined && collision.response !== "bounce" && collision.response !== "kill") throw new TypeError("Invalid collision response");
        kill = collision.response === "kill";
        if (!Array.isArray(collision.colliders) || collision.colliders.length > 32) throw new TypeError("collision requires at most 32 colliders");
        for (const c of collision.colliders) {
            const a = new THREE.Vector3(), b = new THREE.Vector3(); let r = 0, offset = 0;
            switch (c.kind) {
                case "plane":
                    record(c, ["kind", "normal", "offset"], "plane"); a.copy(vector(c.normal, "plane normal"));
                    if (!a.lengthSq()) throw new TypeError("plane normal cannot be zero");
                    offset = number(c.offset, -1e6, 1e6, "plane offset") / a.length(); a.normalize(); break;
                case "sphere": record(c, ["kind", "center", "radius"], "sphere"); a.copy(vector(c.center, "sphere center")); r = number(c.radius, 0.000001, 1e6, "sphere radius"); break;
                case "box":
                    record(c, ["kind", "min", "max"], "box"); a.copy(vector(c.min, "box min")); b.copy(vector(c.max, "box max"));
                    if (a.x >= b.x || a.y >= b.y || a.z >= b.z) throw new TypeError("box min must be below max"); break;
                default: throw new TypeError("Invalid collider");
            }
            colliders.push({ kind: c.kind, a, b, radius: r, offset });
        }
    }
    const stepMs = number(options.simulationStepMs ?? 1000 / 60, 1, 100, "simulationStepMs");
    const limit = number(options.limitVelocity ?? 1e6, 0, 1e6, "limitVelocity");
    const maxSteps = integer(options.maxSubSteps ?? 120, 1, 1024, "maxSubSteps");
    const f = new THREE.Vector3(), delta = new THREE.Vector3(), start = new THREE.Vector3(), normal = new THREE.Vector3(), bestNormal = new THREE.Vector3();
    const projected = new THREE.Vector3(), contact = new THREE.Vector3();
    return {
        contact,
        enabled: !!(velocity || force || noise || fields.length || collision || options.limitVelocity !== undefined || options.runtime?.update || options.triggers?.length), stepMs, maxSteps,
        initialVelocity(v: THREE.Vector3, random = 0) { if (velocity) for (let k = 0; k < 3; k++) { const c = velocity[k]; if (c) v.setComponent(k, v.getComponent(k) + c.sample(0, random)); } if (options.limitVelocity !== undefined) v.clampLength(0, limit); },
        /** Returns collision/kill flags. p and v are reusable caller-owned scratch vectors. */
        step(p: THREE.Vector3, v: THREE.Vector3, dtMs: number, ageMs: number, lifetimeMs: number, seed: number, acceleration: THREE.Vector3, drag: number): number {
            const dt = dtMs / 1000, t0 = Math.min(1, ageMs / lifetimeMs), t1 = Math.min(1, (ageMs + dtMs) / lifetimeMs);
            f.copy(acceleration);
            for (let k = 0; k < 3; k++) {
                const fc = force?.[k], vc = velocity?.[k];
                if (fc) f.setComponent(k, f.getComponent(k) + fc.sample((t0 + t1) / 2, seed / 4294967296));
                if (vc && dt > 0) f.setComponent(k, f.getComponent(k) + (vc.sample(t1, seed / 4294967296) - vc.sample(t0, seed / 4294967296)) / dt);
            }
            if (strength) {
                const t = ageMs / 1000 * scroll + seed * 0.0001;
                f.x += strength * Math.sin(p.y * frequency + t) * Math.cos(p.z * frequency - t);
                f.y += strength * Math.sin(p.z * frequency + t * 1.1) * Math.cos(p.x * frequency - t);
                f.z += strength * Math.sin(p.x * frequency + t * 0.9) * Math.cos(p.y * frequency - t);
            }
            for (const field of fields) {
                delta.copy(field.position).sub(p);
                if (field.kind === "vortex") delta.addScaledVector(field.axis, -delta.dot(field.axis));
                const distance = delta.length();
                if (distance > 1e-9 && distance < field.radius) {
                    if (field.kind === "vortex") delta.negate().crossVectors(field.axis, delta);
                    f.addScaledVector(delta.normalize(), field.strength * (1 - distance / field.radius));
                }
            }
            const decay = drag === 0 ? dt : -Math.expm1(-drag * dt) / drag;
            const x = drag * dt;
            const integral = x < 0.001 ? dt * dt * (0.5 - x / 6 + x * x / 24 - x * x * x / 120) : (dt - decay) / drag;
            start.copy(p); p.addScaledVector(v, decay).addScaledVector(f, integral);
            v.multiplyScalar(Math.exp(-drag * dt)).addScaledVector(f, decay);
            if (options.limitVelocity !== undefined) v.clampLength(0, limit);
            if (!colliders.length) return 0;
            let flags = 0, remaining = dt;
            for (let iteration = 0; iteration < 4; iteration++) {
                delta.copy(p).sub(start);
                let best = Infinity, correction = 0;
                for (const c of colliders) {
                    let hit = Infinity, penetration = 0;
                    normal.set(0, 0, 0);
                    if (c.kind === "plane") {
                        const d0 = start.dot(c.a) - c.offset - radius, d1 = p.dot(c.a) - c.offset - radius;
                        if (d0 < -1e-7) { hit = 0; penetration = -d0; normal.copy(c.a); }
                        else if (d1 < 0 && d1 < d0) { hit = Math.max(0, d0 / (d0 - d1)); normal.copy(c.a); }
                    } else if (c.kind === "sphere") {
                        projected.copy(start).sub(c.a); const r = c.radius + radius, dist = projected.length();
                        if (dist < r - 1e-7) { hit = 0; penetration = r - dist; normal.copy(projected); if (!dist) normal.set(0, 1, 0); normal.normalize(); }
                        else {
                            const a = delta.lengthSq(), b = projected.dot(delta), d = b * b - a * (projected.lengthSq() - r * r);
                            if (a > 0 && b < 0 && d >= 0) { const h = (-b - Math.sqrt(d)) / a; if (h >= 0 && h <= 1) { hit = h; normal.copy(start).addScaledVector(delta, h).sub(c.a).normalize(); } }
                        }
                    } else {
                        let enter = -Infinity, leave = Infinity, axis = 0, sign = 1, inside = true, nearest = Infinity;
                        for (let k = 0; k < 3; k++) {
                            const lo = c.a.getComponent(k) - radius, hi = c.b.getComponent(k) + radius, s = start.getComponent(k), d = delta.getComponent(k);
                            if (s <= lo || s >= hi) inside = false;
                            const dLo = s - lo, dHi = hi - s;
                            if (dLo < nearest) { nearest = dLo; normal.set(0, 0, 0).setComponent(k, -1); }
                            if (dHi < nearest) { nearest = dHi; normal.set(0, 0, 0).setComponent(k, 1); }
                            if (Math.abs(d) < 1e-12) { if (s < lo || s > hi) leave = -Infinity; }
                            else {
                                const tLo = (lo - s) / d, tHi = (hi - s) / d, n = Math.min(tLo, tHi);
                                if (n > enter) { enter = n; axis = k; sign = d > 0 ? -1 : 1; }
                                leave = Math.min(leave, Math.max(tLo, tHi));
                            }
                        }
                        if (inside) { hit = 0; penetration = nearest; }
                        else if (enter >= 0 && enter <= 1 && enter <= leave) { hit = enter; normal.set(0, 0, 0).setComponent(axis, sign); }
                    }
                    if (hit < best) { best = hit; bestNormal.copy(normal); correction = penetration; }
                }
                if (best === Infinity) break;
                const firstHit = flags === 0;
                flags |= 1;
                p.copy(start).addScaledVector(delta, best).addScaledVector(bestNormal, correction + 1e-6);
                if (firstHit) contact.copy(p);
                if (kill) return flags | 2;
                const vn = v.dot(bestNormal);
                if (vn < 0) v.addScaledVector(bestNormal, -vn).multiplyScalar(1 - friction).addScaledVector(bestNormal, -vn * bounce);
                start.copy(p); remaining *= 1 - best;
                if (iteration < 3) p.addScaledVector(v, remaining);
            }
            return flags;
        },
    };
}
