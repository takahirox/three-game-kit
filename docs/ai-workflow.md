# Tool-agnostic assisted workflow

This page implements the A12 documentation workflow: a bounded, reviewable way to
use software assistance when discovering and composing Three Game Kit Features.
It is guidance, not runtime functionality or a support commitment for any agent,
IDE, hosted service, autonomous change mechanism, or product-specific configuration.
All proposed changes remain subject to human ownership, review, tests, and the same
public API boundaries as hand-authored work.

## 1. Discover from the catalog

Start with [the foundation catalog](./features/foundation-catalog.json). Treat its
machine-readable fields as the discovery index for each included capability:
runtime, Feature IDs, requirements, conflicts, configuration, phases, authority,
ownership, limitations, public imports, examples, and verification command.

Do not infer a capability from a name or invent a missing Feature. Follow the
catalog's linked examples and contract documents when implementation detail is
needed. The [Interaction contract](./features/interaction.md) and the
[authoring guides](./authoring/cross-runtime-interaction.md) show the external
composition boundary.

## 2. Compose through public exports

Select only catalog entries needed by the consumer and import only the package
roots or exported subpaths listed in `publicImports`. Do not import workspace
source, build output, or an undeclared deep path. Keep the complete Feature list
and configuration fixed at runtime construction; requirements are explicit and do
not auto-install another Feature.

For consumer-specific behavior, define a consumer-owned descriptor with public
Core types and compose it with a public Client or Server Runtime. Do not add a kit
Feature merely to encode application policy. See
[server-only Feature authoring](./authoring/server-only-feature.md) and
[client-only Feature authoring](./authoring/client-only-feature.md).

## 3. Review ownership and authority

Before accepting a composition, write down for every live object whether it is
caller-owned, Feature-owned, runtime-owned, or borrowed. Confirm who creates it,
who may publish work from it, how setup failure rolls it back, and who disposes it.
Borrowers must never dispose or transfer borrowed values. Use the
[Feature lifecycle contract](./architecture/feature-lifecycle.md) as the checklist.

Separately review authority. Client input is intent, not truth. Server code must
derive identity and ownership from live bindings and validate schema, sequence,
tick window, permissions, finite bounds, and authoritative state before mutation.
Scheduling code on the server does not replace those checks. Consult the
[protocol trust rules](./protocol/mvp.md).

## 4. Inspect bounded telemetry

Inspect runtime telemetry and lifecycle reports through public APIs. Compare
installed Feature IDs and the frozen schedule with the intended catalog entries;
check lifecycle failures, structured errors, resource counts, connection state,
backlog, and rejection-reason counters. Use observations to find mismatches, never
to grant authority or silently change behavior. Telemetry is bounded and
in-memory; its limits are documented in
[errors and telemetry](./architecture/errors-and-telemetry.md).

## 5. Inject deterministic tests

Prefer exact server ticks, programmable semantic input, injected presentation
frames, observation clocks, and the deterministic application-level network
injector. Fix the command sequence, intended tick, delay, jitter, drop decision,
and frame/tick advancement in the test rather than relying on wall-clock timing.

Test valid behavior and boundaries: invalid configuration before setup, missing
requirements and conflicts, forced setup rollback, malformed and wrong-owner
commands, stale sequences, non-finite or out-of-range values, reconciliation,
disconnect fencing, zero live owned resources, and repeated shutdown. Deterministic
injection makes the selected scenario repeatable; it does not promise production
network behavior or cross-engine bit-identical physics. The normative scenario is
described in [two-client acceptance](./testing/two-client-acceptance.md).

## 6. Verify and review the diff

Use the narrow command while iterating, then run the release-candidate gate before
acceptance:

```sh
pnpm test:node
pnpm test:m4-packed-consumer
pnpm verify:m5
git diff --check
```

Review the final diff for public-export compliance, static composition, ownership,
authority validation, cleanup, deterministic evidence, and alignment with
[known limitations](./known-limitations.md). A successful command does not approve
an autonomous change: the consumer remains responsible for deciding whether the
change matches its application requirements.
