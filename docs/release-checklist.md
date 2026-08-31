# Release checklist

This is the normative checklist for a Milestone 5 release candidate. Complete it
against one commit. Do not substitute an ad hoc local environment for the candidate
CI run, and do not mark future evidence complete.

## Candidate and environment

- [x] The candidate is a clean checkout (`actions/checkout@v4`, `clean: true`) with
  no uncommitted or untracked inputs to verification.
- [x] The host is Ubuntu 24.04 x64.
- [x] Node.js 24 x64 was selected with `actions/setup-node@v4`.
- [x] `corepack enable` and `corepack prepare pnpm@11.24.0 --activate` completed.
- [x] `pnpm install --frozen-lockfile` completed without changing the lockfile.
- [x] `pnpm exec playwright install --with-deps chromium` completed.
- [x] `pnpm verify:m5` passed on the same checkout.

The exact command sequence is defined in
[`m5-verification.md`](./m5-verification.md) and must match
[`ci.yml`](../.github/workflows/ci.yml).

## Runtime, acceptance, and boundaries

- [x] Browser and Server evidence reports zero unexpected uncaught exceptions,
  unhandled rejections, page errors, console errors, and structured runtime errors.
- [x] M2 and M3 cleanup evidence reports zero live resources after shutdown; M4
  rollback, normal shutdown, and repeated shutdown leak no Feature-owned resources
  and do not dispose borrowed host objects.
- [x] `scripts/verify-workspace.mjs` reports zero source, dependency, public-export,
  package-root, environment, or emitted-declaration boundary violations.
- [x] Protocol rejection counters change only for their exercised documented reason,
  rejected input does not mutate authority, and no unexpected rejection is present.
- [x] Disconnect fencing records the documented `stale-connection` rejection,
  removes the disconnected binding/avatar/capsule by the bounded tick, prevents stale
  recreation, and leaves the peer connected and functional.
- [x] Both bundled-Chromium acceptances pass, including M2 local browser behavior and
  the M3 canonical two-context, real-loopback-WebSocket scenario with one worker,
  zero retries, and clean shutdown.
- [x] M4 catalog and packed outside-workspace consumer checks pass, including
  Interaction acceptance, deterministic rejection boundaries, removal of
  Interaction, lifecycle rollback, and borrowed-resource ownership.

These items are exercised by `pnpm verify:m5`; the generated M3 `evidence.json` and
the test output must agree with the successful process result.

## Feature documentation and discovery

- [x] The catalog contains exactly the six sorted entries `collision`, `interaction`,
  `movement-input`, `third-person-camera`, `three-rendering`, and `vfx`.
- [x] Collision documentation matches its catalog metadata, public factory, ownership,
  phases, configuration, limitations, examples, and verification command.
- [x] Interaction documentation matches its catalog metadata, consumer-owned factories,
  authority and rejection contract, lifecycle, limitations, examples, and verification
  command.
- [x] Movement Input documentation matches its catalog metadata, public factory,
  ownership, phase, configuration, limitations, examples, and verification command.
- [x] Third-person Camera documentation matches its catalog metadata, public factory,
  ownership, phase, configuration, limitations, examples, and verification command.
- [x] Three Rendering documentation matches its catalog metadata, public factory,
  ownership, phase, configuration, limitations, examples, and verification command.
- [x] VFX documentation matches its catalog metadata, public factory, deterministic
  command/time contract, bounds, ownership, examples, and verification command.

The five client-only Feature contracts are in
[`client-features.md`](./features/client-features.md); the Interaction contract is in
[`interaction.md`](./features/interaction.md). `pnpm test:m5-catalog` checks the
machine-readable catalog against the public factories, exports, examples, and M4
Interaction entry.

## Package archive audit

- [x] Exactly five archives are produced: `@three-game-kit/client`,
  `@three-game-kit/core`, `@three-game-kit/protocol`, `@three-game-kit/server`, and
  `@three-game-kit/shared`.
- [x] Every archive has the expected package name, shared version `0.1.0`, exact
  package description, repository metadata, Node engine `24.x`, and `README.md`.
- [x] Every declared public export has its JavaScript, declaration, and source-map
  files, and the complete set remains exactly 17 public specifiers.
- [x] Every archive declares `license: "UNLICENSED"`; no release note or checklist
  entry represents that field as a license grant.
- [x] No archive contains workspace/local dependency specifiers, source or test
  directories, workspace configuration, or unexpected top-level files.
- [x] The archive audit is evidence only. No registry publication was performed or
  claimed by this checklist.

These criteria are machine-checked by `pnpm test:m5-release` within `pnpm verify:m5`.

## Claims and recorded evidence

- [x] Review [`known-limitations.md`](./known-limitations.md), each Feature's
  limitations, milestone exclusions, and deferred roadmap claims. Release wording
  does not imply support for a deferred capability or expand the narrow environment.
- [x] Candidate commit: **24dbe37fbd5552b53fdc96b6a3464cb58bc6c348**
- [x] GitHub Actions CI run URL: **https://github.com/takahirox/three-game-kit/actions/runs/33231303871**
- [x] Archived CI artifact/evidence URL: **https://api.github.com/repos/takahirox/three-game-kit/actions/artifacts/9708580913/zip**
- Artifact ID `9708580913`, named `m5-verification-evidence`, is 42179 bytes and is
  retained until `2026-11-27T03:24:13Z`.
- [x] The recorded commit equals the checkout verified by the recorded CI run, and
  the archived artifact belongs to that run.

Immutable evidence summary: M2 Chromium 2/2; Node/WebSocket 172/172; M3 canonical
two-context 1/1 with one worker and zero retries; catalog features 5, public
specifiers 16, public feature IDs 6, examples 8; docs 39 Markdown files and 250
links with zero failures; release audit 5 packages, 5 tarballs, 102 files, 16
exports; packed consumer 5 tarballs, 16 resolved exports, consumer tests passed.
