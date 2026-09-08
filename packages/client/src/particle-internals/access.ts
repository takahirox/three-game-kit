import type { createSpace } from "./space.js";
import type { ParticleEmission, ParticleEmitter } from "./types.js";

/** Internal batching hooks; never exposed through the public emitter handle. */
/** @internal */
export const emitterAccess = new WeakMap<ParticleEmitter, {
    space(): ReturnType<typeof createSpace>;
    emit(count: number, overrides: ParticleEmission, ageMs: number): number;
    flush(): void;
    refresh(): void;
    reset(): void;
    complete(): void;
}>();
