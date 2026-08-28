# External Interaction consumer

This directory is a consumer-owned Milestone 4 fixture. It is intentionally
outside the repository's pnpm workspace and imports only documented package
roots and public subpaths. It must be installed from packed `0.1.x` artifacts;
it has no workspace aliases or imports back into this repository.

`src/interaction-feature.ts` demonstrates an ordinary external server/client
Feature pair. The server Feature borrows a host-owned authoritative adapter
activation port. The client Feature borrows a host-owned replication engine,
queues Interaction commands, and observes the newest interactable presentation
state. Neither Feature disposes a borrowed host object; each releases only the
state it acquired through its lifecycle ledger.

`src/client-only-feature.ts` is the smallest client-only Feature example.

After installing packed packages, run:

```sh
npm run build
npm test
```

The acceptance test imports the compiled `dist` output. It covers lifecycle
metadata and strict configuration, graph failures, setup rollback, idempotent
shutdown, zero live resources, a two-client authoritative toggle, rejection
boundaries, and continued movement after the Interaction Feature is removed.

The host supplies services under the stable IDs
`host.authoritative-interaction` and `host.client-replication`. The ordinary
Feature dependencies are `host.server-authority` and `host.client-session`.
