import * as THREE from "three";

/** Adapt the same particle vertex transform for PBR, depth and point-light shadows. @internal */
export function createStandardMaterial(source: THREE.MeshStandardMaterial, template: THREE.ShaderMaterial) {
    const material = source.clone();
    material.map ??= template.uniforms.particleMap!.value as THREE.Texture | null;
    material.transparent = true; material.depthWrite = source.depthWrite;
    const inverse = new THREE.Matrix4();
    const shared = { ...template.uniforms, particleInverseModelView: { value: inverse } };
    let vertex = template.vertexShader.replace(/vNormal/g, "particleViewNormal").replace("void main()", "void particleVertex()");
    vertex = vertex.replace(/gl_Position = projectionMatrix \* (.*);/g, "particleViewPosition = $1;");
    vertex = "uniform mat4 particleInverseModelView;\nvec4 particleViewPosition;\n" + vertex;
    function adapt(target: THREE.MeshStandardMaterial | THREE.MeshDepthMaterial | THREE.MeshDistanceMaterial) {
        const original = source.onBeforeCompile, originalKey = source.customProgramCacheKey();
        target.onBeforeCompile = (shader, renderer) => {
            if (target === material) original.call(source, shader, renderer);
            if (!shader.vertexShader.includes("#include <begin_vertex>")) throw new Error("Particle standard material requires the begin_vertex shader hook");
            Object.assign(shader.uniforms, shared);
            shader.vertexShader = vertex + "\n" + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace("void main() {", "void main() {\nparticleVertex();")
                .replace("#include <uv_vertex>", THREE.ShaderChunk.uv_vertex.replace(/vec3\(\s*[A-Z_]+_UV\s*,\s*1\s*\)/g, "vec3(vParticleUv, 1)"))
                .replace("#include <begin_vertex>", "vec3 transformed = (particleInverseModelView * particleViewPosition).xyz;")
                .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nobjectNormal = transpose(mat3(modelViewMatrix)) * particleViewNormal;");
            shader.fragmentShader = "varying vec4 vAppearance; varying vec2 vParticleUv; varying vec2 vQuadUv;\n" + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
                #include <map_fragment>
                diffuseColor *= vAppearance;
                #if !defined(USE_MAP) && !defined(MESH_PARTICLE)
                    diffuseColor.a *= 1.0 - smoothstep(0.65, 1.0, length(vQuadUv - 0.5) * 2.0);
                #endif
                if (diffuseColor.a <= 0.001) discard;
            `);
        };
        target.defines = { ...target.defines, ...template.defines, PARTICLE_LIGHT: 1 };
        target.customProgramCacheKey = () => `particles-standard-v1:${originalKey}:${JSON.stringify(template.defines)}`;
    }
    adapt(material);
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: material.map, alphaMap: material.alphaMap, alphaTest: material.alphaTest, side: material.side });
    const distance = new THREE.MeshDistanceMaterial({ map: material.map, alphaMap: material.alphaMap, alphaTest: material.alphaTest, side: material.side });
    adapt(depth); adapt(distance);
    return { material, depth, distance,
        update(camera: THREE.Camera, mesh: THREE.Object3D) { inverse.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld).invert(); },
        dispose() { material.dispose(); depth.dispose(); distance.dispose(); },
    };
}
