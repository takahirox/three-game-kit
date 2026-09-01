# Priority C advanced and specialized Features

Priority C is an optional layer outside minimal Core. `@three-game-kit/shared/advanced` contains deterministic Dialogue, Vehicles, and structured Debug/DevTools state. `@three-game-kit/client/advanced` adds their client wrappers plus Post-processing, Camera extensions, and Input experience extensions. `@three-game-kit/server/advanced` owns authoritative Dialogue, Vehicles, and headless Debug/DevTools wrappers. Consumers can omit or replace every capability independently.

## Dialogue

`createDialogueRuntime` stores localization-friendly dialogue, node, line, choice, condition, and effect IDs. `start`, `advance`, `choose`, `snapshot`, and `restore` are deterministic and UI-independent. Condition/effect hooks remain caller-owned. `dialogue.server` owns trusted multiplayer progression; `dialogue.client` is local presentation or prediction.

## Vehicles

`createVehicleRuntime` provides enter/exit occupancy, driver and passenger seats, bounded throttle/brake/steering, a small arcade reference integrator, and replaceable validation/integration hooks. `vehicles.server` validates trusted driver control in `gameplay`; `vehicles.client` predicts in `shared-predict`. Physics bodies, replication, camera, and input handoff remain host integrations rather than a forced simulator.

## Post-processing

`createPostProcessingRuntime` owns an injected composer adapter and ordered opaque pass handles. It registers, removes, enables, resizes, renders, and disposes passes deterministically. `post-processing` runs in the client `render` phase. No Three.js examples module or standard pass is imported, so unrelated games do not pay that bundle/runtime cost.

## Camera extensions

`createCameraEffectsRuntime` supplies first-person, orbit, and fixed-follow variants, bounded zoom, tick-based blends, deterministic shake, and an optional occlusion hook. `camera-extensions` publishes transforms in `camera-view` and conflicts with the existing `third-person-camera` owner. All effects are non-authoritative presentation.

## Input experience extensions

`createInputExperienceRuntime` keeps programmable sources first-class while supporting device-neutral gamepad/touch updates, rebinding, sensitivity, dead zones, gameplay/UI contexts, and disconnect cleanup. `input-experience-extensions` publishes semantic movement/actions in `action-sample`. Browser device enumeration, listeners, haptics, accessibility UI, and binding persistence remain adapters or host policy.

## Debug / DevTools

`createDebugDevToolsRuntime` captures sorted, depth-bounded JSON-like provider output and exports it for automation. Injection is limited to explicitly registered semantic command kinds. Client and server wrappers capture in `telemetry`; provider callbacks can expose installed Features, lifecycle inspection, telemetry, ECS, renderer, physics, or camera state without coupling this module to those implementations. This is not a production remote administration or authentication service.

The public-import-only [`advanced-features` example](../../examples/advanced-features/README.md) composes all six capabilities and proves reverse-order cleanup in Chromium. Shared/client/server Node tests cover deterministic behavior, authority, and ownership. Run `pnpm verify:advanced-features`; it is included in `pnpm verify:m5` and CI.
