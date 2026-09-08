import * as THREE from "three";
import { createParticleEmitter } from "@three-game-kit/client/particles";

/** Pixel-level checks exercised through Vite/Chromium, using the same public API as consumers. */
export function checkParticleRendering() {
    const renderer = new THREE.WebGLRenderer(); renderer.setSize(80, 80); renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    const target = new THREE.WebGLRenderTarget(80, 80), depth = new THREE.WebGLRenderTarget(32, 32);
    depth.depthTexture = new THREE.DepthTexture(32, 32);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10); camera.position.z = 3; camera.updateMatrixWorld();
    const scene = new THREE.Scene(), opaque = new THREE.Scene();
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial()); plane.position.z = -0.2; opaque.add(plane);
    renderer.setRenderTarget(depth); renderer.render(opaque, camera);
    const pixels = new Uint8Array(4), flat = [{ time: 0, value: 1 }, { time: 1, value: 1 }];
    function pixel(renderCamera: THREE.Camera = camera) { renderer.setRenderTarget(target); renderer.setViewport(8, 8, 64, 64); renderer.setScissorTest(false); renderer.clear(); renderer.render(scene, renderCamera); renderer.readRenderTargetPixels(target, 40, 40, 1, 1, pixels); return Array.from(pixels); }
    const soft = createParticleEmitter(scene, { size: 1, speed: 0, opacityOverLife: flat,
        runtime: { softParticles: { depthTexture: depth.depthTexture, camera, width: 64, height: 64, origin: { x: 8, y: 8 }, fadeDistance: 1 } } });
    soft.emit(1); const faded = pixel(); soft.dispose();
    const perspective = new THREE.PerspectiveCamera(45, 1, 0.1, 10); perspective.position.z = 3; perspective.updateMatrixWorld();
    renderer.setRenderTarget(depth); renderer.setViewport(0, 0, 32, 32); renderer.clear(); renderer.render(opaque, perspective);
    const perspectiveSoft = createParticleEmitter(scene, { size: 1, speed: 0, opacityOverLife: flat,
        runtime: { softParticles: { depthTexture: depth.depthTexture, camera: perspective, width: 64, height: 64, fadeDistance: 1 } } });
    perspectiveSoft.setDepthSource(depth.depthTexture, 64, 64, { x: 8, y: 8 });
    perspectiveSoft.emit(1); const perspectiveFaded = pixel(perspective); perspectiveSoft.dispose();
    const hard = createParticleEmitter(scene, { size: 1, speed: 0, opacityOverLife: flat }); hard.emit(1); const solid = pixel(); hard.dispose();

    const atlas = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]), 2, 1); atlas.needsUpdate = true;
    atlas.magFilter = THREE.NearestFilter; atlas.minFilter = THREE.NearestFilter;
    const sprite = createParticleEmitter(scene, { size: 1, speed: 0, texture: atlas, lifetimeMs: 2000, opacityOverLife: flat,
        spriteSheet: { columns: 2, rows: 1, fps: 1, blend: true } });
    sprite.emit(1); sprite.present(0); sprite.present(500); const blended = pixel(); sprite.dispose();
    const positions = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0];
    function lit(direction: number) {
        const emitter = createParticleEmitter(scene, { size: 1, speed: 0, opacityOverLife: flat, renderer: { kind: "mesh", positions },
            sizeAxes: { x: 1, y: 1, z: 1 }, rotation3D: { z: 0.2 }, lighting: { ambient: 0, intensity: 1, direction: { x: 0, y: 0, z: direction } } });
        emitter.emit(1); const result = pixel(); emitter.dispose(); return result;
    }
    const litFront = lit(1), litBack = lit(-1);
    const tilted = createParticleEmitter(scene, { size: 1, speed: 0, opacityOverLife: flat, rotation3D: { y: Math.PI / 3 }, lighting: { ambient: 0, intensity: 1, direction: { x: 0, y: 0, z: 1 } } });
    tilted.emit(1); const tiltedLight = pixel(); tilted.dispose();
    const material = new THREE.ShaderMaterial({
        vertexShader: `attribute vec3 particleCenter, particleDimensions; attribute float customHeat; varying float heat;
            void main() { heat = customHeat; gl_Position = projectionMatrix * modelViewMatrix * vec4(particleCenter + position * particleDimensions.x, 1.0); }`,
        fragmentShader: `varying float heat; void main() { gl_FragColor = vec4(heat, 0.0, 0.0, 1.0); }`,
    });
    let materialDisposals = 0; material.addEventListener("dispose", () => materialDisposals++);
    const custom = createParticleEmitter(scene, { size: 1, speed: 0, simulationStepMs: 100, customAttributes: [{ name: "customHeat", size: 1 }],
        runtime: { material, update(p) { p.attributes[0] = p.ageMs / 1000; } } });
    custom.emit(1); custom.present(0); custom.present(500); const customPixel = pixel(); custom.dispose(); const borrowedDisposals = materialDisposals;
    const pbr = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide });
    let pbrDisposals = 0; pbr.addEventListener("dispose", () => pbrDisposals++);
    const sun = new THREE.DirectionalLight(0xffffff, 3); sun.position.set(2, 0, 3); scene.add(sun);
    const standard = createParticleEmitter(scene, { size: 0.8, speed: 0, opacityOverLife: flat, runtime: { material: pbr } });
    standard.emit(1); const standardLit = pixel(); sun.intensity = 0; const standardDark = pixel(); standard.dispose(); sun.intensity = 3;
    pbr.map = atlas;
    const mapped = createParticleEmitter(scene, { size: 0.8, speed: 0, opacityOverLife: flat, spriteSheet: { columns: 2, rows: 1, startFrame: 1 }, runtime: { material: pbr } });
    mapped.emit(1); const standardBlue = pixel(); atlas.offset.x = -0.5; const standardRed = pixel(); mapped.dispose(); atlas.offset.x = 0; pbr.map = null;
    renderer.shadowMap.enabled = true; sun.castShadow = true; sun.shadow.mapSize.set(256, 256); sun.shadow.camera.left = -2; sun.shadow.camera.right = 2; sun.shadow.camera.top = 2; sun.shadow.camera.bottom = -2; sun.shadow.bias = -0.0001;
    const receiver = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshStandardMaterial({ roughness: 1 })); receiver.position.z = -0.6; receiver.receiveShadow = true; scene.add(receiver);
    const caster = createParticleEmitter(scene, { size: 0.6, speed: 0, opacityOverLife: flat, renderer: { kind: "mesh", positions }, rotation3D: { z: 0.2 }, castShadow: true, receiveShadow: true, runtime: { material: pbr } }); caster.emit(1);
    const casterMesh = scene.children.find(o => o.name === "three-game-kit-particles")!;
    function energy() { pixel(); const buffer = new Uint8Array(80 * 80 * 4); renderer.readRenderTargetPixels(target, 0, 0, 80, 80, buffer); return buffer.reduce((sum, value, i) => sum + (i % 4 < 3 ? value : 0), 0); }
    const shadowEnergy = energy(); casterMesh.castShadow = false; const unshadowedEnergy = energy();
    casterMesh.castShadow = true;
    const point = new THREE.PointLight(0xffffff, 2); point.position.set(-1, 1, 2); point.castShadow = true; point.shadow.mapSize.set(128, 128); scene.add(point); pixel();
    caster.dispose(); receiver.removeFromParent(); receiver.geometry.dispose(); receiver.material.dispose(); sun.removeFromParent(); point.removeFromParent(); sun.shadow.map?.depthTexture?.dispose(); point.shadow.map?.depthTexture?.dispose(); sun.shadow.dispose(); point.shadow.dispose();
    const borrowedPbrDisposals = pbrDisposals; pbr.dispose();
    material.dispose(); atlas.dispose(); target.dispose(); depth.dispose(); plane.geometry.dispose(); plane.material.dispose();
    const remaining = { ...renderer.info.memory }; renderer.dispose();
    return { standardBlue, standardRed, standardLit, standardDark, shadowEnergy, unshadowedEnergy, borrowedPbrDisposals, faded, perspectiveFaded, solid, blended, litFront, litBack, tiltedLight, customPixel, borrowedDisposals, remaining };
}
