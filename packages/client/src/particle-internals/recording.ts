import * as THREE from "three";
import type { ParticleEmitter, ParticleEmitterOptions } from "./types.js";
import { integer, number, record } from "./validation.js";
import { emitterAccess } from "./access.js";

type Command = { method: string; args: unknown[]; matrix: number[]; vertices: number[][]; elapsed: number; bytes: number };
/** Bounded input journal. Runtime update callbacks must be deterministic. @internal */
export function createRecordedEmitter(parent: THREE.Object3D, options: ParticleEmitterOptions, factory: (parent: THREE.Object3D, options: ParticleEmitterOptions) => ParticleEmitter): ParticleEmitter {
    record(options.recording!, ["maxCommands", "maxBytes"], "recording");
    const maxCommands = integer(options.recording!.maxCommands ?? 10000, 1, 1000000, "recording maxCommands"), maxBytes = integer(options.recording!.maxBytes ?? 8 * 1024 * 1024, 1024, 256 * 1024 * 1024, "recording maxBytes");
    const { recording: _recording, runtime, texture, ...data } = options;
    const initial = structuredClone(data), initialMatrix = snapshot();
    let replaying = false, samples: number[][] = [], sampleIndex = 0, commands: Command[] = [], bytes = 0, full = false, until = 0, clock = 0, branch: Command[] | undefined;
    let sampleBytes = 0, overflow = false, executing = false;
    const provider = runtime?.meshPositions, onComplete = runtime?.onComplete;
    const runtimeCopy = runtime ? { ...runtime, ...(runtime.softParticles ? { softParticles: { ...runtime.softParticles, ...(runtime.softParticles.origin ? { origin: { ...runtime.softParticles.origin } } : {}) } } : {}), ...(runtime.meshPositions ? { meshPositions: () => {
        if (replaying) { const value = samples[sampleIndex++]; if (!value) throw new Error("Missing recorded mesh snapshot"); return value; }
        const value = provider!();
        if (!full && sampleBytes + value.length * 8 + bytes <= maxBytes) { samples.push(Array.from(value)); sampleBytes += value.length * 8; } else overflow = true;
        return value;
    } } : {}), ...(runtime.onComplete ? { onComplete: () => { if (!replaying) onComplete!(); } } : {}) } : undefined;
    const config = { ...initial, ...(texture ? { texture } : {}), ...(runtimeCopy ? { runtime: runtimeCopy } : {}) };
    function create() {
        const before = new Set(parent.children); const emitter = factory(parent, config);
        for (const child of parent.children) if (!before.has(child)) child.userData.particleCustomMaterial = true;
        return emitter;
    }
    let current = create();
    if (overflow) { current.dispose(); throw new RangeError("recording budget cannot hold prewarm mesh snapshots"); }
    const initialSamples = samples, initialBytes = sampleBytes; bytes = initialBytes; samples = []; sampleBytes = 0;
    function snapshot() { parent.updateWorldMatrix(true, false); return parent.matrixWorld.toArray(); }
    function withMatrix<T>(matrix: number[], action: () => T): T {
        const ownedUpdate = Object.hasOwn(parent, "updateWorldMatrix"), update = parent.updateWorldMatrix, saved = parent.matrixWorld.clone();
        parent.updateWorldMatrix = () => { parent.matrixWorld.fromArray(matrix); };
        parent.matrixWorld.fromArray(matrix);
        try { return action(); } finally { if (ownedUpdate) parent.updateWorldMatrix = update; else Reflect.deleteProperty(parent, "updateWorldMatrix"); parent.matrixWorld.copy(saved); }
    }
    function invoke(method: string, args: unknown[]): unknown {
        const target = method.startsWith("$") ? emitterAccess.get(current)! : current;
        return Reflect.apply(Reflect.get(target, method.replace(/^\$/, "")) as (...args: unknown[]) => unknown, target, args);
    }
    function run(method: string, args: unknown[]) {
        if (executing || replaying) throw new Error("Particle callbacks cannot reenter recorded mutations");
        const matrix = snapshot();
        // Texture/camera handles are borrowed; all authoring data is copied.
        const copy = method === "setDepthSource" ? [args[0], ...structuredClone(args.slice(1))] : structuredClone(args);
        if (branch !== undefined) { commands = branch; bytes = commands.reduce((n, c) => n + c.bytes, initialBytes); until = clock; full = false; branch = undefined; }
        const before = current.inspect().elapsedMs; samples = []; sampleBytes = 0; overflow = false;
        let result: unknown; executing = true;
        try { result = invoke(method, args); } catch (error) { full = true; throw error; } finally { executing = false; }
        clock += Math.max(0, current.inspect().elapsedMs - before);
        if (!full) {
            const size = (method === "setDepthSource" ? 256 : JSON.stringify(copy).length * 2 + 256) + samples.reduce((n, a) => n + a.length * 8, 0);
            if (overflow || commands.length >= maxCommands || bytes + size > maxBytes) full = true;
            else { commands.push({ method, args: copy, matrix, vertices: samples, elapsed: clock, bytes: size }); bytes += size; until = clock; }
        }
        return result;
    }
    function seek(time: number, mode: "automatic" | "recorded" = "automatic") {
        if (executing || replaying) throw new Error("Particle callbacks cannot reenter recorded seeking");
        if (current.inspect().disposed) throw new Error("Particle emitter has been disposed");
        if (mode !== "automatic" && mode !== "recorded") throw new TypeError("Invalid seek mode");
        if (mode === "automatic") { run("seek", [time]); return; }
        number(time, 0, until, "recorded seek timeMs");
        const old = current; replaying = true;
        let next: ParticleEmitter | undefined; const prefix: Command[] = []; let previousTime = 0;
        try {
            samples = initialSamples; sampleIndex = 0;
            next = withMatrix(initialMatrix, () => create()); current = next;
            let index = 0;
            for (; index < commands.length; index++) {
                const command = commands[index]!;
                samples = command.vertices; sampleIndex = 0;
                if (command.elapsed > time) {
                    const state = current.inspect();
                    if (command.method === "present" && state.presentationTimeMs !== null && state.timeScale > 0) {
                        const timestamp = state.presentationTimeMs + (time - previousTime) / state.timeScale;
                        withMatrix(command.matrix, () => current.present(timestamp));
                        prefix.push({ ...command, args: [timestamp], elapsed: time });
                    } else if (command.method === "prewarm") { withMatrix(command.matrix, () => current.prewarm(time - previousTime)); prefix.push({ ...command, args: [time - previousTime], elapsed: time }); }
                    break;
                }
                previousTime = command.elapsed; prefix.push(command);
                withMatrix(command.matrix, () => invoke(command.method, command.args));
            }
            current.drainEvents(); branch = prefix; clock = time; old.dispose();
        } catch (error) { next?.dispose(); current = old; throw error; }
        finally { replaying = false; }
    }
    const readOnly = new Set(["inspect", "dispose", "drainEvents", "cull", "sort"]);
    const api = Object.freeze(Object.fromEntries(Object.keys(current).map(method => [method,
        method === "seek" ? seek : method === "inspect" ? () => Object.freeze({ ...current.inspect(), recordedUntilMs: until, recordingFull: full }) : (...args: unknown[]) => readOnly.has(method) ? invoke(method, args) : run(method, args),
    ]))) as unknown as ParticleEmitter;
    emitterAccess.set(api, { emit: (count, overrides, age) => run("$emit", [count, overrides, age]) as number, flush: () => { run("$flush", []); }, refresh: () => { invoke("$refresh", []); }, reset: () => { run("$reset", []); }, complete: () => { invoke("$complete", []); } });
    return api;
}
