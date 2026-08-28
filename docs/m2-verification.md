# Milestone 2 verification

Milestone 2 is complete. It delivers the local browser Client slice through public package exports and
keeps networking deferred to Milestone 3. The accepted gate completed **76 Node tests and one
Playwright-bundled Chromium acceptance test**.

## Run the gate

From the repository root in the [supported environment](./supported-environments.md):

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm exec playwright install chromium
corepack pnpm verify:m2
```

`verify:m2` builds all workspaces, type-checks package source, public-type fixtures, and the browser
sandbox, runs 76 Node tests, verifies workspace exports and source/emitted-declaration boundaries, and
then runs the single Chromium acceptance in
[`tests/m2-browser.spec.ts`](../tests/m2-browser.spec.ts).

## Deliverable map

Every deliverable below is exercised by `corepack pnpm verify:m2`. Positions and distances are meters;
simulation and animation durations are seconds, speed is meters per second, camera yaw is radians, and
the browser frame-source adapter accepts the platform timestamp in milliseconds.

| M2 deliverable | Public modules, phase, and ownership | Evidence and bounded limitation |
| --- | --- | --- |
| Client Runtime with injectable frames and fixed simulation | `@three-game-kit/client` exports `Runtime`, `createRuntime`, `createClientRuntime`, and `createBrowserPresentationFrameSource`; `@three-game-kit/core` exports the schedule and deterministic frame source. The Runtime owns one World, the schedule, and its pending request, but borrows the injected frame source. | Node runtime/scheduling tests and Chromium drive exactly 120 simulation ticks and, independently, 75 presentation frames; shutdown cancels the one remaining request. Exact and bounded wall-clock drivers are implemented; browser-global `requestAnimationFrame` is only an injected adapter. |
| Renderer, semantic input, camera, and static collision | `@three-game-kit/client/input` runs `movement-input` in `action-sample`; `@three-game-kit/client/collision` runs `collision` in `shared-predict`; `@three-game-kit/client/camera` runs `third-person-camera` in `camera-view`; `@three-game-kit/client/rendering` runs `three-rendering` in `render`. Input sources are caller-owned; Collision owns its adapter; Rendering owns its renderer. | Unit tests cover keyboard/programmatic input and camera transforms. Chromium proves grounded movement, collision, finite transforms, resize, listener cleanup, and 75 renders. Collision is limited to a capsule-like controller against a static floor and obstacle. |
| URL glTF loading and disposal | `@three-game-kit/client/assets` exports `createGltfAvatarLoader` and documented success/failure outcomes. The pending load Promise represents loading; the loader owns each successfully loaded asset, and the renderer only borrows the asset scene while attached. | Chromium loads the one local `avatar.gltf` with zero clips, attaches it, observes a missing-URL `load-failed`, and proves loader/asset cleanup. Assets allow zero or one clip; there is no cache, CDN pipeline, or animation graph. |
| Public-export browser sandbox and telemetry | `examples/local-browser/main.ts` composes eight declared modules and five Features. Its observation Feature publishes one entity in `presentation-publish`; Core owns telemetry snapshots and structured errors. | Chromium observes `entityCount === 1`, the five exact Feature IDs, positive finite frame duration, and zero unexpected structured runtime errors or uncaught page errors. The scene is a deterministic acceptance sandbox, not a general game or visual-golden test. |
| Browser lifecycle acceptance | Public Client/Core lifecycle APIs boot immutable Feature composition, roll back setup, stop scheduling, dispose in reverse order, and return the same shutdown result. Caller-owned keyboard and resize listeners are removed by the sandbox. | The Chromium acceptance covers success/failure loading, resize, frame cleanup, setup rollback, two shutdown calls, resource disposal, and serialization of the evidence report. Certification is only for Playwright-bundled Chromium. |
| Public API, Feature contract, units, ownership, phases, limitations, and command documentation | Public export maps provide `@three-game-kit/client` plus `/input`, `/collision`, `/camera`, `/rendering`, and `/assets`; Shared supplies semantic movement and collision values without vendor types. This page records the contract and `verify:m2` command. | `scripts/verify-workspace.mjs`, package builds, and type checks reject deep/undeclared imports and Three.js/Rapier types in emitted public declarations. Networking remains outside M2. |

## Phase contract

The implemented local slice uses four relevant ordered phases:

| Clock | Phase | Work |
| --- | --- | --- |
| Simulation tick | `action-sample` | Sample one caller-owned semantic `move(x, z)` command. |
| Simulation tick | `shared-predict` | Convert speed and fixed `dt` to a desired translation, resolve it through the Feature-owned collision adapter, and publish the position. |
| Presentation frame | `camera-view` | Read the latest target and publish a finite third-person camera transform. |
| Presentation frame | `render` | Render the Feature-owned Three.js scene once. |

Presentation frames never advance the simulation tick. The accepted evidence reaches simulation tick 120
before delivering 75 frames and remains at tick 120 afterward.

## Exit-criterion evidence

| M2 exit criterion | Passing evidence |
| --- | --- |
| Semantic movement and bounded obstacle collision | Sixty rightward ticks move the grounded avatar at least **2.5 m** while vertical error remains at most **0.02 m**. Sixty head-on ticks collide with the obstacle; the absolute avatar-center error from the expected obstacle bound is at most **0.02 m**. |
| Independent clocks and finite interpolation/presentation values | Exactly **120 simulation ticks** produce 120 commands, desired translations, and collision results. Exactly **75 independently delivered presentation frames** produce 75 camera transforms and renders without changing tick 120. All collision, avatar, and camera transforms are finite. |
| Distinct glTF states and exact cleanup | The local glTF succeeds with zero clips; a missing URL returns `load-failed`. Shutdown detaches/disposes owned renderer resources, and loader disposal releases the asset's geometries, materials, textures, and animation state. Keyboard and resize listeners finish at zero; exactly one pending frame is cancelled; all live-resource gauges are zero. |
| Public sandbox and telemetry | The sandbox imports only declared exports and produces no uncaught page error. Telemetry reports `entityCount: 1`, a positive finite `clientFrameDurationSeconds`, and exactly `movement-input`, `collision`, `third-person-camera`, `three-rendering`, and `m2-entity`; unexpected structured errors are zero. |
| Client and declaration boundaries | The boundary gate checks Client source and emitted declarations. Public collision APIs expose kit-owned value types, not Rapier types; renderer and asset APIs likewise expose no Three.js types. |

The rollback probe forces the second Feature's setup to fail after the first owns one listener. Only the
first Feature is disposed, its listener is released, and the stopped Runtime has zero live resources.
Normal shutdown is called twice concurrently: both calls return the identical Promise and identical
stopped result, disposal happens once, and the result is clean.

## Ownership and disposal contract

- The caller owns programmable input and keyboard adapters and disposes them; `movement-input` only
  samples a borrowed command source. The keyboard adapter owns its two registered listeners.
- The `collision` Feature takes ownership of the injected collision adapter and disposes its Rapier
  World, character controller, capsule collider, and static colliders exactly once.
- The `three-rendering` Feature takes ownership of the injected renderer and disposes its WebGL
  renderer plus its floor, obstacle, and placeholder-avatar geometries and materials.
- The glTF loader owns successful assets and disposes their geometry, material, texture, and optional
  animation resources. A renderer attachment is borrowed: renderer disposal detaches it, while loader
  disposal releases it.
- The Runtime owns its World, activated systems, lifecycle records, and pending presentation request.
  The injected frame source and host callbacks remain borrowed. Sandbox-owned keyboard/resize listeners
  are removed explicitly.

## Deliberate M2 limits

The collision World contains only a static floor and one static obstacle. Gravity is exactly zero; a
small downward desired translation supplies contact for grounded reporting. There are no dynamic rigid
bodies. The sandbox loads one local glTF containing zero clips; the public loader accepts zero or one
clip only. Browser evidence is certified only in the Playwright-bundled Chromium revision pinned by the
repository. Audio, WebXR, post-processing, generalized assets/animation, and screenshot goldens remain
unsupported. Networking, authoritative correction, remote interpolation, and Protocol runtime behavior
remain Milestone 3 work.

Vite excludes `@dimforge/rapier3d` from dependency prebundling. This keeps the Rapier JavaScript/WASM
glue on one module path so its internal WASM state is unified between the application and the collision
adapter; prebundling a second copy can split that state.
