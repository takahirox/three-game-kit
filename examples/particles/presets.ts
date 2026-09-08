import * as THREE from "three";
import { createParticleEmitter, createParticleSystem, defineParticleEffect, type ParticleRuntimeOptions, type ParticleEffectDefinition, type ParticleEmitter, type ParticleEmitterOptions, type ParticleEmission } from "@three-game-kit/client/particles";
import type { TextureName } from "./textures.js";

const P = (x = 0, y = 0, z = 0) => ({ x, y, z });
const fade = [{ time: 0, value: 1 }, { time: 0.75, value: 0.7 }, { time: 1, value: 0 }];
const shard = [0, 0.7, 0, -0.25, -0.3, 0.25, 0.25, -0.3, 0.25, 0, 0.7, 0, 0.25, -0.3, 0.25, 0, -0.3, -0.3, 0, 0.7, 0, 0, -0.3, -0.3, -0.25, -0.3, 0.25];
const NATIVE_PRESETS = [
    { id: "turbulence", category: "FIRE", color: "#ff954f", name: "Ember turbulence", description: "接線付きカーブと三層のノイズで炎が呼吸する。揺らぎが大きさと回転にも伝わり、床との境界は淡く溶ける。", definition: { emitters: [
        { id: "main", options: { capacity: 512, rate: 100, rateOverTime: [{ time: 0, value: 0.5, interpolation: "hermite", outTangent: 0 }, { time: 0.5, value: 1.4, interpolation: "hermite", inTangent: 0, outTangent: 0 }, { time: 1, value: 0.5, inTangent: 0 }], sizeOverLife: { min: [{ time: 0, value: 0.4 }, { time: 1, value: 1 }], max: [{ time: 0, value: 0.8 }, { time: 1, value: 1.8 }] }, durationMs: 2000, loop: true, prewarmMs: 1200, position: P(0, -1.4), shape: { kind: "circle", radius: 0.35 }, velocity: P(0, 1.2), lifetimeMs: [900, 1800], size: [0.18, 0.42], blending: "additive", noise: { strength: 2.5, frequency: 2, scrollSpeed: 1, octaves: 3, strengthAxes: P(1, 0.3, 1), rotationAmount: 0.15, sizeAmount: 0.12 }, forceOverLife: { y: [{ time: 0, value: 0.3 }, { time: 1, value: 2 }] }, colorOverLife: [{ time: 0, value: 0xffe0a0 }, { time: 0.3, value: 0xff7d20 }, { time: 1, value: 0xa01924 }], opacityOverLife: fade } },
        { id: "sparks", options: { capacity: 128, rate: 24, position: P(0, -1.3), shape: { kind: "cone", radius: 0.3, angle: 0.4 }, speed: [2, 4], lifetimeMs: 1600, size: 0.045, color: 0xffc469, blending: "additive", renderer: { kind: "stretched", velocityScale: 0.12 } } },
    ] } },
    { id: "orbital-current", category: "ENERGY", color: "#a37bff", name: "Orbital current", description: "往復する円弧から光が生まれ、軌道速度と半径方向の移動で螺旋を編む。速度に応じて色が変わる。", definition: { emitters: [
        { id: "main", options: { capacity: 128, rate: 24, renderer: { kind: "horizontal" }, limitVelocity: 4, colorBySpeed: { range: [0, 3], curve: [{ time: 0, value: 0x8765ff }, { time: 1, value: 0xffffff }] }, orbitalVelocity: { y: [{ time: 0, value: 1.8 }, { time: 1, value: 0.6 }] }, radialVelocity: [{ time: 0, value: -0.1 }, { time: 1, value: -0.35 }], shape: { kind: "ring", radius: 1.7, arc: { angle: Math.PI * 1.5, mode: "pingPong", speed: 2 } }, velocity: P(0, 0.15), lifetimeMs: 4000, size: 0.08, color: 0xa37bff, blending: "additive", trails: { segments: 20, intervalMs: 30, width: 0.06, widthOverTrail: [{ time: 0, value: 1 }, { time: 1, value: 0 }] }, prewarmMs: 1000 } },
    ] } },
    { id: "comet", category: "COSMIC", color: "#5be7ff", name: "Ribbon flight", description: "生きている粒子も発生源の速度を受け継ぐリボン。動きと手動バーストを記録し、残光が続く。", definition: { emitters: [
        { id: "main", options: { capacity: 256, rateOverDistance: 35, simulationSpace: "world", velocity: P(), inheritVelocity: 0.25, inheritVelocityMode: "current", inheritVelocityOverLife: [{ time: 0, value: 1 }, { time: 1, value: 0.2 }], recording: { maxCommands: 4000 }, lifetimeMs: 1600, size: 0.08, color: 0x5be7ff, blending: "additive", drag: 1, trails: { segments: 20, intervalMs: 25, width: 0.07, persistMs: 650, widthOverTrail: [{ time: 0, value: 1 }, { time: 1, value: 0 }], colorOverTrail: [{ time: 0, value: 0xffffff }, { time: 1, value: 0x6941ff }] } } },
    ] } },
    { id: "shards", category: "NATURE", color: "#86dfff", name: "Crystal impact", description: "シーンの照明と影を受けるPBRの結晶。軸別の大きさ・回転カーブを持ち、衝突のたびに寿命が短くなる。", definition: { emitters: [
        { id: "main", options: { capacity: 128, rate: 18, castShadow: true, receiveShadow: true, sizeAxesOverLife: { y: [{ time: 0, value: 0.5, interpolation: "bezier", outControl: 1.8 }, { time: 1, value: 0.4, inControl: 1.1 }] }, angularVelocityAxesBySpeed: { range: [0, 5], curves: { x: [{ time: 0, value: 0.2 }, { time: 1, value: 2 }] } }, sizeAxes: { x: [0.6, 1.3], y: [1, 2], z: [0.6, 1.2] }, rotation3D: { x: [0, 6.28], y: [0, 6.28], z: [0, 6.28] }, angularVelocity3D: { x: [-2, 2], y: [-3, 3] }, lighting: { ambient: 0.25, intensity: 1.6, direction: P(2, 3, 4) }, startColors: [0x86dfff, 0xb9a8ff, 0x6dffcf], position: P(0, 1.6), simulationSpace: "world", shape: { kind: "circle", radius: 0.7 }, velocity: P(0.35, -0.5), acceleration: P(0, -4), lifetimeMs: 3500, size: [0.12, 0.24], angularVelocity: [1, 4], color: 0x86dfff, renderer: { kind: "mesh", positions: shard }, collision: { colliders: [{ kind: "plane", normal: P(0, 1), offset: -1.5 }, { kind: "sphere", center: P(-0.5, -0.65), radius: 0.45 }, { kind: "box", min: P(0.4, -1.5, -0.4), max: P(1.1, -0.8, 0.4) }], bounce: 0.65, friction: 0.15, radius: 0.1 }, prewarmMs: 1000 } },
    ] } },
    { id: "cascade", category: "FIRE", color: "#ff87c4", name: "Midnight cascade", description: "確率と個数が変わる連続バースト。衝突した火花の色と大きさを子粒子が受け継ぎ、二次的な光が生まれる。", definition: { emitters: [
        { id: "main", options: { capacity: 16, durationMs: 1800, loop: true, bursts: [{ timeMs: 0, count: [1, 2], cycles: 2, intervalMs: 550, probability: 0.85 }], position: P(0, -1.3), velocity: P(0, 3), lifetimeMs: 700, size: 0.12, color: 0xffd67d, blending: "additive", trails: { segments: 16, width: 0.035 } } },
        { id: "bloom", options: { capacity: 512, speed: [0.7, 2], lifetimeMs: [1400, 2200], acceleration: P(0, -1.2), color: 0xff87c4, size: 0.07, blending: "additive", renderer: { kind: "stretched", velocityScale: 0.12 }, collision: { colliders: [{ kind: "plane", normal: P(0, 1), offset: -1.5 }], response: "kill" } } },
        { id: "splash", options: { capacity: 128, shape: { kind: "cone", radius: 0, angle: 1 }, speed: [0.3, 1], lifetimeMs: 300, size: 0.06, color: 0xffffff, blending: "additive" } },
    ], subEmitters: [{ source: "main", target: "bloom", event: "death", count: 80 }, { source: "bloom", target: "splash", event: "collision", count: 3, probability: 0.7, inheritColor: true, inheritSize: true }] } },
    { id: "surface", category: "MAGIC", color: "#58ffc3", name: "Prismatic forge", description: "画像の明るい部分をマスクに、変形する結晶から光が生まれる。箱の辺をなぞる光と二層で描く。", definition: { emitters: [
        { id: "main", options: { capacity: 256, rate: 90, shape: { kind: "mesh", positions: shard }, speed: [0.3, 0.8], size: 0.055, lifetimeMs: 1800, color: 0x58ffc3, blending: "additive", prewarmMs: 1000 } },
        { id: "rim", options: { capacity: 256, rate: 60, shape: { kind: "box", halfExtents: P(1.4, 0.6, 0.5), emitFrom: "edge" }, velocity: P(0, 0.8), lifetimeMs: 1400, size: 0.045, color: 0xaf96ff, blending: "additive", prewarmMs: 1000 } },
    ] } },
] as const satisfies readonly { id: string; name: string; category: string; color: string; description: string; definition: ParticleEffectDefinition }[];

export const PRESETS = [
    { id: "solar-flare", name: "Solar flare", category: "FIRE", color: "#ff954f", description: "白熱するコアから炎と火の粉が立ち上がる、太陽のフレア。" },
    { id: "singularity", name: "Singularity", category: "COSMIC", color: "#ffbe75", description: "暗い中心を囲む降着円盤。傾いた軌道に金色の星屑が渦を巻く。" },
    { id: "storm-core", name: "Storm core", category: "ENERGY", color: "#8ecaff", description: "青白い放電がプラズマの球を取り巻く、高電圧のエネルギー体。" },
    { id: "sakura", name: "Sakura drift", category: "NATURE", color: "#ffadd8", description: "風に揺れ、回転しながら舞い落ちる桜の花びら。" },
    { id: "aurora", name: "Aurora veil", category: "COSMIC", color: "#71ffd3", description: "エメラルドと紫の光が幾重にも重なる、揺らめくオーロラ。" },
    { id: "fireworks", name: "Midnight bloom", category: "FIRE", color: "#ffdb80", description: "夜空に次々と花開く花火。重力で弧を描く残光と瞬く星。" },
    { id: "frost", name: "Frost nova", category: "MAGIC", color: "#a3edff", description: "氷の結晶と青い衝撃波が広がる、凍てつく魔法の爆発。" },
    { id: "reactor", name: "Arc reactor", category: "ENERGY", color: "#57e5ff", description: "逆回転する同心円と、中心で脈打つシアンのリアクター。" },
    { id: "phoenix", name: "Phoenix wings", category: "MAGIC", color: "#ff9061", description: "火の羽根を大きく広げた不死鳥。翼の輪郭を金色の光がなぞる。" },
    { id: "nebula", name: "Velvet nebula", category: "COSMIC", color: "#c79aff", description: "紫と青のガスが漂い、星々がきらめく色鮮やかな星雲。" },
    { id: "meteors", name: "Meteor shower", category: "COSMIC", color: "#8faeff", description: "斜めに降り注ぐ流星群。鋭い光の筋と青い尾が夜を横切る。" },
    { id: "wisps", name: "Spirit wisps", category: "MAGIC", color: "#95ffdc", description: "互いを追いかける三つの精霊。ゆっくりとほどける光の軌跡。" },
    { id: "vortex", name: "Plasma vortex", category: "ENERGY", color: "#cf8bff", description: "幾層もの螺旋が回転する、紫色のプラズマ・トルネード。" },
    { id: "sigil", name: "Astral sigil", category: "MAGIC", color: "#ffd999", description: "星形の印と複数の輪が回転する、金色の魔法陣。" },
    { id: "abyss", name: "Abyssal bloom", category: "NATURE", color: "#64e7fa", description: "深海で淡く発光するクラゲ。長い触手のような光が漂う。" },
    { id: "volcano", name: "Volcanic heart", category: "FIRE", color: "#ff744f", description: "赤熱した溶岩が噴き上がり、灰と煙がその上を覆う。" },
    { id: "confetti", name: "Chromatic joy", category: "NATURE", color: "#ffd672", description: "鮮やかな紙吹雪が回転し、カラフルな祝福のシャワーに。" },
    { id: "warp", name: "Warp speed", category: "COSMIC", color: "#9caeff", description: "星々の間を駆け抜けるワープ航行。奥から光の線が迫る。" },
    { id: "toxic", name: "Toxic garden", category: "NATURE", color: "#c1ff6c", description: "ライム色の胞子と霧があふれ出す、幻想的な毒の庭。" },
    { id: "matrix", name: "Digital rain", category: "ENERGY", color: "#6bffb3", description: "光る文字が縦に流れ落ちるデジタルの雨。スプライトシートを使用。" },
    ...NATIVE_PRESETS.map(preset => ({ id: preset.id, name: preset.name, category: preset.category, color: preset.color, description: preset.description, native: true as const })),
] as const;
export type PresetId = typeof PRESETS[number]["id"];
export interface Effect {
    readonly scene: THREE.Scene;
    readonly camera: THREE.PerspectiveCamera;
    readonly emitters: readonly Pick<ParticleEmitter, "inspect">[];
    readonly drawSavings?: number;
    advance(deltaMs: number, emitting: boolean): void;
    prepareRender?(renderer: THREE.WebGLRenderer): void;
    burst(): void;
    dispose(): void;
}
const flat = [{ time: 0, value: 1 }, { time: 1, value: 1 }];
const fadeInOut = [{ time: 0, value: 0 }, { time: 0.15, value: 1 }, { time: 1, value: 0 }];

function createNativeEffect(preset: typeof NATIVE_PRESETS[number], textures: Record<TextureName, THREE.DataTexture>): Effect {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 1.8, 7.5); camera.lookAt(0, 0, 0);
    let time = 0;
    const runtime: Record<string, ParticleRuntimeOptions> = {};
    let depthTarget: THREE.WebGLRenderTarget | undefined, opaqueScene: THREE.Scene | undefined, floor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | undefined;
    if (preset.id === "turbulence") {
        depthTarget = new THREE.WebGLRenderTarget(256, 256); depthTarget.depthTexture = new THREE.DepthTexture(256, 256);
        runtime.main = { softParticles: { depthTexture: depthTarget.depthTexture, camera, width: 256, height: 256, fadeDistance: 0.3 } };
        opaqueScene = new THREE.Scene();
        floor = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.2), new THREE.MeshBasicMaterial({ color: 0x101626 }));
        floor.rotation.x = -Math.PI / 2; floor.position.y = -1.4;
        opaqueScene.add(floor); scene.add(floor.clone());
    }
    let standard: THREE.MeshStandardMaterial | undefined, sun: THREE.DirectionalLight | undefined, receiver: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | undefined;
    if (preset.id === "shards") {
        standard = new THREE.MeshStandardMaterial({ roughness: 0.28, metalness: 0.55 }); runtime.main = { material: standard };
        scene.add(new THREE.HemisphereLight(0xa5dfff, 0x3b174b, 2.5)); sun = new THREE.DirectionalLight(0xffffff, 4); sun.position.set(2, 4, 3); sun.castShadow = true;
        sun.shadow.mapSize.set(256, 256); sun.shadow.camera.left = -3; sun.shadow.camera.right = 3; sun.shadow.camera.top = 3; sun.shadow.camera.bottom = -3; sun.shadow.bias = -0.001; scene.add(sun);
        receiver = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 3.5), new THREE.MeshStandardMaterial({ color: 0x101a2a, roughness: 1 })); receiver.rotation.x = -Math.PI / 2; receiver.position.y = -1.5; receiver.receiveShadow = true; scene.add(receiver);
    }
    if (preset.id === "comet") runtime.main = { trailTexture: textures.streak };
    if (preset.id === "surface") runtime.main = { meshPositions: () => shard.map((v, i) => i % 3 === 1 ? v * (1.25 + Math.sin(time / 500) * 0.35) : v * (1.1 + Math.cos(time / 650) * 0.25)) };
    const system = createParticleSystem(scene, { camera, cull: true, maxParticles: 2048, runtime });
    let definition: ParticleEffectDefinition = preset.definition;
    if (preset.id === "surface") {
        const image = textures.star.image;
        const values = Array.from({ length: image.width * image.height }, (_, i) => image.data![i * 4 + 3]! / 255);
        definition = { ...preset.definition, emitters: preset.definition.emitters.map(e => e.id !== "main" ? e : { ...e, options: { ...e.options, shape: { kind: "mesh", positions: shard, uvs: shard.flatMap((_, i) => i % 3 ? [] : [(shard[i]! + 0.25) / 0.5, shard[i + 1]! + 0.3]), mask: { width: image.width, height: image.height, values, threshold: 0.2, channel: "clip" } } } }) };
    }
    const effect = system.createEffect(defineParticleEffect(definition));
    let state = effect.inspect();
    const viewport = new THREE.Vector4(), scissor = new THREE.Vector4();

    const emitters = state.emitters.map((_, index) => ({ inspect: () => state.emitters[index]!.state }));
    function advance(deltaMs: number, emitting: boolean): void {
        time += deltaMs;
        effect.setEmitting(emitting);
        if (preset.id === "comet") effect.setTransform(P(Math.sin(time / 900) * 1.6, Math.cos(time / 650) * 0.8, Math.sin(time / 1200) * 0.5));
        if (deltaMs > 0 && preset.id === "shards") effect.setCollision("main", { colliders: [
            { kind: "plane", normal: P(0, 1), offset: -1.5 }, { kind: "sphere", center: P(Math.sin(time / 900) * 0.65, -0.65), radius: 0.5 },
        ], bounce: 0.7, friction: 0.15, radius: 0.1, lifetimeLoss: 0.12 });
        system.present(time);
        state = effect.inspect();
    }
    advance(0, true);
    for (let i = 0; i < 36; i++) advance(40, true);
    return {
        scene, camera, emitters, advance, drawSavings: state.drawSavings,
        prepareRender(renderer) {
            renderer.shadowMap.enabled = !!sun;
            if (!depthTarget || !opaqueScene) return;
            const target = renderer.getRenderTarget(), scissorTest = renderer.getScissorTest();
            renderer.getViewport(viewport); renderer.getScissor(scissor);
            const pixelRatio = renderer.getPixelRatio();
            effect.setDepthSource("main", depthTarget.depthTexture!, viewport.z * pixelRatio, viewport.w * pixelRatio, { x: viewport.x * pixelRatio, y: viewport.y * pixelRatio });
            renderer.setRenderTarget(depthTarget); renderer.setScissorTest(false); renderer.setViewport(0, 0, 256, 256); renderer.clear(); renderer.render(opaqueScene, camera);
            renderer.setRenderTarget(target); renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest);
        },
        burst() { effect.emit("main", preset.id === "cascade" ? 1 : 16); state = effect.inspect(); },
        dispose() { system.dispose(); state = effect.inspect(); scene.clear(); depthTarget?.dispose(); floor?.geometry.dispose(); floor?.material.dispose(); opaqueScene?.clear(); standard?.dispose(); receiver?.geometry.dispose(); receiver?.material.dispose(); sun?.shadow.map?.depthTexture?.dispose(); sun?.shadow.dispose(); },
    };
}

export function createEffect(id: PresetId, textures: Record<TextureName, THREE.DataTexture>): Effect {
    const native = NATIVE_PRESETS.find(preset => preset.id === id);
    if (native) return createNativeEffect(native, textures);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    camera.position.set(0, 0.5, 7.2); camera.lookAt(0, 0.3, 0);
    const root = new THREE.Group(); scene.add(root);
    const emitters: ParticleEmitter[] = [];
    const alpha: ParticleEmitter[] = [];
    const formations: { emitter: ParticleEmitter; commands: { count: number; overrides?: ParticleEmission }[]; refreshedAt: number }[] = [];
    let recording = true;
    const motions: ((seconds: number) => void)[] = [];
    const pulses: { emitter: ParticleEmitter; count: number; interval: number; next: number }[] = [];
    let time = 0, seed = PRESETS.findIndex(p => p.id === id) * 71 + 11;
    let state = seed;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    function layer(options: ParticleEmitterOptions, texture: TextureName = "glow", parent = root): ParticleEmitter {
        const emitter = createParticleEmitter(parent, {
            seed: seed++, lifetimeMs: 1800, speed: 0, size: 0.12,
            blending: "additive", texture: textures[texture], opacityOverLife: fadeInOut, ...options, capacity: (options.capacity ?? 768) + 128,
        });
        let handle = emitter;
        if (options.lifetimeMs === 1e6) {
            const commands: { count: number; overrides?: ParticleEmission }[] = [];
            formations.push({ emitter, commands, refreshedAt: 0 });
            handle = { ...emitter, emit(count, overrides) {
                if (recording) commands.push(overrides === undefined ? { count } : { count, overrides });
                return emitter.emit(count, overrides);
            } };
        }
        emitters.push(handle);
        if (options.blending === "normal") alpha.push(emitter);
        return handle;
    }
    function stars(color: number, count = 100, radius = 2.5): void {
        const e = layer({ capacity: count, lifetimeMs: 1e6, color, size: [0.035, 0.09], opacityOverLife: flat }, "star");
        for (let i = 0; i < count; i++) e.emit(1, { position: P((random() - 0.5) * radius * 2, (random() - 0.5) * radius * 2, (random() - 0.5) * 2) });
    }
    function ring(color: number, radius: number, count = 160, tilt = 0, spin = 0.2, style: "circle" | "spiral" | "sigil" = "circle"): void {
        const group = new THREE.Group(); root.add(group); group.rotation.x = tilt;
        const e = layer({ capacity: count, lifetimeMs: 1e6, color, size: [0.09, 0.2], opacityOverLife: flat }, "glow", group);
        for (let i = 0; i < count; i++) {
            const a = i / count * Math.PI * 2 * (style === "spiral" ? 4 : 1);
            const r = style === "spiral" ? radius * (0.28 + i / count * 0.72) : radius;
            e.emit(1, { position: P(Math.cos(a) * r, Math.sin(a) * r, (random() - 0.5) * (style === "spiral" ? 0.25 : 0.035)) });
        }
        if (style === "sigil") {
            // Connect five points using a second emitter of closely spaced stars.
            const lines = layer({ capacity: 200, lifetimeMs: 1e6, color, size: 0.06, opacityOverLife: flat }, "star", group);
            for (let i = 0; i < 200; i++) {
                const edge = Math.floor(i / 40), t = i % 40 / 40;
                const a = edge * Math.PI * 4 / 5 + Math.PI / 2, b = a + Math.PI * 4 / 5;
                lines.emit(1, { position: P((Math.cos(a) * (1 - t) + Math.cos(b) * t) * radius * 0.83, (Math.sin(a) * (1 - t) + Math.sin(b) * t) * radius * 0.83) });
            }
        }
        motions.push(t => { group.rotation.z = t * spin; });
    }
    function trail(color: number, phase: number, path: (t: number) => { x: number; y: number; z: number }, size = 0.15): void {
        const e = layer({ rate: 125, color, size, lifetimeMs: 1200, sizeOverLife: [{ time: 0, value: 1.5 }, { time: 1, value: 0 }] });
        motions.push(t => e.setTransform(path(t + phase)));
    }
    function pulse(e: ParticleEmitter, count: number, interval = 1600, delay = 0): void {
        pulses.push({ emitter: e, count, interval, next: delay });
    }
    switch (id) {
        case "solar-flare":
            layer({ rate: 150, simulationSpace: "world", position: P(0, -1.5), shape: { kind: "cone", radius: 0.22, angle: 0.23 }, speed: [1.5, 3.2], size: [0.4, 0.8], lifetimeMs: [600, 1400], colorOverLife: [{ time: 0, value: 0xfff4b2 }, { time: 0.3, value: 0xffa323 }, { time: 1, value: 0xc31710 }], sizeOverLife: [{ time: 0, value: 0.4 }, { time: 0.3, value: 1 }, { time: 1, value: 0 }] });
            layer({ rate: 90, position: P(0, -1.4), shape: { kind: "cone", radius: 0.3, angle: 0.4 }, speed: [2, 4], acceleration: P(0, -0.6), size: [0.035, 0.08], color: 0xffb14a }, "star"); break;
        case "singularity":
            ring(0xffb14b, 2, 500, 1, 0.24, "spiral");
            ring(0xffeed3, 0.64, 180, 1, -0.4);
            ring(0xaa78ff, 2.2, 120, -0.5, -0.2);
            root.rotation.z = -0.35; break;
        case "storm-core":
            layer({ rate: 65, shape: { kind: "sphere", radius: 1.15, surface: true }, lifetimeMs: [140, 400], size: [1.1, 1.9], angle: [0, 6.28], color: 0x8ecaff, opacityOverLife: flat }, "bolt");
            layer({ rate: 25, shape: { kind: "sphere", radius: 0.5 }, size: [0.5, 1.2], lifetimeMs: 500, color: 0x1768ff });
            ring(0x5d9dff, 1.3, 150, 0.9, 0.8); break;
        case "sakura":
            for (const color of [0xff80b7, 0xffcde6]) layer({ rate: 30, position: P(0, 2.4), shape: { kind: "box", halfExtents: P(2.7, 0.3, 1) }, speed: 0, acceleration: P(0.16, -0.65), lifetimeMs: [2500, 4000], size: [0.12, 0.24], angle: [0, 6.28], angularVelocity: [-2, 2], color, blending: "normal" }, "petal"); break;
        case "aurora":
            for (const [j, color] of [0x38ffd0, 0x44a9ff, 0x985aff].entries()) {
                const e = layer({ capacity: 180, renderer: { kind: "vertical" }, lifetimeMs: 1e6, size: 0.8, color, opacityOverLife: [{ time: 0, value: 0.3 }, { time: 1, value: 0.3 }] }, "streak");
                // Tall vertical sprites trace a wavy curtain, animated by the parent.
                for (let i = 0; i < 160; i++) { const x = (i / 159 - 0.5) * 4.8; e.emit(1, { position: P(x, Math.sin(x * 1.6 + j * 0.8) * 0.65 + j * 0.28, j * -0.15), size: 1.4 + Math.sin(i * 0.05) * 0.6 }); }
            }
            motions.push(t => { root.rotation.y = Math.sin(t * 0.3) * 0.4; root.rotation.z = Math.sin(t * 0.4) * 0.08; }); break;
        case "fireworks":
            for (const [i, color] of [0xffb84f, 0xff619f, 0x78bdff].entries()) {
                const e = layer({ position: P((i - 1) * 1.1, 0.7 - i * 0.3), shape: { kind: "sphere", radius: 0 }, speed: [0.6, 2.5], acceleration: P(0, -0.55), color, size: [0.035, 0.09], lifetimeMs: 2100, opacityOverLife: flat }, "star");
                pulse(e, 150, 2400, i * 650);
            } break;
        case "frost":
            pulse(layer({ shape: { kind: "sphere", radius: 0.1 }, speed: [0.5, 2.7], color: 0x8bdbff, size: [0.1, 0.22], angularVelocity: [-2, 2], lifetimeMs: 1700 }, "star"), 180, 1000);
            pulse(layer({ color: 0x61d9ff, size: 4, lifetimeMs: 1500, spriteSheet: { columns: 2, rows: 2 }, sizeOverLife: [{ time: 0, value: 0.05 }, { time: 1, value: 1.3 }] }, "ripple"), 1, 1000); break;
        case "reactor":
            ring(0x4bdfff, 1.7, 200, 0.3, 0.5); ring(0x669bff, 1.3, 140, -0.3, -0.8);
            layer({ rate: 65, shape: { kind: "sphere", radius: 0.3 }, color: 0x44baff, size: 0.4, lifetimeMs: 600 });
            trail(0xe2ffff, 0, t => P(Math.cos(t * 2) * 1.7, Math.sin(t * 2) * 1.7), 0.12); break;
        case "phoenix": {
            const e = layer({ capacity: 600, lifetimeMs: 1e6, color: 0xff953b, size: [0.05, 0.12], opacityOverLife: flat }, "star");
            for (let i = 0; i < 560; i++) {
                const side = i < 280 ? -1 : 1, u = (i % 280) / 280;
                const feather = (i % 7) / 7;
                e.emit(1, { position: P(side * (0.15 + u * 2.3), Math.sin(u * Math.PI * 0.8) * 1.7 - feather * (0.3 + u), feather * 0.15), color: i % 3 ? 0xff772f : 0xffdb8c });
            }
            layer({ rate: 65, position: P(0, -0.6), shape: { kind: "cone", radius: 0.1, angle: 0.12 }, speed: [1, 2], color: 0xff8a31, size: 0.35, lifetimeMs: 900 });
            motions.push(t => { root.rotation.y = Math.sin(t * 0.8) * 0.35; root.scale.y = 1 + Math.sin(t * 2) * 0.08; }); break;
        }
        case "nebula":
            for (const [i, color] of [0x553fff, 0xdb54de, 0x299abe].entries()) layer({ rate: 20, position: P((i - 1) * 0.85), shape: { kind: "sphere", radius: 0.9 }, speed: 0.1, lifetimeMs: 4000, size: [0.7, 1.5], color, angle: [0, 6.28], angularVelocity: 0.1, opacityOverLife: [{ time: 0, value: 0 }, { time: 0.3, value: 0.35 }, { time: 1, value: 0 }] }, "smoke");
            stars(0xc9bcff, 100); break;
        case "meteors":
            layer({ rate: 60, position: P(1, 3), shape: { kind: "box", halfExtents: P(3, 0.5, 1) }, acceleration: P(-1.8, -2.7), speed: 0.1, size: [0.35, 0.9], angle: -0.64, color: 0x95c5ff, lifetimeMs: 1900 }, "streak"); stars(0x6372a8, 60); break;
        case "wisps":
            for (const [i, color] of [0x55ffbd, 0x79aaff, 0xe2d7ff].entries()) trail(color, i * 2.09, t => P(Math.cos(t * 1.2) * 1.8, Math.sin(t * 1.8) * 1.1, Math.sin(t * 1.2)), 0.2); break;
        case "vortex": {
            const e = layer({ capacity: 600, lifetimeMs: 1e6, size: [0.035, 0.1], color: 0xad6aff, opacityOverLife: flat });
            for (let i = 0; i < 560; i++) { const t = i / 560, a = t * Math.PI * 20, r = 0.2 + t * 1.4; e.emit(1, { position: P(Math.cos(a) * r, t * 3.5 - 1.8, Math.sin(a) * r), color: i % 4 === 0 ? 0xf9b8ff : 0x974fff }); }
            motions.push(t => { root.rotation.y = -t * 1.5; });
            layer({ rate: 40, position: P(0, -1.5), shape: { kind: "cone", radius: 0.1, angle: 0.2 }, speed: 2, color: 0xe18fff, size: 0.18 }); break;
        }
        case "sigil":
            ring(0xffcf78, 1.7, 200, 0.1, 0.12, "sigil"); ring(0xa880ff, 2, 160, -0.1, -0.2);
            trail(0xfff2bd, 0, t => P(Math.cos(t * 1.2) * 2, Math.sin(t * 1.2) * 2), 0.09); break;
        case "abyss": {
            const e = layer({ capacity: 550, lifetimeMs: 1e6, size: [0.04, 0.095], color: 0x43cbe0, opacityOverLife: flat });
            for (let i = 0; i < 220; i++) { const a = random() * Math.PI * 2, r = Math.sqrt(random()) * 1.25; e.emit(1, { position: P(Math.cos(a) * r, 0.6 + Math.sqrt(Math.max(0, 1.6 - r * r)) * 0.65, Math.sin(a) * r) }); }
            for (let strand = 0; strand < 9; strand++) for (let j = 0; j < 34; j++) { const a = strand / 9 * Math.PI * 2, y = j / 34; e.emit(1, { position: P(Math.cos(a) * (0.7 - y * 0.4) + Math.sin(y * 8 + strand) * 0.15, 0.6 - y * 2.4, Math.sin(a) * 0.7), color: j % 4 ? 0x447fdc : 0xa4fff4 }); }
            motions.push(t => { root.rotation.y = t * 0.25; root.position.y = Math.sin(t) * 0.12; }); break;
        }
        case "volcano":
            layer({ rate: 160, position: P(0, -1.6), shape: { kind: "cone", radius: 0.2, angle: 0.35 }, speed: [2.5, 5], acceleration: P(0, -2.7), lifetimeMs: 2200, size: [0.045, 0.12], color: 0xff6930 }, "star");
            layer({ rate: 40, position: P(0, -0.8), shape: { kind: "cone", radius: 0.25, angle: 0.4 }, speed: [0.5, 1.3], size: [0.5, 0.9], lifetimeMs: 3000, color: 0x5d4551, blending: "normal", sizeOverLife: [{ time: 0, value: 0.5 }, { time: 1, value: 2.5 }] }, "smoke"); break;
        case "confetti":
            for (const color of [0xff627f, 0xffd15c, 0x69e7eb]) layer({ rate: 40, position: P(0, 2.5), shape: { kind: "box", halfExtents: P(2.2, 0.6, 0.5) }, acceleration: P(0, -1), lifetimeMs: 3000, size: [0.09, 0.18], angle: [0, 6.28], angularVelocity: [-5, 5], color, blending: "normal" }, "petal"); break;
        case "warp":
            layer({ rate: 160, position: P(0, 0, -8), shape: { kind: "cone", radius: 2.8, angle: 0.12 }, rotation: P(Math.PI / 2), speed: [4, 8], lifetimeMs: 1800, size: [0.2, 0.55], color: 0xadc6ff, angle: [0, 6.28] }, "streak");
            ring(0x5f71ff, 0.7, 120, 0, -0.4); break;
        case "toxic":
            layer({ rate: 65, position: P(0, -1.2), shape: { kind: "cone", radius: 0.8, angle: 0.35 }, speed: [0.3, 1.2], lifetimeMs: 2500, size: [0.1, 0.22], color: 0xc4ff40 }, "ripple");
            layer({ rate: 40, position: P(0, -1.1), shape: { kind: "sphere", radius: 0.65 }, acceleration: P(0, 0.3), lifetimeMs: 3000, size: [0.5, 1], color: 0x4a8e21, sizeOverLife: [{ time: 0, value: 0.2 }, { time: 1, value: 2 }] }, "smoke"); break;
        case "matrix":
            layer({ rate: 120, position: P(0, 2.9), rotation: P(0, 0, Math.PI), shape: { kind: "cone", radius: 2, angle: 0 }, speed: [1.2, 2.5], lifetimeMs: 2600, size: [0.16, 0.23], color: 0x65ffac, spriteSheet: { columns: 4, rows: 4, fps: 10, startFrame: [0, 15], row: "random", blend: true } }, "glyph"); break;
    }
    function advance(deltaMs: number, emitting: boolean): void {
        recording = false;
        time += deltaMs;
        for (const motion of motions) motion(time / 1000);
        for (const e of emitters) { e.setEmitting(emitting); e.present(time); }
        // Refresh long-lived authored formations before the engine's finite lifetime.
        // Replay only initial layout commands; user bursts remain temporary.
        for (const formation of formations) if (time - formation.refreshedAt >= 900_000) {
            formation.emitter.restart();
            for (const command of formation.commands) formation.emitter.emit(command.count, command.overrides);
            formation.refreshedAt = time;
        }
        for (const p of pulses) if (time >= p.next) {
            if (emitting) p.emitter.emit(p.count);
            p.next = time + p.interval;
        }
        for (const e of alpha) e.sort(camera);
    }
    // Warm only when a preset first becomes visible; off-screen effects do no work.
    advance(0, true);
    for (let i = 0; i < 65; i++) advance(40, true);
    return {
        scene, camera, emitters, advance,
        burst(): void { for (const e of emitters) e.emit(80, { lifetimeMs: 900, speed: [0.4, 2.5], size: [0.07, 0.16] }); },
        dispose(): void { for (const e of emitters) e.dispose(); scene.clear(); },
    };
}
