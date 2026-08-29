# Milestone 4 verification

Milestone 4 validates public extensibility with one optional, consumer-owned
Interaction Feature. The evidence below is limited to the implemented Node and
packed-consumer surfaces. It makes no browser Interaction claim. Milestone 5,
including the clean-checkout release workflow and consolidated release evidence,
remains.

## Objective evidence

### Authoritative server Interaction

[`packages/server/src/authoritative.ts`](../packages/server/src/authoritative.ts)
implements authoritative Interaction ingress, connection and ownership gates,
sequence and tick validation, configured-target and finite-range validation,
gameplay-phase application, snapshot replication, rejection telemetry, and
idempotent cleanup. The nine focused tests in
[`packages/server/test/authoritative-interaction.test.mjs`](../packages/server/test/authoritative-interaction.test.mjs)
cover deterministic two-connection application, adapter absence and rejection,
ownership and duplicate sequence rejection, adapter failures, invalid and detached
snapshots, and double shutdown.

### Client semantic intent and presentation

The Client replication surface queues semantic Interaction intent without movement
prediction and presents the latest authoritative interactable snapshot exactly. The
five focused tests in
[`packages/client/test/interaction.test.mjs`](../packages/client/test/interaction.test.mjs)
cover queueing and acknowledgement retirement, rejection retirement and sequence
reuse, synchronous invalid-target rejection, latest/sorted/detached presentation
including removal, and idempotent shutdown.

### External consumer fixture

The fixture under [`examples/external-interaction-consumer`](../examples/external-interaction-consumer)
contains the client-only example, the cross-runtime Interaction Feature, and its
consumer test. Its six tests cover documented metadata and strict configuration;
missing-dependency and conflict graph failures; invalid configuration; forced setup
rollback; zero-resource and double-shutdown lifecycle behavior; one authoritative
toggle presented by two clients; deterministic rejection boundaries; removal of
Interaction while base movement remains runnable; and borrowed-resource ownership.

### Packed public boundary

[`scripts/verify-m4-packed-consumer.mjs`](../scripts/verify-m4-packed-consumer.mjs)
builds and packs all five public packages, installs the five local tarballs into a
temporary copy outside the workspace graph, validates 16 resolved exports, scans
three fixture code files and 17 imports, then passes the consumer TypeScript build
and all six consumer tests. Kit dependencies, including transitive kit references,
are pinned to the five local `file:` tarballs. Third-party dependencies may use the
package-manager registry fallback when they are not available from its local store;
that fallback does not apply to kit packages.

## Discovery, contracts, and compatibility

- [`docs/features/catalog.json`](./features/catalog.json) is the machine-readable
  catalog entry for purpose, runtimes, dependencies, conflicts, configuration,
  phases, authority, limitations, public imports, examples, and verification.
- [`docs/features/interaction.md`](./features/interaction.md) is the normative
  Interaction contract, including intent, authority, replication, lifecycle,
  rejection reasons, ownership, and scope.
- [`docs/authoring/cross-runtime-interaction.md`](./authoring/cross-runtime-interaction.md)
  documents the complete external server/client composition.
- [`docs/authoring/client-only-feature.md`](./authoring/client-only-feature.md)
  documents the minimal external client-only Feature.
- [`docs/adr/0002-workspace-package-graph-and-public-exports.md`](./adr/0002-workspace-package-graph-and-public-exports.md)
  defines the public export and pre-1.0 SemVer policy. All five packages share one
  release version: a `0.y.0` release may make a documented breaking change with
  migration guidance, while a patch must preserve the public surface and behavior
  of its minor line. The fixture declares compatibility as `^0.1.0`.

## M4 exit-criterion traceability

| Exit criterion | Files | Objective command |
| --- | --- | --- |
| The outside-workspace fixture installs only packed artifacts, builds without aliases or deep imports, and runs both documented examples through public exports. | [`scripts/verify-m4-packed-consumer.mjs`](../scripts/verify-m4-packed-consumer.mjs), [`examples/external-interaction-consumer/package.json`](../examples/external-interaction-consumer/package.json), fixture `src` and `test` files | `node scripts/verify-m4-packed-consumer.mjs` |
| An in-range intent toggles authoritative state once and reaches both clients; out-of-range, wrong-owner, malformed, and duplicate-sequence attempts preserve state and report the documented reasons. | [`packages/server/src/authoritative.ts`](../packages/server/src/authoritative.ts), [`packages/server/test/authoritative-interaction.test.mjs`](../packages/server/test/authoritative-interaction.test.mjs), [`examples/external-interaction-consumer/test/m4.test.mjs`](../examples/external-interaction-consumer/test/m4.test.mjs) | `node --test packages/server/test/authoritative-interaction.test.mjs` and `node scripts/verify-m4-packed-consumer.mjs` |
| Removing Interaction leaves base movement buildable and runnable, and Core has no Interaction-specific branch or type. | [`examples/external-interaction-consumer/test/m4.test.mjs`](../examples/external-interaction-consumer/test/m4.test.mjs), [`examples/external-interaction-consumer/src/interaction-feature.ts`](../examples/external-interaction-consumer/src/interaction-feature.ts), [`packages/core`](../packages/core) | `node scripts/verify-m4-packed-consumer.mjs` and `pnpm typecheck` |
| Forced setup failure and two normal shutdown calls leave zero Feature-owned resources and do not dispose borrowed host objects. | [`examples/external-interaction-consumer/test/m4.test.mjs`](../examples/external-interaction-consumer/test/m4.test.mjs), [`packages/server/test/authoritative-interaction.test.mjs`](../packages/server/test/authoritative-interaction.test.mjs), [`packages/client/test/interaction.test.mjs`](../packages/client/test/interaction.test.mjs) | Both focused `node --test` commands and `node scripts/verify-m4-packed-consumer.mjs` |
| The catalog exposes every required discovery and composition field without requiring package-internal inspection. | [`docs/features/catalog.json`](./features/catalog.json), [`docs/features/interaction.md`](./features/interaction.md), [`docs/authoring/cross-runtime-interaction.md`](./authoring/cross-runtime-interaction.md), [`docs/authoring/client-only-feature.md`](./authoring/client-only-feature.md) | `node scripts/verify-m4-packed-consumer.mjs` |

## Verification commands

Run from the repository root:

```sh
pnpm run build
node --test packages/server/test/authoritative-interaction.test.mjs
node --test packages/client/test/interaction.test.mjs
pnpm typecheck
node scripts/verify-m4-packed-consumer.mjs
git diff --check
```

`pnpm verify:m4` is the wired aggregate: it runs the complete M3 verification, the M4 catalog/boundary verifier, and the packed-consumer verifier.
