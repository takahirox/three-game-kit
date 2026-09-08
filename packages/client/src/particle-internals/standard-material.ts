import * as THREE from "three";

/** Adapt the same particle vertex transform for PBR, depth and point-light shadows. @internal */
export function createStandardMaterial(source: THREE.MeshStandardMaterial, template: THREE.ShaderMaterial) {
    const material = source.clone();
    material.map ??= template.uniforms.particleMap!.value as THREE.Texture | null;
    if (template.defines.PARTICLE_FLIP) material.side = THREE.DoubleSide;
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
            if (template.defines.FRAME_BLEND) {
                shader.fragmentShader = "varying vec2 vNextUv; varying float vFrameBlend;\n" + shader.fragmentShader;
                const maps = ["map", "alphaMap", "emissiveMap", "roughnessMap", "metalnessMap", "normalMap", "aoMap", "lightMap", "bumpMap"];
                for (const map of maps) shader.fragmentShader = `#ifdef USE_${map.toUpperCase()}\nuniform mat3 ${map}Transform;\n#endif\n` + shader.fragmentShader;
                const chunks = ["map_fragment", "alphamap_fragment", "emissivemap_fragment", "roughnessmap_fragment", "metalnessmap_fragment", "normal_fragment_maps", "aomap_fragment", "lights_fragment_maps", "bumpmap_pars_fragment"] as const;
                for (const name of chunks) {
                    let chunk = THREE.ShaderChunk[name];
                    for (const map of maps) chunk = chunk.replace(new RegExp(`texture2D\\(\\s*${map}\\s*,\\s*([^;]+?)\\s*\\)`, "g"), (_match, uv: string) => `mix(texture2D(${map}, ${uv}), texture2D(${map}, (${uv}) + mat2(${map}Transform) * (vNextUv - vParticleUv)), vFrameBlend)`);
                    shader.fragmentShader = shader.fragmentShader.replace(`#include <${name}>`, chunk);
                }
            }
            if (target === material && template.defines.SOFT_PARTICLES) {
                if (!shader.fragmentShader.includes("#include <packing>")) shader.fragmentShader = "#include <packing>\n" + shader.fragmentShader;
                shader.fragmentShader = "uniform sampler2D sceneDepth; uniform vec4 depthCamera, depthViewport;\n" + shader.fragmentShader;
                shader.fragmentShader = shader.fragmentShader.replace("#include <alphatest_fragment>", `
                    float depth = texture2D(sceneDepth, (gl_FragCoord.xy - depthViewport.xy) / depthViewport.zw).x;
                    float sceneZ = depthCamera.w > 0.5 ? perspectiveDepthToViewZ(depth, depthCamera.x, depthCamera.y) : orthographicDepthToViewZ(depth, depthCamera.x, depthCamera.y);
                    float particleZ = depthCamera.w > 0.5 ? perspectiveDepthToViewZ(gl_FragCoord.z, depthCamera.x, depthCamera.y) : orthographicDepthToViewZ(gl_FragCoord.z, depthCamera.x, depthCamera.y);
                    diffuseColor.a *= clamp((particleZ - sceneZ) / depthCamera.z, 0.0, 1.0);
                    #include <alphatest_fragment>
                `);
            }
            shader.fragmentShader = shader.fragmentShader.replace("#include <alphatest_fragment>", `
                diffuseColor *= vAppearance;
                #if !defined(USE_MAP) && !defined(MESH_PARTICLE)
                    diffuseColor.a *= 1.0 - smoothstep(0.65, 1.0, length(vQuadUv - 0.5) * 2.0);
                #endif
                if (diffuseColor.a <= 0.001) discard;
                #include <alphatest_fragment>
            `);
        };
        target.defines = { ...target.defines, ...template.defines, PARTICLE_LIGHT: 1 };
        target.customProgramCacheKey = () => `particles-standard-v2:${originalKey}:${JSON.stringify(template.defines)}`;
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
