import * as THREE from "three";
import { integer, record } from "./validation.js";
import type { ParticleSortOptions } from "./types.js";

/** Exact opt-in object ordering for heterogeneous alpha particles, with a hard draw budget. @internal */
export function createAlphaSort() {
    type Mesh = THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;
    const pool: Mesh[] = [], hidden = new Map<Mesh, boolean>(), entries: { source: Mesh; index: number; depth: number }[] = [];
    const point = new THREE.Vector3(), matrix = new THREE.Matrix4();
    function disposeGeometry(geometry: THREE.InstancedBufferGeometry) {
        // Base vertices/index are borrowed from the source; only instance buffers belong to the proxy.
        geometry.setIndex(null); for (const [name, a] of Object.entries(geometry.attributes)) if (!(a instanceof THREE.InstancedBufferAttribute)) geometry.deleteAttribute(name);
        geometry.dispose();
    }
    function reset() {
        for (const [source, visible] of hidden) { source.visible = visible; delete source.userData.particleSortReset; delete source.userData.particleSortCull; }
        hidden.clear(); for (const mesh of pool) mesh.visible = false;
    }
    return {
        get count() { return pool.length; },
        reset,
        sort(camera: THREE.Camera, roots: readonly THREE.Object3D[], options: ParticleSortOptions = {}) {
            record(options, ["scope", "maxParticles"], "sort options");
            if (options.scope !== undefined && options.scope !== "global" && options.scope !== "emitter") throw new TypeError("Invalid sorting scope");
            const limit = integer(options.maxParticles ?? 2048, 1, 4096, "global sort maxParticles");
            reset(); entries.length = 0; camera.updateWorldMatrix(true, false);
            for (const root of roots) root.traverseVisible(object => {
                if (!(object instanceof THREE.Mesh) || !object.userData.particleFrame || Array.isArray(object.material) || object.material.blending !== THREE.NormalBlending || !object.material.transparent || !object.material.visible || !camera.layers.test(object.layers)) return;
                const source = object as Mesh, centers = source.geometry.getAttribute("particleCenter");
                if (!centers) return;
                matrix.multiplyMatrices(camera.matrixWorldInverse, source.userData.particleFrame() as THREE.Matrix4);
                for (let i = 0; i < source.geometry.instanceCount; i++) {
                    if (entries.length >= limit) throw new RangeError("global sorting exceeds its particle/draw budget");
                    point.fromBufferAttribute(centers, i).applyMatrix4(matrix); entries.push({ source, index: i, depth: point.z });
                }
            });
            entries.sort((a, b) => a.source.renderOrder - b.source.renderOrder || a.depth - b.depth || a.source.id - b.source.id || a.index - b.index);
            while (pool.length > limit) { const mesh = pool.pop()!; mesh.removeFromParent(); disposeGeometry(mesh.geometry); }
            for (let rank = 0; rank < entries.length; rank++) {
                const { source, index } = entries[rank]!;
                let mesh = pool[rank];
                if (!mesh) { mesh = new THREE.Mesh(new THREE.InstancedBufferGeometry(), source.material); mesh.name = "three-game-kit-particle-alpha"; mesh.frustumCulled = false; pool.push(mesh); }
                const layout = Object.entries(source.geometry.attributes).filter(([, a]) => a instanceof THREE.InstancedBufferAttribute).map(([name, a]) => `${name}:${a.itemSize}`).join("|");
                if (mesh.userData.layout !== undefined && mesh.userData.layout !== layout) { disposeGeometry(mesh.geometry); mesh.geometry = new THREE.InstancedBufferGeometry(); }
                mesh.userData.layout = layout;
                const proxy = mesh, geometry = mesh.geometry;
                for (const name of Object.keys(geometry.attributes)) if (!(name in source.geometry.attributes)) geometry.deleteAttribute(name);
                geometry.setIndex(source.geometry.index);
                for (const [name, attribute] of Object.entries(source.geometry.attributes)) {
                    if (attribute instanceof THREE.InstancedBufferAttribute) {
                        let target = geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
                        if (!(target instanceof THREE.InstancedBufferAttribute) || target.itemSize !== attribute.itemSize) { target = new THREE.InstancedBufferAttribute(new Float32Array(attribute.itemSize), attribute.itemSize); geometry.setAttribute(name, target); }
                        for (let k = 0; k < attribute.itemSize; k++) target.array[k] = attribute.array[index * attribute.itemSize + k]!;
                        target.needsUpdate = true;
                    } else geometry.setAttribute(name, attribute);
                }
                geometry.instanceCount = 1; mesh.layers.mask = source.layers.mask; mesh.material = source.material; mesh.visible = true;
                mesh.castShadow = source.castShadow; mesh.receiveShadow = source.receiveShadow; mesh.customDepthMaterial = source.customDepthMaterial; mesh.customDistanceMaterial = source.customDistanceMaterial;
                // Within each public renderOrder bucket, fractional priorities preserve exact particle order.
                mesh.renderOrder = source.renderOrder + rank / (limit + 1);
                mesh.onBeforeRender = (renderer, scene, camera, _g, material, group) => { source.onBeforeRender(renderer, scene, camera, source.geometry, material, group); proxy.matrixWorld.copy(source.matrixWorld); };
                mesh.onBeforeShadow = (renderer, object, camera, shadowCamera, _g, material, group) => { source.onBeforeShadow(renderer, object, camera, shadowCamera, source.geometry, material, group); proxy.matrixWorld.copy(source.matrixWorld); };
                source.parent!.add(mesh); hidden.set(source, true); source.userData.particleSortReset = reset; mesh.userData.source = source;
                source.userData.particleSortCull = (visible: boolean) => { hidden.set(source, visible); for (const proxy of pool) if (proxy.userData.source === source) proxy.visible = visible; };
            }
            for (const source of hidden.keys()) source.visible = false;
        },
        dispose() { reset(); for (const mesh of pool) { mesh.removeFromParent(); disposeGeometry(mesh.geometry); } pool.length = 0; entries.length = 0; },
    };
}
