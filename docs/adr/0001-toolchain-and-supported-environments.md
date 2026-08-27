# ADR 0001: Toolchain and supported environments

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

Milestone 0 must select one reproducible toolchain and one required CI environment before package or runtime work begins.
TypeScript output must run in both the headless Node runtime and the browser-facing package graph without a floating language target or an ambiguous CommonJS/ESM boundary.

The baseline review performed on the decision date identifies Node.js 24 as LTS, TypeScript 6.0 as current, pnpm 11 as the conservative package-manager line, and Playwright's bundled Chromium as the bounded browser-test choice.
The selection also has to keep Shared Simulation and Server packages free from browser dependencies while allowing DOM types only in client-facing code.

## Decision

The MVP adopts the following toolchain and required environment as one decision:

| Concern | Selected choice |
| --- | --- |
| Node.js | Node.js 24.x |
| Language | TypeScript 6.0 with `strict: true` |
| ECMAScript target | `ES2023` |
| Modules | Native ESM using TypeScript `module: "NodeNext"` and `moduleResolution: "NodeNext"` |
| Package manager | `pnpm@11.24.0`, pinned exactly when the root manifest is introduced |
| Required CI operating system | Ubuntu 24.04 x64 |
| Required CI browser | The Chromium revision bundled by Playwright |

`strict: true` applies to every package.
Client-specific TypeScript configurations may add DOM libraries; Core, Shared, Protocol, and Server configurations must not include DOM libraries merely to satisfy accidental imports.

Package output is ESM only.
Relative source imports use extensions that resolve to emitted `.js` files under Node's ESM rules.
Package manifests will declare ESM explicitly, and public package entrypoints will use the explicit export maps selected by [ADR 0002](./0002-workspace-package-graph-and-public-exports.md).

CI runs the Node and browser gates on Ubuntu 24.04 x64.
Only Playwright's bundled Chromium is required for MVP browser acceptance; no system-installed browser or additional Playwright engine is part of the required gate.

## Rationale

- Node.js 24 is the selected LTS major and is supported by Playwright.
- TypeScript 6.0 supplies current strict checking without requiring a floating compiler family.
- `ES2023` is a fixed, non-floating output contract supported by the selected runtime generation while avoiding output changes when a future `ESNext` definition advances.
- Native ESM and NodeNext resolution give Node execution, declaration resolution, and package import rules one explicit model.
- pnpm 11.24.0 is the verified exact pin on the selected major; pinning it makes local and CI installs agree.
- Ubuntu 24.04 x64 supplies one stable, reproducible CI platform rather than an unbounded operating-system matrix.
- Playwright's bundled Chromium keeps the browser binary aligned with the test runner and provides the independent contexts required by the normative two-client test.

## Consequences

- Local and CI verification must use Node 24 and the exact pnpm pin; version drift is a setup error rather than an implicit compatibility promise.
- CommonJS consumers do not receive a parallel CommonJS build during the MVP.
- Source imports must obey Node ESM extension and package-boundary rules.
- Browser acceptance proves behavior only in the bundled Chromium revision used by CI.
- macOS, Windows, Linux architectures other than x64, and other browser engines are not required support environments for the MVP.
- Exact application dependency versions belong in the future lockfile; this ADR selects TypeScript 6.0 but does not pin dependency patch versions in prose.
- Any future expansion of the module formats, browser matrix, or CI platform matrix requires evidence and a superseding ADR.

## Rejected alternatives

- **Node.js 22:** supported but older than the selected Node 24 LTS baseline, so carrying it would add a second runtime target without an MVP acceptance need.
- **Node.js 26:** Current rather than LTS at the decision date and therefore unsuitable as the production baseline.
- **A floating `ESNext` target:** its emitted-language meaning changes over time and would make upgrades alter the runtime contract implicitly.
- **`ES2022` or an earlier target:** adds downlevel constraints that the selected Node and CI browser do not require.
- **CommonJS or dual ESM/CommonJS output:** duplicates build, export, and consumer test surfaces without an MVP consumer requirement.
- **Bundler-only module resolution:** would hide import patterns that fail in the native ESM headless server and packed-consumer fixture.
- **npm or Yarn workspaces:** viable, but selecting another manager adds no acceptance value once pnpm is chosen and pinned.
- **pnpm 12:** rejected for the MVP because its rewrite was only one day old when the baseline was verified.
- **A multi-operating-system CI matrix:** increases cost before portability is an accepted MVP outcome.
- **System Chrome, Firefox, or WebKit as required browsers:** expands or destabilizes the gate; additional engines may be run diagnostically but do not establish support.

## Follow-up boundaries

This ADR intentionally does not choose the package graph, ECS, collision adapter, schema validator, WebSocket library, protocol details, scheduler phases, lifecycle contract, or public export shape.
The package graph and public export shape are selected by [ADR 0002](./0002-workspace-package-graph-and-public-exports.md); the other items remain separate Milestone 0 decisions.
Each future implementation must conform to the environment matrix without claiming that the still-unrecorded contracts already exist.
