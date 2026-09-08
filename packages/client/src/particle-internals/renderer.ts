import * as THREE from "three";
import type { ParticleEmitterOptions } from "./types.js";
import { integer, number, record, vector } from "./validation.js";
import { createTrails } from "./trails.js";
import { createStandardMaterial } from "./standard-material.js";
import { usesAxes } from "./variation.js";
import { triangles } from "./shapes.js";
import type { createSpace } from "./space.js";
import { meshVariants } from "./mesh-variants.js";

/** @internal */
export function createRenderer(parent: THREE.Object3D, options: ParticleEmitterOptions, capacity: number, columns: number, rows: number, simulation: ReturnType<typeof createSpace>) {
    const render = options.renderer ? { ...options.renderer } : { kind: "billboard" as const };
    const initialRenderOrder = integer(options.renderOrder ?? 0, -1000000, 1000000, "renderOrder");
    const common = ["pivot", "flip", "minScreenSize", "maxScreenSize"];
    const pivot = vector(render.pivot ?? { x: 0, y: 0, z: 0 }, "renderer pivot");
    const flip = vector(render.flip ?? { x: 0, y: 0, z: 0 }, "renderer flip");
    for (const value of flip) number(value, 0, 1, "flip probability");
    const minimum = number(render.minScreenSize ?? 0, 0, 1, "minScreenSize"), maximum = number(render.maxScreenSize ?? 1, minimum, 1, "maxScreenSize");
    const screenSize = render.minScreenSize !== undefined || render.maxScreenSize !== undefined;
    const meshes = render.kind === "mesh" ? meshVariants(render, capacity) : undefined;
    let lengthScale = 1, velocityScale = 0.1, meshRadius = Math.SQRT1_2;
    let data: ReturnType<typeof triangles> | undefined;
    switch (render.kind) {
        case "billboard": case "horizontal": case "vertical": record(render, ["kind", ...common], "renderer"); break;
        case "stretched":
            record(render, ["kind", "lengthScale", "velocityScale", ...common], "renderer");
            lengthScale = number(render.lengthScale ?? 1, 0, 1e6, "lengthScale"); velocityScale = number(render.velocityScale ?? 0.1, 0, 1e6, "velocityScale"); break;
        case "mesh":
            record(render, ["kind", "positions", "indices", "uvs", "normals", "meshes", ...common], "renderer"); data = meshes![0]!.data; meshRadius = Math.max(...meshes!.map(m => m.radius));
            for (let i = 0; i < data.positions.length; i += 3) meshRadius = Math.max(meshRadius, Math.hypot(data.positions[i]!, data.positions[i + 1]!, data.positions[i + 2]!)); break;
        default: throw new TypeError("Invalid particle renderer");
    }
    for (const flag of [options.castShadow, options.receiveShadow]) if (flag !== undefined && typeof flag !== "boolean") throw new TypeError("shadow flags must be boolean");
    const standardSource = options.runtime?.material instanceof THREE.MeshStandardMaterial ? options.runtime.material : undefined;
    const light = options.lighting;
    if (light) record(light, ["ambient", "intensity", "direction", "color"], "lighting");
    const ambient = number(light?.ambient ?? 0.25, 0, 100, "ambient light"), intensity = number(light?.intensity ?? 1, 0, 100, "light intensity");
    const direction = vector(light?.direction ?? { x: 1, y: 2, z: 3 }, "light direction");
    if (light && !direction.lengthSq()) throw new TypeError("light direction cannot be zero");
    const lightColor = new THREE.Color(number(light?.color ?? 0xffffff, 0, 0xffffff, "light color"));
    const soft = options.runtime?.softParticles;
    const camera = soft?.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera | undefined;
    const attributeCount = 6 + (render.flip ? 1 : 0) + (render.kind === "mesh" || render.kind === "stretched" ? 1 : 0) + (usesAxes(options) ? 2 : 0) + (options.spriteSheet?.blend ? 1 : 0) + (options.customAttributes?.length ?? 0);
    if (attributeCount > 16) throw new TypeError("particle renderer exceeds the portable limit of 16 vertex attributes");
    const trails = createTrails(options, capacity);
    const world = options.simulationSpace === "world";
    const centers = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const appearances = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const dimensions = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const velocities = render.kind !== "stretched" && render.kind !== "mesh" ? undefined : new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const attribute = (size: number) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(THREE.DynamicDrawUsage);
    const axes = !!(usesAxes(options));
    const scales = axes ? attribute(3) : undefined, rotations = axes ? attribute(3) : undefined;
    const atlas = options.spriteSheet?.blend ? attribute(3) : undefined;
    const flips = render.flip ? attribute(3) : undefined;
    const birthFlips = flips ? new Float32Array(capacity * 3) : undefined;
    const customAttributes = (options.customAttributes ?? []).map(a => attribute(a.size));
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(data?.indices ?? [0, 1, 2, 0, 2, 3]);
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(data?.positions ?? [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    // Mesh UVs use planar XY projection; textures remain optional.
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(meshes?.[0]?.uvs ?? (data ? data.positions.flatMap((_, i) => i % 3 ? [] : [data!.positions[i]! + 0.5, data!.positions[i + 1]! + 0.5]) : [0, 0, 1, 0, 1, 1, 0, 1]), 2));
    geometry.setAttribute("particleCenter", centers); geometry.setAttribute("particleAppearance", appearances); geometry.setAttribute("particleDimensions", dimensions);
    if (velocities) geometry.setAttribute("particleVelocity", velocities);
    if (scales && rotations) { geometry.setAttribute("particleScale", scales); geometry.setAttribute("particleRotation", rotations); }
    if (flips) geometry.setAttribute("particleFlip", flips);
    if (atlas) geometry.setAttribute("particleAtlas", atlas);
    customAttributes.forEach((a, i) => geometry.setAttribute(options.customAttributes![i]!.name, a));
    if (meshes?.[0]?.normals) geometry.setAttribute("normal", new THREE.Float32BufferAttribute(meshes[0].normals, 3)); else geometry.computeVertexNormals(); geometry.instanceCount = 0;
    const fragment = `
        #include <packing>
        uniform sampler2D particleMap;
        #ifdef FRAME_BLEND
            varying vec2 vNextUv; varying float vFrameBlend;
        #endif
        #ifdef SOFT_PARTICLES
            uniform sampler2D sceneDepth;
            uniform vec4 depthCamera;
            uniform vec4 depthViewport;
        #endif
        #ifdef PARTICLE_LIGHT
            uniform vec3 lightDirection, lightColor;
            uniform vec2 lightPower;
            varying vec3 vNormal;
        #endif
        varying vec2 vParticleUv;
        varying vec2 vQuadUv;
        varying vec4 vAppearance;
        void main() {
            vec4 color = vAppearance;
            #ifdef PARTICLE_TEXTURE
                #ifdef FRAME_BLEND
                    color *= mix(texture2D(particleMap, vParticleUv), texture2D(particleMap, vNextUv), vFrameBlend);
                #else
                    color *= texture2D(particleMap, vParticleUv);
                #endif
            #elif !defined(MESH_PARTICLE) && !defined(TRAIL)
                float r = length(vQuadUv - 0.5) * 2.0;
                color.a *= 1.0 - smoothstep(0.65, 1.0, r);
            #endif
            #ifdef SOFT_PARTICLES
                float depth = texture2D(sceneDepth, (gl_FragCoord.xy - depthViewport.xy) / depthViewport.zw).x;
                float sceneZ = depthCamera.w > 0.5 ? perspectiveDepthToViewZ(depth, depthCamera.x, depthCamera.y) : orthographicDepthToViewZ(depth, depthCamera.x, depthCamera.y);
                float particleZ = depthCamera.w > 0.5 ? perspectiveDepthToViewZ(gl_FragCoord.z, depthCamera.x, depthCamera.y) : orthographicDepthToViewZ(gl_FragCoord.z, depthCamera.x, depthCamera.y);
                color.a *= clamp((particleZ - sceneZ) / depthCamera.z, 0.0, 1.0);
            #endif
            #ifdef PARTICLE_LIGHT
                vec3 normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
                color.rgb *= vec3(lightPower.x) + lightColor * lightPower.y * max(0.0, dot(normal, normalize(mat3(viewMatrix) * lightDirection)));
            #endif
            if (color.a <= 0.001) discard;
            gl_FragColor = color;
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }`;
    const material = (options.runtime?.material instanceof THREE.ShaderMaterial ? options.runtime.material : undefined) ?? new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, depthTest: options.depthTest ?? true,
        blending: options.blending === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending,
        side: !render.flip && (render.kind === "billboard" || render.kind === "stretched") ? THREE.FrontSide : THREE.DoubleSide,
        uniforms: {
            particlePivot: { value: pivot }, screenLimits: { value: new THREE.Vector2(minimum, maximum) }, particleDiameter: { value: render.kind === "mesh" ? 2 * meshRadius : 1 },
            lightDirection: { value: direction.normalize() }, lightColor: { value: lightColor }, lightPower: { value: new THREE.Vector2(ambient, intensity) },
            sceneDepth: { value: soft?.depthTexture ?? null }, depthCamera: { value: new THREE.Vector4(camera?.near ?? 0.1, camera?.far ?? 1000, soft?.fadeDistance ?? 0.5, camera instanceof THREE.PerspectiveCamera ? 1 : 0) }, depthViewport: { value: new THREE.Vector4(soft?.origin?.x ?? 0, soft?.origin?.y ?? 0, soft?.width ?? 1, soft?.height ?? 1) },
            particleMap: { value: options.texture ?? null }, sheet: { value: new THREE.Vector2(columns, rows) }, stretch: { value: new THREE.Vector2(lengthScale, velocityScale) } },
        defines: { ...(flips ? { PARTICLE_FLIP: 1 } : {}), ...(screenSize ? { SCREEN_SIZE: 1 } : {}), ...(axes ? { AXES: 1 } : {}), ...(atlas ? { FRAME_BLEND: 1 } : {}), ...(soft ? { SOFT_PARTICLES: 1 } : {}), ...(light ? { PARTICLE_LIGHT: 1 } : {}), ...(render.kind === "horizontal" ? { HORIZONTAL: 1 } : {}), ...(render.kind === "vertical" ? { VERTICAL: 1 } : {}), ...(options.texture ? { PARTICLE_TEXTURE: 1 } : {}), ...(world ? { WORLD_SPACE: 1 } : {}), ...(render.kind === "mesh" ? { MESH_PARTICLE: 1 } : {}), ...(render.kind === "stretched" ? { STRETCHED: 1 } : {}) },
        vertexShader: `
            uniform vec3 particlePivot;
            uniform vec2 screenLimits; uniform float particleDiameter;
            #ifdef PARTICLE_FLIP
                attribute vec3 particleFlip;
            #endif
            #ifdef AXES
                attribute vec3 particleScale, particleRotation;
            #endif
            #ifdef FRAME_BLEND
                attribute vec3 particleAtlas;
                varying vec2 vNextUv; varying float vFrameBlend;
            #endif
            #ifdef PARTICLE_LIGHT
                varying vec3 vNormal;
            #endif
            vec3 rotateParticle(vec3 v, vec3 r) {
                vec3 c = cos(r), s = sin(r);
                v.yz = mat2(c.x, s.x, -s.x, c.x) * v.yz;
                v.xz = mat2(c.y, -s.y, s.y, c.y) * v.xz;
                v.xy = mat2(c.z, s.z, -s.z, c.z) * v.xy;
                return v;
            }
            attribute vec3 particleCenter;
            attribute vec4 particleAppearance;
            attribute vec3 particleDimensions;
            #if defined(STRETCHED) || defined(MESH_PARTICLE)
                attribute vec3 particleVelocity;
            #endif
            uniform vec2 sheet;
            uniform vec2 stretch;
            varying vec2 vParticleUv;
            varying vec2 vQuadUv;
            varying vec4 vAppearance;
            void main() {
                vec3 vertexPosition = position + particlePivot;
                vec4 viewPosition;
                vec3 vertexNormal = normal;
                #ifdef PARTICLE_FLIP
                    vertexPosition *= particleFlip; vertexNormal *= particleFlip;
                #endif
                #ifdef AXES
                    vertexPosition = rotateParticle(vertexPosition * particleScale, particleRotation);
                    vertexNormal = rotateParticle(vertexNormal / max(particleScale, vec3(0.00001)), particleRotation);
                #endif
                float c = cos(particleDimensions.y), s = sin(particleDimensions.y);
                vec2 offset = mat2(c, s, -s, c) * vertexPosition.xy * particleDimensions.x;
                #ifdef WORLD_SPACE
                    vec4 center = viewMatrix * vec4(particleCenter, 1.0);
                    mat3 basis = mat3(viewMatrix);
                    float parentScale = 1.0;
                #else
                    vec4 center = modelViewMatrix * vec4(particleCenter, 1.0);
                    mat3 basis = mat3(modelViewMatrix);
                    float parentScale = length(modelMatrix[0].xyz);
                #endif
                #ifdef STRETCHED
                    vec3 velocity = basis * particleVelocity;
                    vec2 direction = length(velocity.xy) > 0.00001 ? normalize(velocity.xy) : vec2(0.0, 1.0);
                    vec2 sideways = vec2(direction.y, -direction.x);
                    offset = sideways * vertexPosition.x * particleDimensions.x * parentScale + direction * vertexPosition.y * (particleDimensions.x * parentScale * stretch.x + length(velocity) * stretch.y);
                    viewPosition = (center + vec4(offset, vertexPosition.z * particleDimensions.x * parentScale, 0.0));
                #elif defined(MESH_PARTICLE)
                    vec3 up = length(particleVelocity) > 0.00001 ? normalize(particleVelocity) : vec3(0.0, 1.0, 0.0);
                    vec3 helper = abs(up.z) < 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
                    vec3 right = normalize(cross(up, helper));
                    vec3 forward = cross(right, up);
                    #ifdef AXES
                        right = vec3(1.0, 0.0, 0.0); up = vec3(0.0, 1.0, 0.0); forward = vec3(0.0, 0.0, 1.0);
                    #endif
                    vec3 vertex = vec3(c * vertexPosition.x - s * vertexPosition.z, vertexPosition.y, s * vertexPosition.x + c * vertexPosition.z);
                    vec3 displacement = (right * vertex.x + up * vertex.y + forward * vertex.z) * particleDimensions.x;
                    viewPosition = (center + vec4(basis * displacement, 0.0));
                    #ifdef PARTICLE_LIGHT
                        vec3 rotatedNormal = vec3(c * vertexNormal.x - s * vertexNormal.z, vertexNormal.y, s * vertexNormal.x + c * vertexNormal.z);
                        vNormal = normalMatrix * (right * rotatedNormal.x + up * rotatedNormal.y + forward * rotatedNormal.z);
                        #ifdef WORLD_SPACE
                            vNormal = mat3(viewMatrix) * (right * rotatedNormal.x + up * rotatedNormal.y + forward * rotatedNormal.z);
                        #endif
                    #endif
                #elif defined(HORIZONTAL)
                    viewPosition = (center + vec4(basis * vec3(offset.x, vertexPosition.z * particleDimensions.x, offset.y), 0.0));
                #elif defined(VERTICAL)
                    vec3 up = normalize(basis * vec3(0.0, 1.0, 0.0));
                    vec3 right = cross(up, vec3(0.0, 0.0, 1.0));
                    if (length(right) < 0.00001) right = vec3(1.0, 0.0, 0.0);
                    viewPosition = (center + vec4((normalize(right) * offset.x + up * offset.y + cross(normalize(right), up) * vertexPosition.z * particleDimensions.x) * parentScale, 0.0));
                #else
                    offset *= parentScale;
                    viewPosition = (center + vec4(offset, vertexPosition.z * particleDimensions.x * parentScale, 0.0));
                #endif
                #ifdef SCREEN_SIZE
                    float nominal = particleDimensions.x * parentScale * particleDiameter;
                    #ifdef AXES
                        nominal *= max(particleScale.x, max(particleScale.y, particleScale.z));
                    #endif
                    float projected = abs(projectionMatrix[1][1] * nominal / (projectionMatrix[3][3] == 0.0 ? max(abs(center.z), 0.00001) : 1.0)) * 0.5;
                    if (projected > 0.000001) viewPosition.xyz = center.xyz + (viewPosition.xyz - center.xyz) * clamp(projected, screenLimits.x, screenLimits.y) / projected;
                #endif
                gl_Position = projectionMatrix * viewPosition;
                #if defined(PARTICLE_LIGHT) && !defined(MESH_PARTICLE)
                    vec3 faceNormal = vec3(c * vertexNormal.x - s * vertexNormal.y, s * vertexNormal.x + c * vertexNormal.y, vertexNormal.z);
                    #ifdef HORIZONTAL
                        #ifdef WORLD_SPACE
                            vNormal = basis * vec3(faceNormal.x, faceNormal.z, faceNormal.y);
                        #else
                            vNormal = normalMatrix * vec3(faceNormal.x, faceNormal.z, faceNormal.y);
                        #endif
                    #elif defined(VERTICAL)
                        vNormal = normalize(right) * faceNormal.x + up * faceNormal.y + cross(normalize(right), up) * faceNormal.z;
                    #else
                        vNormal = faceNormal;
                    #endif
                #endif
                #ifdef FRAME_BLEND
                    vNextUv = (uv + vec2(mod(particleAtlas.x, sheet.x), floor(particleAtlas.x / sheet.x))) / sheet;
                    vFrameBlend = particleAtlas.y;
                #endif
                float frame = particleDimensions.z;
                vParticleUv = (uv + vec2(mod(frame, sheet.x), floor(frame / sheet.x))) / sheet;
                vQuadUv = uv; vAppearance = particleAppearance;
            }`, fragmentShader: fragment,
    });
    const standard = standardSource ? createStandardMaterial(standardSource, material) : undefined;
    const mesh = new THREE.Mesh(geometry, standard?.material ?? material);
    mesh.castShadow = options.castShadow ?? false; mesh.receiveShadow = options.receiveShadow ?? false;
    if (standard) { if (flips) standard.material.side = THREE.DoubleSide; mesh.customDepthMaterial = standard.depth; mesh.customDistanceMaterial = standard.distance; mesh.onBeforeRender = (_renderer, _scene, camera) => standard.update(camera, mesh); mesh.onBeforeShadow = (_renderer, _object, _camera, shadowCamera) => standard.update(shadowCamera, mesh); } mesh.name = "three-game-kit-particles"; mesh.frustumCulled = false; mesh.visible = false;
    mesh.userData.particleCustomMaterial = !!options.runtime?.material;
    const attributes = [centers, appearances, dimensions, ...(velocities ? [velocities] : []), ...(scales && rotations ? [scales, rotations] : []), ...(atlas ? [atlas] : []), ...(flips ? [flips] : []), ...customAttributes];
    const variants = [{ mesh, geometry, attributes }, ...(meshes?.slice(1).map(entry => {
        const g = new THREE.InstancedBufferGeometry(); g.setIndex(entry.data.indices);
        g.setAttribute("position", new THREE.Float32BufferAttribute(entry.data.positions, 3));
        g.setAttribute("uv", new THREE.Float32BufferAttribute(entry.uvs, 2));
        if (entry.normals) g.setAttribute("normal", new THREE.Float32BufferAttribute(entry.normals, 3)); else g.computeVertexNormals();
        const m = new THREE.Mesh(g, mesh.material); m.name = mesh.name; m.castShadow = mesh.castShadow; m.receiveShadow = mesh.receiveShadow;
        m.customDepthMaterial = mesh.customDepthMaterial; m.customDistanceMaterial = mesh.customDistanceMaterial;
        m.frustumCulled = false; m.visible = false; g.instanceCount = 0;
        return { mesh: m, geometry: g, attributes: [] as THREE.InstancedBufferAttribute[] };
    }) ?? [])];
    const choiceCapacity = variants.length > 1 ? capacity : 0;
    const choices = new Uint8Array(choiceCapacity), displayChoices = new Uint8Array(choiceCapacity), choiceScratch = new Uint8Array(choiceCapacity);
    const attributeNames = Object.entries(geometry.attributes).filter(([, a]) => attributes.includes(a as THREE.InstancedBufferAttribute)).map(([name, a]) => [name, attributes.indexOf(a as THREE.InstancedBufferAttribute)] as const);
    if (variants.length > 1) for (const entry of variants) {
        entry.attributes = attributes.map(a => attribute(a.itemSize));
        for (const [name, index] of attributeNames) entry.geometry.setAttribute(name, entry.attributes[index]!);
    }
    let activeCount = 0;
    function gather() {
        if (variants.length === 1) { geometry.instanceCount = activeCount; mesh.visible = activeCount > 0; return; }
        for (const entry of variants) entry.geometry.instanceCount = 0;
        for (let i = 0; i < activeCount; i++) {
            const entry = variants[displayChoices[i]!]!, target = entry.geometry.instanceCount++;
            attributes.forEach((a, j) => { for (let k = 0; k < a.itemSize; k++) entry.attributes[j]!.array[target * a.itemSize + k] = a.array[i * a.itemSize + k]!; });
        }
        for (const entry of variants) { entry.mesh.visible = entry.geometry.instanceCount > 0; for (const a of entry.attributes) dirty(a, entry.geometry.instanceCount); }
    }
    function setRenderOrder(order: number) { integer(order, -1000000, 1000000, "renderOrder"); for (const e of variants) e.mesh.renderOrder = order; if (trails) trails.mesh.renderOrder = order; }
    setRenderOrder(initialRenderOrder);
    for (const entry of variants) {
        entry.mesh.userData.particleCustomMaterial = !!options.runtime?.material || simulation.independent || variants.length > 1;
        entry.mesh.onBeforeRender = (_r, _s, c) => { simulation.apply(entry.mesh); standard?.update(c, entry.mesh); };
        entry.mesh.onBeforeShadow = (_r, _o, _c, c) => { simulation.apply(entry.mesh); standard?.update(c, entry.mesh); };
        parent.add(entry.mesh);
    }
    if (trails) { parent.add(trails.mesh); trails.mesh.onBeforeRender = () => simulation.apply(trails.mesh); }

    const bounds = new THREE.Box3(), point = new THREE.Vector3(), sphere = new THREE.Sphere(), frustum = new THREE.Frustum(), matrix = new THREE.Matrix4();
    let culled = false;
    function dirty(a: THREE.InstancedBufferAttribute, count: number) { a.clearUpdateRanges(); if (count) { a.addUpdateRange(0, count * a.itemSize); a.needsUpdate = true; } }
    return {
        setRenderOrder,
        sorted(order: ArrayLike<number>) { if (variants.length === 1) return; choiceScratch.set(displayChoices); for (let i = 0; i < order.length; i++) displayChoices[i] = choiceScratch[order[i]!]!; gather(); },
        geometry, material, mesh, attributes, centers, appearances, dimensions, velocities, scales, rotations, atlas, customAttributes,
        get culled() { return culled; },
        get resourceCount() { return variants.length + (trails ? 1 : 0); },
        get materialCount() { return (trails ? 1 : 0) + (standard ? 4 : options.runtime?.material ? 0 : 1); },
        get activeTrailCount() { return trails?.activeTrailCount ?? 0; },
        clear() { trails?.clear(); },
        setDepthSource(texture: THREE.Texture, width: number, height: number, origin = { x: 0, y: 0 }) {
            if (!soft || options.runtime?.material instanceof THREE.ShaderMaterial) throw new TypeError("setDepthSource requires the built-in soft-particle material");
            if (!(texture instanceof THREE.Texture)) throw new TypeError("depth source must be a Texture");
            number(width, 1, 65536, "depth width"); number(height, 1, 65536, "depth height");
            record(origin, ["x", "y"], "depth origin"); number(origin.x, -65536, 65536, "depth origin x"); number(origin.y, -65536, 65536, "depth origin y");
            material.uniforms.sceneDepth!.value = texture; material.uniforms.depthViewport!.value.set(origin.x, origin.y, width, height);
        },
        birth(i: number, p: THREE.Vector3, time: number, id: number, random: () => number) {
            if (meshes && meshes.length > 1) { const value = random() * meshes.reduce((n, m) => n + m.weight, 0); let sum = 0; choices[i] = meshes.length - 1; for (let k = 0; k < meshes.length; k++) { sum += meshes[k]!.weight; if (value < sum) { choices[i] = k; break; } } }
            if (birthFlips) { birthFlips[i * 3] = random() < flip.x ? -1 : 1; birthFlips[i * 3 + 1] = random() < flip.y ? -1 : 1; birthFlips[i * 3 + 2] = random() < flip.z ? -1 : 1; }
            trails?.birth(i, p, time, id);
        },
        appearance(i: number, color: THREE.Color, alpha: number) { trails?.appearance(i, color, alpha); },
        remove(i: number, last: number, time: number, endpoint: THREE.Vector3) { choices[i] = choices[last]!; birthFlips?.copyWithin(i * 3, last * 3, last * 3 + 3); trails?.remove(i, last, time, endpoint); },
        sample(i: number, p: THREE.Vector3, time: number) { trails?.sample(i, p, time); },
        upload(active: number, time: number) {
            culled = false;
            if (camera && !(options.runtime?.material instanceof THREE.ShaderMaterial)) material.uniforms.depthCamera!.value.set(camera.near, camera.far, soft!.fadeDistance ?? 0.5, camera instanceof THREE.PerspectiveCamera ? 1 : 0);
            if (flips && birthFlips) flips.array.set(birthFlips);
            for (const a of attributes) dirty(a, active);
            activeCount = active; displayChoices.set(choices); gather();
            trails?.upload(active, time, centers);
        },
        cull(camera: THREE.Camera) {
            simulation.update(); camera.updateWorldMatrix(true, false);
            bounds.makeEmpty(); let padding = 0;
            for (let i = 0; i < activeCount; i++) {
                point.fromBufferAttribute(centers, i); bounds.expandByPoint(point);
                const speed = velocities ? Math.hypot(velocities.getX(i), velocities.getY(i), velocities.getZ(i)) : 0;
                padding = Math.max(padding, dimensions.getX(i) * (meshRadius + pivot.length()) * (scales ? Math.max(scales.getX(i), scales.getY(i), scales.getZ(i)) : 1), render.kind === "stretched" ? (dimensions.getX(i) * (1 + lengthScale) + speed * velocityScale) * (scales ? Math.max(scales.getX(i), scales.getY(i), scales.getZ(i)) : 1) / 2 : 0);
            }
            if (trails) { trails.expand(bounds); padding = Math.max(padding, trails.maxWidth); }
            if (!world) {
                bounds.applyMatrix4(simulation.matrix);
                // Frobenius norm bounds any stretch/shear, including billboard offsets
                // whose camera-facing orientation is independent of the parent axes.
                const e = simulation.matrix.elements;
                padding *= Math.hypot(e[0]!, e[1]!, e[2]!, e[4]!, e[5]!, e[6]!, e[8]!, e[9]!, e[10]!);
            }
            bounds.expandByScalar(padding);
            bounds.getBoundingSphere(sphere); matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(matrix);
            culled = bounds.isEmpty() || (!screenSize && !frustum.intersectsSphere(sphere));
            for (const entry of variants) entry.mesh.visible = !culled && entry.geometry.instanceCount > 0; if (trails) trails.mesh.visible = !culled && trails.mesh.geometry.instanceCount > 0;
            return !culled;
        },
        dispose() { for (const entry of variants) { entry.mesh.removeFromParent(); entry.geometry.dispose(); } standard?.dispose(); if (standard || !options.runtime?.material) { material.dispose(); material.uniforms.particleMap!.value = null; material.uniforms.sceneDepth!.value = null; } trails?.dispose(); },
    };
}
