# Particle atlas

Run `pnpm exec vite --host 127.0.0.1`, then open `/examples/particles/index.html`.
The gallery contains **20 animated effects** made with the public
`@three-game-kit/client/particles` API:

| Fire | Cosmic | Magic | Energy | Nature |
| --- | --- | --- | --- | --- |
| Solar flare | Singularity | Frost nova | Storm core | Sakura drift |
| Midnight bloom | Aurora veil | Phoenix wings | Arc reactor | Abyssal bloom |
| Volcanic heart | Velvet nebula | Spirit wisps | Plasma vortex | Chromatic joy |
| | Meteor shower | Astral sigil | Digital rain | Toxic garden |
| | Warp speed | | | |

Filter by category, click a card to enlarge it, or use **← / →** in the enlarged
view. **Escape** returns to the grid. **Pause / Play** (or Space outside buttons)
freezes/resumes motion; **Burst** adds short-lived particles, **Restart** resets
the selected effect or the entire gallery, and the speed slider runs at 0.25–2×.
The footer reports visible effects, particles and draw calls.

One WebGL canvas uses viewport/scissor rendering for all visible cards. Effects
are created and warmed only on first visibility; hidden cards do not advance or
render. Authored rings and constellations replay their initial layout before the
finite particle lifetime expires; temporary user bursts are not replayed. Initialized effects are reused when switching views. Each preset uses
one to four emitters, fixed capacities with burst headroom, and eight shared
procedural textures. Alpha smoke/petals use per-emitter sorting. Reduced-motion
preferences start the gallery paused. No external images or packages are needed.

`presets.ts` contains effect compositions and animation paths. `textures.ts`
generates the shared glow, star, streak, smoke, petal, lightning, ripple and glyph
assets. `main.ts` handles the gallery, clipping, controls and resource ownership.

Run `pnpm verify:particles` for typechecking and Chromium checks. The tests visit
all 20 effects, check visible output/draw budgets/instance counts, exercise
switching, pause, burst, restart, category filters and mobile navigation, and
verify that resources do not accumulate and are released on disposal. Screenshots
are written under `test-results/particles-*.png`. If the default test port is
occupied, set `PLAYWRIGHT_PORT` to an available port.

[feature.ts](./feature.ts) separately demonstrates transferring emitter ownership
to a Client Runtime with `createParticleFeature`; call `client.boot()`,
`client.startPresentation()`, and `client.shutdown()` on the returned runtime.
See [particle API documentation](../../docs/features/particles.md) for engine
limits, ownership, overload policy, and simulation-space semantics.
