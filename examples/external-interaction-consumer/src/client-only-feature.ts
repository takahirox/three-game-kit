import {
  defineFeatureConfiguration,
  type ClientFeatureDescriptor,
} from "@three-game-kit/core";

const configuration = defineFeatureConfiguration<Readonly<{ enabled: boolean }>>({
  defaultValue: () => ({ enabled: true }),
  parse(input) {
    if (typeof input === "object" && input !== null && !Array.isArray(input) &&
        Object.keys(input).join("|") === "enabled" &&
        typeof (input as { enabled?: unknown }).enabled === "boolean") {
      return { ok: true, value: { enabled: (input as { enabled: boolean }).enabled } };
    }
    return { ok: false, issues: [{ path: [], code: "invalid-client-only-configuration" }] };
  },
});

export const clientOnlyFeature: ClientFeatureDescriptor<Readonly<{ enabled: boolean }>> = {
  id: "external.client-only",
  description: "Minimal external client-only Feature",
  runtimeContributions: [],
  requires: [],
  conflicts: [],
  configuration,
  setup() {},
  dispose() {},
};
