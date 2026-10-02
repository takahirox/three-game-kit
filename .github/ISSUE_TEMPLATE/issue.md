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
are needed. For example, after a merge-triggered deployment, verify publication
and the newly published site's expected behavior. Report these checks as pending
until performed; do not present them as passed based on pre-merge validation.
See the [post-merge workflow](https://github.com/takahirox/three-game-kit/blob/main/docs/development-flow.md#6-perform-post-merge-verification).

## Context

Add any relevant context, examples, screenshots, logs, or related issues.
