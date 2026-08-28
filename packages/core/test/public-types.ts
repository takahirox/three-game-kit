import {
  SIMULATION_DT_SECONDS,
  createBoundedMailbox,
  createServerFeatureRuntime,
  defineFeatureConfiguration,
  createRuntimeLiveFence,
  createServerSchedule,
  createTelemetryStore,
  createWorld,
  defineComponent,
  defineResource,
  type BoundedMailbox,
  type ComponentType,
  type CreateServerScheduleResult,
  type EntityId,
  type MailboxAdmissionResult,
  type ResourceType,
  type FeatureDescriptor,
  type FeatureLifecycleFailure,
  type FeatureStoppedResult,
  type HostOwnershipTransferToken,
  type RuntimeGeneration,
  type ServerFeatureBootResult,
  type ServerFeatureRuntime,
  type ServerSystemDeclaration,
  type ServerTelemetrySnapshot,
  type TelemetryStore,
  type World,
} from "@three-game-kit/core";

const Position = defineComponent<{ x: number }>("position");
const Clock = defineResource<{ tick: number }>("clock");
const world: World = createWorld();
const entity: EntityId = world.createEntity();
const componentType: ComponentType<{ x: number }> = Position;
const resourceType: ResourceType<{ tick: number }> = Clock;

world.addComponent(entity, Position, { x: 1 });
world.addResource(Clock, { tick: 1 });
const position: { x: number } | undefined = world.getComponent(
  entity,
  Position,
);
const clock: { tick: number } | undefined = world.getResource(Clock);
const entities: readonly EntityId[] = world.queryAll(Position);

// @ts-expect-error EntityId cannot be constructed from a number.
const forgedEntity: EntityId = 1;
// @ts-expect-error Query snapshots are read-only.
entities.push(entity);
// @ts-expect-error Component values are checked against their token type.
world.addComponent(entity, Position, { x: "invalid" });
// @ts-expect-error Resource values are checked against their token type.
world.addResource(Clock, { tick: "invalid" });

void componentType;
void resourceType;
void position;
void clock;
void forgedEntity;

type MailboxInput = { value: number };
type MailboxSnapshot = Readonly<{ value: number }>;
const fence = createRuntimeLiveFence();
const generation: RuntimeGeneration = fence.capture();
const mailbox: BoundedMailbox<MailboxInput, MailboxSnapshot> =
  createBoundedMailbox({
    capacity: 2,
    fence,
    copySnapshot: (value) => Object.freeze({ value: value.value }),
  });
const admission: MailboxAdmissionResult = mailbox.enqueue(
  { value: 1 },
  generation,
);
const scheduledSystem: ServerSystemDeclaration = {
  domain: "server-simulation",
  phase: "ingress",
  priority: -1,
  featureId: "types",
  featureDeclarationIndex: 0,
  systemId: "types-system",
  withinFeatureDeclarationIndex: 0,
  run: ({ dt }) => {
    const exactDt: typeof SIMULATION_DT_SECONDS = dt;
    void exactDt;
  },
};
const scheduleResult: CreateServerScheduleResult = createServerSchedule({
  driver: "exact",
  world,
  systems: [scheduledSystem],
});
const invalidSystem: ServerSystemDeclaration = {
  ...scheduledSystem,
  // @ts-expect-error Client presentation phases are not Server simulation phases.
  phase: "render",
};
void admission;
void scheduleResult;
void invalidSystem;
const telemetryStore: TelemetryStore<"server"> = createTelemetryStore({
  runtime: "server",
});
const telemetrySnapshot: ServerTelemetrySnapshot =
  telemetryStore.snapshotTelemetry();
void telemetryStore;
void telemetrySnapshot;

const featureConfiguration = defineFeatureConfiguration<{ enabled: boolean }>({
  defaultValue: () => ({ enabled: true }),
  parse(input) {
    if (
      typeof input !== "object" ||
      input === null ||
      !("enabled" in input) ||
      typeof input.enabled !== "boolean"
    ) {
      return {
        ok: false,
        issues: [{ path: ["enabled"], code: "boolean-required" }],
      };
    }
    return { ok: true, value: { enabled: input.enabled } };
  },
});
const typedFeature: FeatureDescriptor<{ enabled: boolean }> = {
  id: "typed-feature",
  description: "Exercises the public Feature boundary",
  runtimeContributions: [
    {
      kind: "system",
      id: "typed-system",
      domain: "server-simulation",
      phase: "gameplay",
      priority: 0,
      run: () => undefined,
    },
  ],
  requires: [],
  conflicts: [],
  configuration: featureConfiguration,
  setup({ configuration, ledger, signal }) {
    const enabled: boolean = configuration.enabled;
    signal.throwIfAborted();
    if (enabled) ledger.activateSystem("typed-system");
  },
  dispose() {},
};
interface HypotheticalRuntimeContribution {
  readonly kind: "hypothetical";
  readonly id: string;
  readonly value: number;
}

const hypotheticalFeature: FeatureDescriptor<
  { enabled: boolean },
  HypotheticalRuntimeContribution
> = {
  id: "hypothetical-feature",
  description: "Exercises a typed non-Server contribution",
  runtimeContributions: [
    {
      kind: "hypothetical",
      id: "hypothetical-contribution",
      value: 1,
    },
  ],
  requires: [],
  conflicts: [],
  configuration: featureConfiguration,
  setup({ configuration }) {
    const enabled: boolean = configuration.enabled;
    void enabled;
  },
  dispose() {},
};

// @ts-expect-error Non-Server contribution descriptors are not Server runtime options.
createServerFeatureRuntime({ features: [hypotheticalFeature] });

const featureRuntime: ServerFeatureRuntime = createServerFeatureRuntime({
  features: [typedFeature],
});
const transferToken: HostOwnershipTransferToken<{ close(): void }> =
  featureRuntime.createHostTransferToken("typed-feature", {
    resourceId: "typed-host-value",
    kind: "sockets",
    value: { close() {} },
    release() {},
  });
const featureBoot: Promise<ServerFeatureBootResult> = featureRuntime.boot();
const featureShutdown: Promise<FeatureStoppedResult> =
  featureRuntime.shutdown();
declare const lifecycleFailure: FeatureLifecycleFailure;
void transferToken;
void featureBoot;
void featureShutdown;
void lifecycleFailure;
