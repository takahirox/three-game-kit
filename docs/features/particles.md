# Particle systems

`@three-game-kit/client/particles` provides seeded emitters, serializable effect
compositions, bounded sub-emitter graphs, and a system that owns effects. It uses
Three.js without adding dependencies. Existing emitter and VFX calls remain valid.

## A single emitter

```ts
import { createParticleEmitter, createParticleFeature } from "@three-game-kit/client/particles";

const sparks = createParticleEmitter(scene, {
  capacity: 2048, seed: 42, rate: 200,
  durationMs: 2000, loop: true, prewarmMs: 500,
  shape: { kind: "cone", radius: 0.1, angle: Math.PI / 6 },
  position: { x: 0, y: 1, z: 0 }, simulationSpace: "world",
  speed: [2, 6], lifetimeMs: [500, 1200], size: [0.03, 0.09],
  acceleration: { x: 0, y: -9.8, z: 0 }, blending: "additive",
  renderer: { kind: "stretched", velocityScale: 0.08 },
  collision: {
    colliders: [{ kind: "plane", normal: { x: 0, y: 1, z: 0 }, offset: 0 }],
    bounce: 0.5, friction: 0.2,
  },
});

sparks.present(timestampMs); // Application-owned presentation, before rendering.
sparks.emit(40, { position: { x: 2, y: 1, z: 0 }, seed: 7 });
sparks.pause();              // Freeze age and automatic emission.
sparks.play();
sparks.setTimeScale(0.5);
sparks.setParameters({ emissionScale: 0.5, sizeScale: 1.5, color: 0xffaa33 });
sparks.setEmitting(false);   // Stop automatic births; live particles keep aging.
sparks.restart();           // Clear, reset schedule/seed, resume and repeat configured prewarm.
sparks.dispose();

// Alternatively transfer ownership to the Client Runtime:
// const feature = createParticleFeature({ emitters: [sparks] });
// Do not manually present or dispose handles after transferring ownership.
```

`createParticleFeature` accepts emitters, effects, or systems with `present` and
`dispose`. It presents at render priority `-100`, and owns disposal. Standalone
handles must be presented and disposed by the application.

## Authoring modules

| Property | Behavior |
| --- | --- |
| `rate`, `rateOverTime`, `bursts`, `durationMs` | Births/second with a duration curve; repeated, probabilistic bursts with count ranges |
| `loop`, `startDelayMs`, `prewarmMs` | Repeat the schedule without killing live particles, delay the first cycle, advance initial simulation |
| `rateOverDistance` | Additional births per unit moved, interpolated along observed emitter positions |
| `shape` | Point, sphere volume/surface, box volume, cone, circle disk, ring/annulus, line, or mesh surface |
| `position`, `rotation` | Birth origin and XYZ Euler rotation; `setTransform` changes future births |
| `simulationSpace` | `local` follows parent transforms; `world` captures transformed birth positions/velocities |
| `lifetimeMs`, `speed`, `size`, `angle`, `angularVelocity` | Constants or uniformly sampled `[min, max]` ranges; angles are radians |
| `velocity` | Explicit initial vector replacing shape direction/speed, then rotated/transformed at birth |
| `inheritVelocity` | 0–1 fraction of the emitter's observed velocity added at birth |
| `acceleration`, `drag` | Constant acceleration and linear resistance, with an analytic fast path |
| `velocityOverLife`, `forceOverLife` | Independent optional `x`, `y`, `z` scalar curves, additive in simulation space |
| `noise` | Seeded smooth spatial/temporal turbulence: `strength`, `frequency`, `scrollSpeed` |
| `forceFields` | Attractors (negative strength repels) and axis-aligned vortices, with linear radial falloff |
| `sizeOverLife`, `opacityOverLife`, `colorOverLife` | Size/opacity multipliers and color tint over normalized age |
| `texture`, `spriteSheet` | Borrowed texture; columns/rows, cycles or FPS, random start frame/row, frame blending |
| `renderer` | Camera-facing, horizontal, vertical or velocity-stretched billboard; triangle mesh with velocity alignment or independent 3D rotation |
| `trails` | Per-particle ring-buffer histories rendered as connected, camera-facing ribbon segments |
| `collision` | Swept plane, sphere and axis-aligned box collisions; bounce/friction or kill response |
| `events`, `eventCapacity` | Optional bounded birth/death/collision snapshot queue, consumed with `drainEvents()` |
| `sizeAxes`, `rotation3D`, `angularVelocity3D` | Independent per-axis birth ranges and angular rates |
| `angularVelocityOverLife` | Multiplier integrated over age for 2D/3D angular velocity |
| `sizeBySpeed`, `colorBySpeed`, `rotationBySpeed`, `limitVelocity` | Speed-range appearance curves and an absolute velocity cap |
| `startColors` | Seeded choice from a palette of 1–256 initial sRGB colors |
| `triggers` | Named plane/sphere/box volumes with enter/exit records |
| `lighting`, `runtime.softParticles` | Ambient/directional Lambert lighting and scene-depth intersection fades |
| `customAttributes`, `runtime.update` | Bounded custom instance data and fixed-step update callback |
| `blending`, `depthTest` | Normal/additive blending; depth writes disabled |

Curves require 2–16 strictly increasing keys covering 0 to 1. Each key can set
`interpolation: "smooth"` for a smoothstep transition to the next key; the default
is linear. Lifetime and speed curves also accept `{ min: curveA, max: curveB }`.
Each particle chooses one seeded blend factor and retains it through sorting,
reuse and replay. All distributions on a particle share that factor. Color values are
unsigned sRGB hex, interpolated in Three.js linear working space and multiplied
by each particle's initial tint. Vector curves omit axes to leave them unchanged.
Velocity curves add their initial value at birth and their change as acceleration
throughout life; drag and collision can modify the resulting velocity.

Circle and ring shapes lie in XZ and emit toward +Y; a ring defaults to its outer
circumference, or samples annular area when `innerRadius` is provided. Lines sample
between `start` and `end`. Mesh shapes accept copied, optionally indexed triangle
`positions`, sample triangles proportional to area, and emit along face normals.
Mesh renderers accept the same triangle format, orient their +Y axis toward
velocity, and spin about that axis. Specifying 3D rotation/size axes selects independent
XYZ rotation instead of velocity alignment. `sizeAxes` multiplies scalar size;
`angularVelocity3D` is radians/second. Optional mesh textures use planar XY UVs.

Planes define their permitted half-space by `dot(normal, position) >= offset`.
Sphere/box interiors are solid. Collision `radius` expands colliders around the
particle center; it is independent of rendered size. Collider coordinates,
noise, acceleration and force fields are all in **simulation space**, not birth
orientation space. Sweeps use the straight segment of each numerical step, with
at most four contact resolutions. This is visual particle collision, not a rigid
body solver or a replacement for game-authoritative physics.

Trails use `segments` (2–64), `intervalMs`, and `width`. `widthOverTrail`,
`colorOverTrail`, and `opacityOverTrail` run from head (0) to tail (1), interpolated
at segment endpoints. `runtime.trailTexture` supplies a borrowed texture;
`textureMode: "stretch"` covers the length once, while `"tile"` uses `tileLength`
in simulation units (set repeat wrapping on the texture). `persistMs` retains
trails after death and fades them out. The retained pool is bounded by emitter
capacity; overflow replaces the oldest retained trail. Without `persistMs`,
trails end with their owner. `clear`/`restart` remove retained trails too.
Numerical particles sample their committed fixed steps. Analytic particles sample
presentations, so their trail detail depends on presentation frequency. Sorting
changes rendered instance order without changing histories or simulation state.

## Emission and speed variation

```ts
const emitter = createParticleEmitter(scene, {
  rate: 100, durationMs: 2000, loop: true,
  rateOverTime: [
    { time: 0, value: 0.25, interpolation: "smooth" },
    { time: 0.5, value: 1.5, interpolation: "smooth" },
    { time: 1, value: 0.25 },
  ],
  bursts: [{ timeMs: 100, count: [8, 16], cycles: 3, intervalMs: 300, probability: 0.8 }],
  limitVelocity: 8,
  sizeBySpeed: { range: [0, 8], curve: [{ time: 0, value: 0.5 }, { time: 1, value: 2 }] },
  spriteSheet: { columns: 4, rows: 4, fps: 12, startFrame: [0, 15], row: "random", blend: true },
});
```

`rateOverTime` multiplies `rate` over the explicit positive duration; birth times
come from integrating the curve. Burst repetitions beyond the duration are
clipped. `cycles` is 1–65,536 and requires positive `intervalMs` when greater than
1; counts are inclusive integer ranges, and probability is 0–1. Random bursts
use a seeded 256-occurrence table, repeating within each burst stream. This
allows exact arithmetic skipping without an unbounded loop during long hitches.

Speed curves clamp to their `[min, max]` speed range. Size/color multiply the
particle's current appearance; rotation adds a radian offset. Velocity limits
apply at birth and each numerical step. Sprite FPS overrides lifetime-based
`cycles`; `row` restricts animation/wrapping to that row and may be `"random"`.
`startFrame` can be fractional; `blend` interpolates adjacent atlas samples.

## Runtime scene inputs, callbacks and seeking

Call `setForceFields(fields)` and `setCollision(collision)` to replace validated
snapshots atomically. Live positions/velocities are preserved at the boundary;
subsequent steps use the new scene data. `setMeshPositions(vertices)` rebuilds a
mesh shape's area distribution for future births. Alternatively,
`runtime.meshPositions()` supplies a snapshot before an emission batch. For a
Three.js `SkinnedMesh`, update its animation/world matrices, then gather
`mesh.getVertexPosition(index, scratch)` results in mesh-local coordinates and
return those values. Supply the original indices in the shape definition.

`triggers: [{ id: "water", volume: sphereOrBoxOrPlane }]` records `enter`/`exit`
with `triggerId` when membership changes at birth or a committed fixed-step
boundary. Plane interiors satisfy `dot(normal, position) <= offset`. At most 32
unique volumes are allowed. Enable `events` to drain records; linked effects
enable it automatically. Thin volumes crossed entirely between samples can be
missed; use smaller simulation steps when required.

```ts
const emitter = createParticleEmitter(scene, {
  customAttributes: [{ name: "customHeat", size: 1, value: [0] }],
  runtime: {
    update(p) {
      p.attributes[0] = p.ageMs / p.lifetimeMs;
      // p.position and p.velocity can also be changed here.
    },
    onComplete() { /* schedule cleanup or the next effect */ },
  },
});
emitter.seek(1500);
```

The update callback runs at birth (`deltaMs: 0`) and after committed numerical
steps. Fractional render previews do not invoke it. Its vectors and flattened
attribute array are reused scratch values; do not retain them. Names must begin
with `custom` followed by an uppercase letter and be unique. Attributes contain
1–4 components and the complete renderer must fit the portable 16-attribute GPU
limit. Outputs must be finite. Callbacks cannot reenter the emitter; callback
errors propagate. Deterministic callbacks should derive state from the supplied
particle context instead of external frame counts.

Emitter `runtime.onComplete` and effect/system `onComplete` notify once when
scheduled emission has ended/stopped and all particles and retained trails finish.
A new birth or restart rearms completion. Inspection exposes `completed` and
`activeTrailCount` (the latter per emitter). An effect's notification waits for
all downstream sub-emitters. The system option applies to each created effect.

`seek(ms)` clears and replays automatic emission from zero in 1/60-second steps
(up to 1,000,000 ms), preserving the accepted absolute presentation timestamp and
pause state. Effect seeking also replays its complete sub-emitter graph. It uses
current settings, transforms and runtime providers; it cannot reconstruct past
manual emissions, moving scene inputs or distance-emission paths. Configured
prewarm is not added to the seek target. Counters remain cumulative. Direct
emitter seeking discards replayed events; effect seeking consumes them for routing.

Definitions remain plain JSON. Supply functions/resources through
`createParticleEffect(parent, definition, { runtime: { emitterId: runtimeOptions },
onComplete })`, or the same options on `createParticleSystem`. Effects expose
named `setForceFields`, `setCollision`, `setMeshPositions`, and `setDepthSource`.

## Lighting, soft intersections and borrowed shaders

`lighting: { ambient, intensity, direction, color }` enables ambient plus one
world-space directional Lambert light. Mesh normals follow per-axis scale and
3D rotation; billboard normals follow their rendering orientation. This is an
explicit particle light, independent of Three.js scene light enumeration, shadows,
PBR materials and environment maps.

For soft particles, render opaque geometry into a render target with a depth
texture first, using the same camera/projection. Pass
`runtime.softParticles: { depthTexture, camera, width, height, origin?, fadeDistance }`.
Width, height and origin describe the output viewport in physical pixels; origin
defaults to (0, 0). Perspective and orthographic cameras are supported. Read from
a completed opaque pass, never the active render target. Refresh the texture or
viewport after resize with `setDepthSource(texture, width, height, origin?)`.
The emitter updates near/far uniforms from the borrowed camera during presentation.
The atlas fire demo shows a complete depth pass and viewport/scissor integration.

`runtime.material` borrows a `THREE.ShaderMaterial` for arbitrary shader behavior.
It owns its shader, uniforms, transparency, texture and lighting semantics; built-in
material options apply only when no material is supplied. The shared contract is:

| Shader attribute | Components |
| --- | --- |
| `position`, `normal`, `uv` | Base geometry data |
| `particleCenter` | Position in configured simulation space |
| `particleAppearance` | Linear RGB + opacity |
| `particleDimensions` | Scalar size, radian angle, atlas frame |
| `particleVelocity` | Velocity, present for stretched/mesh modes |
| `particleScale`, `particleRotation` | Optional per-axis scale and XYZ radians |
| `particleAtlas` | Next frame, blend fraction, reserved 0 (when blending enabled) |
| `custom…` | Declared custom components, in definition order |

The shader must apply instance centers/dimensions itself. `modelViewMatrix` works
for local-space centers; world-space centers use `viewMatrix`. Custom materials
remain caller-owned and are excluded from automatic batching. Soft fades or
lighting in a custom shader must be implemented by that shader.

## Reusable effects and sub-emitters

```ts
import { defineParticleEffect, createParticleSystem } from "@three-game-kit/client/particles";

const fireworks = defineParticleEffect({
  emitters: [
    { id: "rocket", options: {
      capacity: 16, durationMs: 1500, loop: true,
      bursts: [{ timeMs: 0, count: 1 }],
      velocity: { x: 0, y: 3, z: 0 }, lifetimeMs: 700,
      blending: "additive", trails: { width: 0.03 },
    } },
    { id: "bloom", options: {
      capacity: 1024, speed: [1, 3], lifetimeMs: 1200,
      acceleration: { x: 0, y: -1, z: 0 },
      blending: "additive", color: 0xffaa66,
    } },
  ],
  subEmitters: [{ source: "rocket", target: "bloom", event: "death", count: 80 }],
});

const particles = createParticleSystem(scene, {
  maxParticles: 8192, camera, cull: true,
  lod: [{ distance: 30, emissionScale: 0.5 }, { distance: 80, emissionScale: 0 }],
});
const effect = particles.createEffect(fireworks);
effect.setTransform({ x: 2, y: 0, z: 0 });
effect.emit("rocket", 1);
particles.present(timestampMs);
// effect.dispose() returns its reserved capacity; particles.dispose() releases all effects.
```

`defineParticleEffect` validates the composition and makes a deep frozen JSON
copy. Emitter options are validated during `createParticleEffect` (or the system's
`createEffect`), with rollback if any emitter fails. Definitions contain no Three.js
objects or functions. Texture values in definitions are string IDs, resolved from
`{ textures: { smoke: borrowedTexture } }` when instantiated. Definitions can be
saved with `JSON.stringify` and reused after `JSON.parse`.

Effects provide named manual `emit`, group `setTransform`, `pause`, `play`,
`setEmitting`, `setTimeScale`, `prewarm`, `clear`, `restart`, and `setParameters`.
`sort(camera)` sorts each emitter for alpha rendering; call `cull(camera)` afterward
when both are used.
`emissionScale` is 0–1 automatic density, while `sizeScale`, `speedScale` (0–100)
and `color` affect future births, including manual emissions. Existing particles
retain their sampled appearance and velocity. A system's distance LOD owns the
emission density of its effects when LOD bands are configured.

Sub-emitter graphs must be acyclic (up to 64 emitters and 64 links). Links can
trigger on birth, death, collision, enter, or exit, optionally replacing the target's initial
velocity with a fraction of the source's velocity. Positions and inherited
velocities are converted through the effect's transform. Each presentation first
advances the clocks, then processes the graph in topological order. Child births
are backdated by the source event's age, including further child death events in
the same frame. Use a shared playback scale and prewarm across linked emitters
for aligned timelines. Link processing is capped at the target emitter's capacity
per presentation; `droppedSubEmitterCount` reports suppressed requests. Source
event queues can also overflow before routing. Events are snapshots, so application
event consumers cannot reenter the update that created them. Effects consume their emitters' event queues.

## Time, bounds, and determinism

Presentation accepts finite non-negative monotonic absolute timestamps up to
`Number.MAX_SAFE_INTEGER`. The first establishes time zero. Rate births begin
after one rate interval; bursts at zero run on the first presentation. Duration
endpoints are included, and a new cycle's zero-time burst can share that endpoint.
Looping requires explicit `durationMs >= 1`; start delay applies only once.

`pause` freezes simulation while accepting timestamps, preventing catch-up on
resume. Continue presenting while paused. `timeScale` is 0–100. `prewarm(ms)`
advances simulation without changing the accepted timestamp (even while paused)
and obeys the same bounded catch-up policy. `clear` removes live particles without
rewinding time, seeds or counters. `restart` resets schedule/random sequence and
resumes playback while preserving accepted absolute time and lifetime counters.

Manual `emit` is immediate at the last presented age (zero before presentation),
returns the accepted count, and works while paused or emission is stopped. Its
`position`, `velocity`, `lifetimeMs`, `speed`, `size`, `color`, and `seed` overrides
are validated and copied. Explicit seed overrides reproduce sampled bursts.

Basic motion uses the closed-form solution of `dv/dt = acceleration - drag * velocity`.
No wall clock or `Math.random` is read. Corresponding births produce identical
motion across frame partitions if capacity/catch-up budgets are not exceeded.
Optional numerical modules use birth-relative fixed steps (`simulationStepMs`,
default 1000/60, range 1–100 ms) and a noncommitted fractional preview. Thus varying
frame partitions do not alter committed simulation. Collision events are emitted
for committed steps (at step-end time, with the first contact position), or the
final partial step at natural death. Each particle performs at most `maxSubSteps`
(default 120, range 1–1024) per advance. Excess old steps are skipped without motion
or collision events; `droppedSimulationMs` sums skipped particle-milliseconds.

Automatic scheduling processes at most `capacity` raw birth attempts per advance,
then skips remaining streams arithmetically. Births known to be dead are skipped.
Distance emission has its own capacity-sized budget. Lower density does not enlarge
these processing budgets. Full pools drop incoming particles and retain survivors.
Overload results can depend on frame partitioning; bounded cost is preferred to
unlimited replay. Counters distinguish accepted, dropped and expired particles.
Skipped events and simulation time have separate counters. Counts saturate at the
maximum safe integer.

Distance emission interpolates observed emitter origins in simulation space.
It cannot reconstruct curved paths or parent rotation between observations.
Automatic time births still use the transform observed at processing time.
Velocity inheritance measures origin displacement per simulated second; manual
births use the latest measured velocity. Paused movement is discarded on resume.
Local particles follow the parent; world particles remain at their captured world
positions. Use uniform parent scaling for billboard and trail width semantics.

All authoring vectors/scalars are validated; most are bounded to magnitude
1,000,000. Lifetime is 0.001–1,000,000 ms and capacity is 1–65,536 per emitter.
Meshes accept up to 65,536 vertices/triangles, force fields up to 16, and colliders
up to 32. Trail `capacity * segments * (persistMs > 0 ? 2 : 1)` may not exceed 1,048,576. Event queues hold
1–65,536 records and drop new events when full. Texture dimensions are 1–256 cells.
Configuration data is copied; textures, cameras and parent objects stay borrowed.

## Rendering, performance and ownership

Simulation uses fixed typed arrays and a dense active prefix with constant-time
swap removal. Basic particles update three dynamic instance attributes; mesh and
stretched particles add velocity. Resources are reused across births, expiry,
clear and restart. No per-particle objects are allocated during motion or rendering;
enabled event recording intentionally allocates bounded immutable snapshots.

Each emitter uses one instanced draw; trails add a second. Optional `sort(camera)`
provides back-to-front sorting within a standalone emitter with reusable scratch
storage. Different alpha emitters are not globally sorted. Effect batching is on
by default and merges **compatible additive emitters under the same effect**,
including compatible trails. It reuses aggregate buffers and checks geometry,
shader, texture, atlas, stretch, blend and depth settings. Borrowed custom materials
and soft-particle emitters retain individual draws. It does not merge across
separate effects or normal-alpha layers. Set `batch: false` to avoid buffer-copy
cost when reducing draws is not beneficial. `drawSavings` reports the static
reduction available when all compatible source emitters are visible.

`cull(camera)` computes conservative bounds from live centers, rendered size,
velocity stretching, and trail history. It suppresses offscreen draws without
stopping simulation or events. Call after presentation/camera movement. Static
Three.js geometry culling is disabled because particle positions live in instance
attributes. Systems can call culling automatically and apply distance-band emission
LOD. A band's `updateIntervalMs` (0–1000) also throttles simulation/presentation;
the next update catches up under the normal substep budget. The default is 0.
`offscreenSimulation: "pause"` explicitly freezes offscreen effects, including
their events, and resumes without a catch-up jump; it requires camera+culling.
Empty effects can still emit so they do not become permanently dormant. The
default `"continue"` preserves simulation and event processing while culled.

System `maxParticles` is a hard **reserved capacity** budget across all owned
effects, including child emitters. It rejects over-budget creation before retaining
resources; it does not evict running effects. Disposal releases reservations.
This provides predictable memory/particle bounds rather than a first-come-per-frame
allocation policy. GPU simulation, arbitrary mesh collision, cross-effect/alpha
batching and a visual node editor remain outside this implementation.

Disposal is idempotent, detaches owned scene objects and releases geometry/material
resources. Borrowed textures, shader materials, cameras and parents are not disposed. Mutation after
disposal throws; inspection remains available. Drop disposed handles to release CPU
storage. System and effect ownership can be transferred to the optional Feature.

## Design decision and verification

The public engine remains a Client subpath with internal modules for shapes,
scheduling, motion, rendering, effects and batching. A new workspace package would
add packaging complexity without an independent dependency/runtime boundary.
`vfx` continues to delegate bursts to this engine; its existing trail and popup
commands retain their semantics. Native particle trails are a separate capability.

The [particle atlas](../../examples/particles/README.md) contains 26 effects in one
gallery. Its six **NEW** effects demonstrate native
curved emission, soft intersections, dynamic forces/colliders, persistent ribbons,
lit 3D shards, probabilistic cascades, deforming surface emission and batching with the same cards, focus view and playback
controls as the original 20 effects. The **New** filter selects these six.

`pnpm verify` covers deterministic sampling, playback, shapes, motion, collision,
events, transforms, sorting, trails, budgets, graph validation and resource ownership.
`pnpm verify:particles` adds real Chromium shader compilation and visible output
for the 20 atlas presets and six module experiments, control interactions, mobile
navigation and GPU resource stability/disposal. CI runs both and retains screenshots.
