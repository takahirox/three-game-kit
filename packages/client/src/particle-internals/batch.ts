import * as THREE from "three";

/** Merge compatible instance buffers under one parent. Source simulations stay independent. */
/** @internal */
export function createBatches(parent: THREE.Object3D) {
    const groups = new Map<string, THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>[]>();
    for (const child of parent.children) {
        if (!(child instanceof THREE.Mesh) || !(child.geometry instanceof THREE.InstancedBufferGeometry) || !(child.material instanceof THREE.ShaderMaterial)) continue;
        const g = child.geometry, m = child.material;
        if (m.blending !== THREE.AdditiveBlending) continue;
        const key = JSON.stringify({ vertex: m.vertexShader, fragment: m.fragmentShader, defines: m.defines, blending: m.blending, depth: m.depthTest, side: m.side,
            uniforms: Object.fromEntries(Object.entries(m.uniforms).map(([k, u]) => [k, u.value instanceof THREE.Texture ? u.value.uuid : u.value])),
            index: Array.from(g.index?.array ?? []),
            attributes: Object.fromEntries(Object.entries(g.attributes).map(([k, a]) => [k, a instanceof THREE.InstancedBufferAttribute ? a.itemSize : Array.from(a.array)])),
        });
        const group = groups.get(key) ?? []; group.push(child as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>); groups.set(key, group);
    }
    const batches = [...groups.values()].filter(g => g.length > 1).map(sources => {
        const first = sources[0]!, geometry = new THREE.InstancedBufferGeometry();
        if (first.geometry.index) geometry.setIndex(first.geometry.index.clone());
        for (const [name, attr] of Object.entries(first.geometry.attributes)) {
            if (attr instanceof THREE.InstancedBufferAttribute) {
                const length = sources.reduce((sum, source) => sum + source.geometry.getAttribute(name).array.length, 0);
                geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(length), attr.itemSize).setUsage(THREE.DynamicDrawUsage));
            } else geometry.setAttribute(name, attr.clone());
        }
        geometry.instanceCount = 0;
        const mesh = new THREE.Mesh(geometry, first.material); mesh.name = "three-game-kit-particle-batch"; mesh.frustumCulled = false; mesh.visible = false; parent.add(mesh);
        return { sources, geometry, mesh };
    });
    return {
        drawSavings: batches.reduce((sum, b) => sum + b.sources.length - 1, 0),
        count: batches.length,
        update() {
            for (const b of batches) {
                let count = 0;
                for (const source of b.sources) {
                    if (!source.visible) continue;
                    const n = source.geometry.instanceCount;
                    for (const [name, attr] of Object.entries(b.geometry.attributes)) if (attr instanceof THREE.InstancedBufferAttribute) {
                        const input = source.geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
                        (attr.array as Float32Array).set(input.array.subarray(0, n * attr.itemSize), count * attr.itemSize);
                    }
                    count += n; source.visible = false;
                }
                for (const attr of Object.values(b.geometry.attributes)) if (attr instanceof THREE.InstancedBufferAttribute) {
                    attr.clearUpdateRanges(); if (count) { attr.addUpdateRange(0, count * attr.itemSize); attr.needsUpdate = true; }
                }
                b.geometry.instanceCount = count; b.mesh.visible = count > 0;
            }
        },
        dispose() { for (const b of batches) { b.mesh.removeFromParent(); b.geometry.dispose(); } },
    };
}
