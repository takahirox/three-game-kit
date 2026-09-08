import * as THREE from "three";
import { createParticleEmitter, type ParticleEmitter, type ParticleEmitterOptions } from "@three-game-kit/client/particles";
import type { Effect } from "./presets.js";
import type { TextureName } from "./textures.js";

export const SHOWCASES = [
    { id: "silk-orbit", name: "Celestial silk", category: "COSMIC", color: "#79ffe0", description: "翡翠と桃色の絹が、黒い星を包み込む。光を受ける幅広のリボンと、移動を補間した星屑が天球を編む。", native: true },
    { id: "gilded-fountain", name: "Gilded fountain", category: "FIRE", color: "#ffd18c", description: "金色の結晶が噴き上がる、夜の噴水。回転する破片が器で弾み、自らの光で青い台座を照らす。", native: true },
    { id: "lantern-garden", name: "Lantern garden", category: "NATURE", color: "#9effc5", description: "石の庭を巡る三色の精霊。光の尾がほどけ、粒子そのものが灯りとなって岩肌に色を映す。", native: true },
    { id: "opal-bloom", name: "Opal bloom", category: "NATURE", color: "#ffb4e2", description: "半透明の花びらが重なる、オパール色の天球。奥行き順に描く薄膜と、螺旋の星屑が静かに回る。", native: true },
] as const;
export type ShowcaseId = typeof SHOWCASES[number]["id"];
const p = (x = 0, y = 0, z = 0) => ({ x, y, z });
const fade = [{ time: 0, value: 0 }, { time: 0.12, value: 1 }, { time: 0.7, value: 0.8 }, { time: 1, value: 0 }];

/** Authored scenes using public particle modules; all non-particle resources are owned here. */
export function createShowcase(id: ShowcaseId, textures: Record<TextureName, THREE.DataTexture>): Effect {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 60);
    camera.position.set(0, 2.1, 8); camera.lookAt(0, 0, 0);
    const emitters: ParticleEmitter[] = [];
    const owned: { dispose(): void }[] = [];
    const motions: ((seconds: number) => void)[] = [];
    let time = 0;
    let sorted: ParticleEmitter | undefined;
    function layer(options: ParticleEmitterOptions, texture: TextureName | null = "glow") {
        const emitter = createParticleEmitter(scene, {
            seed: 410 + emitters.length * 37, capacity: 384, speed: 0, lifetimeMs: 2400,
            size: 0.06, ...(texture ? { texture: textures[texture] } : {}), blending: "additive", opacityOverLife: fade, ...options,
        });
        emitters.push(emitter); return emitter;
    }
    function material(color: number, metalness = 0.35) {
        const result = new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness, side: THREE.DoubleSide });
        owned.push(result); return result;
    }
    function solid(geometry: THREE.BufferGeometry, surface: THREE.Material, position = p()) {
        owned.push(geometry);
        const mesh = new THREE.Mesh(geometry, surface); mesh.position.copy(position); scene.add(mesh); return mesh;
    }
    scene.add(new THREE.HemisphereLight(0xa2cfff, 0x311b45, 1.3));
    const key = new THREE.DirectionalLight(0xc7e7ff, 3); key.position.set(2, 4, 4); scene.add(key);
    const rim = new THREE.DirectionalLight(0xff82b8, 2); rim.position.set(-3, 1, -2); scene.add(rim);

    if (id === "silk-orbit") {
        const core = solid(new THREE.IcosahedronGeometry(0.65, 1), material(0x152538, 0.8));
        motions.push(t => { core.rotation.y = t * 0.18; core.rotation.z = t * 0.12; });
        for (let i = 0; i < 3; i++) {
            const color = [0x6dffce, 0xff95c8, 0x8faaff][i]!;
            const silk = material(0xffffff, 0.25); silk.transparent = true; silk.depthWrite = false; silk.forceSinglePass = true;
            const ribbon = layer({ capacity: 384, rate: 120, lifetimeMs: 2900, interpolateMotion: true, simulationSpace: "world", size: 0.035, color,
                trails: { mode: "ribbon", ribbonCount: 1, width: 0.18, widthOverTrail: [{ time: 0, value: 0.15 }, { time: 0.4, value: 1 }, { time: 1, value: 0 }], colorOverTrail: [{ time: 0, value: 0xffffff }, { time: 1, value: color }] },
                runtime: { trailMaterial: silk },
            }, "star");
            motions.push(t => { const a = t * 2 + i * Math.PI * 2 / 3; ribbon.setTransform(p(Math.cos(a) * 1.85, Math.sin(a) * Math.cos(i * 1.05 - 0.9) * 1.85, Math.sin(a) * Math.sin(i * 1.05 - 0.9) * 1.85)); });
        }
        layer({ rate: 45, shape: { kind: "sphere", radius: 2.2 }, lifetimeMs: 3500, size: [0.025, 0.07], color: 0xadcfff, orbitalVelocity: { y: [{ time: 0, value: 0.25 }, { time: 1, value: 0.5 }] } }, "star");
    } else if (id === "gilded-fountain") {
        solid(new THREE.CylinderGeometry(1.8, 1.95, 0.22, 48), material(0x183a55, 0.7), p(0, -1.35));
        const lip = solid(new THREE.TorusGeometry(1.78, 0.055, 8, 64), material(0x8b6937, 0.75), p(0, -1.2)); lip.rotation.x = Math.PI / 2;
        const crystal = new THREE.OctahedronGeometry(1, 0); owned.push(crystal);
        const positions = Array.from(crystal.attributes.position!.array);
        const gold = material(0xffffff, 0.65); gold.side = THREE.FrontSide;
        layer({ capacity: 192, rate: 48, position: p(0, -1.05), shape: { kind: "cone", radius: 0.2, angle: 0.36 }, speed: [3.6, 5.4], acceleration: p(0, -4), lifetimeMs: 3000,
            size: [0.07, 0.15], sizeAxes: { x: 0.65, y: [1, 2.5], z: 0.65 }, rotation3D: { x: [0, 6], y: [0, 6] }, angularVelocity3D: { x: [-3, 3], z: [-2, 2] },
            startColors: [0xffd580, 0xffaa4f, 0xb1efff], blending: "normal", runtime: { material: gold },
            renderer: { kind: "mesh", meshes: [{ positions, weight: 3 }, { positions: positions.map((v, j) => j % 3 === 1 ? v * 1.7 : v * 0.7), weight: 1 }] },
            drag: { coefficient: 0.08, multiplyByVelocity: true }, lights: { maxLights: 4, ratio: 0.25, intensity: 3, range: 3 },
            collision: { colliders: [{ kind: "plane", normal: p(0, 1), offset: -1.16 }], bounce: 0.55, friction: 0.2, radius: 0.08 },
        }, null);
        layer({ rate: 100, position: p(0, -1), shape: { kind: "cone", radius: 0.15, angle: 0.3 }, speed: [3, 5], acceleration: p(0, -3.8), lifetimeMs: 2100, color: 0xffc77c,
            collision: { colliders: [{ kind: "plane", normal: p(0, 1), offset: -1.16 }], response: "kill" },
            renderer: { kind: "stretched", velocityScale: 0.09, cameraScale: 0.15 }, trails: { segments: 10, intervalMs: 45, width: 0.018 }, size: 0.035 }, "star");
    } else if (id === "lantern-garden") {
        const stone = material(0x718090, 0.15);
        solid(new THREE.CylinderGeometry(2.1, 1.85, 0.22, 48), material(0x10242e), p(0, -1.4));
        // Shared geometry/material keep the seven rocks inexpensive and easy to dispose.
        const rockGeometry = new THREE.IcosahedronGeometry(1, 0); owned.push(rockGeometry);
        for (let i = 0; i < 7; i++) {
            const a = i * 2.4, rock = new THREE.Mesh(rockGeometry, stone);
            rock.position.set(Math.cos(a) * 1.25, -1.03, Math.sin(a) * 0.8);
            rock.scale.set(0.22 + i * 0.035, 0.3 + (i % 3) * 0.23, 0.3); rock.rotation.y = a; scene.add(rock);
        }
        key.intensity = 0.35;
        for (let i = 0; i < 3; i++) {
            const color = [0x7dffb2, 0x78bcff, 0xffa667][i]!;
            const spirit = layer({ capacity: 96, rate: 28, interpolateMotion: true, lifetimeMs: 2000, size: [0.055, 0.12], color,
                velocity: p(0, 0.1), drag: { coefficient: 0.3, multiplyBySize: true }, noise: { strength: 0.15, frequency: 1.8, octaves: 3 },
                lights: { maxLights: 2, intensity: 4, range: 2.6, alphaAffectsIntensity: true }, trails: { segments: 14, width: 0.025, intervalMs: 40 },
            });
            motions.push(t => { const a = t * 1.2 + i * 2.1; spirit.setTransform(p(Math.cos(a) * 1.4, -0.25 + Math.sin(a * 1.7) * 0.6, Math.sin(a) * 0.85)); });
        }
        layer({ rate: 30, shape: { kind: "box", halfExtents: p(1.8, 1.1, 1) }, size: [0.025, 0.055], color: 0x96e8c5, velocity: p(0, 0.12), lifetimeMs: 4000 }, "star");
    } else {
        camera.position.set(0, 0.7, 7.8); camera.lookAt(0, 0, 0);
        const petals = layer({ capacity: 48, rate: 10, lifetimeMs: 4200, shape: { kind: "ring", radius: 1.45 },
            renderer: { kind: "billboard", alignment: "facing", allowRoll: false }, blending: "normal", size: [0.5, 0.95],
            sizeAxes: { x: 0.6, y: 1.6 }, startColors: [0xffb2df, 0x89e5ff, 0xc7adff], opacityOverLife: fade.map(k => ({ ...k, value: k.value * 0.48 })),
            orbitalVelocity: { x: [{ time: 0, value: 0.65 }, { time: 1, value: 0.3 }], y: [{ time: 0, value: 0.9 }, { time: 1, value: 0.5 }] },
            angularVelocity: [-0.8, 0.8], radialVelocity: [{ time: 0, value: -0.18 }, { time: 1, value: 0.15 }],
        }, "petal");
        // Exact alpha sorting is intentionally limited to this small 48-particle layer.
        layer({ rate: 90, lifetimeMs: 3200, shape: { kind: "ring", radius: 1.7, arc: { angle: Math.PI * 2, mode: "loop", speed: 1 } }, color: 0xb5ccff, size: [0.025, 0.055],
            orbitalVelocity: { y: [{ time: 0, value: 1 }, { time: 1, value: 0.3 }] }, velocity: p(0, 0.2), trails: { segments: 12, width: 0.018 } }, "star");
        layer({ rate: 7, lifetimeMs: 1800, size: [0.6, 1.1], color: 0xffbadf, sizeOverLife: [{ time: 0, value: 0.3 }, { time: 1, value: 1.3 }] });
        // Sorting happens after uploads in prepareRender, including when paused or burst.
        sorted = petals;
    }
    function advance(deltaMs: number, emitting: boolean) {
        time += deltaMs; for (const motion of motions) motion(time / 1000);
        for (const emitter of emitters) { emitter.setEmitting(emitting); emitter.present(time); }
    }
    advance(0, true); for (let i = 0; i < 85; i++) advance(40, true);
    return {
        scene, camera, emitters, advance,
        prepareRender(renderer) { renderer.shadowMap.enabled = false; sorted?.sort(camera, "distance", { scope: "global", maxParticles: 48 }); },
        burst() { for (const emitter of emitters) emitter.emit(12, { lifetimeMs: 1200 }); },
        dispose() { for (const emitter of emitters) emitter.dispose(); scene.clear(); for (const resource of owned) resource.dispose(); },
    };
}
