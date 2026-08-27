# Feature composition and lifecycle contract

- **Status:** Accepted
- **Milestone:** M0
- **Applies to:** static Feature composition in Core, Client Runtime, Server Runtime, and headless tests

## Purpose and scope

This document is the accepted product contract for Feature identity, configuration, dependency
resolution, setup, ownership, rollback, and shutdown in the bounded MVP. A runtime receives one
complete ordered Feature list and one configuration input before boot. That list is immutable for
the lifetime of the runtime.

The contract is deliberately a static boot contract. It supplies enough composition for the
headless kernel, local browser slice, authoritative multiplayer slice, and external Interaction
proof without defining a plugin solver or a dynamic runtime.

## Feature descriptor

A Feature descriptor has exactly these fields and no others:

| Field | Contract |
| --- | --- |
| id | Stable, non-empty, case-sensitive Feature ID with no leading or trailing whitespace. |
| description | Non-empty human-readable purpose and boundary; it has no resolver semantics. |
| runtimeContributions | Ordered, immutable declarations of systems, resources, hooks, mailboxes, or other runtime-visible contributions. |
| requires | Ordered, immutable list of required Feature IDs. |
| conflicts | Ordered, immutable list of Feature IDs that cannot coexist with this Feature. |
| configuration | Exactly one kit-owned configuration parser/default provider. |
| setup | The single setup callback. |
| dispose | The single disposal callback. |

IDs are identity, not display labels or provider names. An ID remains stable across compatible
revisions; renaming it is a breaking public contract. An ID cannot be an alias, version range,
capability request, or package specifier. A Feature cannot require or conflict with itself, and
each requires and conflicts list contains no duplicate ID.

runtimeContributions is declarative. Each contribution has a stable ID, a supported runtime and
kind, and the static scheduling or publication data required by that kind. A scheduled system
declares exactly one accepted domain and phase, a signed safe-integer priority, and its position in
runtimeContributions. Contribution validation follows the accepted scheduler contract. The list
does not itself activate a system or acquire a resource.

The descriptor has no capabilities, optional requirements, provider claims, compatibility solver
metadata, enable predicate, replacement hook, remove hook, version negotiation, arbitrary ordering
edge, or custom configuration validator field.

### Configuration provider

configuration is one value created by the kit-owned Feature configuration facility. It is both the
only parser and the only default provider for that Feature. A descriptor cannot combine a schema,
a second parser, a second default source, or setup-time fallback logic.

The provider is synchronous, deterministic, side-effect-free, and runtime-independent. Given the
same input it returns the same fresh, immutable, kit-owned configuration value or the same bounded
issues. It cannot read a World, clock, environment variable, another Feature, or runtime service,
and it cannot return a Promise.

The runtime configuration input is a map keyed by Feature ID. A key that is not present in the
declared Feature list is unknown configuration and is rejected. If a Feature key is absent, its
provider supplies a complete fresh default and validates that default. If the key is present, the
provider parses that value; defaults for omitted fields may be applied only by that same provider.
Unknown fields at every configured object depth are rejected. Coercion, stripping, passthrough
fields, setup-time reparsing, and silent fallback after an invalid value are forbidden.

No setup callback is invoked until every declared Feature configuration has either parsed
successfully or produced a validated default.

## Resolution and preflight validation

The runtime records each Feature's zero-based position in the caller's original Feature list as its
declaration index. It does not sort the input or discover additional Features.

Preflight performs all of these checks before the first setup callback:

1. Validate descriptor shape, stable IDs, list uniqueness, contribution shape, supported runtime,
   scheduler domain, phase, priority, and contribution ID.
2. Reject duplicate Feature IDs and duplicate runtime contribution or system IDs in the composed
   runtime.
3. Reject every required ID absent from the original list.
4. Reject every dependency cycle.
5. Reject the composition when either member declares the other in conflicts.
6. Reject unknown Feature configuration keys and every invalid Feature configuration value or
   default.
7. Produce and freeze the dependency order, parsed configuration map, contribution inventory, and
   scheduler input.

A validation run may report multiple independent failures. Their order is deterministic: declaration
index, then the declaration position of the relevant requirement, conflict, contribution, or
configuration issue, then stable failure code. No validation failure is hidden by partial setup.

Dependency edges point from a required Feature to its dependent. Resolution uses stable Kahn
topological sorting. Whenever more than one node is eligible, the node with the lowest original
Feature declaration index is selected. Original Feature declaration order is the sole tie-breaker:
Feature ID spelling, requirement-list order, package order, discovery timing, and callback timing
never break a tie. The resulting order is the setup order.

A conflict is pairwise and directional declaration is sufficient: if A lists B or B lists A, both
cannot be in the same runtime. A requirement does not auto-enable an absent Feature.

## Lifecycle states

A runtime lifecycle has exactly these observable states:

| State | Meaning |
| --- | --- |
| created | The host exists, but validation and setup have not begun. |
| validating | The complete descriptor graph, configuration, contributions, and schedules are being checked and frozen. |
| setting-up | Valid Features are being set up serially in resolved order; no tick or frame may run. |
| running | All Feature setups committed, contributions and schedules are frozen, and runtime work may run. |
| rolling-back | Boot failed or was cancelled; uncommitted ownership is being released and completed Features are being disposed. |
| shutting-down | A running or never-started runtime is performing terminal normal shutdown. |
| stopped | Terminal result is cached; no runtime or Feature work can begin. |

The complete legal transition set is:

| From | To | Cause |
| --- | --- | --- |
| created | validating | Boot begins. |
| created | shutting-down | Shutdown is requested before boot. |
| validating | setting-up | All preflight checks succeed. |
| validating | stopped | Any preflight check fails. |
| setting-up | running | Every setup callback completes and commits. |
| setting-up | rolling-back | Setup fails or a shutdown request cancels boot. |
| rolling-back | stopped | Rollback and all cleanup attempts finish. |
| running | shutting-down | Normal shutdown begins. |
| shutting-down | stopped | All shutdown cleanup attempts finish. |

There are no other transitions. In particular, stopped is terminal; restart, return to created,
and running-to-setting-up are illegal. Validation is synchronous and non-reentrant. A lifecycle call
made reentrantly from validation returns a structured busy-state failure and causes no transition.

State changes are committed before their transition record is emitted. Entering rolling-back or
shutting-down flips the runtime live fence before any Feature disposal, so no new system, frame,
mailbox admission, listener delivery, timer action, socket action, physics action, or setup
publication can begin.

## Setup and contribution publication

Setup callbacks run serially in resolved dependency order. A callback receives only its parsed
configuration, a read-only view of permitted borrowed dependencies, an abort signal, and a
Feature-scoped kit-owned ownership ledger. It does not receive a raw scheduler registration
surface.

All runtime-visible publication and every owned cleanup obligation pass through that ledger.
A setup may stage only contributions declared by its own runtimeContributions list. Direct World
resource publication, direct system registration, untracked listeners or timers, hidden global
registration, and publication under another Feature's ID violate the contract.

A Feature setup is successfully completed only when its callback resolves and the runtime
atomically commits its staged ledger scope. Committed contributions then become available to later
dependent Feature setups, but no system or frame callback executes until the whole runtime reaches
running. A setup that throws, rejects, returns an invalid result, or is cancelled is not successful
and its scope is never committed.

For a failed in-progress Feature, the runtime fences and releases every staged ledger record in
exact reverse acquisition order. It does not call that Feature's dispose callback. It then disposes
only successfully completed Features in exact reverse setup order.

Setup and dispose may return void or one Promise that represents all their work. Detached,
fire-and-forget, or unregistered asynchronous work is forbidden. A shutdown request during an
awaited setup aborts its signal, rejects new ledger actions, starts no later Feature, and waits for
the active callback to quiesce before rollback. After observing cancellation, setup may only unwind
and settle; asynchronous setup continuing to acquire, publish, or mutate after cancellation is
unsupported and is an invariant failure. The runtime never reports stopped while Feature-owned
async work is still allowed to reach runtime state.

## Ownership ledger

The ledger is kit-owned and scoped by runtime generation and Feature ID. Every record has one
owner, one stable resource ID, one kind, one live fence, and one idempotent kit-controlled release
operation. The ledger records acquisition order and whether a contribution is staged, committed,
unpublished, or released.

Owned items include all Feature-created systems, World resources, subscriptions, listeners, timers,
sockets, physics objects and handles, presentation requests and callbacks, bounded mailboxes,
external objects, and any other resource capable of retaining a reference or producing work. A
Feature must ledger-register the cleanup obligation before the item can publish work.

During rollback or shutdown the runtime first unpublishes and fences a Feature's contributions,
then invokes its dispose callback, then releases all still-owned ledger records in exact reverse
acquisition order. The final ledger release runs even when dispose throws or rejects. A Feature may
release one of its own records early; repeated ledger release is a no-op. The Feature cannot mark a
record released while it can still invoke runtime work.

### Borrowing

A borrowed resource remains owned by its publishing Feature or by the runtime host. Borrowing gives
use permission only: the borrower cannot dispose, close, free, unregister, transfer, replace, or
republish it. Borrowed handles expose no ownership operation.

A Feature may borrow from a required Feature that has completed setup, or from an explicitly
host-owned service supplied in its setup context. Borrowing from an unrelated Feature is rejected.
Because shutdown reverses successful setup order, a dependent borrower is fully cleaned before its
required owner. A host-owned World, frame source, clock, telemetry sink, or process-level module is
borrowed unless an explicit transfer token says otherwise; a Feature never disposes the World or an
externally supplied frame source merely because it used it.

A listener attached to a borrowed object is still owned by the Feature that attached it. Its ledger
record must detach that listener without disposing the borrowed object.

### Ownership transfer

Ownership transfer is not inferred from assignment, return values, publication, or configuration.
The only supported transfer is an explicit transfer into the active Feature scope through a
kit-owned, single-use transfer token issued by the current host owner. Consuming the token during
that Feature's setup atomically relinquishes the prior owner and creates exactly one ledger record
with the Feature as owner and the supplied release operation.

A borrowed item cannot be converted into owned state without such a token. Tokens cannot be copied,
reused, consumed after setup commits, or consumed by a different Feature. Feature-to-Feature
transfer, transfer out of the ledger, transfer while running or stopping, and ownership replacement
are unsupported. Features share a service by publishing a borrowable contribution and declaring a
requirement, not by transferring ownership.

## Rollback, shutdown, and stopped results

Rollback after setup failure or boot cancellation performs this order:

1. Flip the runtime live fence, stop scheduling, cancel owned pumps or frame requests, and clear
   scheduler-owned pending mailboxes without executing them.
2. Fence and release the failed or cancelled Feature's uncommitted scope in reverse acquisition
   order without calling its dispose callback.
3. Visit successfully completed Features in exact reverse setup order.
4. For each, unpublish and fence its contributions, invoke dispose, and then release all remaining
   owned records in reverse acquisition order.
5. Continue through every Feature and ledger record after any disposal or release error.
6. Release published presentation state and schedule registrations, then dispose the runtime-owned
   World and remaining scheduler state according to their accepted contracts.
7. Enter stopped and cache one stopped result.

Normal shutdown uses the same steps except that every Feature was successfully completed and step 2
is absent. It visits Features in exact reverse successful setup order. Shutdown before boot has an
empty successful setup order but still applies the host cleanup and returns a stopped result.

Feature disposal errors, rejected disposal Promises, and ledger release errors are captured and
aggregated in observed cleanup order; none short-circuits later cleanup. Before stopped is entered,
all kit-visible contributions are unpublished and all work sources are fenced. The stopped
invariants are zero registered systems, World or published resources, subscriptions, listeners,
timers, sockets, live physics objects or handles, presentation requests or frame callbacks,
mailboxes, queued async deliveries, and Feature ledger records. An adapter whose release operation
cannot leave its item fenced and non-live even when reporting an error does not satisfy this
contract.

The first shutdown call owns one completion Promise. A call while shutdown or rollback is already
in progress returns that same Promise. After stopped, every later shutdown call returns the same
cached stopped result through the same settled Promise and performs no state transition, callback,
cancellation, disposal, release, telemetry increment, or other side effect.

## Result and error shapes

Boot and shutdown expose result unions rather than throwing expected lifecycle failures. A running
result contains state running, runtime, original Feature IDs, resolved setup order, installed
Feature IDs, and the frozen schedule report. A stopped result has exactly these fields:

| Field | Meaning |
| --- | --- |
| state | Always stopped. |
| runtime | client or server. |
| reason | shutdown, validation-failed, setup-failed, or setup-cancelled. |
| clean | True only when failures is empty. |
| setupOrder | Successfully completed Feature IDs in order. |
| disposedOrder | Feature IDs whose dispose callback was attempted, in order. |
| failures | Immutable ordered FeatureLifecycleFailure records. |

A FeatureLifecycleFailure has exactly these fields:

| Field | Meaning |
| --- | --- |
| kind | Always feature-lifecycle-failure. |
| code | Stable code from the vocabulary below. |
| runtime | client or server. |
| featureId | Relevant stable Feature ID, or null for a host-wide failure. |
| operation | validate, setup, rollback-dispose, rollback-release, shutdown-dispose, shutdown-release, or state. |
| state | Lifecycle state when observed. |
| expected | Whether the failure is an expected caller-correctable outcome. |
| details | At most 16 kit-owned path/code issue records; never raw values. |
| cause | A bounded kit-owned cause record or null. |

Stable lifecycle codes are duplicate-feature-id, invalid-feature-id, invalid-descriptor,
missing-requirement, dependency-cycle, feature-conflict, unknown-configuration,
invalid-configuration, invalid-contribution, duplicate-contribution-id, duplicate-system-id,
invalid-state, lifecycle-busy, setup-failed, setup-cancelled, dispose-failed,
resource-release-failed, ownership-violation, and invariant-failed.

A cause record contains only name, stable code or null, and bounded message. It contains no raw
configuration, payload, credentials, vendor object, stack, socket, World, Zod issue, Rapier handle,
DOM object, or arbitrary thrown value.

For setup failure, failures lists the primary setup failure first, then release failures for its
uncommitted scope, then disposal and release failures in exact cleanup order. For normal shutdown,
failures contains disposal and release failures in exact cleanup order. Validation failures use the
deterministic preflight order. All records are immutable kit-owned data and are also emitted on the
runtime's structured error stream exactly once.

## Observability

The lifecycle exposes bounded, read-only observations:

- one state-transition record for every legal transition, containing runtime, previous state, next
  state, operation, and monotonic sequence;
- one validation report containing original IDs, resolved IDs when valid, contribution inventory,
  and bounded failures;
- setup start, setup success, setup failure, dispose start, dispose success, and dispose failure
  records with Feature ID and sequence;
- ledger acquisition, commit, borrow, fence, unpublish, and release counts by kind, without raw
  resource values;
- the exact installed Feature ID list while running and an empty installed list after stopped;
- the frozen scheduler inspection report required by the scheduling contract; and
- the cached stopped result and final zero live-resource counters.

Feature declaration index is included where ordering is relevant. Timing may be included as finite
monotonic duration, but timing never affects order. Observers cannot mutate lifecycle state and
must not receive configuration values, raw causes, vendor handles, or borrowed resource objects.
An observer failure is an invariant failure and cannot prevent cleanup.

## Scheduler integration

Feature dependency order determines setup and reverse disposal order. System execution order is a
separate frozen order governed by the accepted runtime scheduling contract:

1. domain phase order;
2. ascending signed priority;
3. original Feature declaration index for equal priority; and
4. runtimeContributions declaration index within one Feature.

Setup completion timing never affects system order. All contribution and duplicate system
validation occurs in validating. Setup may only activate its predeclared entries through the ledger.
The final schedules are frozen before running and cannot be mutated afterward.

No tick or presentation frame starts before running. Entering rolling-back or shutting-down calls
the scheduler stop fence and clears scheduler-owned mailboxes before Feature disposal. Frozen
schedule registrations and published presentation state are released after Feature cleanup, and the
runtime-owned World is disposed last. These rules refine, and do not replace, the stop and disposal
order in [the runtime scheduling contract](./runtime-scheduling.md).

## Package and public boundaries

The environment-neutral descriptor, configuration provider, resolver result, lifecycle state,
ownership-ledger handle, stopped result, and failure record are public only from the existing
@three-game-kit/core root entrypoint. This contract creates no new package or public subpath.

Client Runtime and Server Runtime use those Core contracts from their existing package roots and
own their respective lifecycle hosts. Shared may declare authority-neutral state and system logic
against public Core data but owns no runtime host. Protocol owns no Feature resolution,
configuration, setup, ledger, or disposal behavior.

Public Feature descriptors and emitted declarations contain only kit-owned data and handles. They
must not expose DOM, Three.js, WebSocket, ws, Node HTTP, Zod, Rapier, scheduler internals, or another
package's unexported type. Client-only implementation resources remain private to Client; headless
Server and Shared remain browser-free.

First-party Features and the external packed-consumer Interaction Feature import only the public
specifier set accepted by the package map. The external fixture receives no workspace alias,
source-path, deep-import, or ledger-internal exception. Package peer dependencies and the documented
kit package version range are the only MVP compatibility signal; compatibility does not participate
in runtime Feature resolution.

## Consequences

- The full composition either validates before setup or produces no Feature side effect.
- Declaration order is observable for independent dependency choices and equal-priority systems, so
  callers must preserve it deliberately.
- Sequential awaited setup and cleanup favor inspectability and complete rollback over parallel
  startup.
- The ledger adds bookkeeping and requires adapters to express cleanup as fenced, idempotent release
  operations.
- A failing dispose cannot prevent later cleanup, and public results retain every bounded failure in
  deterministic order.
- Features may share services without sharing ownership, while explicit single-use adoption avoids
  accidental double disposal.
- Static composition keeps the MVP resolver small; changing the Feature set requires a new runtime
  instance.

## Unsupported and excluded behavior

The MVP does not support runtime Feature add, remove, enable, disable, replacement, restart, or
schedule mutation; optional dependencies; provider or capability selection; automatic enablement;
ambiguous-provider resolution; arbitrary version negotiation; runtime compatibility solving;
Feature aliases; conditional dependencies; arbitrary before/after ordering; cross-phase ordering;
parallel setup; detached asynchronous setup or disposal; setup work continuing after cancellation;
ownership transfer between Features or after setup; disposal of borrowed resources; or best-effort
operation after stopped.

Package installation does not sandbox Feature code. Production plugin discovery, a marketplace,
hot reload, state migration, persistent Feature state, process isolation, and recovery of a
non-cooperative async callback are outside the bounded MVP.

## Objective milestone tests

### Milestone 1

1. Compose Features declared in the order D, B, A, C where D requires B, B requires A, and C is
   independent. Assert the sole stable topological result A, B, D, C. Permute independent Features
   and assert each result follows only the new declaration indices. Assert system reports still use
   phase, priority, declaration index, and within-Feature order.
2. Table-test duplicate IDs, invalid IDs, duplicate requires/conflicts, a missing requirement, a
   two-node cycle, a longer cycle, either-direction conflict, invalid contribution, duplicate system
   ID, unknown configuration key, invalid nested field, unknown nested field, and invalid default.
   Assert stopped from validating, zero setup calls, and deterministic failure records.
3. Assert an absent Feature config yields a fresh validated default twice, a present partial value
   uses only the same provider's defaults, and rejected input is neither coerced nor stripped. No
   parser reads a World or returns a Promise.
4. Force the third setup to fail after acquiring a staged resource. Assert that Feature receives no
   dispose call, its staged scope releases in reverse acquisition order, the first two Features
   dispose in exact reverse setup order, later Features never start, and the stopped result lists
   the primary and cleanup failures in observed order.
5. Make the first reverse-order dispose throw and one ledger release report an error. Assert every
   remaining Feature and record is still cleaned, every live counter is zero, failures are
   aggregated, and two further shutdown calls return the same stopped result and cause no event or
   cleanup count change.
6. Assert a dependent may borrow its requirement until the dependent is disposed, cannot dispose or
   transfer it, and cleans its owned listener before the owner. Assert a single-use host transfer
   token changes owner exactly once; copy, reuse, wrong-Feature, late, and borrowed-item transfer
   attempts fail with ownership-violation and no double release.
7. Run exact stepping only after running, then shut down. Assert no tick starts during setup or
   cleanup, stop fences admission before disposal, frozen schedule inspection equals execution, and
   final counts are zero for systems, resources, subscriptions, listeners, timers, sockets, physics
   handles, frame callbacks, and mailboxes.

### Milestone 2

1. Compose the bounded Client Features with independent simulation and presentation schedules.
   Assert all configurations validate before any setup, installed Feature IDs equal the declared
   set while running, and 120 exact simulation ticks plus 75 explicit frames use the frozen
   scheduler order without setup-timing influence.
2. Force a Client Feature setup failure after staging a World resource, DOM listener, timer, physics
   object, and frame request. Assert no staged contribution commits, the failed Feature is not
   disposed, completed Features dispose in reverse setup order, and every listed live count is zero.
3. Cancel an awaited asset or collision setup through shutdown. Assert its abort signal fires once,
   no later Feature starts, no late publish or callback reaches the runtime, the active staged scope
   is released, and stopped is not reported until the awaited work has quiesced.
4. On normal Client shutdown, assert exact reverse successful setup order, Feature-owned listeners
   detach without disposing borrowed World or frame source, the runtime cancels its owned frame
   request, and two shutdown calls return the identical stopped result with no second side effect.
5. Typecheck source and emitted declarations to prove lifecycle types come only from the Core root,
   public Client descriptors expose only kit-owned types, and no DOM, Three.js, Rapier, or private
   scheduler type leaks through Core or Shared.

### Milestone 3

1. Boot one Server and two Client runtimes from fixed Feature lists. Assert each independently
   validates its complete graph before opening a socket or running setup, reports its exact original
   and resolved Feature ID order, and freezes the accepted Server, Client simulation, and Client
   presentation schedules before network work.
2. Inject a Server networking setup failure after listener, timer, socket, and command-mailbox
   acquisition. Assert the uncommitted scope is fenced and released, only completed Features are
   disposed in reverse setup order, no tick runs, all failures are aggregated, and there are zero
   systems, resources, listeners, timers, sockets, bindings, queues, physics handles, or callbacks.
3. Complete the normative two-context scenario, then shut down both Clients and the Server. Assert
   each runtime uses exact reverse successful setup order, dependents release borrowed networking
   services before owners, scheduler and transport fences reject delayed work, and every final live
   counter is zero.
4. Make disposal fail independently in one Client transport Feature and one Server Feature. Assert
   cleanup continues in each runtime, the other runtime instances remain isolated until their own
   shutdown, all stopped results contain ordered structured failures, and repeated shutdown returns
   each runtime's same result without another close, disposal, release, state event, or error event.
5. Packed-consumer and boundary checks prove the external Interaction Feature uses only existing
   public package specifiers, declares ordinary required IDs and conflicts, uses the single Core
   configuration provider and ledger, and introduces no optional dependency, provider selection,
   auto-enable, runtime replacement, version negotiation, or internal import.
