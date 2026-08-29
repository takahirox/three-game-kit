# Client Features

The Client package implements four first-party public client-only Feature factories. They are
composed in the [`local-browser` example](../../examples/local-browser/main.ts) and follow the
static boot, rollback, and shutdown rules in the
[Feature lifecycle contract](../architecture/feature-lifecycle.md). This page describes the
implemented MVP only.

All four descriptors have empty `requires` and `conflicts` lists. Composition order therefore uses
the caller's declaration order as the lifecycle tie-breaker, while system execution follows the
fixed client phase order. Each descriptor contributes one priority-`0` system. They contribute no
server systems: server phase, server authority, and server runtime-contribution fields are **not
applicable** to these client-only Features.

## Common configuration and lifecycle contract

The runtime configuration for every Feature on this page is exactly an empty object. The default is
a fresh frozen `{}`. If a configuration entry is supplied under the descriptor ID, it must be a
non-null, non-array object with no own keys; there are no configurable fields, numeric bounds, or
per-field defaults. Factory options such as callbacks, adapters, and camera values are constructor
inputs captured by the descriptor, not runtime Feature configuration.

Setup activates the descriptor's declared system through its Feature-scoped lifecycle ledger. A
failed activation resets the Feature's active fence and rethrows. If this Feature completed setup
and a later Feature fails, runtime rollback first fences contributions, then calls `dispose`, and
finally releases ledger records; normal shutdown performs the same per-Feature cleanup in reverse
successful-setup order. The lifecycle does not call `dispose` on the Feature whose own setup failed.
Consequently, callers must retain references to injected disposable objects until boot succeeds so
they can clean them up if that Feature's own activation fails. Runtime shutdown is terminal and
idempotent; the Feature disposal implementations below are also idempotent where they own a
disposable object.

The Runtime owns its World, schedules, activated-system records, lifecycle state, and pending
presentation request. Factory callbacks and callback-returned values remain caller-owned. Ownership
of each injected input, adapter, or renderer is stated explicitly below.

## `createInputFeature`

Import from `@three-game-kit/client/input`.

| Contract | Implemented value |
| --- | --- |
| Descriptor ID | `movement-input` |
| Purpose | Sample and publish one validated semantic movement command per simulation tick. |
| System | `movement-input-sample`, `client-simulation`, phase `action-sample`, priority `0` |
| Requirements / conflicts | None / none |
| Runtime configuration | Empty object only; default `{}`; no fields or bounds |
| Server phase / authority | Not applicable; client-only Feature |

Factory options are `input`, a borrowed `MovementCommandSource` with `sample()`, and `publish`, a
caller-owned callback. On each active tick the Feature calls `sample()`, validates and copies the
result as a finite bounded Shared `move` command, then calls `publish`. The Feature does not retain a
command history or apply movement.

The caller owns and disposes the input source. In particular, a `MovementInput` remains caller-owned,
and a keyboard adapter owns its two keyboard listeners until the caller disposes it. Feature
disposal only disables later sampling/publication; it does not dispose the source or callback.
There are no setup acquisitions beyond the activated-system ledger record.

This is semantic local input, not authorization. Published commands are not trusted server state,
network messages, input buffering, rebinding, pointer/gamepad input, or an authoritative movement
decision.

## `createCollisionFeature`

Import from `@three-game-kit/client/collision`.

| Contract | Implemented value |
| --- | --- |
| Descriptor ID | `collision` |
| Purpose | Compute and publish one collision move per client prediction tick. |
| System | `collision-shared-predict`, `client-simulation`, phase `shared-predict`, priority `0` |
| Requirements / conflicts | None / none |
| Runtime configuration | Empty object only; default `{}`; no fields or bounds |
| Server phase / authority | Not applicable; client prediction only |

Factory options are an owned `ClientCollisionAdapter`, caller-owned `readStartPosition` and
`readDesiredTranslation` callbacks, and a caller-owned `publish` callback. Each active tick reads
both finite three-component vectors, calls `adapter.move`, and publishes the successful
`CollisionMoveResult`. A failed adapter outcome becomes a system error.

The Feature takes ownership of the injected adapter. After successful Feature setup, disposal calls
`adapter.dispose()` exactly once. The public Rapier adapter in turn owns and releases its Rapier
World, character controller, capsule, and static colliders. If this Feature's own system activation
fails, lifecycle does not call its `dispose`; the caller must dispose the retained adapter reference.
After disposal, the descriptor cannot be set up again and movement reports `disposed-resource`.

The bundled adapter is a bounded local predictor: zero gravity, one kinematic capsule-like
character controller, sliding enabled, autostep and snap-to-ground disabled, and static boxes only.
It has no dynamic rigid bodies, broad gameplay physics, reconciliation, or authority. A server must
independently validate authoritative movement; this client result cannot grant authority.

## `createCameraFeature`

Import from `@three-game-kit/client/camera`.

| Contract | Implemented value |
| --- | --- |
| Descriptor ID | `third-person-camera` |
| Purpose | Publish one third-person camera transform per presentation frame. |
| System | `third-person-camera-view`, `client-presentation`, phase `camera-view`, priority `0` |
| Requirements / conflicts | None / none |
| Runtime configuration | Empty object only; default `{}`; no fields or bounds |
| Server phase / authority | Not applicable; presentation-only client Feature |

Factory options contain exactly `readTarget`, `configuration`, and `publish`. `readTarget` must
return exactly finite `x`, `y`, and `z` components. The captured camera configuration has exactly:

| Field | Constraint and default |
| --- | --- |
| `distance` | Positive finite number; no default |
| `height` | Finite number; no default |
| `lookAtHeight` | Finite number; no default |
| `yawRadians` | Finite number in radians; no default or normalized range |

The configuration is copied and frozen when the factory is called. Each active frame reads the
latest target, computes position from distance and yaw, offsets vertical position by `height`,
offsets the look-at point by `lookAtHeight`, and publishes copied finite vectors.

The caller owns the target state and callbacks. The Feature owns no camera object or external
resource; setup only activates its system and disposal disables reads and publication. It does not
implement orbit controls, collision avoidance, smoothing, interpolation, zoom limits, occlusion,
input binding, or server-visible state. Camera output is presentation data and has no authority.

## `createRenderingFeature`

Import from `@three-game-kit/client/rendering`.

| Contract | Implemented value |
| --- | --- |
| Descriptor ID | `three-rendering` |
| Purpose | Render the owned renderer scene once per presentation frame. |
| System | `three-render-frame`, `client-presentation`, phase `render`, priority `0` |
| Requirements / conflicts | None / none |
| Runtime configuration | Empty object only; default `{}`; no fields or bounds |
| Server phase / authority | Not applicable; presentation-only client Feature |

The sole factory option is an owned `ClientRendererAdapter`. The adapter must implement avatar asset
attachment, avatar and camera updates, resize, render, snapshot, and disposal. The Feature's system
only calls `render()`; callers and other client callbacks drive the other adapter methods.

After successful setup, the Feature owns and disposes the renderer exactly once. The public Three.js
adapter releases its WebGL renderer, owned scene objects, geometries, and materials. Attached glTF
assets remain borrowed and must be released by their loader owner. If this Feature's own activation
fails, the caller must dispose the retained renderer reference. A disposed descriptor cannot be set
up or rendered again.

The renderer covers the local MVP scene. It does not provide post-processing, WebXR, audio,
generalized scene management, screenshot-golden guarantees, or server behavior. Rendering is never
authoritative and presentation frames do not advance simulation.

## Public-import composition

This shortened composition mirrors the wiring in the
[`local-browser` example](../../examples/local-browser/main.ts). The caller owns `input`; the
collision and rendering Features take ownership of their adapters after successful setup.

```ts
import { Runtime } from "@three-game-kit/client";
import { createInputFeature } from "@three-game-kit/client/input";
import { createCameraFeature } from "@three-game-kit/client/camera";
import { createCollisionFeature } from "@three-game-kit/client/collision";
import { createRenderingFeature } from "@three-game-kit/client/rendering";

const runtime = new Runtime({
  features: [
    createInputFeature({ input, publish: setCommand }),
    createCollisionFeature({
      adapter: collisionAdapter,
      readStartPosition: () => position,
      readDesiredTranslation: () => desiredTranslation,
      publish: setCollisionResult,
    }),
    createCameraFeature({
      readTarget: () => position,
      configuration: {
        distance: 5,
        height: 2.5,
        lookAtHeight: 1,
        yawRadians: 0,
      },
      publish: setCameraTransform,
    }),
    createRenderingFeature({ renderer }),
  ],
});

const started = await runtime.start();
if (started.state !== "running") throw new Error(started.reason);
// Later: await runtime.shutdown(); then dispose caller-owned input resources.
```

## Verification

From the repository root in the [supported environment](../supported-environments.md), run:

```sh
corepack pnpm verify:m5
```

That release gate includes the M2 unit, public-type, workspace-boundary, local-browser typecheck, and
Playwright Chromium coverage described in [Milestone 2 verification](../m2-verification.md), plus the
later milestone and release checks.
