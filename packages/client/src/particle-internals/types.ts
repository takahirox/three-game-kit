export interface ParticleVector3 { readonly x: number; readonly y: number; readonly z: number }
export interface ParticleSceneParent { readonly isObject3D: true }
export interface ParticleCamera { readonly isCamera: boolean }
/** Borrowed Three.js texture; the emitter never disposes it. */
export interface ParticleTexture { readonly isTexture: true }
export type ParticleRange = number | readonly [number, number];
export interface ParticleKeyframe { readonly time: number; readonly value: number }
export type ParticleCurve = readonly ParticleKeyframe[];
export type ParticleShape =
    | { readonly kind: "point" }
    | { readonly kind: "sphere"; readonly radius: number; readonly surface?: boolean }
    | { readonly kind: "box"; readonly halfExtents: ParticleVector3 }
    | { readonly kind: "cone"; readonly radius: number; readonly angle: number }
    | { readonly kind: "circle"; readonly radius: number }
    | { readonly kind: "ring"; readonly radius: number; readonly innerRadius?: number }
    | { readonly kind: "line"; readonly start: ParticleVector3; readonly end: ParticleVector3 }
    /** Copied triangle positions, optionally indexed. Samples uniformly by surface area. */
    | { readonly kind: "mesh"; readonly positions: readonly number[]; readonly indices?: readonly number[] };
export interface ParticleVectorCurve { readonly x?: ParticleCurve; readonly y?: ParticleCurve; readonly z?: ParticleCurve }
export type ParticleForceField =
    | { readonly kind: "attractor"; readonly position: ParticleVector3; readonly strength: number; readonly radius: number }
    | { readonly kind: "vortex"; readonly position: ParticleVector3; readonly axis: ParticleVector3; readonly strength: number; readonly radius: number };
export type ParticleCollider =
    | { readonly kind: "plane"; readonly normal: ParticleVector3; readonly offset: number }
    | { readonly kind: "sphere"; readonly center: ParticleVector3; readonly radius: number }
    | { readonly kind: "box"; readonly min: ParticleVector3; readonly max: ParticleVector3 };
export interface ParticleCollisionOptions {
    readonly colliders: readonly ParticleCollider[];
    readonly bounce?: number;
    readonly friction?: number;
    readonly radius?: number;
    readonly response?: "bounce" | "kill";
}
export interface ParticleTrailOptions {
    /** Fixed ring-buffer samples per particle (2–64). Trails end with their particle. */
    readonly segments?: number;
    readonly intervalMs?: number;
    readonly width?: number;
}
export type ParticleRendererOptions =
    | { readonly kind: "billboard" }
    | { readonly kind: "stretched"; readonly lengthScale?: number; readonly velocityScale?: number }
    | { readonly kind: "mesh"; readonly positions: readonly number[]; readonly indices?: readonly number[] };
export interface ParticleParameters {
    /** Scales automatic emission density; 0 suppresses births. */
    readonly emissionScale?: number;
    /** Applied to future births, including manual emission. */
    readonly sizeScale?: number;
    readonly speedScale?: number;
    readonly color?: number;
}
export interface ParticleEvent {
    readonly kind: "birth" | "death" | "collision";
    readonly particleId: number;
    readonly timeMs: number;
    /** Position and velocity in this emitter's simulation space. */
    readonly position: ParticleVector3;
    readonly velocity: ParticleVector3;
}
export interface ParticleBurst { readonly timeMs: number; readonly count: number }
export interface ParticleEmitterOptions {
    readonly capacity?: number;
    readonly seed?: number;
    /** Particles per second. The first automatic particle is born after 1/rate seconds. */
    readonly rate?: number;
    /** Automatic emission stops at this elapsed time; existing particles finish normally. */
    readonly durationMs?: number;
    readonly loop?: boolean;
    readonly startDelayMs?: number;
    readonly prewarmMs?: number;
    readonly timeScale?: number;
    readonly rateOverDistance?: number;
    readonly bursts?: readonly ParticleBurst[];
    readonly position?: ParticleVector3;
    /** Rotation in radians, XYZ Euler order. Applies to shape and initial velocity. */
    readonly rotation?: ParticleVector3;
    readonly shape?: ParticleShape;
    readonly simulationSpace?: "local" | "world";
    readonly lifetimeMs?: ParticleRange;
    readonly speed?: ParticleRange;
    /** Replaces shape-derived velocity; rotated at birth, in units/second. */
    readonly velocity?: ParticleVector3;
    readonly inheritVelocity?: number;
    /** Additive velocity and force curves in simulation space. */
    readonly velocityOverLife?: ParticleVectorCurve;
    readonly forceOverLife?: ParticleVectorCurve;
    readonly noise?: { readonly strength: number; readonly frequency?: number; readonly scrollSpeed?: number };
    readonly forceFields?: readonly ParticleForceField[];
    readonly collision?: ParticleCollisionOptions;
    /** Optional numerical modules use a fixed step; excess catch-up steps are dropped. */
    readonly simulationStepMs?: number;
    readonly maxSubSteps?: number;
    readonly renderer?: ParticleRendererOptions;
    readonly trails?: ParticleTrailOptions;
    /** Event records are allocated only when enabled; drainEvents clears the bounded queue. */
    readonly events?: boolean;
    readonly eventCapacity?: number;
    readonly acceleration?: ParticleVector3;
    /** Linear drag in inverse seconds; integrated analytically. */
    readonly drag?: number;
    readonly size?: ParticleRange;
    readonly angle?: ParticleRange;
    readonly angularVelocity?: ParticleRange;
    readonly color?: number;
    /** Size and opacity curves are multipliers; color values are sRGB hex colors. */
    readonly sizeOverLife?: ParticleCurve;
    readonly opacityOverLife?: ParticleCurve;
    readonly colorOverLife?: ParticleCurve;
    readonly blending?: "normal" | "additive";
    readonly depthTest?: boolean;
    readonly texture?: ParticleTexture;
    /** Sprite sheet cells run left-to-right, bottom-to-top over each particle's life. */
    readonly spriteSheet?: { readonly columns: number; readonly rows: number; readonly cycles?: number };
}
export interface ParticleEmission {
    readonly position?: ParticleVector3;
    readonly lifetimeMs?: ParticleRange;
    readonly speed?: ParticleRange;
    readonly velocity?: ParticleVector3;
    readonly size?: ParticleRange;
    readonly color?: number;
    readonly seed?: number;
}
export interface ParticleInspection {
    readonly disposed: boolean;
    readonly emitting: boolean;
    readonly presentationTimeMs: number | null;
    readonly activeParticleCount: number;
    readonly capacity: number;
    readonly paused: boolean;
    readonly timeScale: number;
    readonly elapsedMs: number;
    readonly culled: boolean;
    readonly droppedSimulationMs: number;
    readonly droppedEventCount: number;
    readonly emittedParticleCount: number;
    readonly droppedParticleCount: number;
    readonly expiredParticleCount: number;
    readonly liveResourceCounts: { readonly objects: number; readonly geometries: number; readonly materials: number };
}
export interface ParticleEmitter {
    /** Absolute monotonic milliseconds. First call establishes automatic emission time zero. */
    present(timestampMs: number): void;
    /** Immediately emits at the last presentation time (or time zero before the first present). Returns accepted count. */
    emit(count: number, overrides?: ParticleEmission): number;
    /** Affects future particles; local particles also follow the borrowed parent transform. */
    setTransform(position: ParticleVector3, rotation?: ParticleVector3): void;
    /** Stopped automatic emissions are skipped; live particles continue to age. */
    setEmitting(emitting: boolean): void;
    pause(): void;
    play(): void;
    setTimeScale(scale: number): void;
    setParameters(parameters: ParticleParameters): void;
    /** Advances simulation without changing the accepted presentation timestamp. */
    prewarm(durationMs: number): void;
    drainEvents(): readonly ParticleEvent[];
    /** Refresh conservative world-space bounds and hide draws outside the camera frustum. */
    cull(camera: ParticleCamera): boolean;
    /** Optional back-to-front alpha sorting. Call after present/camera movement and before rendering. */
    sort(camera: ParticleCamera): void;
    /** Removes live particles without rewinding the clock, schedule, or random sequence. */
    clear(): void;
    /** Clears particles and restarts automatic emission and the seed sequence at the last presentation time. */
    restart(): void;
    inspect(): ParticleInspection;
    dispose(): void;
}
