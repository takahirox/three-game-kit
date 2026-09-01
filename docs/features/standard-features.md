# Priority S standard Features

The Client package exposes four optional first-party Standard Features. None is a Core dependency,
none grants server authority, and games can omit or replace each one. Their public contracts are
listed in [`foundation-catalog.json`](./foundation-catalog.json); the runnable external-style usage
is [`examples/standard-features`](../../examples/standard-features/README.md).

## Audio

Import `createAudioRuntime`, `createWebAudioDriver`, `createSilentAudioDriver`, and
`createAudioFeature` from `@three-game-kit/client/audio`.

Register decoded audio buffers under stable IDs, then call `playEffect` or `playMusic`. Playback
options support a bus, volume, rate, loop, and optional three-dimensional position. `master`,
`music`, and `effects` buses exist initially; additional named buses are created by
`setBusVolume`. Call `audio.unlock()` inside a user gesture to satisfy browser autoplay policy.
Hosts without audio can use the default silent driver and retain the same deterministic API.

The runtime owns voices, Web Audio nodes created by its driver, and registered buffer references.
It does not close the caller's `AudioContext`. Feature rollback/shutdown stops and disconnects all
voices and disposes the driver once. Playback is presentation-only and never authoritative.

## Character Controller

Import from `@three-game-kit/client/character-controller`. Create the controller with any public
`ClientCollisionAdapter`; the bundled `createRapierCollisionAdapter` is available from
`@three-game-kit/client/collision`.

Every fixed tick the Feature reads bounded semantic input, selects walk/run speed, applies gravity,
grounded jump, caller-supplied platform velocity, and external impulses, then submits one
translation to the collision adapter. `teleport` resets velocity; `inspect` returns an immutable,
save-friendly snapshot. Slopes and steps inherit the chosen adapter's behavior. Platform contact
discovery is deliberately game-owned; the hook accepts a computed platform velocity.

The Feature conflicts with the lower-level `collision` Feature because both would otherwise drive
the same adapter. It owns and disposes the controller and adapter. Results are local prediction;
servers must validate movement, grounded state, jumps, and impulses independently.

## Animation

Import from `@three-game-kit/client/animation`. `createThreeAnimationRuntime` accepts a caller-owned
Three `Object3D`, stable clip registrations, and an optional semantic-state map. `setState` performs
the standard idle/walk/run/jump-style switch, `play` configures looping/rate/crossfade, and
`playOneShot` emits completion callbacks. The Feature advances the mixer on deterministic fixed
ticks so tests can reproduce state.

Root motion is ignored by policy: locomotion remains owned by gameplay/Character Controller state.
The runtime owns its mixer/actions/listeners, but borrows the root and clips. Disposal stops and
uncaches actions and clears retained references; asset geometry/material/texture disposal remains
with the Asset Manager or caller.

## Asset Manager

Import from `@three-game-kit/client/asset-manager`. Manifests use unique stable IDs, one of `gltf`,
`texture`, or `audio`, a source, and optional preload groups. Concurrent `load(id)` calls share one
promise, completed values are cached, and `preloadGroup` returns structured outcomes. Progress
snapshots expose total, started, completed, failed, and pending counts without exposing vendor
loader state.

`createThreeAssetBackend` loads glTF and textures. Supply its `loadAudio` callback to fetch/decode
audio according to host policy. Custom deterministic/in-memory backends are first-class for tests.
The manager owns successful values, disposes cached Three resources once, and fences in-flight
loads so a value arriving after shutdown is disposed instead of published. Per-asset eviction and
reference counting are not part of this first version.

## Minimal composition

```ts
const runtime = createClientRuntime({
  frameSource,
  features: [
    createAssetManagerFeature(assets),
    createAudioFeature(audio),
    createAnimationFeature({ runtime: animation, readState }),
    createCharacterControllerFeature({ controller, readInput, publish }),
  ],
});
```

Order matters only for reverse cleanup here: Character Controller and Animation release borrowed
asset/audio-adjacent state before Audio and Asset Manager release their owned resources.

## How to verify

- `pnpm test:node` covers validation, fixed-tick behavior, failures, cache deduplication, in-flight
  disposal, setup rollback, normal shutdown, and idempotent cleanup with headless adapters.
- `pnpm typecheck:standard-features` verifies public-only imports from an external-style example.
- `pnpm test:standard-features` exercises real Chromium Web Audio, glTF loading, animation,
  Character Controller ticks, and complete reverse-order shutdown.
- `pnpm test:m4-packed-consumer` proves all new subpaths are present and importable from packed
  packages without workspace or deep imports.
- `pnpm verify:standard-features` runs the complete standard-Feature gate.
