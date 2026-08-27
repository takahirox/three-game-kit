# ADR 0002: Workspace package graph and public exports

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

Milestone 0 must freeze the smallest package graph that preserves the Core, Shared Simulation,
browser Client, headless Server, and wire Protocol boundaries. Ordinary consumers must be able to
install packed artifacts and use documented ESM entrypoints without workspace aliases or internal
imports.

The package decision must keep authority-neutral and headless code free of browser presentation
dependencies while avoiding a package for every Feature. It defines packaging boundaries only.
Scheduler phases, lifecycle behavior, and protocol fields and validation rules remain contracts for
later Milestone 0 decisions.

## Decision

### Workspace membership

The initial workspace has exactly five publishable packages:

1. `@three-game-kit/core`
2. `@three-game-kit/shared`
3. `@three-game-kit/protocol`
4. `@three-game-kit/client`
5. `@three-game-kit/server`

Their future workspace locations are `packages/core`, `packages/shared`, `packages/protocol`,
`packages/client`, and `packages/server`. The repository root is private orchestration, not a
publishable package. No package may be added for a deferred capability or merely to reserve a name.

Interaction is not a sixth workspace package. It remains consumer-owned code in an external,
non-workspace packed-consumer fixture through Milestone 4. That fixture must install tarballs for
the five packages and must not be matched by workspace package globs or use workspace aliases.

### Dependency graph

An arrow below means “depends on.” These are the only allowed direct workspace dependencies:

| Package | Direct workspace dependencies |
| --- | --- |
| `@three-game-kit/core` | None |
| `@three-game-kit/shared` | `@three-game-kit/core` |
| `@three-game-kit/protocol` | None |
| `@three-game-kit/client` | `@three-game-kit/core`, `@three-game-kit/shared`, `@three-game-kit/protocol` |
| `@three-game-kit/server` | `@three-game-kit/core`, `@three-game-kit/shared`, `@three-game-kit/protocol` |

Equivalently:

```text
client -> core, shared, protocol
server -> core, shared, protocol
shared -> core
protocol -> (none)
core -> (none)
```

The table is normative. The graph is acyclic; Client and Server are sibling leaves and cannot
depend on each other.

### Runtime ownership

| Package | Owns | Must not own or expose |
| --- | --- | --- |
| `core` | Environment-neutral World/resource and Feature composition primitives | Browser, rendering, transport, game-specific, or wire-format behavior |
| `shared` | Authority-neutral simulation rules and semantic movement state used by more than one runtime | Authority, presentation, physical device input, or transport |
| `protocol` | Runtime-validation schemas and data-only public wire types | World state, runtime orchestration, transport connections, or presentation |
| `client` | Browser presentation, Three.js rendering, physical-to-semantic input, camera, assets, prediction presentation, reconciliation, and remote interpolation | Multiplayer authority or server-owned identity |
| `server` | Headless authoritative runtime composition, connection/player/entity ownership, ingress validation, fixed-tick execution, replication, and disconnect cleanup | Presentation or physical device handling |

Shared and Server must not depend on Client, Three.js, DOM, WebXR, device input, camera, or audio.
Core and Protocol are also environment-neutral and must not introduce those dependencies. Only
Client may own browser and Three.js integration.

The exact scheduler/lifecycle semantics and the exact protocol envelopes, limits, and disconnect
rules are intentionally not specified here; their later Milestone 0 contracts must respect this
ownership table.

### Public entrypoints

The complete initial public module-specifier set is:

| Package | Public specifiers |
| --- | --- |
| `@three-game-kit/core` | `@three-game-kit/core` |
| `@three-game-kit/shared` | `@three-game-kit/shared`, `@three-game-kit/shared/movement` |
| `@three-game-kit/protocol` | `@three-game-kit/protocol` |
| `@three-game-kit/client` | `@three-game-kit/client`, `@three-game-kit/client/rendering`, `@three-game-kit/client/input`, `@three-game-kit/client/camera`, `@three-game-kit/client/collision`, `@three-game-kit/client/assets`, `@three-game-kit/client/networking` |
| `@three-game-kit/server` | `@three-game-kit/server` |

Root entrypoints contain each package's primary composition surface. The Shared movement subpath
contains only the authority-neutral movement slice. Client capability subpaths keep browser
adapters discoverable without creating more packages. Exact exported symbol names are selected
with the later contracts and implementations; they may not create additional module specifiers
without superseding this ADR.

Every listed specifier must map through an explicit, non-wildcard export to ESM JavaScript and its
matching emitted TypeScript declaration. There is no CommonJS condition or build. A root export
does not make an unlisted subpath public, and a subpath is not required to be re-exported from its
package root.

### Internal paths and package consumption

- Code inside one package may use relative imports within that package.
- Cross-package imports must use one of the public specifiers above.
- Relative imports that cross a package root, workspace aliases in shipped code, and imports from
  another package's `src`, `dist`, `internal`, test, or other unexported path are forbidden.
- Paths containing an `internal` segment and all paths absent from the export list are private,
  regardless of whether a development tool can resolve them.
- Examples, tests, declarations, and fixtures are consumers of the same public surface and receive
  no deep-import exception.

Published output is ESM-only under the NodeNext rules selected by ADR 0001. The packed-consumer
fixture must install the five tarballs into a directory outside the workspace graph, typecheck and
run under Node.js 24, and exercise browser-facing imports through the selected browser build/test
path. It may not use source paths, TypeScript path aliases, or a CommonJS `require`.

### Boundary verification

Implementation milestones must add automated failures for all of the following:

1. Source imports that violate the dependency table, cross package roots relatively, or target
   anything other than a listed public specifier.
2. Any Shared or Server source reference to Client, Three.js, DOM, WebXR, device input, camera, or
   audio; the same environment-neutral restriction applies to Core and Protocol.
3. Emitted declarations that name an undeclared workspace dependency, a forbidden environment
   type, a source/internal path, or an unlisted package subpath.
4. Export-map drift: missing listed exports, wildcard or extra exports, mismatched ESM/declaration
   targets, or a CommonJS target.
5. A packed-consumer install, typecheck, build, or execution that resolves through the workspace,
   reaches an internal path, or fails native ESM consumption.

Checks must inspect both source import graphs and emitted `.d.ts` graphs. Passing one is not
evidence for the other.

### Versioning before 1.0

All five public packages use SemVer and begin on `0.y.z` versions. Before 1.0:

- a minor release may make a breaking change to a documented public export, but must identify the
  break and migration in release notes;
- a patch release must remain backward-compatible with the public exports and behavior of its
  corresponding minor release;
- unexported internal paths have no compatibility guarantee;
- changing the public specifier set or moving ownership across packages is a breaking change.

The five packages are versioned and released together during the MVP so their package versions
match. Moving to independent versioning requires a later ADR.

## Consequences

- Consumers have five installation and version units, while Client capabilities remain subpaths
  until independent versioning is justified.
- Core, Shared, and Protocol can be used without browser or Three.js dependencies; Server remains
  headless.
- Protocol can evolve without depending on runtime implementations, and Shared rules remain
  reusable in Client and Server.
- Adding a public subpath, workspace package, reverse dependency, or CommonJS output requires an
  explicit decision rather than accidental publication.
- The packed fixture and declaration checks make packaging part of acceptance, not merely a build
  artifact.

## Rejected alternatives

- **One package:** permits accidental client or browser dependencies to leak into headless use and
  makes runtime ownership harder to enforce.
- **A package per Feature or adapter:** creates versioning and graph overhead before independent
  release needs are demonstrated.
- **Interaction as a sixth workspace package:** fails to prove that an external packed consumer can
  implement a cross-runtime Feature using only public APIs.
- **Client depending on Server or Server depending on Client:** creates a runtime cycle and erases
  the authority/presentation boundary.
- **Wildcard exports or public internals:** make the supported surface accidental and prevent
  reliable boundary enforcement.
- **CommonJS or dual output:** duplicates the module and consumer surfaces without an MVP need.
