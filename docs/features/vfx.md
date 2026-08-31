# Deterministic VFX

`@three-game-kit/client/vfx` is the reusable client presentation boundary for
small Three.js effects. It contains no Core Run types and does not advance
simulation or participate in authority.

## Commands and time

The runtime accepts three copied command variants:

- `burst`: position, particle count, color, speed, lifetime, and seed;
- `trail`: start/end positions, color, width, lifetime, and seed;
- `popup`: billboard position, color, size, lifetime, and seed.

Vectors and numeric fields are validated before enqueue. Seeds must be unsigned
32-bit integers and colors unsigned 24-bit integers. `present(timestampMs)`
requires explicit finite, non-negative, monotonic time. Randomized burst motion
uses a local deterministic generator initialized from the command seed; the
runtime never reads a wall clock or calls `Math.random`.

## Bounds and inspection

`createVfxRuntime(parent, options)` allocates fixed command and effect
capacities. Full command queues drop the oldest pending command. Full effect
pools overwrite the next ring slot. Both cases increment inspection counters.
`inspect()` returns queue depth, active effect counts, overflow and expiry
counters, disposal state, presentation time, and live groups, objects,
geometries, materials, and retained references.

## Lifecycle ownership

`createVfxFeature({ runtime })` installs `vfx-present` in the `render` phase at
priority `-100`, before `three-render-frame`. Setup acquires the runtime through
the Feature ownership ledger as `renderResources`. Shutdown is idempotent: it
clears commands, detaches the owned group, disposes all owned geometries and
materials, and drops retained references. The parent scene remains borrowed.

## Core Run mapping

Core Run maps pickup, deposit, dash, jump-pad, hazard-entry, and movement data
to generic commands through the public entrypoint. The renderer no longer owns
a game-specific particle, popup, or trail implementation.

The bounded scope excludes audio, post-processing, camera shake, multiplayer
replication, text layout, and dynamic plugin discovery.

Verification: `pnpm verify`, `pnpm verify:core-run`, and `pnpm verify:m5`.
