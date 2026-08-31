import * as THREE from "three";
import {
    defineFeatureConfiguration,
    type ClientFeatureDescriptor,
    type ClientFeatureSetupContext,
} from "@three-game-kit/core";
export interface VfxVector3 {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}
/** Structural public handle for a Three.js Object3D without leaking vendor types. */
export interface VfxSceneParent {
    readonly isObject3D: true;
}
export interface VfxBurstCommand {
    readonly kind: "burst";
    readonly position: VfxVector3;
    readonly count: number;
    readonly color: number;
    readonly speed: number;
    readonly lifetimeMs: number;
    readonly seed: number;
}
export interface VfxTrailCommand {
    readonly kind: "trail";
    readonly start: VfxVector3;
    readonly end: VfxVector3;
    readonly color: number;
    readonly width: number;
    readonly lifetimeMs: number;
    readonly seed: number;
}
export interface VfxPopupCommand {
    readonly kind: "popup";
    readonly position: VfxVector3;
    readonly color: number;
    readonly size: number;
    readonly lifetimeMs: number;
    readonly seed: number;
}
export type VfxCommand = VfxBurstCommand | VfxTrailCommand | VfxPopupCommand;
export interface VfxRuntimeOptions {
    readonly commandCapacity?: number;
    readonly burstEffectCapacity?: number;
    readonly trailEffectCapacity?: number;
    readonly popupEffectCapacity?: number;
    readonly maxBurstParticles?: number;
}
export interface VfxInspectionCounters {
    readonly submittedCommandCount: number;
    readonly presentedCommandCount: number;
    readonly commandOverflowCount: number;
    readonly effectOverflowCount: number;
    readonly expiredEffectCount: number;
}
export interface VfxLiveResourceCounts {
    readonly groups: number;
    readonly objects: number;
    readonly geometries: number;
    readonly materials: number;
    readonly retainedReferences: number;
}
export interface VfxInspection {
    readonly disposed: boolean;
    readonly presentationTimeMs: number | null;
    readonly queuedCommandCount: number;
    readonly activeBurstCount: number;
    readonly activeTrailCount: number;
    readonly activePopupCount: number;
    readonly counters: VfxInspectionCounters;
    readonly liveResourceCounts: VfxLiveResourceCounts;
}
export interface VfxRuntime {
    enqueue(command: VfxCommand): void;
    present(presentationTimeMs: number): void;
    inspect(): VfxInspection;
    dispose(): void;
}
interface BurstSlot {
    command: VfxBurstCommand | null;
    bornMs: number;
    readonly geometry: THREE.BufferGeometry;
    readonly material: THREE.PointsMaterial;
    readonly object: THREE.Points;
}
interface TrailSlot {
    command: VfxTrailCommand | null;
    bornMs: number;
    readonly geometry: THREE.BufferGeometry;
    readonly material: THREE.LineBasicMaterial;
    readonly object: THREE.Line;
}
interface PopupSlot {
    command: VfxPopupCommand | null;
    bornMs: number;
    readonly material: THREE.SpriteMaterial;
    readonly object: THREE.Sprite;
}
const DEFAULT_COMMAND_CAPACITY = 64;
const DEFAULT_BURST_EFFECT_CAPACITY = 8;
const DEFAULT_TRAIL_EFFECT_CAPACITY = 16;
const DEFAULT_POPUP_EFFECT_CAPACITY = 8;
const DEFAULT_MAX_BURST_PARTICLES = 64;
const MAX_COMMAND_CAPACITY = 1024;
const MAX_EFFECT_CAPACITY = 256;
const MAX_BURST_PARTICLES = 512;
const MAX_COUNTER = Number.MAX_SAFE_INTEGER;
const UINT32_MAX = 4294967295;
const RGB_MAX = 16777215;
const BURST_MATERIAL_COLOR = 16777215;
const TRAIL_MATERIAL_COLOR = 16777215;
const POPUP_MATERIAL_COLOR = 16777215;
function hasExactlyKeys(value: object, expected: readonly string[]): boolean { const keys = Reflect.ownKeys(value); return keys.length === expected.length && expected.every((key) => keys.includes(key)); }
function requireCapacity(value: number | undefined, fallback: number, maximum: number, label: string): number { const resolved = value ?? fallback; if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum)
    throw new TypeError(`${label} must be a positive safe integer no greater than ${maximum}`); return resolved; }
function copyVector(value: VfxVector3, label: string): VfxVector3 { if (typeof value !== "object" || value === null || Array.isArray(value) || !hasExactlyKeys(value, ["x", "y", "z"]))
    throw new TypeError(`${label} must contain exactly x, y, and z`); const { x, y, z } = value; if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
    throw new TypeError(`${label} components must be finite numbers`); return Object.freeze({ x, y, z }); }
function requirePositive(value: number, label: string): number { if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new TypeError(`${label} must be a positive finite number`); return value; }
function requireColor(value: number): number { if (!Number.isInteger(value) || value < 0 || value > RGB_MAX)
    throw new TypeError("VFX color must be an unsigned 24-bit integer"); return value; }
function requireSeed(value: number): number { if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX)
    throw new TypeError("VFX seed must be an unsigned 32-bit integer"); return value; }
function copyCommand(command: VfxCommand, maxBurstParticles: number): VfxCommand { if (typeof command !== "object" || command === null || Array.isArray(command))
    throw new TypeError("VFX command must be an object"); switch (command.kind) {
    case "burst":
        if (!hasExactlyKeys(command, ["kind", "position", "count", "color", "speed", "lifetimeMs", "seed"]))
            throw new TypeError("Burst command fields are invalid");
        if (!Number.isSafeInteger(command.count) || command.count <= 0 || command.count > maxBurstParticles)
            throw new TypeError(`Burst count must be between 1 and ${maxBurstParticles}`);
        return Object.freeze({ kind: "burst", position: copyVector(command.position, "Burst position"), count: command.count, color: requireColor(command.color), speed: requirePositive(command.speed, "Burst speed"), lifetimeMs: requirePositive(command.lifetimeMs, "Burst lifetimeMs"), seed: requireSeed(command.seed) });
    case "trail":
        if (!hasExactlyKeys(command, ["kind", "start", "end", "color", "width", "lifetimeMs", "seed"]))
            throw new TypeError("Trail command fields are invalid");
        return Object.freeze({ kind: "trail", start: copyVector(command.start, "Trail start"), end: copyVector(command.end, "Trail end"), color: requireColor(command.color), width: requirePositive(command.width, "Trail width"), lifetimeMs: requirePositive(command.lifetimeMs, "Trail lifetimeMs"), seed: requireSeed(command.seed) });
    case "popup":
        if (!hasExactlyKeys(command, ["kind", "position", "color", "size", "lifetimeMs", "seed"]))
            throw new TypeError("Popup command fields are invalid");
        return Object.freeze({ kind: "popup", position: copyVector(command.position, "Popup position"), color: requireColor(command.color), size: requirePositive(command.size, "Popup size"), lifetimeMs: requirePositive(command.lifetimeMs, "Popup lifetimeMs"), seed: requireSeed(command.seed) });
    default: throw new TypeError("VFX command kind must be burst, trail, or popup");
} }
function increment(value: number): number { return value === MAX_COUNTER ? value : value + 1; }
function createRandom(seed: number): () => number { let state = seed >>> 0; return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; }; }
export function createVfxRuntime(scene: VfxSceneParent, options?: VfxRuntimeOptions): VfxRuntime { if (!(scene instanceof THREE.Object3D))
    throw new TypeError("VFX scene must be a Three.js Object3D"); if (options !== undefined && (typeof options !== "object" || options === null || Array.isArray(options) || !Reflect.ownKeys(options).every((key) => typeof key === "string" && ["commandCapacity", "burstEffectCapacity", "trailEffectCapacity", "popupEffectCapacity", "maxBurstParticles"].includes(key))))
    throw new TypeError("VFX runtime options are invalid"); const commandCapacity = requireCapacity(options?.commandCapacity, DEFAULT_COMMAND_CAPACITY, MAX_COMMAND_CAPACITY, "Command capacity"); const burstCapacity = requireCapacity(options?.burstEffectCapacity, DEFAULT_BURST_EFFECT_CAPACITY, MAX_EFFECT_CAPACITY, "Burst effect capacity"); const trailCapacity = requireCapacity(options?.trailEffectCapacity, DEFAULT_TRAIL_EFFECT_CAPACITY, MAX_EFFECT_CAPACITY, "Trail effect capacity"); const popupCapacity = requireCapacity(options?.popupEffectCapacity, DEFAULT_POPUP_EFFECT_CAPACITY, MAX_EFFECT_CAPACITY, "Popup effect capacity"); const maxBurstParticles = requireCapacity(options?.maxBurstParticles, DEFAULT_MAX_BURST_PARTICLES, MAX_BURST_PARTICLES, "Maximum burst particles"); const parent = scene as THREE.Object3D; const root = new THREE.Group(); root.name = "three-game-kit-vfx"; parent.add(root); const bursts: BurstSlot[] = []; const trails: TrailSlot[] = []; const popups: PopupSlot[] = []; for (let index = 0; index < burstCapacity; index += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(maxBurstParticles * 3), 3));
    geometry.setDrawRange(0, 0);
    const material = new THREE.PointsMaterial({ color: BURST_MATERIAL_COLOR, size: 0.09, transparent: true, depthWrite: false });
    const object = new THREE.Points(geometry, material);
    object.visible = false;
    root.add(object);
    bursts.push({ command: null, bornMs: 0, geometry, material, object });
} for (let index = 0; index < trailCapacity; index += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const material = new THREE.LineBasicMaterial({ color: TRAIL_MATERIAL_COLOR, transparent: true, depthWrite: false });
    const object = new THREE.Line(geometry, material);
    object.visible = false;
    root.add(object);
    trails.push({ command: null, bornMs: 0, geometry, material, object });
} for (let index = 0; index < popupCapacity; index += 1) {
    const material = new THREE.SpriteMaterial({ color: POPUP_MATERIAL_COLOR, transparent: true, depthWrite: false });
    const object = new THREE.Sprite(material);
    object.visible = false;
    root.add(object);
    popups.push({ command: null, bornMs: 0, material, object });
} const queued: VfxCommand[] = []; let disposed = false; let presentationTimeMs: number | null = null; let burstCursor = 0; let trailCursor = 0; let popupCursor = 0; let submittedCommandCount = 0; let presentedCommandCount = 0; let commandOverflowCount = 0; let effectOverflowCount = 0; let expiredEffectCount = 0; function expire(slot: BurstSlot | TrailSlot | PopupSlot): void { if (slot.command !== null)
    expiredEffectCount = increment(expiredEffectCount); slot.command = null; slot.object.visible = false; } function spawn(command: VfxCommand, nowMs: number): void { presentedCommandCount = increment(presentedCommandCount); if (command.kind === "burst") {
    const slot = bursts[burstCursor];
    burstCursor = (burstCursor + 1) % bursts.length;
    if (slot === undefined)
        return;
    if (slot.command !== null)
        effectOverflowCount = increment(effectOverflowCount);
    slot.command = command;
    slot.bornMs = nowMs;
    slot.material.color.setHex(command.color);
    slot.material.opacity = 1;
    slot.geometry.setDrawRange(0, command.count);
    slot.object.visible = true;
    return;
} if (command.kind === "trail") {
    const slot = trails[trailCursor];
    trailCursor = (trailCursor + 1) % trails.length;
    if (slot === undefined)
        return;
    if (slot.command !== null)
        effectOverflowCount = increment(effectOverflowCount);
    slot.command = command;
    slot.bornMs = nowMs;
    slot.material.color.setHex(command.color);
    slot.material.linewidth = command.width;
    const position = slot.geometry.getAttribute("position");
    position.setXYZ(0, command.start.x, command.start.y, command.start.z);
    position.setXYZ(1, command.end.x, command.end.y, command.end.z);
    position.needsUpdate = true;
    slot.object.visible = true;
    return;
} const slot = popups[popupCursor]; popupCursor = (popupCursor + 1) % popups.length; if (slot === undefined)
    return; if (slot.command !== null)
    effectOverflowCount = increment(effectOverflowCount); slot.command = command; slot.bornMs = nowMs; slot.material.color.setHex(command.color); slot.object.position.set(command.position.x, command.position.y, command.position.z); slot.object.scale.set(command.size, command.size, 1); slot.object.visible = true; } function updateBurst(slot: BurstSlot, nowMs: number): void { const command = slot.command; if (command === null)
    return; const elapsedMs = nowMs - slot.bornMs; if (elapsedMs >= command.lifetimeMs) {
    expire(slot);
    return;
} const elapsedSeconds = elapsedMs / 1000; const random = createRandom(command.seed); const position = slot.geometry.getAttribute("position"); for (let index = 0; index < command.count; index += 1) {
    const angle = random() * Math.PI * 2;
    const vertical = 0.35 + random() * 0.9;
    const magnitude = command.speed * (0.4 + random() * 0.6);
    position.setXYZ(index, command.position.x + Math.cos(angle) * magnitude * elapsedSeconds, command.position.y + vertical * magnitude * elapsedSeconds - 4.9 * elapsedSeconds * elapsedSeconds, command.position.z + Math.sin(angle) * magnitude * elapsedSeconds);
} position.needsUpdate = true; slot.material.opacity = 1 - elapsedMs / command.lifetimeMs; } function updateTrail(slot: TrailSlot, nowMs: number): void { const command = slot.command; if (command === null)
    return; const elapsedMs = nowMs - slot.bornMs; if (elapsedMs >= command.lifetimeMs) {
    expire(slot);
    return;
} slot.material.opacity = 1 - elapsedMs / command.lifetimeMs; } function updatePopup(slot: PopupSlot, nowMs: number): void { const command = slot.command; if (command === null)
    return; const elapsedMs = nowMs - slot.bornMs; if (elapsedMs >= command.lifetimeMs) {
    expire(slot);
    return;
} const progress = elapsedMs / command.lifetimeMs; slot.object.position.set(command.position.x, command.position.y + progress * command.size, command.position.z); slot.material.opacity = 1 - progress; } return Object.freeze({ enqueue(command: VfxCommand): void { if (disposed)
        throw new Error("VFX runtime has been disposed"); const copied = copyCommand(command, maxBurstParticles); submittedCommandCount = increment(submittedCommandCount); if (queued.length === commandCapacity) {
        queued.shift();
        commandOverflowCount = increment(commandOverflowCount);
    } queued.push(copied); }, present(nowMs: number): void { if (disposed)
        throw new Error("VFX runtime has been disposed"); if (typeof nowMs !== "number" || !Number.isFinite(nowMs) || nowMs < 0 || (presentationTimeMs !== null && nowMs < presentationTimeMs))
        throw new TypeError("VFX presentation time must be finite, non-negative, and monotonic"); presentationTimeMs = nowMs; while (queued.length > 0) {
        const command = queued.shift();
        if (command !== undefined)
            spawn(command, nowMs);
    } for (const slot of bursts)
        updateBurst(slot, nowMs); for (const slot of trails)
        updateTrail(slot, nowMs); for (const slot of popups)
        updatePopup(slot, nowMs); }, inspect(): VfxInspection { const activeBurstCount = bursts.reduce((count, slot) => count + (slot.command === null ? 0 : 1), 0); const activeTrailCount = trails.reduce((count, slot) => count + (slot.command === null ? 0 : 1), 0); const activePopupCount = popups.reduce((count, slot) => count + (slot.command === null ? 0 : 1), 0); const objectCount = disposed ? 0 : bursts.length + trails.length + popups.length; const geometryCount = disposed ? 0 : bursts.length + trails.length; const materialCount = disposed ? 0 : objectCount; return Object.freeze({ disposed, presentationTimeMs, queuedCommandCount: queued.length, activeBurstCount, activeTrailCount, activePopupCount, counters: Object.freeze({ submittedCommandCount, presentedCommandCount, commandOverflowCount, effectOverflowCount, expiredEffectCount }), liveResourceCounts: Object.freeze({ groups: disposed ? 0 : 1, objects: objectCount, geometries: geometryCount, materials: materialCount, retainedReferences: disposed ? 0 : 1 + objectCount + geometryCount + materialCount + queued.length }) }); }, dispose(): void { if (disposed)
        return; disposed = true; queued.length = 0; for (const slot of bursts) {
        slot.command = null;
        slot.object.visible = false;
        slot.geometry.dispose();
        slot.material.dispose();
    } for (const slot of trails) {
        slot.command = null;
        slot.object.visible = false;
        slot.geometry.dispose();
        slot.material.dispose();
    } for (const slot of popups) {
        slot.command = null;
        slot.object.visible = false;
        slot.material.dispose();
    } root.remove(...root.children); if (root.parent !== null)
        root.parent.remove(root); } }); }

type VfxFeatureConfiguration = Readonly<Record<string, never>>;

const VFX_FEATURE_CONFIGURATION =
    defineFeatureConfiguration<VfxFeatureConfiguration>({
        defaultValue: () => Object.freeze({}),
        parse(input: unknown) {
            if (
                typeof input === "object" &&
                input !== null &&
                !Array.isArray(input) &&
                hasExactlyKeys(input, [])
            ) {
                return {
                    ok: true,
                    value: Object.freeze({}) as VfxFeatureConfiguration,
                };
            }
            return {
                ok: false,
                issues: [{ path: [], code: "empty-object-required" }],
            };
        },
    });

/**
 * Installs a VFX runtime in the public client presentation schedule.
 *
 * Commands remain caller-driven. The Feature supplies the explicit presentation
 * timestamp and owns disposal of the runtime and its Three.js resources.
 */
export function createVfxFeature(options: {
    readonly runtime: VfxRuntime;
}): ClientFeatureDescriptor<VfxFeatureConfiguration> {
    if (
        typeof options !== "object" ||
        options === null ||
        Array.isArray(options) ||
        !hasExactlyKeys(options, ["runtime"]) ||
        typeof options.runtime !== "object" ||
        options.runtime === null ||
        typeof options.runtime.enqueue !== "function" ||
        typeof options.runtime.present !== "function" ||
        typeof options.runtime.inspect !== "function" ||
        typeof options.runtime.dispose !== "function"
    ) {
        throw new TypeError("VFX feature options are invalid");
    }

    const runtime = options.runtime;
    let active = false;
    let disposed = false;

    const contribution = Object.freeze({
        kind: "system" as const,
        id: "vfx-present",
        domain: "client-presentation" as const,
        phase: "render" as const,
        priority: -100,
        run({ timestampMs }: { readonly timestampMs: number }): void {
            if (disposed) throw new Error("VFX feature has been disposed");
            if (!active) return;
            runtime.present(timestampMs);
        },
    });

    return Object.freeze({
        id: "vfx",
        description: "Presents deterministic bounded VFX before Three.js rendering",
        runtimeContributions: Object.freeze([contribution]),
        requires: Object.freeze([]),
        conflicts: Object.freeze([]),
        configuration: VFX_FEATURE_CONFIGURATION,
        setup({ ledger }: ClientFeatureSetupContext<VfxFeatureConfiguration>): void {
            if (disposed) throw new Error("VFX feature has been disposed");
            ledger.acquire({
                resourceId: "vfx-runtime",
                kind: "renderResources",
                value: runtime,
                release: () => runtime.dispose(),
            });
            active = true;
            try {
                ledger.activateSystem(contribution.id);
            } catch (error) {
                active = false;
                throw error;
            }
        },
        dispose(): void {
            if (disposed) return;
            active = false;
            disposed = true;
            runtime.dispose();
        },
    });
}
