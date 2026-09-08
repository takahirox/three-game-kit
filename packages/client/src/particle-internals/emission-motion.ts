import * as THREE from "three";
import type { createSpace } from "./space.js";

/** Observed endpoint interpolation, used only for scheduled births. @internal */
export function createEmissionMotion(space: ReturnType<typeof createSpace>, enabled: boolean) {
    const snapshot = () => ({ birth: new THREE.Matrix4(), velocity: new THREE.Matrix4(), simulation: new THREE.Matrix4(), origin: new THREE.Vector3(), rotation: new THREE.Quaternion() });
    const previous = snapshot(), current = snapshot();
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p2 = p.clone(), q2 = q.clone(), s2 = s.clone();
    const birth = new THREE.Matrix4(), velocity = new THREE.Matrix4(), inverse = new THREE.Matrix4(), velocityMatrix = new THREE.Matrix3(), origin = new THREE.Vector3(), rotation = new THREE.Quaternion();
    let observed = false, active = false, start = 0, duration = 0, sampledTime = NaN;
    function capture(target: typeof previous, origin: THREE.Vector3, rotation: THREE.Quaternion) { space.update(); target.birth.copy(space.birthWorld); target.velocity.copy(space.velocityWorld); target.simulation.copy(space.matrix); target.origin.copy(origin); target.rotation.copy(rotation); }
    function blend(a: THREE.Matrix4, b: THREE.Matrix4, t: number, target: THREE.Matrix4) {
        if (t <= 0) return target.copy(a); if (t >= 1) return target.copy(b);
        a.decompose(p, q, s); b.decompose(p2, q2, s2);
        return target.compose(p.lerp(p2, t), q.slerp(q2, t), s.lerp(s2, t));
    }
    return {
        begin(time: number, delta: number, origin: THREE.Vector3, rotation: THREE.Quaternion) { active = enabled && observed && delta > 0; if (!enabled) return; capture(current, origin, rotation); start = time; duration = delta; sampledTime = NaN; },
        end(origin: THREE.Vector3, rotation: THREE.Quaternion) { if (enabled) capture(previous, origin, rotation); observed = true; active = false; },
        reset() { observed = false; active = false; },
        transform(position: THREE.Vector3, speed: THREE.Vector3, time: number) {
            if (!active) return false;
            if (sampledTime !== time) {
                const t = Math.max(0, Math.min(1, (time - start) / duration));
                blend(previous.simulation, current.simulation, t, inverse);
                if (Math.abs(inverse.determinant()) < 1e-18) throw new TypeError("interpolated particle frame must be invertible");
                inverse.invert(); blend(previous.birth, current.birth, t, birth).premultiply(inverse);
                blend(previous.velocity, current.velocity, t, velocity).premultiply(inverse); velocityMatrix.setFromMatrix4(velocity);
                origin.copy(previous.origin).lerp(current.origin, t); rotation.copy(previous.rotation).slerp(current.rotation, t); sampledTime = time;
            }
            position.applyQuaternion(rotation).add(origin).applyMatrix4(birth);
            speed.applyQuaternion(rotation).applyMatrix3(velocityMatrix); return true;
        },
    };
}
