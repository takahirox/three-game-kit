# Interaction Feature contract (M4)

This is the normative M4 contract for the consumer-owned Interaction Feature described by the [feature catalog](./catalog.json) and implemented and exercised by the [external consumer fixture](../../examples/external-interaction-consumer/README.md). “Must” and “must not” are requirements.

## Intent, authority, and replication

Interaction is the semantic client intent `{ kind: "interact", targetEntityId }`. It requests an action against one entity; it does not contain or directly mutate authoritative state. An interactable snapshot entity has exactly this shape:

```ts
{
  entityKind: "interactable";
  entityId: string;
  position: { x: number; y: number; z: number };
  active: boolean;
}
```

The joined client must accept either that intent or a target ID through `queueInteract`. It must reject an invalid target ID synchronously without queuing. Only one action may occupy the current send slot; a queued action must receive the next sequence and intended tick when sent. Pending-history limits, acknowledgement retirement, matching-rejection retirement and sequence reuse apply exactly as they do to the replication engine's command history. Interaction must not run movement prediction, collision, or change the local simulation or presentation position.

The server must decode and schema-check the command at ingress, then validate connection phase, next sequence, intended-tick window, queue capacity, live connection, and ownership before consulting the Interaction adapter. It must then require the requested target ID to equal the configured target and compute finite Euclidean distance from the authoritative owned actor position to the configured finite target position. Distance equal to `range` is accepted. A validated command is applied in the `gameplay` phase and toggles `active` exactly once; rejected commands never toggle it.

The server must build snapshots in `snapshot-build` at its authoritative cadence (every three authoritative ticks), include the current interactable beside avatar entities, and emit the snapshot to every joined client, including both clients in the two-client fixture. Clients must present the newest interactable values exactly, detached and sorted by entity ID. They must not interpolate interactable position or state; removal from the newest snapshot removes the presentation.

## Feature metadata and configuration

The server Feature ID is `external.interaction.server`; it requires `host.server-authority`. The client Feature ID is `external.interaction.client`; it requires `host.client-session`. Both conflict with `external.interaction.alternative`.

Configuration is exact—unknown or missing keys are invalid:

| Key | Contract | Default |
| --- | --- | --- |
| `targetEntityId` | String matching `^[A-Za-z0-9_-]{1,64}$` | `switch_1` |
| `position` | Exact `{ x, y, z }`; each coordinate finite and within `[-1_000_000, 1_000_000]` | `{ x: 2, y: 0, z: 0 }` |
| `range` | Finite number in `[0, 1_000_000]` | `3` |
| `initialActive` | Boolean | `false` |
| `forceSetupFailure` | Boolean test boundary | `false` |

The external fixture's server adapter and client observer are defined in [`interaction-feature.ts`](../../examples/external-interaction-consumer/src/interaction-feature.ts), and its contract evidence is in [`m4.test.mjs`](../../examples/external-interaction-consumer/test/m4.test.mjs).

## Lifecycle and ownership

The server borrows `host.authoritative-interaction`; the client borrows `host.client-replication`. A Feature must never dispose, close, transfer, replace, or republish either borrowed host object. Adapter state, client control state, retained references, subscriptions, listeners, and system activations acquired by the Feature are Feature-owned.

Setup must validate configuration before activation, record each acquired resource in the lifecycle ledger, and roll back owned acquisitions in reverse order if setup fails. Normal disposal must release only Feature-owned resources. Shutdown must leave zero Feature-owned live resources, and a second shutdown must be safe and return the already-completed result without disposing a borrowed object.

Removing both Interaction descriptors and their host services must leave the base movement Feature and its gameplay loop runnable.

## Rejections and failures

The applicable rejection reasons are:

- `schema-invalid` for a decoded command that does not satisfy the protocol schema, including a malformed Interaction target at the decode boundary;
- `unsupported-version`, `unknown-kind`, `wrong-direction`, and the frame/JSON decode failures before command validation;
- `phase-invalid` for the wrong connection/adapter phase or an unavailable or invalid adapter result;
- `sequence-invalid`, `tick-out-of-window`, `queue-full`, `stale-connection`, and `ownership-violation` for their corresponding authoritative gates;
- `unknown-target` when the target differs from the configured target; and
- `interaction-out-of-range` when the authoritative actor is outside the inclusive finite range.

Decode-ingress failures are recorded at the malformed boundary and must not be admitted to the authoritative command queue. Adapter exceptions or invalid adapter snapshots are contained as structured invariant failures; invalid interactables must not be replicated.

## Compatibility and scope

The compatibility range is `^0.1.0`. Consumers may import only these documented package roots and public subpaths:

- `@three-game-kit/core`
- `@three-game-kit/protocol`
- `@three-game-kit/shared`
- `@three-game-kit/client` and `@three-game-kit/client/replication`
- `@three-game-kit/server` and `@three-game-kit/server/authoritative`

M4 supports exactly one configured target and one boolean toggle. Multi-target interaction, line-of-sight or physics-occlusion checks, hot enable/disable/replacement, and roadmap gameplay such as inventory, combat, damage, dialogue, navigation, or arbitrary actions are unsupported. This contract does not claim browser Interaction acceptance; browser evidence for other milestones is not M4 Interaction evidence.

## Verification

```sh
node --test packages/server/test/authoritative-interaction.test.mjs # 9 tests
node --test packages/client/test/interaction.test.mjs                # 5 tests
pnpm test:m4-packed-consumer
git diff --check
```
