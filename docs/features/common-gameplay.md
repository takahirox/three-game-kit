# Priority A common gameplay Features

The Priority A layer adds five optional first-party capabilities without making any
of them a Core dependency: UI/HUD, Trigger/Area, Health/Damage, Spawn/Prefab, and
Game State/Flow. The authority-neutral models are exported from
`@three-game-kit/shared/gameplay`; lifecycle wrappers are exported from
`@three-game-kit/client/gameplay` and `@three-game-kit/server/gameplay`.

## Public APIs and runtime placement

| Capability | Shared model | Client Feature | Server Feature | Scheduled phase |
| --- | --- | --- | --- | --- |
| UI/HUD | `createHudStateStore` | `createHudFeature` / `createDomHudAdapter` | not applicable | client `render` |
| Trigger/Area | `createTriggerAreaRuntime` | `createTriggerAreaClientFeature` | `createTriggerAreaServerFeature` | client `shared-predict`; server `gameplay` |
| Health/Damage | `createHealthRuntime` | `createHealthClientFeature` | `createHealthServerFeature` | client `shared-predict`; server `gameplay` |
| Spawn/Prefab | `createSpawnPrefabRuntime` | `createSpawnPrefabClientFeature` | `createSpawnPrefabServerFeature` | passive ownership wrapper |
| Game State/Flow | `createGameFlowRuntime` | `createGameFlowClientFeature` | `createGameFlowServerFeature` | passive ownership wrapper |

Shared has no DOM, Three.js, transport, or server dependency. Its values are copied,
validated, frozen, and ordered by stable IDs. Client and Server wrappers accept the
same model interfaces, so a game can test rules headlessly and choose the appropriate
runtime owner without deep imports.

## Authority boundary

In multiplayer, the Server remains authoritative. Trigger and Health Client Features
provide provisional local prediction only; the Server wrappers reevaluate trusted
actor positions and apply trusted health requests on exact ticks. Spawn and Flow on a
client are likewise prediction or presentation until the host accepts and replicates
an authoritative result. These APIs deliberately add no network message or identity
field. Existing Protocol and connection-owned identity rules remain unchanged.

For non-networked single-player, a local host may own authoritative state and use the
same Shared models directly. HUD is always presentation-only: DOM actions are semantic
callbacks and displayed values never grant authority.

## Capability contracts

Trigger/Area supports axis-aligned boxes and spheres, optional string layers, finite
positions, and deterministic `enter`, `stay`, then `exit` observations by stable area
and actor ID. It does not perform physics queries or apply gameplay effects itself.

Health/Damage registers bounded health values and queues positive finite damage or
healing. Exact steps clamp changes, enforce optional tick-based invulnerability, emit
death once, ignore healing while dead, and expose explicit reset. Combat protocols,
armor, teams, and status effects are outside this layer.

Spawn/Prefab copies immutable JSON-like component and resource descriptors. IDs are
caller-supplied or deterministic, and adapters create, reuse, pool, or destroy opaque
handles. If reuse fails, the handle remains pooled; if release fails, the active
instance remains owned and observable so cleanup can be retried. Networking, assets,
placement, and ECS token creation remain host policy.

Game State/Flow validates a closed state graph, rejects same or disallowed transitions,
runs synchronous enter/exit hooks, retains bounded transition telemetry, and leaves the
current state unchanged after a hook failure. Persistence and scene loading are not
implicit side effects.

HUD snapshots contain screen, score, timer, health, pause, and primitive extras. The
store synchronously publishes immutable snapshots. The DOM adapter binds text through
`data-hud-bind`, screen visibility through `data-hud-screen`, and semantic clicks
through `data-hud-action`; disposal removes its listener without deleting caller-owned
DOM children.

## Ownership, rollback, and disposal

Each wrapper owns the runtime passed to it after successful setup. Trigger and Health
activate exactly one system through the lifecycle ledger. HUD owns both its store and
adapter. Spawn and Flow are passive descriptors so runtime shutdown still orders and
disposes them with the rest of the immutable Feature composition.

Setup activation failure resets the wrapper fence. A later Feature failure invokes
reverse-order rollback; normal shutdown uses the same disposal path. Every runtime is
terminal and idempotent after disposal. Reader, publisher, hook, definition, and DOM
root inputs remain caller-owned unless the public API explicitly says otherwise.

## Example and verification

[`examples/common-gameplay`](../../examples/common-gameplay/README.md) is an
external-style public-import example. It composes all five Client Features, exercises
trigger and health ticks, prefab pooling, a flow transition, real DOM HUD binding and
semantic action delivery, then proves reverse cleanup without removing the DOM.

- `pnpm typecheck:common-gameplay` checks external public imports.
- `pnpm test:node` checks deterministic models, validation, adapter failures,
  client prediction, server authority wrappers, rollback, and idempotent cleanup.
- `pnpm test:common-gameplay` runs the Chromium composition and cleanup proof.
- `pnpm verify:common-gameplay` runs the complete Priority A gate.
