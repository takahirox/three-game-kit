import * as THREE from "three";
import type { ParticleEmitterOptions } from "./types.js";
import { integer, number, record } from "./validation.js";
import { triangles } from "./shapes.js";

/** @internal */
export function createRenderer(parent: THREE.Object3D, options: ParticleEmitterOptions, capacity: number, columns: number, rows: number) {
    const render = options.renderer ?? { kind: "billboard" };
    let lengthScale = 1, velocityScale = 0.1, meshRadius = Math.SQRT1_2;
    let data: ReturnType<typeof triangles> | undefined;
    switch (render.kind) {
        case "billboard": record(render, ["kind"], "renderer"); break;
        case "stretched":
            record(render, ["kind", "lengthScale", "velocityScale"], "renderer");
            lengthScale = number(render.lengthScale ?? 1, 0, 1e6, "lengthScale"); velocityScale = number(render.velocityScale ?? 0.1, 0, 1e6, "velocityScale"); break;
        case "mesh":
            record(render, ["kind", "positions", "indices"], "renderer"); data = triangles(render.positions, render.indices); meshRadius = 0;
            for (let i = 0; i < data.positions.length; i += 3) meshRadius = Math.max(meshRadius, Math.hypot(data.positions[i]!, data.positions[i + 1]!, data.positions[i + 2]!)); break;
        default: throw new TypeError("Invalid particle renderer");
    }
    let segments = 0, interval = 0, width = 0;
    if (options.trails !== undefined) {
        record(options.trails, ["segments", "intervalMs", "width"], "trails");
        segments = integer(options.trails.segments ?? 12, 2, 64, "trail segments");
        if (capacity * segments > 1048576) throw new TypeError("trail capacity * segments must not exceed 1048576");
        interval = number(options.trails.intervalMs ?? 32, 1, 1e6, "trail intervalMs");
        width = number(options.trails.width ?? 0.04, 0, 1e6, "trail width");
    }
    const world = options.simulationSpace === "world";
    const centers = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const appearances = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const dimensions = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const velocities = render.kind === "billboard" ? undefined : new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(data?.indices ?? [0, 1, 2, 0, 2, 3]);
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(data?.positions ?? [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    // Mesh UVs use planar XY projection; textures remain optional.
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(data ? data.positions.flatMap((_, i) => i % 3 ? [] : [data!.positions[i]! + 0.5, data!.positions[i + 1]! + 0.5]) : [0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.setAttribute("particleCenter", centers); geometry.setAttribute("particleAppearance", appearances); geometry.setAttribute("particleDimensions", dimensions);
    if (velocities) geometry.setAttribute("particleVelocity", velocities);
    geometry.instanceCount = 0;
    const fragment = `
        uniform sampler2D particleMap;
        varying vec2 vParticleUv;
        varying vec2 vQuadUv;
        varying vec4 vAppearance;
        void main() {
            vec4 color = vAppearance;
            #ifdef PARTICLE_TEXTURE
                color *= texture2D(particleMap, vParticleUv);
            #elif !defined(MESH_PARTICLE) && !defined(TRAIL)
                float r = length(vQuadUv - 0.5) * 2.0;
                color.a *= 1.0 - smoothstep(0.65, 1.0, r);
            #endif
            if (color.a <= 0.001) discard;
            gl_FragColor = color;
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }`;
    const material = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, depthTest: options.depthTest ?? true,
        blending: options.blending === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending,
        side: render.kind === "mesh" ? THREE.DoubleSide : THREE.FrontSide,
        uniforms: { particleMap: { value: options.texture ?? null }, sheet: { value: new THREE.Vector2(columns, rows) }, stretch: { value: new THREE.Vector2(lengthScale, velocityScale) } },
        defines: { ...(options.texture ? { PARTICLE_TEXTURE: 1 } : {}), ...(world ? { WORLD_SPACE: 1 } : {}), ...(render.kind === "mesh" ? { MESH_PARTICLE: 1 } : {}), ...(render.kind === "stretched" ? { STRETCHED: 1 } : {}) },
        vertexShader: `
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
                float c = cos(particleDimensions.y), s = sin(particleDimensions.y);
                vec2 offset = mat2(c, s, -s, c) * position.xy * particleDimensions.x;
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
                    offset = sideways * position.x * particleDimensions.x * parentScale + direction * position.y * (particleDimensions.x * parentScale * stretch.x + length(velocity) * stretch.y);
                    gl_Position = projectionMatrix * (center + vec4(offset, 0.0, 0.0));
                #elif defined(MESH_PARTICLE)
                    vec3 up = length(particleVelocity) > 0.00001 ? normalize(particleVelocity) : vec3(0.0, 1.0, 0.0);
                    vec3 helper = abs(up.z) < 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
                    vec3 right = normalize(cross(up, helper));
                    vec3 forward = cross(right, up);
                    vec3 vertex = vec3(c * position.x - s * position.z, position.y, s * position.x + c * position.z);
                    vec3 displacement = (right * vertex.x + up * vertex.y + forward * vertex.z) * particleDimensions.x;
                    gl_Position = projectionMatrix * (center + vec4(basis * displacement, 0.0));
                #else
                    offset *= parentScale;
                    gl_Position = projectionMatrix * (center + vec4(offset, 0.0, 0.0));
                #endif
                float frame = particleDimensions.z;
                vParticleUv = (uv + vec2(mod(frame, sheet.x), floor(frame / sheet.x))) / sheet;
                vQuadUv = uv; vAppearance = particleAppearance;
            }`, fragmentShader: fragment,
    });
    const mesh = new THREE.Mesh(geometry, material); mesh.name = "three-game-kit-particles"; mesh.frustumCulled = false; mesh.visible = false;
    const attributes = [centers, appearances, dimensions, ...(velocities ? [velocities] : [])];
    const history = new Float32Array(capacity * segments * 3), counts = new Uint8Array(segments ? capacity : 0), heads = new Uint8Array(counts.length), lastSample = new Float64Array(counts.length);
    let trail: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> | undefined;
    let trailStarts: THREE.InstancedBufferAttribute | undefined, trailEnds: THREE.InstancedBufferAttribute | undefined, trailColors: THREE.InstancedBufferAttribute | undefined;
    if (segments) {
        const g = new THREE.InstancedBufferGeometry(); g.setIndex([0, 1, 2, 0, 2, 3]);
        g.setAttribute("position", new THREE.Float32BufferAttribute([0, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, 0, 0.5, 0], 3));
        g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
        trailStarts = new THREE.InstancedBufferAttribute(new Float32Array(capacity * segments * 3), 3).setUsage(THREE.DynamicDrawUsage);
        trailEnds = new THREE.InstancedBufferAttribute(new Float32Array(capacity * segments * 3), 3).setUsage(THREE.DynamicDrawUsage);
        trailColors = new THREE.InstancedBufferAttribute(new Float32Array(capacity * segments * 4), 4).setUsage(THREE.DynamicDrawUsage);
        g.setAttribute("segmentStart", trailStarts); g.setAttribute("segmentEnd", trailEnds); g.setAttribute("particleAppearance", trailColors); g.instanceCount = 0;
        const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: material.depthTest, blending: material.blending, side: THREE.DoubleSide,
            uniforms: { width: { value: width } }, defines: { TRAIL: 1, ...(world ? { WORLD_SPACE: 1 } : {}) }, fragmentShader: fragment,
            vertexShader: `
                attribute vec3 segmentStart;
                attribute vec3 segmentEnd;
                attribute vec4 particleAppearance;
                uniform float width;
                varying vec2 vParticleUv;
                varying vec2 vQuadUv;
                varying vec4 vAppearance;
                void main() {
                    #ifdef WORLD_SPACE
                        vec4 a = viewMatrix * vec4(segmentStart, 1.0), b = viewMatrix * vec4(segmentEnd, 1.0);
                        float scale = 1.0;
                    #else
                        vec4 a = modelViewMatrix * vec4(segmentStart, 1.0), b = modelViewMatrix * vec4(segmentEnd, 1.0);
                        float scale = length(modelMatrix[0].xyz);
                    #endif
                    vec2 d = b.xy - a.xy;
                    vec2 side = length(d) > 0.00001 ? normalize(vec2(-d.y, d.x)) : vec2(1.0, 0.0);
                    vec4 center = mix(a, b, position.x); center.xy += side * position.y * width * scale;
                    gl_Position = projectionMatrix * center;
                    vParticleUv = uv; vQuadUv = uv; vAppearance = particleAppearance;
                }` });
        trail = new THREE.Mesh(g, m); trail.name = "three-game-kit-particle-trails"; trail.frustumCulled = false; trail.visible = false;
    }
    parent.add(mesh); if (trail) parent.add(trail);
    const bounds = new THREE.Box3(), point = new THREE.Vector3(), sphere = new THREE.Sphere(), frustum = new THREE.Frustum(), matrix = new THREE.Matrix4();
    let culled = false;
    function dirty(a: THREE.InstancedBufferAttribute, count: number) { a.clearUpdateRanges(); if (count) { a.addUpdateRange(0, count * a.itemSize); a.needsUpdate = true; } }
    return {
        geometry, material, mesh, attributes, centers, appearances, dimensions, velocities,
        get culled() { return culled; },
        get resourceCount() { return trail ? 2 : 1; },
        birth(i: number, p: THREE.Vector3, time: number) {
            if (!segments) return;
            counts[i] = 1; heads[i] = 0; lastSample[i] = time; p.toArray(history, i * segments * 3);
        },
        remove(i: number, last: number) {
            if (!segments || i === last) return;
            counts[i] = counts[last]!; heads[i] = heads[last]!; lastSample[i] = lastSample[last]!;
            history.copyWithin(i * segments * 3, last * segments * 3, (last + 1) * segments * 3);
        },
        sample(i: number, p: THREE.Vector3, time: number) {
            if (!segments || time - lastSample[i]! < interval) return;
            const head = (heads[i]! + 1) % segments; heads[i] = head; counts[i] = Math.min(segments, counts[i]! + 1); lastSample[i] = time;
            p.toArray(history, (i * segments + head) * 3);
        },
        upload(active: number) {
            culled = false;
            for (const a of attributes) dirty(a, active);
            geometry.instanceCount = active; mesh.visible = active > 0;
            if (!trail || !trailStarts || !trailEnds || !trailColors) return;
            let n = 0;
            for (let i = 0; i < active; i++) {
                let x = centers.getX(i), y = centers.getY(i), z = centers.getZ(i);
                for (let k = 0; k < counts[i]!; k++) {
                    const j = (i * segments + (heads[i]! - k + segments) % segments) * 3;
                    const nx = history[j]!, ny = history[j + 1]!, nz = history[j + 2]!;
                    if (Math.abs(x - nx) + Math.abs(y - ny) + Math.abs(z - nz) > 1e-8) {
                        trailStarts.setXYZ(n, nx, ny, nz); trailEnds.setXYZ(n, x, y, z);
                        trailColors.setXYZW(n, appearances.getX(i), appearances.getY(i), appearances.getZ(i), appearances.getW(i) * (1 - k / counts[i]!)); n++;
                    }
                    x = nx; y = ny; z = nz;
                }
            }
            trail.geometry.instanceCount = n; trail.visible = n > 0;
            dirty(trailStarts, n); dirty(trailEnds, n); dirty(trailColors, n);
        },
        cull(camera: THREE.Camera) {
            parent.updateWorldMatrix(true, false); camera.updateWorldMatrix(true, false);
            bounds.makeEmpty(); let padding = 0;
            for (let i = 0; i < geometry.instanceCount; i++) {
                point.fromBufferAttribute(centers, i); bounds.expandByPoint(point);
                const speed = velocities ? Math.hypot(velocities.getX(i), velocities.getY(i), velocities.getZ(i)) : 0;
                padding = Math.max(padding, dimensions.getX(i) * meshRadius, render.kind === "stretched" ? (dimensions.getX(i) * (1 + lengthScale) + speed * velocityScale) / 2 : 0);
            }
            if (trail && trailStarts && trailEnds) for (let i = 0; i < trail.geometry.instanceCount; i++) {
                bounds.expandByPoint(point.fromBufferAttribute(trailStarts, i)); bounds.expandByPoint(point.fromBufferAttribute(trailEnds, i)); padding = Math.max(padding, width);
            }
            if (!world) {
                bounds.applyMatrix4(parent.matrixWorld);
                // Frobenius norm bounds any stretch/shear, including billboard offsets
                // whose camera-facing orientation is independent of the parent axes.
                const e = parent.matrixWorld.elements;
                padding *= Math.hypot(e[0]!, e[1]!, e[2]!, e[4]!, e[5]!, e[6]!, e[8]!, e[9]!, e[10]!);
            }
            bounds.expandByScalar(padding);
            bounds.getBoundingSphere(sphere); matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(matrix);
            culled = bounds.isEmpty() || !frustum.intersectsSphere(sphere);
            mesh.visible = !culled && geometry.instanceCount > 0; if (trail) trail.visible = !culled && trail.geometry.instanceCount > 0;
            return !culled;
        },
        dispose() { mesh.removeFromParent(); geometry.dispose(); material.dispose(); material.uniforms.particleMap!.value = null; if (trail) { trail.removeFromParent(); trail.geometry.dispose(); trail.material.dispose(); } },
    };
}
