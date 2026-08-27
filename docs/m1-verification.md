# Milestone 1 verification

Milestone 1 is complete. It delivers the Core headless kernel and Feature lifecycle, Shared semantic
movement, and the headless Server Runtime. The repository-level verification command is:

```sh
corepack pnpm verify
```

Run it from the repository root in the supported environment. The command builds all five workspaces,
type-checks package source and the Core public-type fixture, runs the six Node test files listed below,
and then verifies workspace shape, exports, dependency boundaries, representative forbidden imports,
and emitted declarations with `scripts/verify-workspace.mjs`.

## Acceptance evidence

| M1 acceptance area | Existing evidence run by `corepack pnpm verify` |
| --- | --- |
| ECS World, components, resources, queries, isolation, cleanup, and idempotent disposal | [`packages/core/test/ecs.test.mjs`](../packages/core/test/ecs.test.mjs) |
| Fixed-tick phases, exact stepping, stable phase/priority/Feature ordering, bounded catch-up, mailbox phase boundaries, and schedule failures | [`packages/core/test/runtime-scheduling.test.mjs`](../packages/core/test/runtime-scheduling.test.mjs) |
| Feature dependency ordering; duplicate, missing, cycle, conflict, descriptor, contribution, and configuration failures before setup | [`packages/core/test/feature-lifecycle.test.mjs`](../packages/core/test/feature-lifecycle.test.mjs) |
| Third-Feature setup failure, reverse rollback, ownership release, async cancellation, and zero final resource gauges | [`packages/core/test/feature-lifecycle.test.mjs`](../packages/core/test/feature-lifecycle.test.mjs) and [`packages/server/test/runtime.test.mjs`](../packages/server/test/runtime.test.mjs) |
| Idempotent shutdown with no additional disposal effects | [`packages/core/test/feature-lifecycle.test.mjs`](../packages/core/test/feature-lifecycle.test.mjs), [`packages/core/test/ecs.test.mjs`](../packages/core/test/ecs.test.mjs), and [`packages/server/test/runtime.test.mjs`](../packages/server/test/runtime.test.mjs) |
| Shared semantic movement state, fixed-dt command application, validation, and tick-addressable headless command input | [`packages/shared/test/movement.test.mjs`](../packages/shared/test/movement.test.mjs) |
| One-World headless Server Runtime, exactly 60 executions at tick 60, exact stepping to tick 600, bounded wall-clock pumping, rollback, and shutdown | [`packages/server/test/runtime.test.mjs`](../packages/server/test/runtime.test.mjs) |
| Equal serialized state for two fresh same-build Worlds after the same 600-command sequence | [`packages/server/test/runtime.test.mjs`](../packages/server/test/runtime.test.mjs) |
| Observable tick, schedule, backlog, discarded time, resource gauges, and bounded structured runtime errors | [`packages/core/test/telemetry.test.mjs`](../packages/core/test/telemetry.test.mjs) and [`packages/core/test/runtime-scheduling.test.mjs`](../packages/core/test/runtime-scheduling.test.mjs) |
| Public Core types and source/declaration boundaries | [`packages/core/test/public-types.ts`](../packages/core/test/public-types.ts) is compiled by `tsconfig.typecheck.json`; [`scripts/verify-workspace.mjs`](../scripts/verify-workspace.mjs) checks package shape, explicit exports, allowed dependencies, source and emitted declarations, and representative rejected imports. |

## Determinism limit

The Server integration test constructs two fresh Worlds through separate Runtime instances from the same
build, drives them with the same commands, and compares their serialized movement state after 600 exact
ticks. This verifies equal same-build results under the tested command sequence. It does not claim
cross-JavaScript-runtime, cross-engine, cross-platform, or bit-identical determinism.

## Deferred runtime scope

Client and Protocol package directories and public export boundaries exist, but their runtime behavior is
not part of Milestone 1. Client runtime behavior, Protocol schemas/codecs and runtime validation, networking,
rendering, and physics remain future work, beginning with the local browser slice in Milestone 2.
