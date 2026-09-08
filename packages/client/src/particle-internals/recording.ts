import * as THREE from "three";
import type { ParticleEmitter, ParticleEmitterOptions, ParticleRecordedState } from "./types.js";
import { integer, number, record } from "./validation.js";
import { emitterAccess } from "./access.js";

type Frame = { matrix: number[]; scale: number[]; custom?: { matrix: number[]; scale: number[] } };
type Command = { method: string; args: unknown[]; matrix: Frame; state: ParticleRecordedState | undefined; vertices: number[][]; elapsed: number; bytes: number };
/** Bounded input journal. Callbacks can journal external state through captureState/restoreState. @internal */
export function createRecordedEmitter(parent: THREE.Object3D, options: ParticleEmitterOptions, factory: (parent: THREE.Object3D, options: ParticleEmitterOptions) => ParticleEmitter): ParticleEmitter {
    record(options.recording!, ["maxCommands", "maxBytes"], "recording");
    const maxCommands = integer(options.recording!.maxCommands ?? 10000, 1, 1000000, "recording maxCommands"), maxBytes = integer(options.recording!.maxBytes ?? 8 * 1024 * 1024, 1024, 256 * 1024 * 1024, "recording maxBytes");
    const { recording: _recording, runtime, texture, ...data } = options;
    const initial = structuredClone(data), initialMatrix = snapshot();
    if ((runtime?.captureState === undefined) !== (runtime?.restoreState === undefined)) throw new TypeError("captureState and restoreState must be paired");
    let inStateHook = false;
    function capture(): ParticleRecordedState | undefined {
        if (!runtime?.captureState) return undefined;
        let budget = maxBytes;
        const ancestors = new Set<object>();
        function copy(value: unknown, depth: number): ParticleRecordedState {
            if (depth > 32 || (budget -= 16) < 0) throw new RangeError("recorded external state exceeds budget");
            if (value === null || typeof value === "boolean") return value;
            if (typeof value === "number" && Number.isFinite(value)) return value;
            if (typeof value === "string") { budget -= value.length * 2; if (budget < 0) throw new RangeError("recorded external state exceeds budget"); return value; }
            if (typeof value !== "object" || !value || ancestors.has(value) || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new TypeError("recorded state must be finite, acyclic JSON data");
            ancestors.add(value);
            const result = Array.isArray(value) ? Array.from(value, v => copy(v, depth + 1)) : Object.fromEntries(Object.entries(value).map(([k, v]) => { budget -= k.length * 2; return [k, copy(v, depth + 1)]; }));
            ancestors.delete(value); return result;
        }
        if (inStateHook) throw new Error("Recorded state hooks cannot reenter");
        inStateHook = true; try { return copy(runtime.captureState(), 0); } finally { inStateHook = false; }
    }
    const initialState = capture();
    const stateBytes = (state: ParticleRecordedState | undefined) => state === undefined ? 0 : JSON.stringify(state).length * 2;
    function restore(state: ParticleRecordedState | undefined) { if (state !== undefined) { inStateHook = true; try { runtime!.restoreState!(structuredClone(state)); } finally { inStateHook = false; } } }
    let replaying = false, samples: number[][] = [], sampleIndex = 0, commands: Command[] = [], bytes = 0, full = false, until = 0, clock = 0, branch: Command[] | undefined;
    let sampleBytes = stateBytes(initialState), overflow = false, executing = false;
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
    function objectFrame(object: THREE.Object3D) { object.updateWorldMatrix(true, false); return { matrix: object.matrixWorld.toArray(), scale: object.scale.toArray() }; }
    function snapshot(): Frame { return { ...objectFrame(parent), ...(runtime?.customSimulationSpace instanceof THREE.Object3D ? { custom: objectFrame(runtime.customSimulationSpace) } : {}) }; }
    function interpolate(a: Frame, b: Frame, fraction: number): Frame {
        const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p2 = p.clone(), q2 = q.clone(), s2 = s.clone();
        const blend = (a: { matrix: number[]; scale: number[] }, b: { matrix: number[]; scale: number[] }) => {
            new THREE.Matrix4().fromArray(a.matrix).decompose(p, q, s); new THREE.Matrix4().fromArray(b.matrix).decompose(p2, q2, s2);
            return { matrix: new THREE.Matrix4().compose(p.lerp(p2, fraction), q.slerp(q2, fraction), s.lerp(s2, fraction)).toArray(), scale: a.scale.map((v, i) => v + (b.scale[i]! - v) * fraction) };
        };
        return { ...blend(a, b), ...(a.custom && b.custom ? { custom: blend(a.custom, b.custom) } : {}) };
    }
    function withObject<T>(parent: THREE.Object3D, frame: { matrix: number[]; scale: number[] }, action: () => T): T {
        const matrix = frame.matrix, savedScale = parent.scale.clone(); parent.scale.fromArray(frame.scale);
        const ownedUpdate = Object.hasOwn(parent, "updateWorldMatrix"), update = parent.updateWorldMatrix, saved = parent.matrixWorld.clone();
        parent.updateWorldMatrix = () => { parent.matrixWorld.fromArray(matrix); };
        parent.matrixWorld.fromArray(matrix);
        try { return action(); } finally { if (ownedUpdate) parent.updateWorldMatrix = update; else Reflect.deleteProperty(parent, "updateWorldMatrix"); parent.matrixWorld.copy(saved); parent.scale.copy(savedScale); }
    }
    function withMatrix<T>(frame: Frame, action: () => T): T {
        return withObject(parent, frame, () => frame.custom && runtime?.customSimulationSpace instanceof THREE.Object3D ? withObject(runtime.customSimulationSpace, frame.custom, action) : action());
    }
    function invoke(method: string, args: unknown[]): unknown {
        const target = method.startsWith("$") ? emitterAccess.get(current)! : current;
        return Reflect.apply(Reflect.get(target, method.replace(/^\$/, "")) as (...args: unknown[]) => unknown, target, args);
    }
    function run(method: string, args: unknown[]) {
        if (executing || replaying || inStateHook) throw new Error("Particle callbacks cannot reenter recorded mutations");
        const matrix = snapshot();
        const state = full && branch === undefined ? undefined : capture();
        // Texture/camera handles are borrowed; all authoring data is copied.
        const copy = method === "setDepthSource" ? [args[0], ...structuredClone(args.slice(1))] : structuredClone(args);
        if (branch !== undefined) { commands = branch; bytes = commands.reduce((n, c) => n + c.bytes, initialBytes); until = clock; full = false; branch = undefined; }
        const before = current.inspect().elapsedMs; samples = []; sampleBytes = 0; overflow = false;
        let result: unknown; executing = true;
        try { result = invoke(method, args); } catch (error) { full = true; throw error; } finally { executing = false; }
        clock += Math.max(0, current.inspect().elapsedMs - before);
        if (!full) {
            const size = (method === "setDepthSource" ? 256 : JSON.stringify(copy).length * 2 + 512) + stateBytes(state) + samples.reduce((n, a) => n + a.length * 8, 0);
            if (overflow || commands.length >= maxCommands || bytes + size > maxBytes) full = true;
            else { commands.push({ method, args: copy, matrix, state, vertices: samples, elapsed: clock, bytes: size }); bytes += size; until = clock; }
        }
        return result;
    }
    function seek(time: number, mode: "automatic" | "recorded" = "automatic") {
        if (executing || replaying || inStateHook) throw new Error("Particle callbacks cannot reenter recorded seeking");
        if (current.inspect().disposed) throw new Error("Particle emitter has been disposed");
        if (mode !== "automatic" && mode !== "recorded") throw new TypeError("Invalid seek mode");
        if (mode === "automatic") { run("seek", [time]); return; }
        number(time, 0, until, "recorded seek timeMs");
        const old = current, oldState = capture(); replaying = true;
        let next: ParticleEmitter | undefined; const prefix: Command[] = []; let previousTime = 0, previousMatrix = initialMatrix;
        try {
            restore(initialState);
            samples = initialSamples; sampleIndex = 0;
            next = withMatrix(initialMatrix, () => create()); current = next;
            let index = 0;
            for (; index < commands.length; index++) {
                const command = commands[index]!;
                if (command.elapsed > time && previousTime === time) break;
                restore(command.state);
                samples = command.vertices; sampleIndex = 0;
                if (command.elapsed > time) {
                    const frame = interpolate(previousMatrix, command.matrix, (time - previousTime) / (command.elapsed - previousTime));
                    const state = current.inspect();
                    if (command.method === "present" && state.presentationTimeMs !== null && state.timeScale > 0) {
                        const timestamp = state.presentationTimeMs + (time - previousTime) / state.timeScale;
                        withMatrix(frame, () => current.present(timestamp));
                        prefix.push({ ...command, args: [timestamp], matrix: frame, elapsed: time });
                    } else if (command.method === "prewarm") { withMatrix(frame, () => current.prewarm(time - previousTime)); prefix.push({ ...command, args: [time - previousTime], matrix: frame, elapsed: time }); }
                    break;
                }
                previousTime = command.elapsed; previousMatrix = command.matrix; prefix.push(command);
                withMatrix(command.matrix, () => invoke(command.method, command.args));
            }
            current.drainEvents(); branch = prefix; clock = time; old.dispose();
        } catch (error) { next?.dispose(); current = old; restore(oldState); throw error; }
        finally { replaying = false; }
    }
    const readOnly = new Set(["inspect", "dispose", "drainEvents", "cull", "sort"]);
    const api = Object.freeze(Object.fromEntries(Object.keys(current).map(method => [method,
        method === "seek" ? seek : method === "inspect" ? () => Object.freeze({ ...current.inspect(), recordedUntilMs: until, recordingFull: full }) : (...args: unknown[]) => readOnly.has(method) ? invoke(method, args) : run(method, args),
    ]))) as unknown as ParticleEmitter;
    emitterAccess.set(api, { space: () => emitterAccess.get(current)!.space(), emit: (count, overrides, age) => run("$emit", [count, overrides, age]) as number, flush: () => { run("$flush", []); }, refresh: () => { invoke("$refresh", []); }, reset: () => { run("$reset", []); }, complete: () => { invoke("$complete", []); } });
    return api;
}
