# Particle workshop

Run `pnpm exec vite --host 127.0.0.1`, then open `/examples/particles/index.html`.
The workshop uses only `@three-game-kit/client/particles` and the existing Three.js
dependency. It demonstrates a cone spark fountain, alpha-sorted expanding smoke,
and rotating sprite-sheet embers with lifetime color curves.

Use the controls to stop/resume automatic emission, emit a manual burst, or
restart all schedules. The display shows live particle and renderer draw counts.

Run `pnpm verify:particles` for typechecking and Chromium rendering/lifecycle
checks. If the default test port is occupied, set `PLAYWRIGHT_PORT=4184`.
See [particle API documentation](../../docs/features/particles.md) for limits,
ownership, overload policy, and simulation-space semantics.
