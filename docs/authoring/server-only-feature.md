# Author a server-only Feature

Use a server-only Feature for consumer gameplay that runs entirely in a headless
Server Runtime. This example adds no kit Feature: the descriptor and its gameplay
state belong to the consumer. Import only public package roots from
`@three-game-kit/core` and `@three-game-kit/server`.

```ts
import {
  defineFeatureConfiguration,
  type FeatureDescriptor,
  type ServerRuntimeContribution,
} from "@three-game-kit/core";
import { createServerRuntime } from "@three-game-kit/server";

type Configuration = Readonly<Record<string, never>>;

const configuration = defineFeatureConfiguration<Configuration>({
  defaultValue: () => ({}),
  parse(input) {
    if (
      typeof input === "object" &&
      input !== null &&
      !Array.isArray(input) &&
      Object.keys(input).length === 0
    ) {
      return { ok: true, value: {} };
    }

    return {
      ok: false,
      issues: [{ path: [], code: "empty-object-required" }],
    };
  },
});

let authoritativeUpdates = 0;

const gameplaySystem: ServerRuntimeContribution = {
  kind: "system",
  id: "consumer.round-rules.gameplay",
  domain: "server-simulation",
  phase: "gameplay",
  priority: 0,
  run() {
    authoritativeUpdates += 1;
  },
};

export const roundRulesFeature: FeatureDescriptor<
  Configuration,
  ServerRuntimeContribution
> = {
  id: "consumer.round-rules",
  description: "Consumer-owned authoritative round rules",
  runtimeContributions: [gameplaySystem],
  requires: [],
  conflicts: [],
  configuration,
  setup({ ledger, signal }) {
    signal.throwIfAborted();
    ledger.activateSystem(gameplaySystem.id);
  },
  dispose() {},
};

const runtime = createServerRuntime({
  features: [roundRulesFeature],
  configuration: { "consumer.round-rules": {} },
  driver: "exact",
});

const boot = await runtime.boot();
if (boot.state !== 'running') throw new Error(`Server Feature failed to boot: ${boot.reason}`);

runtime.stepExact(1);
await runtime.shutdown();
```

The configuration is exactly an empty object: the default produces `{}`, the
explicit runtime value is `{}`, and the parser rejects arrays, primitives, and
objects with any key. The descriptor declares one authoritative system in the
fixed `gameplay` phase. Do not register a second system for the same rule or apply
the same state change outside that system. Phase order and tie-breaking are defined
by [runtime scheduling](../architecture/runtime-scheduling.md).

## Ownership and authority

The consumer owns the descriptor, its callbacks, and any state captured by them.
The caller owns independently created inputs passed to the runtime unless ownership
is explicitly transferred. The Server Runtime owns its World, scheduler, lifecycle,
and Feature ledger. A Feature owns every resource it acquires through that ledger;
borrowed host or dependency values must not be closed, disposed, replaced, or
transferred by the borrower. See the complete
[Feature lifecycle contract](../architecture/feature-lifecycle.md).

Running in the server schedule establishes where code executes; it does not make
unchecked input trustworthy. The consumer remains responsible for deriving actor
identity and ownership from server-held connection bindings and for validating
protocol shape, sequence, tick window, permissions, finite values, gameplay bounds,
and current authoritative state before mutation. The trust boundary is detailed in
the [MVP protocol](../protocol/mvp.md). Client claims never grant authority.

## Rollback, disposal, and shutdown

If setup acquires a listener, timer, socket, adapter, or other live resource,
register its cleanup obligation with `ledger.acquire` before it can publish work.
Setup failure releases the in-progress scope and rolls back already completed
Features in reverse setup order. On normal shutdown the runtime fences and
unpublishes contributions, calls `dispose`, and releases remaining Feature-owned
records in reverse acquisition order. Keep `dispose` for Feature-local cleanup;
never use it to dispose borrowed values.

Shutdown is terminal and idempotent. Concurrent or later `shutdown()` calls share
the cached stopped result and must not repeat cleanup. Caller-owned resources still
need their own documented cleanup after the runtime can no longer use them.

## Tests and verification

Test the descriptor through public exports with an exact-step runtime. Assert that
`{}` boots, non-empty configuration fails before setup, one exact tick runs the
gameplay system once, and no tick runs after a failed boot. Add a forced setup
failure around every acquired resource and assert rollback leaves zero live
Feature resources. Call shutdown twice and assert the stopped result and disposal
side effects are unchanged. Authority tests must prove malformed, stale,
wrong-owner, non-finite, and out-of-bounds input cannot mutate state.

Run the complete release-candidate gate:

```sh
pnpm verify:m5
```
