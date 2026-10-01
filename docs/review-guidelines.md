# Review guidelines

Review verifies that a change works and is the right response to its Issue.
Start by reading the Issue's problem and expected outcome, then review the PR
against that scope. Follow the [development flow and language policy](./development-flow.md).

## Check for missing work

Verify every requirement the PR claims to resolve. Do not approve it as closing
an Issue while required work remains. Intentional partial implementation must
state what remains and leave the Issue open.

## Check for unnecessary work

Prefer the smallest change that completely solves the stated problem. Watch for:

- unnecessary abstractions and speculative extensibility;
- unrelated refactoring;
- new frameworks or subsystems the Issue does not require;
- configuration or policy without a demonstrated need;
- public API expansion that is not required to solve the Issue.

AI-generated changes deserve the same scrutiny and can over-engineer solutions.
New Core abstractions, public APIs, and reusable Features need demonstrated
showcase or consumer friction or duplication, not speculative future usefulness.
Use the existing [specification review](./specification-review.md),
[milestones](./milestones.md), and [AI workflow](./ai-workflow.md) as guidance.

## Check correctness and validation

Confirm behavior matches the expected outcome, the implementation fits the
existing architecture, and documentation reflects any changed behavior.

For framework changes, confirm documented public imports rather than deep or
internal imports and appropriate Client / Shared / Server boundaries using the
[package map](./architecture/package-map.md). Review ownership, rollback, and
cleanup against the [Feature lifecycle](./architecture/feature-lifecycle.md).

Validation should be sufficient for the change and deterministic or repeatable
where applicable. Use the relevant existing checks and record their results;
the [AI workflow](./ai-workflow.md) describes deterministic validation and the
[release checklist](./release-checklist.md) defines release-candidate evidence.

## Review outcome

The three merge conditions are:

1. **Complete:** the PR fully addresses the Issue it claims to resolve.
2. **Scoped:** the PR introduces no unjustified scope or complexity.
3. **Validated:** the implementation is correct and sufficiently tested or
   otherwise verified.

Passing tests alone is not sufficient. If any condition is unmet, request
changes and review again after revision. A deliberately partial PR may be
reviewed for its stated scope, but must not claim completion of the source Issue.

Adapted from the [GitWeave review guidelines](https://github.com/takahirox/gitweave/blob/main/docs/review-guidelines.md).
