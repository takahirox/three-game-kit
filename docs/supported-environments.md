# Supported environments

This document defines the bounded MVP support baseline selected by [ADR 0001](./adr/0001-toolchain-and-supported-environments.md).
It is a normative Milestone 0 target, not evidence that an implementation or CI workflow already exists.

## Required baseline

| Surface | Required MVP environment | Scope |
| --- | --- | --- |
| Node runtime and development tools | Node.js 24.x | Headless Server, scripts, builds, and tests |
| Type checking | TypeScript 6.0 with `strict: true` | All packages; exact dependency resolution belongs in the future lockfile |
| Emitted language and modules | `ES2023`, native ESM, NodeNext module and resolution semantics | Published package output and Node execution |
| Package manager | Exactly `pnpm@11.24.0` | Workspace install and task execution once a manifest exists |
| CI host | Ubuntu 24.04 x64 | The sole required operating-system and architecture gate |
| Browser acceptance | Playwright-bundled Chromium | Browser smoke, integration, and normative two-client acceptance tests |

CI support means the complete documented verification workflow passes on Ubuntu 24.04 x64 using Node 24, the pinned pnpm version, and Playwright's bundled Chromium.
Node support means headless runtime and package tooling execute under Node 24; it does not imply that browser-only packages can run without browser APIs.

## Browser support boundary

Bundled Chromium is the sole required MVP browser.
Automated acceptance uses its isolated browser contexts; it does not depend on a user's system browser.

The following are outside the required MVP support matrix:

- Firefox and Playwright Firefox;
- Safari and Playwright WebKit;
- system-installed Chrome or Chromium versions;
- physical XR devices and WebXR behavior.

This is a deliberately narrow certification boundary.
Running on an unlisted browser does not establish compatibility or create a support commitment.

## Host support boundary

Ubuntu 24.04 x64 is the only required CI and headless-server host for the MVP.
Other Linux distributions, Linux architectures, macOS, and Windows may be usable development environments, but they are not verified or required by the MVP contract.

## Version policy

- Node.js is fixed to major 24; changing the required major needs an ADR update.
- TypeScript is fixed to the 6.0 release line; its exact resolved version will be recorded by the future lockfile.
- pnpm is fixed exactly to 11.24.0 and must not follow a floating tag.
- The required Chromium revision is the one installed by the repository's future pinned Playwright dependency.
- Ubuntu is fixed to the 24.04 x64 CI image family.

Any expansion of this matrix must add an objective automated gate before the environment is described as supported.
Successful ad hoc execution alone is insufficient.

## Current verification status

The repository contains documentation only at this decision point.
There is no manifest, lockfile, implementation, browser installation, or CI workflow to verify yet, so no product test result is claimed.
Verification commands and evidence belong to the implementation milestones that introduce those surfaces.
