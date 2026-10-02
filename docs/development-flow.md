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

If scope is unclear, clarify the Issue before implementation instead of inventing
requirements during the change.

## 2. Create a Pull Request for the Issue

Propose the implementation through a PR associated with the Issue. Use the
[PR template](../.github/pull_request_template.md) to explain what changed, the
outcome (including before/after behavior when useful), validation, and related
Issues.

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

Merge only when the reviewed change is complete for the Issue it claims to
resolve, no broader than necessary, correct, and appropriately validated.
Passing tests alone is not sufficient.

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
