# Particle emitters

`@three-game-kit/client/particles` provides reusable, seeded particle emitters
and an optional client Feature. It uses the existing Three.js dependency and
has no simulation, networking, physics, or game-specific dependencies.

## Usage

```ts
import { createParticleEmitter, createParticleFeature } from "@three-game-kit/client/particles";

const sparks = createParticleEmitter(scene, {
  capacity: 2048,
  seed: 42,
  rate: 200,
  bursts: [{ timeMs: 0, count: 80 }],
  shape: { kind: "cone", radius: 0.1, angle: Math.PI / 6 },
  position: { x: 0, y: 1, z: 0 },
  simulationSpace: "world",
  speed: [2, 6],
  lifetimeMs: [500, 1200],
  acceleration: { x: 0, y: -9.8, z: 0 },
  size: [0.03, 0.09],
  blending: "additive",
  colorOverLife: [
    { time: 0, value: 0xffffff },
    { time: 0.3, value: 0xffaa33 },
    { time: 1, value: 0xff2200 },
  ],
});

// Transfer ownership to the client runtime's presentation schedule:
const feature = createParticleFeature({ emitters: [sparks] });
// Pass feature in createClientRuntime({ features: [..., feature] }).

// Application-driven bursts may override initial particle properties.
sparks.emit(40, { position: { x: 2, y: 1, z: 0 }, seed: 7 });
sparks.setEmitting(false); // Stop future automatic births; live particles finish.
sparks.restart();         // Clear particles and restart the schedule/seed sequence.
```

Without the Feature, call `emitter.present(timestampMs)` before rendering and
`emitter.dispose()` on shutdown. For normal alpha blending, optionally call
`emitter.sort(camera)` after presentation and camera movement, before rendering.
Sorting is per emitter, back-to-front, and does not change simulation or seeds.
A Feature presents its fixed set of emitters in `render` at priority `-100` and
owns their disposal. Do not also manually advance emitters owned by that Feature.

## Authoring

| Property | Behavior |
| --- | --- |
| `rate`, `bursts`, `durationMs` | Continuous births per second, up to 64 scheduled one-shot bursts, optional automatic emission duration |
| `shape` | Point, uniform sphere volume/surface, uniform box volume, or disk/conical direction around +Y |
| `position`, `rotation` | Birth origin and XYZ Euler orientation in radians; `setTransform` changes future births |
| `simulationSpace` | `local` follows the borrowed parent; `world` captures parent-transformed birth positions and velocities |
| `lifetimeMs`, `speed`, `size`, `angle`, `angularVelocity` | Fixed values or uniformly sampled `[min, max]` ranges; angular units are radians and radians/second |
| `acceleration`, `drag` | Constant acceleration and linear drag, analytically integrated from birth time |
| `sizeOverLife`, `opacityOverLife` | Piecewise-linear multipliers across normalized age; defaults are constant size and linear fade-out |
| `colorOverLife` | Piecewise-linear color tint multiplied by initial color, interpolated in Three.js linear working space |
| `texture`, `spriteSheet` | Borrowed texture, columns/rows, and animation cycles over normalized age; cells run left-to-right, bottom-to-top |
| `blending`, `depthTest` | Normal or additive blending, optional depth test; depth writes are disabled |

Curves require 2–16 strictly increasing keys covering time 0 through 1. Colors
are unsigned sRGB 24-bit hex values. Seeds are unsigned 32-bit integers. Options,
curves, shapes, and emission overrides are validated and copied. Textures and
scene parents remain borrowed objects.

Positions, acceleration, ranges, and other authoring scalars are bounded to
magnitude 1,000,000; lifetime is 0.001–1,000,000 ms; opacity is 0–1. Capacity is
1–65,536 particles per emitter. Sprite sheet dimensions are 1–256 each. Rotation
only transforms the birth shape and initial velocity; acceleration is expressed
in simulation space. Local billboard sizes follow the parent's X-axis scale;
use uniform parent scaling for undistorted size semantics. World billboard sizes
are world units.

## Time, bounds, and determinism

Presentation uses explicit finite, non-negative, monotonic timestamps no greater
than `Number.MAX_SAFE_INTEGER`. The first call establishes automatic emission
time zero. Scheduled bursts at zero run on that call. Rate emission starts after
one rate interval. Automatic emission includes the duration endpoint. Manual
`emit` spawns immediately at the last presented age, or age zero before the first
presentation, and returns the accepted count. It still works while automatic
emission is stopped. An explicit emission seed starts a reproducible burst;
otherwise the emitter's sequence continues.

No wall clock or `Math.random` is read. Motion uses the closed-form solution of
`dv/dt = acceleration - drag * velocity`; frame partitioning does not introduce
Euler integration drift. Without capacity/catch-up drops, corresponding births
have the same sampled properties and motion for any frame partition. Births
on moving parents use the transform observed at the presentation that processes
them; past parent motion is not reconstructed.

Each presentation expires old particles, processes at most `capacity` automatic
birth attempts, expires newly processed particles that are already dead, and
uploads the active prefix. Births known to be dead from maximum lifetime are
skipped. Remaining rate events beyond the per-frame budget are skipped
arithmetically, and scheduled bursts use the same budget. No loop grows with the
length of a frame hitch. A full pool drops incoming particles, preserves live
particles, and advances the random sequence. Overload/catch-up results can depend
on frame partitioning; they are bounded rather than an unbounded replay.
`inspect()` distinguishes emitted, dropped (including skipped/stopped scheduled
births), and expired particle counts. Counters saturate at the maximum safe integer.

`clear` removes live particles without rewinding time or seeds. `restart` clears
particles, resets the automatic schedule and seed sequence, and resumes emission
at the last presented timestamp. Neither rewinds the accepted absolute timestamp
nor resets lifetime inspection counters. Schedule repetition can be driven with
`restart`; there is no implicit loop.

## Rendering, costs, and ownership

The renderer uses one instanced quad mesh, geometry, and shader material per
emitter, with one draw call for each visible emitter. Unlike point sprites,
billboards support world-unit size, rotation, and atlas UVs without hardware
point-size limits. The default untextured sprite is a soft disk.

Simulation uses preallocated typed arrays and a dense active prefix with O(1)
swap removal. Presentation is O(active particles + bounded birth attempts +
scheduled burst entries), with no per-particle object allocation. It updates only
the active ranges of three dynamic instance attributes. GPU resources are reused
through emission, expiry, clearing, and restarting. Optional sorting allocates
fixed-capacity scratch buffers on first use, then costs O(active log active).
Different emitters remain separate draw calls and are not globally alpha-sorted.

Shader-generated billboards disable automatic CPU frustum culling because static
quad bounds do not describe particle positions. There is no particle collision,
mesh-particle rendering, soft depth intersection, GPU simulation, or cross-emitter
batching in this version. Capacity and material/overdraw costs still need to suit
the application's device budget.

Disposal is idempotent, detaches the mesh, releases owned geometry/material GPU
resources, and clears the material's borrowed texture reference. It does not
dispose the parent, camera, or texture. Drop the disposed emitter handle to allow
its CPU storage to be garbage-collected. Mutation/presentation calls after
disposal throw; inspection remains available.

## Design decision and verification

The particle engine is a separate Client subpath rather than a new workspace
package: it shares Client's Three.js runtime and environment boundary without
adding a dependency or exposing vendor declarations. `vfx` is a convenience
adapter for game commands and delegates burst storage, movement, and rendering
to this engine. Generic emitters can be used without VFX; VFX trail and popup
commands retain their existing implementations.

The [particle workshop](../../examples/particles/README.md) demonstrates sparks,
alpha-sorted smoke, and animated atlas sprites. `pnpm verify` covers seeded
sampling, time, analytical motion, bounds, invalid inputs, transforms, sorting,
restart, pool reuse, and Feature ownership. `pnpm verify:particles` additionally
checks real Chromium shader compilation, visible pixels, exactly three draws
for three active emitters, instance counts, stable GPU resources, and disposal.
The CI runs both and retains the workshop screenshot with browser evidence.
