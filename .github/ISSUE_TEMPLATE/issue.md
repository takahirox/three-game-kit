---
name: Issue
about: Report a problem or propose a change
title: ""
labels: ""
assignees: ""
---

<!-- Write in English. See docs/development-flow.md for the repository workflow. -->

## Problem

Describe the problem.

## Expected outcome

Describe what should be true when the issue is resolved.

Default to completion criteria an AI agent can execute and verify. Require human
checks only when necessary; explain why and the expected result, and distinguish
optional validation from mandatory criteria. See the
[Issue-authoring guidance](https://github.com/takahirox/three-game-kit/blob/main/docs/development-flow.md#1-start-with-an-issue).

### Pre-merge acceptance criteria

List mandatory acceptance criteria that are achievable and verifiable before
merge. Checks possible only after merge must not be prerequisites for pre-merge
PR approval.

For a merge-triggered deployment, validate the code and deployment configuration,
local builds, and applicable automated tests before merge. All implementation
requirements and applicable pre-merge tests still apply.

## Post-merge verification

Record required checks possible only after merge separately, or state that none
are needed for this change. Do not add routine manual, device, model-download, or
deployment gates to documentation-only work. For example, after a merge-triggered
deployment, verify publication and the newly published site's expected behavior.
Report checks as pending or environment-blocked until performed; closure does not
claim they passed. Once implementation and mandatory pre-merge acceptance are
complete, merge and close this Issue before required post-merge verification.
Record evidence and any actual defects in accordance with the
[post-merge workflow](https://github.com/takahirox/three-game-kit/blob/main/docs/development-flow.md#6-perform-post-merge-verification),
using a new linked Issue (or existing equivalent) for defects rather than reopening
this Issue solely for follow-up.

## Context

Add any relevant context, examples, screenshots, logs, or related issues.
