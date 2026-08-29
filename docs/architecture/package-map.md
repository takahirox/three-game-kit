# Package map

This is the operational package contract selected by
[ADR 0002](../adr/0002-workspace-package-graph-and-public-exports.md). All five package directories
and their declared public export boundaries are implemented as the Milestone 5 release candidate.
The dependency, ownership, and public import rules below remain the normative package contract.

## Workspace boundary

The release candidate contains exactly five publishable packages:

| Workspace location | Package |
| --- | --- |
| `packages/core` | `@three-game-kit/core` |
| `packages/shared` | `@three-game-kit/shared` |
| `packages/protocol` | `@three-game-kit/protocol` |
| `packages/client` | `@three-game-kit/client` |
| `packages/server` | `@three-game-kit/server` |

The root is private. No deferred capability receives a placeholder package. Interaction remains
consumer-owned code outside workspace membership and workspace package globs, exercised through an
external packed-consumer fixture.

## Dependency and ownership map

An arrow means “depends on”:

```text
@three-game-kit/client ──┬──> @three-game-kit/core
                         ├──> @three-game-kit/shared ──> @three-game-kit/core
                         └──> @three-game-kit/protocol

@three-game-kit/server ──┬──> @three-game-kit/core
                         ├──> @three-game-kit/shared ──> @three-game-kit/core
                         └──> @three-game-kit/protocol
```

`core` and `protocol` have no workspace dependencies. Client and Server are sibling leaves and
never depend on one another.

| Package | Runtime role |
| --- | --- |
| `core` | Environment-neutral World/resources and Feature composition primitives |
| `shared` | Authority-neutral simulation rules and semantic movement state |
| `protocol` | Runtime-validation schemas and data-only wire types |
| `client` | Browser presentation, Three.js, device-to-semantic input, camera, assets, and client networking presentation |
| `server` | Headless authority, identity bindings, validation, fixed ticks, replication, and cleanup |

Shared and Server must never depend on Client, Three.js, DOM, WebXR, device input, camera, or audio.
Core and Protocol remain environment-neutral as well. Exact scheduler, lifecycle, and protocol
behavior is defined by the applicable normative contracts, not by this map.

## Public import map

These and only these module specifiers are public:

| Package | Root export | Public subpath exports |
| --- | --- | --- |
| `@three-game-kit/core` | `@three-game-kit/core` | None |
| `@three-game-kit/shared` | `@three-game-kit/shared` | `@three-game-kit/shared/movement` |
| `@three-game-kit/protocol` | `@three-game-kit/protocol` | None |
| `@three-game-kit/client` | `@three-game-kit/client` | `@three-game-kit/client/rendering`, `@three-game-kit/client/input`, `@three-game-kit/client/camera`, `@three-game-kit/client/collision`, `@three-game-kit/client/assets`, `@three-game-kit/client/networking`, `@three-game-kit/client/replication` |
| `@three-game-kit/server` | `@three-game-kit/server` | `@three-game-kit/server/collision`, `@three-game-kit/server/authoritative`, `@three-game-kit/server/networking` |

Each specifier resolves through an explicit non-wildcard export to ESM JavaScript and matching
TypeScript declarations. There are no CommonJS exports. Root exports provide primary composition;
they do not implicitly expose every public subpath.

All five packages are native ESM packages at version `0.1.0`. Each package includes its own
`README.md` and declares `UNLICENSED` metadata. The release candidate is evidenced by packing all
five packages, installing and exercising them from an external consumer outside the workspace, and
auditing the packed artifacts and release metadata. This evidence does not claim publication to a
package registry.

## Import rules

Allowed:

- relative imports that remain inside one package;
- cross-package imports through a public specifier in the table;
- browser and Three.js dependencies inside Client.

Forbidden:

- relative paths that cross package roots;
- workspace aliases in published code or the packed-consumer fixture;
- another package's `src`, `dist`, `internal`, tests, or unexported files;
- any unlisted package subpath or wildcard export;
- Client, Three.js, DOM, WebXR, device input, camera, or audio in Shared or Server;
- browser or Three.js dependencies in Core or Protocol;
- CommonJS `require` consumption.

An importable file is not necessarily public. Export-map membership is the only public-path test.
These rules apply equally to package source, examples, tests, emitted declarations, and external
fixtures.

## Required boundary evidence

| Check | Must reject |
| --- | --- |
| Source graph | Undeclared or reverse package edges, cross-root relative imports, deep imports, and forbidden runtime dependencies |
| Declaration graph | Internal/source paths, unlisted subpaths, undeclared dependencies, DOM/browser types outside Client, and implementation-library type leaks |
| Export inspection | Missing, extra, or wildcard exports; ESM/declaration mismatches; CommonJS targets |
| Packed consumer | Workspace/path-alias resolution, deep imports, failed Node 24 native-ESM use, and failed browser-facing build/test imports |

Both source and emitted declarations must pass; neither substitutes for the other. The external
fixture installs tarballs for all five packages from outside the workspace graph and uses only the
public import map.

## Version contract

The five packages share version `0.1.0` for the M5 release candidate and release together. They use
SemVer `0.y.z`:

- minor releases may break public APIs when release notes identify the break and migration;
- patch releases may not break the public surface or documented behavior of that minor line;
- internal, unexported paths carry no compatibility promise;
- adding or removing a public specifier or moving runtime ownership is breaking.

Independent package versioning requires a later ADR.
