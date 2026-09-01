# Milestone 5 verification

Milestone 5 consolidates the implemented M1-M4 gates with the Feature catalog and
package-archive release audits. The result is deliberately narrow: it certifies one
clean-checkout workflow on Ubuntu 24.04 x64, Node.js 24, exactly `pnpm@11.24.0`,
and the Chromium revision bundled with pinned `@playwright/test` 1.62.1. It does
not certify another operating system, architecture, Node major, package-manager
version, or browser.

## One clean-checkout CI-equivalent workflow

The following is the complete workflow implemented by
[`ci.yml`](../.github/workflows/ci.yml). Start with a clean checkout and run each
command from the repository root in this order:

```sh
# Host: Ubuntu 24.04 x64
# Checkout: actions/checkout@v4 with clean: true
# Runtime: actions/setup-node@v4 with node-version: '24', architecture: x64
corepack enable
corepack prepare pnpm@11.24.0 --activate
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium
pnpm verify:m5
```

This is one workflow, not a menu of alternatives. A developer-machine run is useful
local evidence, but only a candidate GitHub Actions run in the exact environment
above supplies the release CI record.

## Gate and script map

| Concern | Actual command or script reached by `pnpm verify:m5` |
| --- | --- |
| Reproducible install | `pnpm install --frozen-lockfile` in CI before the aggregate gate |
| Build | `pnpm run build` (`tsc -b`) through `pnpm verify` |
| Type checking | `tsc -p tsconfig.typecheck.json --noEmit`, `pnpm typecheck:m2-browser`, and `pnpm typecheck:m3-browser` |
| Unit and headless integration | `pnpm test:node`, including Client, Core, Protocol, Server, Shared, lifecycle, telemetry, deterministic-evidence, and authoritative tests |
| Real WebSocket integration | Networking and authoritative Server/Client tests in `pnpm test:node` exercise the real WebSocket transport |
| Browser acceptance | `pnpm test:m2-browser` and the one-worker, zero-retry `pnpm test:m3-browser` bundled-Chromium scenarios |
| Source, export, dependency, and declaration boundaries | `node scripts/verify-workspace.mjs` through `pnpm verify` |
| M4 catalog | `node scripts/verify-m4-catalog.mjs` |
| M4 packed outside-workspace consumer | `node scripts/verify-m4-packed-consumer.mjs` |
| M5 all-Feature catalog | `node scripts/verify-m5-catalog.mjs` |
| M5 package archives | `node scripts/verify-m5-release.mjs` |

The aggregate chain is `verify:m5` → `verify:m4` → `verify:m3` → `verify` and the
M2/M3 browser gates, followed by both M4 audits and both M5 audits. Consequently,
one successful `pnpm verify:m5` covers the M1 Core and lifecycle foundation, the M2
local browser Client slice, the M3 authoritative two-client real-WebSocket slice,
the M4 consumer-owned Interaction and packed-consumer boundary, and the M5 catalog
and release-archive checks. The milestone-specific contracts remain in
[`m1-verification.md`](./m1-verification.md),
[`m2-verification.md`](./m2-verification.md),
[`m3-verification.md`](./m3-verification.md), and
[`m4-verification.md`](./m4-verification.md).

## Browser and headless evidence

The M2 browser demo is [`examples/local-browser`](../examples/local-browser). Its
Playwright acceptance proves the local rendering, input, camera, collision, asset,
telemetry, rollback, and cleanup contract. The M3 browser demo is
[`examples/m3-browser`](../examples/m3-browser). Its canonical acceptance uses two
isolated Chromium contexts and one authoritative loopback Server over real
WebSockets. Headless Node tests cover the same public runtime components at focused
unit and integration boundaries, including protocol rejection, disconnect fencing,
Feature rollback, repeated shutdown, and zero-resource cleanup.

Playwright writes run output below `test-results/`. The M3 acceptance always creates
`evidence.json` with `testInfo.outputPath("evidence.json")` and attaches the same
sanitized JSON to the test result after cleanup. It contains the seven ordered
observations, Client A, Client B, Server, and harness cleanup records, rejection and
disconnect observations, and the deterministic application-message schedule. M2
assertions and any retained-on-failure trace are in the corresponding Playwright
test result. Console output from the M4 packed-consumer and M5 catalog/archive
scripts records their machine-readable summaries; their temporary pack directories
are intentionally removed and are not release artifacts.

## M5 catalog and archive audits

`test:m5-catalog` requires exactly fifteen sorted Feature catalog entries, including
the five Priority A common-gameplay entries. It checks their complete discovery metadata,
all twenty public Feature IDs, all 24 public
package specifiers, example paths, first-party factories, and the consumer ownership
of Interaction. The normative prose for the original client-only Features is
[`client-features.md`](./features/client-features.md), Priority S is documented in
[`standard-features.md`](./features/standard-features.md), and Interaction is documented
in [`interaction.md`](./features/interaction.md).
Priority A is documented in [`common-gameplay.md`](./features/common-gameplay.md).

`test:m5-release` builds five temporary package archives for Client, Core, Protocol,
Server, and Shared. It requires exactly five tarballs and audits each archive's
name, version `0.1.0`, exact description, public exports and emitted targets,
`README.md`, Node `24.x` engine, repository metadata, and `UNLICENSED` license field.
It rejects workspace/local dependency strings, package-internal source/test files,
unexpected top-level content, and missing declaration, JavaScript, or source-map
targets. This is an archive audit only: it neither publishes to a registry nor
grants a license.

## Release evidence

Use [`release-checklist.md`](./release-checklist.md) for a candidate. Local criteria
are machine-verifiable with `pnpm verify:m5`. The candidate commit, GitHub Actions
run, and artifact URL must be recorded only after that candidate run exists; this
document does not claim that such a run has been archived.
