# Author a cross-runtime Interaction Feature

Use the actual external fixture as the executable example: its
[source](../../examples/external-interaction-consumer/src/interaction-feature.ts)
defines the Feature pair, and its [test](../../examples/external-interaction-consumer/test/m4.test.mjs)
proves the lifecycle and two-client behavior. The [catalog](../features/catalog.json)
summarizes the public surface; the [Interaction contract](../features/interaction.md)
is normative.

## Install the public packages

The external consumer declares all five packages at the shared compatibility range:

```json
{
  "dependencies": {
    "@three-game-kit/client": "^0.1.0",
    "@three-game-kit/core": "^0.1.0",
    "@three-game-kit/protocol": "^0.1.0",
    "@three-game-kit/server": "^0.1.0",
    "@three-game-kit/shared": "^0.1.0"
  }
}
```

The packed-consumer verifier builds and packs version `0.1.0`, installs those five
tarballs into a temporary external copy of the fixture, then builds and tests that
copy. This ensures the example does not resolve through workspace aliases.

Import only package roots and exported subpaths:

```ts
import { defineFeatureConfiguration, type ClientFeatureDescriptor,
  type FeatureDescriptor, type ServerRuntimeContribution } from "@three-game-kit/core";
import { createRuntime as createServerRuntime } from "@three-game-kit/server";
import { createAuthoritativeServer } from "@three-game-kit/server/authoritative";
import { createRuntime as createClientRuntime } from "@three-game-kit/client";
import { createClientReplicationEngine } from "@three-game-kit/client/replication";
import type { InteractableSnapshotEntity } from "@three-game-kit/protocol";
import type { MovementVector } from "@three-game-kit/shared";
```

Do not import `src`, `dist`, undeclared subpaths, workspace aliases, or other
internal/deep paths.

## Define one configuration provider

Both descriptors use the same `defineFeatureConfiguration` result. Its default is
exactly one target, at `{ x: 2, y: 0, z: 0 }`, with range `3`, inactive state, and
the fixture-only `forceSetupFailure: false`. The parser requires exactly
`targetEntityId`, `position`, `range`, `initialActive`, and `forceSetupFailure`; it
rejects missing, extra, malformed, non-finite, or out-of-bound values. Reusing this
one provider keeps the server and client configuration contract identical.

## Describe and own the Features

The ordinary server descriptor has ID `external.interaction.server`, requires
`host.server-authority`, conflicts with `external.interaction.alternative`, and has
no runtime contributions. During setup it borrows the host service
`host.authoritative-interaction`, acquires its adapter state through the Feature
ledger, and activates that owned adapter through the borrowed host port. The
adapter validates the configured target and finite distance, toggles `active` only
when applied, and returns the interactable snapshot.

The ordinary client descriptor has ID `external.interaction.client`, requires
`host.client-session`, and declares the same conflict. Its one system contribution,
`external.interaction.presentation`, runs in the `client-presentation` `render`
phase. Setup borrows `host.client-replication`, acquires a Feature-owned control,
and activates the presentation system. The control queues the configured target
through `queueInteract` and reads the latest interactables from engine inspection;
it never shuts down the borrowed engine.

Register requirement descriptors and provide the two borrowed host services when
creating the corresponding Server and Client Runtimes. Missing requirements,
conflicts, invalid configuration, or forced setup failure stop boot and roll back
Feature-owned acquisitions. Normal shutdown also releases only owned state, leaves
zero live Feature resources, and is idempotent: a second shutdown returns the
already-completed result without disposing a borrowed service.

## Wire authority and two clients

Create the deterministic adapter and pass it as `interactionAdapter` to
`createAuthoritativeServer`. Create two independent
`createClientReplicationEngine` instances, connect each to the server, and route
each client's emitted messages through its own connection. One client queues an
Interaction; the server receives it and advances authoritative ticks; both clients
then ingest the resulting snapshot and present the same active state.

The server alone validates ownership, sequence, tick window, target, and range,
then applies accepted Interaction state and includes it in snapshots. A client only
queues intent: Interaction performs no client prediction, collision, or local
position change. Client presentation uses the newest interactable snapshot exactly;
newer snapshots replace older values, and omission removes an interactable. Base
movement remains runnable when the Interaction descriptors and host services are
removed.

## Compatibility and exclusions

All five pre-1.0 packages share one release version. Under the documented `0.y.z`
SemVer policy, a minor release may break public APIs when accompanied by release
notes and migration guidance; a patch may not break the public surface or behavior
of its minor line.

This fixture covers one configured target and one boolean toggle. It does not claim
multi-target behavior, line-of-sight or physics occlusion, hot Feature mutation,
browser Interaction acceptance, inventory, combat, damage, dialogue, navigation,
or arbitrary actions.

Verify the packed public boundary and the proposed documentation diff with:

```sh
pnpm test:m4-packed-consumer
git diff --check
```
