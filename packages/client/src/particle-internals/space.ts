import * as THREE from "three";
import type { ParticleEmitterOptions } from "./types.js";

/** Coordinate conversions are shared by simulation, rendering and event routing. @internal */
export function createSpace(parent: THREE.Object3D, options: ParticleEmitterOptions) {
    const mode = options.simulationSpace ?? "local", scaling = options.scalingMode ?? "hierarchy";
    if (!["local", "world", "custom"].includes(mode)) throw new TypeError("Invalid simulationSpace");
    if (!["hierarchy", "local", "shape"].includes(scaling)) throw new TypeError("Invalid scalingMode");
    const custom = options.runtime?.customSimulationSpace;
    if (custom !== undefined && !(custom instanceof THREE.Object3D)) throw new TypeError("customSimulationSpace must be an Object3D");
    if (mode === "custom" && !custom) throw new TypeError("custom space requires runtime.customSimulationSpace");
    if (mode !== "custom" && custom !== undefined) throw new TypeError("customSimulationSpace requires custom mode");
    const reference = mode === "custom" ? custom as THREE.Object3D : parent;
    const matrix = new THREE.Matrix4(), birthWorld = new THREE.Matrix4(), velocityWorld = new THREE.Matrix4(), birthToSimulation = new THREE.Matrix4(), velocityToSimulation = new THREE.Matrix3(), inverse = new THREE.Matrix4(), toBirth = new THREE.Matrix4();
    const position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
    function frame(object: THREE.Object3D, target: THREE.Matrix4, selected: string) {
        object.updateWorldMatrix(true, false); target.copy(object.matrixWorld);
        if (selected !== "hierarchy") {
            if (Math.abs(target.determinant()) < 1e-18) throw new TypeError("scale-controlled particle frames must be invertible");
            target.decompose(position, rotation, scale);
            if (selected === "local") scale.copy(object.scale); else scale.set(1, 1, 1);
            target.compose(position, rotation, scale);
        }
    }
    function update() {
        if (mode === "world") matrix.identity(); else frame(reference, matrix, scaling === "shape" ? "shape" : scaling);
        frame(parent, birthWorld, scaling === "local" ? "local" : "hierarchy");
        if (scaling === "shape") frame(parent, velocityWorld, "shape"); else velocityWorld.copy(birthWorld);
        if (mode === "local" && scaling !== "shape") { birthToSimulation.identity(); velocityToSimulation.identity(); }
        else {
            if (Math.abs(matrix.determinant()) < 1e-18) throw new TypeError("custom particle frames must be invertible");
            inverse.copy(matrix).invert(); birthToSimulation.multiplyMatrices(inverse, birthWorld);
            velocityToSimulation.setFromMatrix4(toBirth.multiplyMatrices(inverse, velocityWorld));
        }
    }
    update();
    return { matrix, birthWorld, velocityWorld, birthToSimulation, velocityToSimulation, update,
        toBirth(p: THREE.Vector3) { return p.applyMatrix4(toBirth.copy(birthToSimulation).invert()); },
        apply(object: THREE.Object3D) { update(); object.matrixWorld.copy(matrix); },
        independent: mode === "custom" || scaling !== "hierarchy",
    };
}
