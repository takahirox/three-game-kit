import * as THREE from "three";
import { createParticleEmitter, type ParticleEmitter, type ParticleEmitterOptions, type ParticleEmission } from "@three-game-kit/client/particles";
import type { TextureName } from "./textures.js";

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
] as const;
export type PresetId = typeof PRESETS[number]["id"];
export interface Effect {
    readonly scene: THREE.Scene;
    readonly camera: THREE.PerspectiveCamera;
    readonly emitters: readonly ParticleEmitter[];
    advance(deltaMs: number, emitting: boolean): void;
    burst(): void;
    dispose(): void;
}
const flat = [{ time: 0, value: 1 }, { time: 1, value: 1 }];
const fadeInOut = [{ time: 0, value: 0 }, { time: 0.15, value: 1 }, { time: 1, value: 0 }];
const P = (x = 0, y = 0, z = 0) => ({ x, y, z });

export function createEffect(id: PresetId, textures: Record<TextureName, THREE.DataTexture>): Effect {
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
                const e = layer({ capacity: 180, lifetimeMs: 1e6, size: 0.8, color, opacityOverLife: [{ time: 0, value: 0.3 }, { time: 1, value: 0.3 }] }, "streak");
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
            layer({ rate: 120, position: P(0, 2.9), rotation: P(0, 0, Math.PI), shape: { kind: "cone", radius: 2, angle: 0 }, speed: [1.2, 2.5], lifetimeMs: 2600, size: [0.16, 0.23], color: 0x65ffac, spriteSheet: { columns: 4, rows: 4, cycles: 3 } }, "glyph"); break;
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
