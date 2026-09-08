export interface ParticleVector2 { readonly x: number; readonly y: number }
export interface ParticleVector3 { readonly x: number; readonly y: number; readonly z: number }
export interface ParticleSceneParent { readonly isObject3D: true }
export interface ParticleCamera { readonly isCamera: boolean }
/** Borrowed Three.js texture; the emitter never disposes it. */
export interface ParticleTexture { readonly isTexture: true }
export type ParticleRange = number | readonly [number, number];
export interface ParticleKeyframe { readonly time: number; readonly value: number; readonly interpolation?: "linear" | "smooth" | "hermite" | "bezier"; readonly inTangent?: number; readonly outTangent?: number; readonly inControl?: number; readonly outControl?: number }
export type ParticleCurve = readonly ParticleKeyframe[];
/** A stable, seeded blend between two curves, chosen once per particle. */
export type ParticleCurveRange = ParticleCurve | { readonly min: ParticleCurve; readonly max: ParticleCurve };
export interface ParticleVectorRange { readonly x?: ParticleRange; readonly y?: ParticleRange; readonly z?: ParticleRange }
export interface ParticleSpeedCurve { readonly range: readonly [number, number]; readonly curve: ParticleCurveRange }
export type ParticleMaterial = { readonly isShaderMaterial: true } | { readonly isMeshStandardMaterial: boolean };
export interface ParticleVectorSpeedCurve { readonly range: readonly [number, number]; readonly curves: ParticleVectorCurve }
export interface ParticleEmissionMask { readonly width: number; readonly height: number; readonly values: readonly number[]; readonly threshold?: number; readonly channel?: "probability" | "clip" }
export interface ParticleArc { readonly angle: number; readonly mode?: "random" | "loop" | "pingPong"; readonly speed?: number; readonly offset?: number }
export interface ParticleNoise { readonly strength: number; readonly frequency?: number; readonly scrollSpeed?: number; readonly octaves?: number; readonly octaveMultiplier?: number; readonly octaveScale?: number; readonly strengthAxes?: ParticleVector3; readonly remap?: ParticleCurve; readonly positionAmount?: number; readonly rotationAmount?: number; readonly sizeAmount?: number }
export interface ParticleTrigger { readonly id: string; readonly volume: ParticleCollider }
export interface ParticleUpdateContext {
    readonly particleId: number;
    readonly ageMs: number;
    readonly lifetimeMs: number;
    readonly deltaMs: number;
    /** Reused scratch values: do not retain them. Changes are committed after each fixed step. */
    readonly position: { x: number; y: number; z: number };
    readonly velocity: { x: number; y: number; z: number };
    /** Components declared by customAttributes, in declaration order. */
    readonly attributes: Float32Array;
}
export type ParticleRecordedState = null | boolean | number | string | readonly ParticleRecordedState[] | { readonly [key: string]: ParticleRecordedState };
export type ParticleSortMode = "distance" | "oldest" | "youngest" | "none";
export interface ParticleDrag {
    readonly coefficient: number | ParticleCurveRange;
    readonly multiplyBySize?: boolean;
    readonly multiplyByVelocity?: boolean;
}
export interface ParticleLights {
    readonly maxLights?: number;
    readonly ratio?: number;
    readonly intensity?: number;
    readonly range?: number;
    readonly intensityOverLife?: ParticleCurveRange;
    readonly rangeOverLife?: ParticleCurveRange;
    readonly sizeAffectsRange?: boolean;
    readonly alphaAffectsIntensity?: boolean;
}
export interface ParticleSortOptions {
    /** Global sorting is an opt-in exact, one-draw-per-particle path for normal-alpha particles. */
    readonly scope?: "emitter" | "global";
    /** Hard limit, 1–4096, default 2048; exceeding it throws without hiding ordinary draws. */
    readonly maxParticles?: number;
}
export interface ParticleVelocityLimit {
    readonly speed?: number | ParticleCurveRange;
    readonly axes?: ParticleVectorCurve;
    /** Fraction of excess velocity removed per 1/60 second; 1 clamps immediately. */
    readonly dampen?: number;
}
export interface ParticleMeshData {
    readonly positions: readonly number[];
    readonly indices?: readonly number[];
    readonly uvs?: readonly number[];
    readonly normals?: readonly number[];
}
export interface ParticleRuntimeOptions {
    /** Borrowed reference object when simulationSpace is custom. */
    readonly customSimulationSpace?: ParticleSceneParent;
    /** Paired JSON-state hooks used by recorded playback. */
    readonly captureState?: () => ParticleRecordedState;
    readonly restoreState?: (state: ParticleRecordedState) => void;
    /** Called at birth and after committed simulation steps, never for render previews. */
    readonly update?: (particle: ParticleUpdateContext) => void;
    /** Supply current mesh vertices, including skinned vertices, before an emission batch. */
    readonly meshPositions?: () => readonly number[];
    /** Borrowed ShaderMaterial, or MeshStandardMaterial adapted for scene lighting and shadows. */
    readonly material?: ParticleMaterial;
    readonly trailTexture?: ParticleTexture;
    readonly trailMaterial?: { readonly isMeshStandardMaterial: boolean };
    /** Depth from an opaque-only pass in the same camera and viewport; never the active render target. */
    readonly softParticles?: { readonly depthTexture: ParticleTexture; readonly camera: ParticleCamera; readonly width: number; readonly height: number; readonly origin?: ParticleVector2; readonly fadeDistance?: number };
    readonly onComplete?: () => void;
}
export type ParticleShape =
    | { readonly kind: "point" }
    | { readonly kind: "sphere"; readonly radius: number; readonly surface?: boolean; readonly hemisphere?: boolean }
    | { readonly kind: "box"; readonly halfExtents: ParticleVector3; readonly emitFrom?: "volume" | "surface" | "edge" }
    | { readonly kind: "cone"; readonly radius: number; readonly angle: number; readonly arc?: ParticleArc }
    | { readonly kind: "circle"; readonly radius: number; readonly arc?: ParticleArc; readonly mask?: ParticleEmissionMask }
    | { readonly kind: "ring"; readonly radius: number; readonly innerRadius?: number; readonly arc?: ParticleArc; readonly mask?: ParticleEmissionMask }
    | { readonly kind: "line"; readonly start: ParticleVector3; readonly end: ParticleVector3 }
    /** Copied triangle positions, optionally indexed. Surface area, unique edge length, or uniform vertices. */
    | { readonly kind: "mesh"; readonly positions: readonly number[]; readonly indices?: readonly number[]; readonly emitFrom?: "surface" | "edge" | "vertex"; readonly uvs?: readonly number[]; readonly mask?: ParticleEmissionMask };
export interface ParticleVectorCurve { readonly x?: ParticleCurveRange; readonly y?: ParticleCurveRange; readonly z?: ParticleCurveRange }
export type ParticleForceField =
    | { readonly kind: "attractor"; readonly position: ParticleVector3; readonly strength: number; readonly radius: number }
    | { readonly kind: "vortex"; readonly position: ParticleVector3; readonly axis: ParticleVector3; readonly strength: number; readonly radius: number };
export type ParticleCollider = { readonly id?: string } & (
    | { readonly kind: "plane"; readonly normal: ParticleVector3; readonly offset: number }
    | { readonly kind: "sphere"; readonly center: ParticleVector3; readonly radius: number }
    | { readonly kind: "box"; readonly min: ParticleVector3; readonly max: ParticleVector3 });
export interface ParticleCollisionOptions {
    readonly colliders: readonly ParticleCollider[];
    readonly bounce?: number;
    readonly friction?: number;
    readonly radius?: number;
    readonly response?: "bounce" | "kill";
    /** Fraction of original lifetime removed per contact step. */
    readonly lifetimeLoss?: number;
}
export interface ParticleTrailOptions {
    readonly castShadow?: boolean;
    readonly receiveShadow?: boolean;
    readonly mode?: "particle" | "ribbon";
    readonly ribbonCount?: number;
    /** Fixed ring-buffer samples per particle (2–64). */
    readonly segments?: number;
    readonly intervalMs?: number;
    readonly width?: number;
    readonly widthOverTrail?: ParticleCurve;
    readonly colorOverTrail?: ParticleCurve;
    readonly opacityOverTrail?: ParticleCurve;
    /** Retain a bounded pool of trails after death; oldest retained trail is replaced on overflow. */
    readonly persistMs?: number;
    readonly textureMode?: "stretch" | "tile";
    readonly tileLength?: number;
}
export type ParticleRendererOptions = {
    readonly alignment?: "view" | "facing" | "world" | "local" | "velocity";
    readonly allowRoll?: boolean;
    /** Offset in unscaled geometry coordinates, applied before rotation. */
    readonly pivot?: ParticleVector3;
    /** Per-axis probability of mirroring the geometry at birth. */
    readonly flip?: ParticleVector3;
    /** Bounds on nominal particle diameter as a fraction of viewport height. */
    readonly minScreenSize?: number;
    readonly maxScreenSize?: number;
} & (
    | { readonly kind: "billboard" }
    | { readonly kind: "horizontal" | "vertical" }
    | { readonly kind: "stretched"; readonly lengthScale?: number; readonly velocityScale?: number; readonly cameraScale?: number }
    | ({ readonly kind: "mesh" } & (ParticleMeshData | { readonly meshes: readonly (ParticleMeshData & { readonly weight?: number })[] }))
);
export interface ParticleParameters {
    /** Scales automatic emission density; 0 suppresses births. */
    readonly emissionScale?: number;
    /** Applied to future births, including manual emission. */
    readonly sizeScale?: number;
    readonly speedScale?: number;
    readonly color?: number;
}
export interface ParticleEvent {
    readonly kind: "birth" | "death" | "collision" | "enter" | "exit";
    readonly triggerId?: string;
    readonly colliderId?: string;
    readonly normal?: ParticleVector3;
    readonly color: number;
    readonly size: number;
    readonly sizeAxes: ParticleVector3;
    readonly rotation: ParticleVector3;
    readonly lifetimeMs: number;
    readonly remainingLifetimeMs: number;
    readonly particleId: number;
    readonly timeMs: number;
    /** Position and velocity in this emitter's simulation space. */
    readonly position: ParticleVector3;
    readonly velocity: ParticleVector3;
}
export interface ParticleBurst { readonly timeMs: number; readonly count: ParticleRange; readonly cycles?: number; readonly intervalMs?: number; readonly probability?: number }
export interface ParticleEmitterOptions {
    readonly capacity?: number;
    readonly seed?: number;
    /** Particles per second. The first automatic particle is born after 1/rate seconds. */
    readonly rate?: number;
    /** Multiplier over the normalized emission duration. Requires explicit durationMs. */
    readonly rateOverTime?: ParticleCurve;
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
    readonly simulationSpace?: "local" | "world" | "custom";
    readonly scalingMode?: "hierarchy" | "local" | "shape";
    readonly lifetimeMs?: ParticleRange;
    readonly speed?: ParticleRange;
    /** Replaces shape-derived velocity; rotated at birth, in units/second. */
    readonly velocity?: ParticleVector3;
    readonly inheritVelocity?: number;
    readonly inheritVelocityMode?: "initial" | "current";
    readonly inheritVelocityOverLife?: ParticleCurveRange;
    readonly orbitalVelocity?: ParticleVectorCurve;
    readonly orbitalOffset?: ParticleVector3;
    readonly radialVelocity?: ParticleCurveRange;
    readonly speedModifier?: ParticleCurveRange;
    /** Additive velocity and force curves in simulation space. */
    readonly velocityOverLife?: ParticleVectorCurve;
    readonly forceOverLife?: ParticleVectorCurve;
    readonly noise?: ParticleNoise;
    readonly forceFields?: readonly ParticleForceField[];
    readonly collision?: ParticleCollisionOptions;
    readonly triggers?: readonly ParticleTrigger[];
    readonly limitVelocity?: number | ParticleVelocityLimit;
    /** Optional numerical modules use a fixed step; excess catch-up steps are dropped. */
    readonly simulationStepMs?: number;
    readonly maxSubSteps?: number;
    readonly renderer?: ParticleRendererOptions;
    readonly sortMode?: ParticleSortMode;
    readonly renderOrder?: number;
    readonly trails?: ParticleTrailOptions;
    /** Event records are allocated only when enabled; drainEvents clears the bounded queue. */
    readonly events?: boolean;
    readonly eventCapacity?: number;
    readonly acceleration?: ParticleVector3;
    /** Linear drag in inverse seconds; integrated analytically. */
    readonly drag?: number | ParticleDrag;
    readonly lights?: ParticleLights;
    /** Interpolate observed emitter transforms at scheduled birth times. Default false preserves existing timing. */
    readonly interpolateMotion?: boolean;
    readonly size?: ParticleRange;
    readonly angle?: ParticleRange;
    readonly angularVelocity?: ParticleRange;
    readonly sizeAxes?: ParticleVectorRange;
    readonly rotation3D?: ParticleVectorRange;
    readonly angularVelocity3D?: ParticleVectorRange;
    readonly angularVelocityOverLife?: ParticleCurveRange;
    readonly sizeAxesOverLife?: ParticleVectorCurve;
    readonly angularVelocityAxesOverLife?: ParticleVectorCurve;
    readonly sizeAxesBySpeed?: ParticleVectorSpeedCurve;
    readonly angularVelocityAxesBySpeed?: ParticleVectorSpeedCurve;
    readonly sizeBySpeed?: ParticleSpeedCurve;
    readonly colorBySpeed?: ParticleSpeedCurve;
    readonly rotationBySpeed?: ParticleSpeedCurve;
    readonly color?: number;
    readonly startColors?: readonly number[];
    /** Size and opacity curves are multipliers; color values are sRGB hex colors. */
    readonly sizeOverLife?: ParticleCurveRange;
    readonly opacityOverLife?: ParticleCurveRange;
    readonly colorOverLife?: ParticleCurveRange;
    readonly blending?: "normal" | "additive";
    readonly depthTest?: boolean;
    readonly castShadow?: boolean;
    readonly receiveShadow?: boolean;
    readonly texture?: ParticleTexture;
    readonly lighting?: { readonly ambient?: number; readonly intensity?: number; readonly direction?: ParticleVector3; readonly color?: number };
    readonly customAttributes?: readonly { readonly name: string; readonly size: 1 | 2 | 3 | 4; readonly value?: readonly number[] }[];
    /** Functions and borrowed GPU resources are supplied separately from serializable effect definitions. */
    readonly runtime?: ParticleRuntimeOptions;
    /** Opt-in bounded history for manual emissions, settings and parent motion. */
    readonly recording?: { readonly maxCommands?: number; readonly maxBytes?: number };
    /** Sprite sheet cells run left-to-right, bottom-to-top over each particle's life. */
    readonly spriteSheet?: { readonly columns: number; readonly rows: number; readonly cycles?: number; readonly startFrame?: ParticleRange; readonly fps?: number; readonly row?: number | "random"; readonly blend?: boolean; readonly frameOverLife?: ParticleCurveRange; readonly frameBySpeed?: ParticleSpeedCurve };
}
export interface ParticleEmission {
    readonly sizeAxes?: ParticleVector3;
    readonly position?: ParticleVector3;
    readonly lifetimeMs?: ParticleRange;
    readonly speed?: ParticleRange;
    readonly velocity?: ParticleVector3;
    readonly size?: ParticleRange;
    readonly color?: number;
    readonly seed?: number;
    readonly rotation3D?: ParticleVector3;
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
    readonly skippedBurstCount: number;
    readonly recordedUntilMs?: number;
    readonly recordingFull?: boolean;
    readonly expiredParticleCount: number;
    readonly completed: boolean;
    readonly activeTrailCount: number;
    readonly activeLightCount: number;
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
    /** Default: automatic emission with current inputs. Recorded mode restores a bounded input journal when recording is enabled. */
    seek(timeMs: number, mode?: "automatic" | "recorded"): void;
    setForceFields(fields: readonly ParticleForceField[]): void;
    setCollision(collision: ParticleCollisionOptions): void;
    setTriggers(triggers: readonly ParticleTrigger[]): void;
    setRenderOrder(order: number): void;
    setDepthSource(texture: ParticleTexture, width: number, height: number, origin?: ParticleVector2): void;
    setMeshPositions(positions: readonly number[]): void;
    drainEvents(): readonly ParticleEvent[];
    /** Refresh conservative world-space bounds and hide draws outside the camera frustum. */
    cull(camera: ParticleCamera): boolean;
    /** Optional back-to-front alpha sorting. Call after present/camera movement and before rendering. */
    sort(camera: ParticleCamera, mode?: ParticleSortMode, options?: ParticleSortOptions): void;
    /** Removes live particles without rewinding the clock, schedule, or random sequence. */
    clear(): void;
    /** Clears particles and restarts automatic emission and the seed sequence at the last presentation time. */
    restart(): void;
    inspect(): ParticleInspection;
    dispose(): void;
}
