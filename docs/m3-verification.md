# Milestone 3 verification

## Outcome

Milestone 3 is complete. One authoritative headless Server supports two isolated browser Clients over
real loopback WebSockets with Protocol v1 runtime validation, server-owned identity and authority,
owner prediction and reconciliation, snapshot-only peer interpolation, deterministic rejection
telemetry, disconnect fencing, and idempotent zero-resource shutdown.

The accepted run completed **158/158 Node/WebSocket tests**, workspace/export/declaration boundary
verification, the M3 browser typecheck, and **1/1 canonical two-context browser test**.

## Public runtime surface

M3 extends the declared package exports rather than exposing test or vendor internals:

- `@three-game-kit/protocol` supplies the versioned Protocol v1 envelopes, strict codecs, bounds, and
  structured rejection reasons.
- `@three-game-kit/server/authoritative`, `/networking`, and `/collision` supply the authoritative
  command pipeline, real WebSocket transport, replication, validation, telemetry, and private Rapier
  collision ownership.
- `@three-game-kit/client/networking` and `/replication` supply the Client connection lifecycle,
  prediction, reconciliation, snapshot buffering, and remote interpolation integrated with the public
  Client Runtime phases.

The workspace gate verifies package shape, explicit exports, allowed dependencies, representative
forbidden imports, and emitted declarations. The acceptance harness uses documented application
controls and detached observations; it does not make package internals part of the public contract.

## Supported verification environment

The normative matrix remains [supported environments](./supported-environments.md): Ubuntu 24.04 x64,
Node.js 24.x, TypeScript 6.0 with strict checking, exactly `pnpm@11.24.0`, native ESM/NodeNext with
ES2023 output, and the Chromium revision bundled with pinned `@playwright/test` 1.62.1. Bundled
Chromium is the sole required MVP browser; other browsers, operating systems, and architectures are
not certified by this result.

## How to verify

From the repository root, install the pinned dependency graph and run the complete M3 gate:

```sh
pnpm install --frozen-lockfile
pnpm verify:m3
```

`verify:m3` builds and type-checks the workspaces and public fixtures, runs the Node/WebSocket suite,
verifies workspace/export/declaration boundaries, type-checks `examples/m3-browser`, and runs the
single canonical Chromium test with one worker and no retries.

To reproduce only the normative browser scenario, use the command recorded by the test and evidence:

```sh
pnpm exec playwright test tests/acceptance/two-client.spec.ts --project=m3-bundled-chromium --workers=1 --retries=0 --grep "M3 canonical two-client authoritative loopback"
```

## Canonical eight-step scenario

The executable contract and all detailed gates are normative in
[deterministic two-client acceptance](./testing/two-client-acceptance.md). Its stable ordered steps are:

1. `01 boot real isolated topology` — start one real loopback Server and two fresh browser contexts;
   prove distinct identities, storage isolation, and distinct private Client A, Client B, and Server
   Rapier ownership with equal detached scene values.
2. `02 predict owner on next injected frame` — A's next explicit frame presents local movement before
   Server ingress or any snapshot; the capsule surface is at most x = 2.001 and within 0.011 m of the
   wall, while B consumes no peer command.
3. `03 step 60 server ticks and present peer snapshots` — step with dt = 1/60 second, obtain exactly 20
   snapshot opportunities at ticks divisible by three, preserve the 2.001/0.011 m collision bounds,
   reconcile A, and present B from authoritative snapshots without extrapolation.
4. `04 reconcile forced authority within 500 injected ms` — snap simulation to authority within
   0.000001 m in one reconcile, then require finite non-increasing presentation-only error no greater
   than 0.05 m at 500 injected ms.
5. `05 reject invalid ingress without authority mutation` — exercise malformed JSON, unknown kind,
   tick-window, ownership, and 10.000001 m/s movement-limit failures; each changes only its documented
   counter and one expected structured error.
6. `06 reject base interaction by phase` — reject the sole Interaction input as `phase-invalid`, with
   no sequence admission or authority mutation.
7. `07 fence disconnect and preserve peer` — purge A's pending command as `stale-connection`, remove
   A's binding/avatar/capsule by disconnect tick D + 2, prevent stale recreation, and prove B remains
   joined and functional.
8. `08 shutdown twice with zero resources` — shut down A, B, and Server twice with identical stored
   results, no second-call mutation, complete zero live-resource gauges, and no unexpected uncaught,
   unhandled, page, console, or structured runtime errors.

The deterministic injector uses `xorshift32-v1`, seed 1592590343 (`0x5eed0007`), 100 ms base RTT split
equally by direction, inclusive 0–20 ms per-message jitter, and zero drop rate. Injected time, exact
simulation steps, and explicit presentation frames are independent; wall time is not gameplay evidence.

## Evidence artifact

The test always writes `testInfo.outputPath("evidence.json")` after cleanup. The detached JSON manifest
has `schemaVersion` 1, `status`, and `firstFailedInvariant` (not `firstFailure`). It contains observations
in the required order `OP-01` through `OP-07`, cleanup records named `clientA`, `clientB`, `server`, and
`harness`, and the deterministic complete application-message schedule.

Evidence is bounded, sanitized, detached JSON: it redacts loopback ports and excludes raw malformed
payloads, sockets and HTTP/WebSocket objects, vendor objects, Zod issues, Rapier handles, stacks,
credentials, addresses, and full URLs. The first failure is preserved. A passing manifest must satisfy
the completeness gates of exactly seven ordered observations, all four cleanup records, cleanup
assertions, and successful serialization.

Writing uses an exclusively created temporary file with mode `0600`, followed by file `fsync` and an
atomic rename. The generated `test-results` evidence is a run artifact and is not committed.

## Explicit exclusions

Production authentication, client-selected ownership, reconnect/resume, matchmaking, persistence,
lag compensation, rollback netcode, nonzero-loss service guarantees, alternate transports,
cryptographic anti-replay, anti-DDoS, and comprehensive anti-cheat are excluded from M3.
