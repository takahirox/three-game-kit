# ADR 0003: Minimal kit-owned ECS

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

Milestone 0 must choose the ECS contract before the headless kernel is implemented. The bounded
vertical slice needs runtime-local entity identity, focused component state, all-of iteration,
World-scoped shared resources, and cleanup semantics that cooperate with the later scheduler and
Feature lifecycle decisions. It does not need a general-purpose ECS framework.

bitECS 0.4 is a small TypeScript ECS with no dependencies, but 0.4 is a complete rewrite and its
public vocabulary and release evolution would become another compatibility surface. The required
slice is smaller than that surface. The kit also must keep ECS types stable across Core, Shared,
Client, Server, and the external Feature fixture without exposing a dependency's types.

## Decision

The MVP will use a deliberately tiny ECS written in TypeScript and owned by Three Game Kit. The ECS
contract is public from the existing `@three-game-kit/core` root entrypoint selected by ADR 0002.
No third-party ECS package or third-party ECS type is part of the MVP implementation or public API.

### Public API boundary

The ECS portion of the Core public API consists of these kit-owned symbols:

| Symbol | Contract |
| --- | --- |
| `EntityId` | Opaque runtime-local entity identity. Consumers can compare and store it but cannot construct it or perform numeric operations on it. |
| `ComponentType<T>` and `defineComponent<T>(name)` | A typed identity token declared by a Feature. The name is diagnostic only; the token carries no runtime field schema, default value, serializer, or storage layout. |
| `ResourceType<T>` and `defineResource<T>(name)` | A typed identity token for one World-scoped shared value. It is not a component or singleton entity. |
| `World` and `createWorld()` | The sole owner and access boundary for entities, components, queries, and shared resources. |

`World` exposes only the following ECS capabilities:

| Area | Operation and result |
| --- | --- |
| Entity lifecycle | `createEntity() -> EntityId`; `destroyEntity(entity) -> boolean`; read-only `entityCount` |
| Components | `addComponent(entity, type, value) -> void`; `removeComponent(entity, type) -> boolean`; `hasComponent(entity, type) -> boolean`; `getComponent(entity, type) -> T | undefined` |
| Queries | `queryAll(type, ...types) -> readonly EntityId[]` for the non-empty intersection of the supplied component types |
| Shared resources | `addResource(type, value) -> void`; `removeResource(type) -> boolean`; `hasResource(type) -> boolean`; `getResource(type) -> T | undefined` |
| World lifecycle | `dispose() -> void` |

These are API declarations, not an implementation prescription. Component and resource tokens are
normally declared once with static Feature declarations. Defining a token establishes identity
only; it does not register or mutate a runtime schema.

Adding an already-present component or resource is an error rather than an implicit replacement.
Adding a component to a destroyed entity is also an error. Removing an absent component or
resource returns `false`; removing one that exists returns `true`. A destroyed, formerly valid
entity returns `false` from `hasComponent`, `undefined` from `getComponent`, and `false`
from a repeated destroy or remove. A forged entity ID or an ID belonging to another World is
rejected. Component and resource operations are synchronous, and `get` returns the stored value,
not a copy.

### Identity, iteration, and mutation order

Each World allocates entity IDs in ascending creation order and never reuses an ID during that
World's lifetime. An EntityId is not a protocol identity and has no meaning in another World;
network-visible identifiers require an explicit runtime-owned mapping.

Every `queryAll` call captures a read-only snapshot of the entities that have all requested
components at the instant of the call. The snapshot contains each matching entity once in ascending
entity-creation order. Component insertion order does not affect it. Adding or removing components
or destroying entities while iterating cannot insert, remove, or reorder entries in that snapshot.
A later query observes those structural changes. If an entity from a snapshot is destroyed or loses
a component before it is visited, normal `hasComponent` and `getComponent` results expose that
change.

All mutations are visible immediately after the operation returns. Consequently, when the scheduler
runs systems serially, a later system's query and reads observe changes made by earlier systems in
the same tick. This ADR does not select scheduler phases, priorities, or Feature ordering; it
provides the stable entity traversal and visibility rules on which that later decision can rely.

### World and cleanup ownership

A runtime host creates and owns each World. The authoritative Server owns its World; each Client or
headless test World is separate. There is no process-global default World, and Features and systems
borrow a World without acquiring the right to dispose it.

Destroying an entity removes all of its component associations before the entity becomes invalid.
Removing a component or resource and disposing a World release ECS-held references but do not call
arbitrary user destructors. A Feature remains responsible for disposing external objects it owns,
then removing its components and resources during rollback or shutdown. After Feature teardown, the
runtime owner calls `World.dispose()`, which removes every remaining entity, component, and
resource and sets `entityCount` to zero. World disposal is idempotent; other World operations after
disposal are rejected.

Shared resources are values stored once per ResourceType in one World. They are accessed only
through that World's add/remove/has/get operations, are never global, and are neither implicitly
copied nor synchronized between Worlds. Resource enumeration and ordered resource iteration are not
part of the API.

## Deliberate exclusions

The MVP ECS has no hierarchy, parent/child model, relations, observers, change subscriptions,
serialization framework, query DSL, OR/NOT queries, jobs, multithreading, dynamic schema,
reflection registry, actor classes, or automatic behavior-bearing entity objects. It exposes no
third-party ECS types. It also makes no promise of cross-runtime, cross-engine, or bit-identical
determinism.

Promises and asynchronous ECS operations are excluded. Systems execute synchronously against one
World; asynchronous work must complete outside an ECS step and be applied later through an explicit
scheduler-owned boundary. Stable query order makes same-build tests inspectable, but floating-point
math, collision behavior, application code, and runtime differences remain outside this ordering
guarantee.

## Consequences

- The public surface matches the vertical slice and external Interaction proof without committing
  the project to a general ECS framework.
- The kit owns correctness, tests, documentation, and maintenance for entity allocation, component
  storage, queries, resources, and cleanup.
- Consumers receive stable kit-owned types across package boundaries and do not inherit bitECS
  release or declaration changes.
- Snapshot queries allocate bounded temporary results unless a future internal optimization
  preserves the exact observable semantics. No performance or capacity claim is made before M1
  evidence exists.
- Component and resource values define their own data shapes and disposal needs. The ECS provides
  identity and storage, not schema validation, serialization, replication, or automatic teardown.
- Immediate mutation visibility and ascending snapshot order support serial scheduler correctness,
  but they are not a deterministic-lockstep claim.

## Replacement boundary

All other packages and external Features may depend only on the Core symbols and semantics defined
above. They must not import bitECS or any other backend type, rely on an internal storage layout, or
treat EntityId as a wire-format identifier.

A future implementation may replace the internal storage strategy, or may place a third-party ECS
behind Core, only if the public types, failure behavior, cleanup rules, query membership snapshots,
and iteration order remain unchanged. A change to any of those observable contracts requires a
superseding ADR and the breaking-version treatment defined by ADR 0002. Because serialization is not
an ECS responsibility, this boundary does not promise migration of persisted World internals.

## Rejected alternatives

- **bitECS 0.4 as the public or direct MVP ECS:** it provides more API and release surface than the
  vertical slice needs, and its rewrite makes that external surface an unnecessary M0 commitment.
  The replacement boundary leaves room to evaluate it internally later with M1 evidence.
- **A broad kit-owned ECS framework:** hierarchy, relations, observers, schema machinery, query
  language, jobs, and parallel execution would be speculative architecture.
- **Actor classes as the gameplay state model:** behavior-bearing entities couple state and system
  execution and undermine the required shared composition model.
- **Different ECS APIs per runtime:** they would duplicate rules and prevent Shared Features from
  composing against one public Core contract.

## Milestone 1 verification obligations

M1 must add objective automated evidence for this decision:

1. Type and export checks show that the ECS surface is available only through the documented Core
   root entrypoint and that emitted declarations contain no third-party ECS type.
2. Operation tests cover create/destroy, add/remove/has/get, duplicate-add errors, stale and foreign
   entity handling, entity count, and resource isolation across two Worlds.
3. All-of query tests cover one and multiple component types, exclusion of partial matches,
   ascending creation order independent of component insertion order, and no duplicate entities.
4. A mutation-during-iteration test proves snapshot membership and order do not change, while a
   subsequent query and later serial system observe the mutation immediately.
5. Entity destruction proves all components become unreachable, IDs are not reused, and repeated
   destruction is harmless. Feature teardown followed by two World disposal calls leaves zero
   entities, components, resources, and ECS-held test references.
6. Exact stepping runs each registered once-per-tick system exactly 60 times for 60 ticks and proves
   that later systems see earlier systems' writes in the documented order.
7. Given identical commands and the same runtime build, two fresh Worlds produce equal
   fixture-owned test state after 600 exact ticks. That fixture comparison is not an ECS
   serialization facility and must not be reported as cross-runtime bit-identical determinism.
8. Dependency and declaration checks prove that M1 has no third-party ECS runtime dependency and
   that Shared, Client, Server, Protocol, and the external fixture consume only kit-owned Core ECS
   types.
