# Author a client-only Feature

Use a client-only Feature for behavior that runs entirely in a Client Runtime. The
[M4 fixture](../../examples/external-interaction-consumer/src/client-only-feature.ts)
is the smallest complete example; the [feature catalog](../features/catalog.json)
records the broader external Feature contract.

Import the descriptor type and configuration helper only from the public Core
package root:

```ts
import {
  defineFeatureConfiguration,
  type ClientFeatureDescriptor,
} from "@three-game-kit/core";

type Configuration = Readonly<{ enabled: boolean }>;

const configuration = defineFeatureConfiguration<Configuration>({
  defaultValue: () => ({ enabled: true }),
  parse(input) {
    if (
      typeof input === "object" &&
      input !== null &&
      !Array.isArray(input) &&
      Object.keys(input).join("|") === "enabled" &&
      typeof (input as { enabled?: unknown }).enabled === "boolean"
    ) {
      return {
        ok: true,
        value: { enabled: (input as { enabled: boolean }).enabled },
      };
    }

    return {
      ok: false,
      issues: [{ path: [], code: "invalid-client-only-configuration" }],
    };
  },
});

export const clientOnlyFeature: ClientFeatureDescriptor<Configuration> = {
  id: "external.client-only",
  description: "Minimal external client-only Feature",
  runtimeContributions: [],
  requires: [],
  conflicts: [],
  configuration,
  setup() {},
  dispose() {},
};
```

The parser accepts exactly one `enabled` boolean and rejects missing, extra, or
wrongly typed fields. `defaultValue` supplies `{ enabled: true }` when the host
does not configure the Feature. Choose an ID that is stable across releases and
a description that identifies the capability. For a minimal independent Feature,
declare empty requirements, conflicts, and runtime contributions explicitly.

`setup` runs during boot after configuration and graph validation. `dispose` runs
during shutdown, and may also run while a failed boot is rolled back. Empty hooks
are sufficient when the Feature acquires nothing. If setup creates a listener,
resource, or other cleanup obligation, register that Feature-owned state with the
setup context's ownership ledger before publishing work. Borrowed host objects are
not disposed by the Feature; only Feature-owned acquisitions are released.

Compose the descriptor with the Client package and a presentation frame source
owned by the host:

```ts
import { createClientRuntime } from "@three-game-kit/client";

const runtime = createClientRuntime({
  features: [clientOnlyFeature],
  frameSource,
});

await runtime.boot();
// Drive the host and runtime as required.
await runtime.shutdown();
```

The runtime borrows `frameSource`; the host remains responsible for that object.
Feature composition is fixed when the runtime is created: runtime mutation and
optional-provider selection are unsupported. Client-only code may produce local
presentation or intent, but it cannot claim server authority or directly mutate
authoritative state.

Verify the public boundary from packed package tarballs, not workspace aliases or
source/deep imports. Install the packed `@three-game-kit/core` and
`@three-game-kit/client` artifacts in an external consumer, then build and run its
tests. The repository's complete packed-consumer check is:

```sh
pnpm test:m4-packed-consumer
git diff --check
```
