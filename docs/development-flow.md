# Development flow

This is the default development workflow for `three-game-kit`, including
AI-assisted changes. Prefer the smallest change that completely solves the
stated problem.

## 1. Start with an Issue

Work should normally begin with an Issue stating the problem, expected outcome,
and relevant context. The Issue defines scope and completion, not a mandatory
implementation plan. Use the [Issue template](../.github/ISSUE_TEMPLATE/issue.md).

By default, completion criteria should be executable and verifiable by an AI
agent. Require human checks, such as physical-device testing, subjective
evaluation, or external approval, only when there is a necessary reason to do so.

When human work is required, state why it is necessary and what result is
expected. Distinguish optional additional validation from mandatory completion
criteria.

Mandatory pre-merge acceptance criteria must be achievable and verifiable before
merge. Record required checks possible only after merge separately as post-merge
verification; they must not be prerequisites for pre-merge PR approval. This
distinction preserves all implementation requirements and applicable pre-merge
tests.

For example, for a merge-triggered deployment, validate the code and deployment
configuration, local builds, and applicable automated tests before merge. Verify
publication and the newly published site's expected behavior after merge. Report
required post-merge verification as pending until performed, rather than claiming
that pre-merge validation proves publication.

If scope is unclear, clarify the Issue before implementation instead of inventing
requirements during the change.

## 2. Create a Pull Request for the Issue

Propose the implementation through a PR associated with the Issue. Use the
[PR template](../.github/pull_request_template.md) to explain what changed, the
outcome (including before/after behavior when useful), validation, and related
Issues.

Record pre-merge validation results and required post-merge verification
separately in the PR's validation report. Keep post-merge checks marked as pending
until performed, and report failed or unperformed pre-merge checks accurately.
Choose and report checks using the [test and CI performance principles](#test-and-ci-performance-principles).

Only claim to close an Issue when the PR fully addresses it. Intentional partial
work is fine, but state what remains, avoid closing keywords, and keep the Issue
open.

## 3. Review before merge

Every PR should be reviewed against its Issue before merge. Ask:

> Does this Pull Request fully address the Issue without adding changes that are
> not justified by the Issue?

Check both missing scope and unnecessary scope using the
[review guidelines](./review-guidelines.md). Be especially alert to
over-engineering in AI-generated changes: additional complexity is not
automatically useful.

## 4. Revise until review passes

If review finds missing requirements, unnecessary scope, correctness problems,
or insufficient validation, update the PR and review it again.

## 5. Merge after scope and correctness are satisfied

Merge only when the reviewed implementation is complete for the Issue it claims
to resolve, no broader than necessary, correct, and satisfies mandatory pre-merge
acceptance criteria with appropriate validation. Required post-merge verification
must be recorded separately as pending and must not block pre-merge PR approval.
Passing tests alone is not sufficient.

## 6. Perform post-merge verification

After merge, perform the recorded post-merge checks and report their actual
results. For a merge-triggered deployment, verify that deployment succeeds and
the newly published site has the expected behavior. Keep checks pending until
performed; approval, merge, or a successful local build does not prove they passed.
Record failures and required follow-up work without claiming full verification
while required checks remain pending or have failed.

## Test and CI performance principles

**Detect the required failures at the lightest appropriate layer, without
redundant execution.** Preserve required behavior, regression assertions, and
meaningful integration coverage when moving or consolidating checks.

1. **Prefer the lightest meaningful layer.** Use Node tests for calculations,
   branches, protocol validation, and broad data combinations; `pnpm test` builds
   before running `test:node`. Reserve Playwright/Three.js rendering and real
   WebSocket integration for behavior that needs those boundaries. Add tests that
   catch a concrete defect rather than mirror the implementation. Preserve
   [deterministic injection](./ai-workflow.md#5-inject-deterministic-tests),
   isolation, ownership, and cleanup evidence.
2. **Choose combinations deliberately.** Cover distinct Feature, asset, state,
   and authority paths with representative cases; exhaust combinations where
   their interactions require it. Do not automatically multiply these by every
   browser or deployment path. Keep the required bundled-Chromium environment and
   [canonical two-client acceptance](./testing/two-client-acceptance.md). Gallery
   development and Pages projects exercise distinct serving/base-path behavior;
   they are not interchangeable coverage.
3. **Match validation to the change.** Use the guidance below for local feedback
   and pre-merge evidence. Keep fast iteration, full regression validation, and
   publication distinct. Applicable mandatory pre-merge checks remain required;
   optional diagnostics do not replace them. Record genuinely post-merge-only
   verification separately and leave it pending until performed.
4. **Reuse work and eliminate duplicate execution.** In future test/CI changes,
   reuse builds, package fixtures, dependency/browser downloads, and asset setup
   with keys tied to relevant source, lockfile, toolchain, and environment; retain
   fresh application state and independent browser contexts. The current CI runs
   on both push and pull request: avoid equivalent runs for the same revision
   when revising triggers. Stop superseded validation safely while preserving
   necessary Pages deployment ordering. Measure resource use before parallelizing
   independent work; more workers need not improve feedback time.
5. **Review value and cost together.** Identify the additional defect each new
   or expanded check detects, whether existing coverage already detects it, and
   its execution and maintenance cost. Watch repeated TypeScript builds,
   browser/renderer startup, package packing/installing, large assets, long tick
   loops, and Cartesian-product growth. Consolidate redundant work without
   dropping meaningful assertions or required integration evidence.
6. **Maintain an execution-time budget.** Normal-CI duration and its target are
   currently unmeasured in repository guidance. Establish a baseline and a
   repository-appropriate target during actual test/CI performance work, using
   representative runs; monitor growth and investigate overruns. Track elapsed
   feedback time, total runner/computation time, and queue time separately.
   Revisit setup, duplication, and validation structure while retaining required
   coverage. This policy adds no benchmark, hardware purchase, or merge gate.

### Apply the existing checks

Commands are defined in [`package.json`](../package.json). The current
[`CI workflow`](../.github/workflows/ci.yml) unconditionally runs `pnpm verify:m5`,
the additional showcase verification commands, and `pnpm verify:gallery`.
`verify:m5` includes build/type checks, Node tests, browser acceptance,
catalog/documentation checks, and packed-consumer/release audits. These principles
do not change CI selection or waive its required checks.

| Change | Relevant pre-merge validation |
| --- | --- |
| Documentation only | Check Markdown structure, local links/anchors, consistency, and `git diff --check`; `pnpm test:m5-docs` is the existing documentation checker. Application builds, browser suites, and timing measurements are not needed solely for prose changes. |
| UI, rendering, or showcase | Use the affected `verify:<showcase>` or Feature command from `package.json`; gallery changes use `pnpm verify:gallery`, including development and local Pages-build behavior. |
| Core/runtime, protocol, or package boundary | Use focused Node tests while iterating after a build; `pnpm verify` covers build/type checks, Node tests, and workspace boundaries. Run applicable browser, packed-consumer, and full regression gates for affected contracts. |
| CI/build or Pages configuration | Check changed configuration and affected commands, builds, and regression gates; use `pnpm build:pages` and local Pages checks when publication paths are affected. A local build does not prove publication. |

The [AI workflow](./ai-workflow.md#6-verify-and-review-the-diff) retains the
`pnpm verify:m5` acceptance gate for Feature composition; the
[release checklist](./release-checklist.md) retains same-commit candidate CI and
archive evidence. Headed runs, extra seeds, and unsupported browsers/hosts are
optional diagnostics under [ADR 0007](./adr/0007-playwright-browser-testing.md),
not new support commitments. The [Pages workflow](../.github/workflows/pages.yml)
publishes on pushes to `main` or manual dispatch; for merge-triggered publication,
verify deployment and the published site's behavior after merge as described in
[step 6](#6-perform-post-merge-verification).

Workflow, cache, worker, test-selection, and test implementation changes require
separately scoped work; this section documents how to assess them.

## Demonstrate reusable responsibilities first

Do not add a new Core abstraction, public API, or reusable Feature merely because
it may be useful later. First implement the needed behavior in a real showcase
or consumer, observe actual friction or duplication, then promote it into the
kit only when the reusable responsibility is demonstrated.

This reinforces the existing [specification review](./specification-review.md),
[milestones](./milestones.md), and [AI workflow](./ai-workflow.md); those documents
remain the references for their respective scope and implementation guidance.

## Language policy

Use English for repository collaboration and documentation:

- Issue titles and bodies;
- PR titles and bodies;
- review comments and ordinary repository comments;
- code comments;
- documentation;
- commit messages;
- user-facing repository text, unless the feature specifically requires another
  language.

This keeps the repository understandable to contributors, tools, and AI agents
without requiring translation context.

Adapted from the [GitWeave development flow](https://github.com/takahirox/gitweave/blob/main/docs/development-flow.md).
