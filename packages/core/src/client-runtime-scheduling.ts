import type { World } from "./index.js";
import {
  MAX_WALL_CLOCK_TICKS_PER_PUMP,
  SIMULATION_DT_SECONDS,
  WALL_CLOCK_ACCUMULATOR_CAP_SECONDS,
  type OperationResult,
  type SimulationDriver,
  type WallClockPumpReport,
} from "./runtime-scheduling.js";
import {
  createTelemetryStore,
  type RuntimeErrorCategory,
  type RuntimeErrorContextEntry,
  type RuntimeErrorInput,
  type RuntimeErrorRecord,
  type TelemetryStore,
} from "./telemetry.js";

export const CLIENT_SIMULATION_PHASES = Object.freeze([
  "snapshot-ingest",
  "reconcile",
  "action-sample",
  "command-send",
  "shared-predict",
  "predictive-collision",
  "presentation-publish",
  "telemetry",
] as const);

export const CLIENT_PRESENTATION_PHASES = Object.freeze([
  "remote-interpolation",
  "camera-view",
  "render",
  "frame-telemetry",
] as const);

export type ClientSimulationPhase = (typeof CLIENT_SIMULATION_PHASES)[number];
export type ClientPresentationPhase =
  (typeof CLIENT_PRESENTATION_PHASES)[number];

declare const presentationFrameRequestBrand: unique symbol;

/** An opaque handle owned by its PresentationFrameSource. */
export interface PresentationFrameRequest {
  readonly [presentationFrameRequestBrand]: never;
}

export interface PresentationFrameSource {
  request(callback: (timestampMs: number) => void): PresentationFrameRequest;
  cancel(request: PresentationFrameRequest): void;
}

export interface ClientSimulationSystemContext {
  readonly world: World;
  readonly tick: number;
  readonly dt: typeof SIMULATION_DT_SECONDS;
}

export interface ClientPresentationSystemContext {
  readonly frame: number;
  readonly timestampMs: number;
}

export interface ClientSimulationSystemDeclaration {
  readonly domain: "client-simulation";
  readonly phase: ClientSimulationPhase;
  readonly priority: number;
  readonly featureId: string;
  readonly featureDeclarationIndex: number;
  readonly systemId: string;
  readonly withinFeatureDeclarationIndex: number;
  readonly run: (context: ClientSimulationSystemContext) => unknown;
}

export interface ClientPresentationSystemDeclaration {
  readonly domain: "client-presentation";
  readonly phase: ClientPresentationPhase;
  readonly priority: number;
  readonly featureId: string;
  readonly featureDeclarationIndex: number;
  readonly systemId: string;
  readonly withinFeatureDeclarationIndex: number;
  readonly run: (context: ClientPresentationSystemContext) => unknown;
}

export interface ClientSimulationScheduleReportEntry {
  readonly domain: "client-simulation";
  readonly phase: ClientSimulationPhase;
  readonly priority: number;
  readonly featureId: string;
  readonly featureDeclarationIndex: number;
  readonly systemId: string;
  readonly withinFeatureDeclarationIndex: number;
  readonly finalExecutionIndex: number;
}

export interface ClientPresentationScheduleReportEntry {
  readonly domain: "client-presentation";
  readonly phase: ClientPresentationPhase;
  readonly priority: number;
  readonly featureId: string;
  readonly featureDeclarationIndex: number;
  readonly systemId: string;
  readonly withinFeatureDeclarationIndex: number;
  readonly finalExecutionIndex: number;
}

export type ClientSimulationScheduleReport =
  readonly ClientSimulationScheduleReportEntry[];
export type ClientPresentationScheduleReport =
  readonly ClientPresentationScheduleReportEntry[];
export type ClientScheduleReport = readonly (
  | ClientSimulationScheduleReportEntry
  | ClientPresentationScheduleReportEntry
)[];

export interface PresentationFrameReport {
  readonly frame: number;
  readonly timestampMs: number;
}

export interface ClientSchedulingInspection {
  readonly tick: number;
  readonly driver: SimulationDriver;
  readonly accumulatorSeconds: number;
  readonly cumulativeDiscardedSeconds: number;
  readonly lastPump: WallClockPumpReport | null;
  readonly presentationFrameCount: number;
  readonly lastPresentationTimestampMs: number | null;
  readonly hasOutstandingPresentationRequest: boolean;
  readonly simulationScheduleReport: ClientSimulationScheduleReport;
  readonly presentationScheduleReport: ClientPresentationScheduleReport;
  readonly scheduleReport: ClientScheduleReport;
  readonly lastPresentationFrame: OperationResult<PresentationFrameReport> | null;
  readonly runtimeErrors: readonly RuntimeErrorRecord[];
}

export interface CreateClientScheduleOptions {
  readonly driver: SimulationDriver;
  readonly world: World;
  readonly simulationSystems: readonly ClientSimulationSystemDeclaration[];
  readonly presentationSystems: readonly ClientPresentationSystemDeclaration[];
  readonly frameSource: PresentationFrameSource;
  readonly telemetryStore?: TelemetryStore<"client">;
  readonly observationClock?: () => number;
}

export interface ClientSchedule {
  readonly driver: SimulationDriver;
  readonly tick: number;
  readonly accumulatorSeconds: number;
  readonly cumulativeDiscardedSeconds: number;
  readonly presentationFrameCount: number;
  readonly lastPresentationTimestampMs: number | null;
  readonly simulationScheduleReport: ClientSimulationScheduleReport;
  readonly presentationScheduleReport: ClientPresentationScheduleReport;
  readonly scheduleReport: ClientScheduleReport;
  readonly errors: readonly RuntimeErrorRecord[];
  readonly lastPump: WallClockPumpReport | null;
  readonly lastPresentationFrame: OperationResult<PresentationFrameReport> | null;
  stepExact(count: number): OperationResult<number>;
  pumpWallClock(elapsedSeconds: number): OperationResult<WallClockPumpReport>;
  startPresentation(): OperationResult<boolean>;
  inspectScheduling(): ClientSchedulingInspection;
  stop(): void;
}

export type CreateClientScheduleResult = OperationResult<ClientSchedule>;

interface InternalSimulationSystem {
  readonly declaration: ClientSimulationSystemDeclaration;
  readonly report: ClientSimulationScheduleReportEntry;
}

interface InternalPresentationSystem {
  readonly declaration: ClientPresentationSystemDeclaration;
  readonly report: ClientPresentationScheduleReportEntry;
}

interface ValidatedSchedules {
  readonly simulation: readonly InternalSimulationSystem[];
  readonly presentation: readonly InternalPresentationSystem[];
}

interface PendingPresentationRequest {
  readonly generation: number;
  request: PresentationFrameRequest | null;
}

type ObservationRead =
  | Readonly<{ ok: true; value: number }>
  | Readonly<{ ok: false; cause?: unknown }>;

function ok<T>(value: T): OperationResult<T> {
  return Object.freeze({ ok: true, value });
}

function fail<T>(error: RuntimeErrorRecord): OperationResult<T> {
  return Object.freeze({ ok: false, error });
}

function safeGet(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function createDefaultObservationClock(): () => number {
  let last = 0;
  return () => {
    try {
      const sampled = Date.now() / 1_000;
      if (Number.isFinite(sampled) && sampled > last) last = sampled;
    } catch {
      // A clock used only for observation must never destabilize scheduling.
    }
    return last;
  };
}

function isClientStore(value: unknown): value is TelemetryStore<"client"> {
  if (
    (typeof value !== "object" || value === null) &&
    typeof value !== "function"
  )
    return false;
  return (
    safeGet(value as object, "runtime") === "client" &&
    typeof safeGet(value as object, "recordRuntimeError") === "function" &&
    typeof safeGet(value as object, "snapshotTelemetry") === "function"
  );
}

function validationFailure(
  store: TelemetryStore<"client">,
  code: string,
  message: string,
  featureId?: string,
): OperationResult<never> {
  return fail(
    store.recordRuntimeError({
      code,
      category: "expected",
      runtime: "client",
      operation: "create-client-schedule",
      message,
      ...(featureId === undefined ? {} : { featureId }),
      context: Object.freeze([]),
    }),
  );
}

function stableId(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.trim() === value
  );
}

function compareSimulation(
  left: InternalSimulationSystem,
  right: InternalSimulationSystem,
): number {
  const phase =
    CLIENT_SIMULATION_PHASES.indexOf(left.declaration.phase) -
    CLIENT_SIMULATION_PHASES.indexOf(right.declaration.phase);
  if (phase !== 0) return phase;
  if (left.declaration.priority !== right.declaration.priority)
    return left.declaration.priority < right.declaration.priority ? -1 : 1;
  if (
    left.declaration.featureDeclarationIndex !==
    right.declaration.featureDeclarationIndex
  )
    return (
      left.declaration.featureDeclarationIndex -
      right.declaration.featureDeclarationIndex
    );
  return (
    left.declaration.withinFeatureDeclarationIndex -
    right.declaration.withinFeatureDeclarationIndex
  );
}

function comparePresentation(
  left: InternalPresentationSystem,
  right: InternalPresentationSystem,
): number {
  const phase =
    CLIENT_PRESENTATION_PHASES.indexOf(left.declaration.phase) -
    CLIENT_PRESENTATION_PHASES.indexOf(right.declaration.phase);
  if (phase !== 0) return phase;
  if (left.declaration.priority !== right.declaration.priority)
    return left.declaration.priority < right.declaration.priority ? -1 : 1;
  if (
    left.declaration.featureDeclarationIndex !==
    right.declaration.featureDeclarationIndex
  )
    return (
      left.declaration.featureDeclarationIndex -
      right.declaration.featureDeclarationIndex
    );
  return (
    left.declaration.withinFeatureDeclarationIndex -
    right.declaration.withinFeatureDeclarationIndex
  );
}

function validate(
  options: CreateClientScheduleOptions,
  store: TelemetryStore<"client">,
): OperationResult<ValidatedSchedules> {
  if (typeof options !== "object" || options === null)
    return validationFailure(
      store,
      "invalid-schedule",
      "Schedule options must be an object",
    );
  const rawOptions = options as unknown as Record<string, unknown>;
  if (rawOptions["driver"] !== "exact" && rawOptions["driver"] !== "wall-clock")
    return validationFailure(
      store,
      "invalid-driver-mode",
      "Driver must be exact or wall-clock",
    );
  if (
    (typeof rawOptions["world"] !== "object" || rawOptions["world"] === null) &&
    typeof rawOptions["world"] !== "function"
  )
    return validationFailure(store, "invalid-schedule", "A World is required");
  if (
    !Array.isArray(rawOptions["simulationSystems"]) ||
    !Array.isArray(rawOptions["presentationSystems"])
  )
    return validationFailure(
      store,
      "invalid-schedule",
      "Client system declarations must be arrays",
    );
  const frameSource = rawOptions["frameSource"];
  if (
    ((typeof frameSource !== "object" || frameSource === null) &&
      typeof frameSource !== "function") ||
    typeof safeGet(frameSource as object, "request") !== "function" ||
    typeof safeGet(frameSource as object, "cancel") !== "function"
  )
    return validationFailure(
      store,
      "invalid-frame-source",
      "A synchronous PresentationFrameSource is required",
    );

  const expectedKeys = [
    "domain",
    "featureDeclarationIndex",
    "featureId",
    "phase",
    "priority",
    "run",
    "systemId",
    "withinFeatureDeclarationIndex",
  ]
    .sort()
    .join("|");
  const ids = new Set<string>();
  const within = new Set<string>();
  const featureByIndex = new Map<number, string>();
  const indexByFeature = new Map<string, number>();
  const simulation: InternalSimulationSystem[] = [];
  const presentation: InternalPresentationSystem[] = [];
  const sources = [
    {
      domain: "client-simulation" as const,
      systems: rawOptions["simulationSystems"],
    },
    {
      domain: "client-presentation" as const,
      systems: rawOptions["presentationSystems"],
    },
  ];

  for (const source of sources) {
    for (const candidate of source.systems) {
      if (
        typeof candidate !== "object" ||
        candidate === null ||
        Object.keys(candidate).sort().join("|") !== expectedKeys
      )
        return validationFailure(
          store,
          "invalid-system-declaration",
          "A system declaration has an invalid shape",
        );
      const raw = candidate as Record<string, unknown>;
      const featureId = raw["featureId"];
      const systemId = raw["systemId"];
      const domain = raw["domain"];
      const phase = raw["phase"];
      const priority = raw["priority"];
      const featureDeclarationIndex = raw["featureDeclarationIndex"];
      const withinFeatureDeclarationIndex =
        raw["withinFeatureDeclarationIndex"];
      const run = raw["run"];
      if (domain !== source.domain)
        return validationFailure(
          store,
          "wrong-schedule-domain",
          "Client systems must be declared in their matching domain",
          typeof featureId === "string" ? featureId : undefined,
        );
      const phaseIsValid =
        source.domain === "client-simulation"
          ? (CLIENT_SIMULATION_PHASES as readonly unknown[]).includes(phase)
          : (CLIENT_PRESENTATION_PHASES as readonly unknown[]).includes(phase);
      if (!phaseIsValid)
        return validationFailure(
          store,
          "invalid-system-phase",
          "System phase is not in its Client schedule domain",
          typeof featureId === "string" ? featureId : undefined,
        );
      if (!Number.isSafeInteger(priority))
        return validationFailure(
          store,
          "invalid-system-priority",
          "System priority must be a signed safe integer",
          typeof featureId === "string" ? featureId : undefined,
        );
      if (!stableId(featureId))
        return validationFailure(
          store,
          "invalid-system-declaration",
          "Feature ID must be stable and non-empty",
        );
      if (!stableId(systemId))
        return validationFailure(
          store,
          "invalid-system-declaration",
          "System ID must be stable and non-empty",
          featureId,
        );
      if (
        !Number.isSafeInteger(featureDeclarationIndex) ||
        (featureDeclarationIndex as number) < 0 ||
        !Number.isSafeInteger(withinFeatureDeclarationIndex) ||
        (withinFeatureDeclarationIndex as number) < 0 ||
        typeof run !== "function"
      )
        return validationFailure(
          store,
          "invalid-system-declaration",
          "System declaration indices and callback are invalid",
          featureId,
        );
      if (ids.has(systemId))
        return validationFailure(
          store,
          "duplicate-system-id",
          "Duplicate system IDs are not permitted",
          featureId,
        );
      ids.add(systemId);
      const featureIndex = featureDeclarationIndex as number;
      const contributionIndex = withinFeatureDeclarationIndex as number;
      const knownFeature = featureByIndex.get(featureIndex);
      const knownIndex = indexByFeature.get(featureId);
      if (
        (knownFeature !== undefined && knownFeature !== featureId) ||
        (knownIndex !== undefined && knownIndex !== featureIndex)
      )
        return validationFailure(
          store,
          "invalid-system-declaration",
          "Feature declaration indices must identify one Feature",
          featureId,
        );
      featureByIndex.set(featureIndex, featureId);
      indexByFeature.set(featureId, featureIndex);
      const withinKey = featureId + "\u0000" + String(contributionIndex);
      if (within.has(withinKey))
        return validationFailure(
          store,
          "invalid-system-declaration",
          "Within-Feature declaration indices must be unique",
          featureId,
        );
      within.add(withinKey);

      if (source.domain === "client-simulation") {
        const declaration = Object.freeze({
          domain: "client-simulation" as const,
          phase: phase as ClientSimulationPhase,
          priority: priority as number,
          featureId,
          featureDeclarationIndex: featureIndex,
          systemId,
          withinFeatureDeclarationIndex: contributionIndex,
          run: run as (context: ClientSimulationSystemContext) => unknown,
        });
        simulation.push({
          declaration,
          report: Object.freeze({
            domain: declaration.domain,
            phase: declaration.phase,
            priority: declaration.priority,
            featureId,
            featureDeclarationIndex: featureIndex,
            systemId,
            withinFeatureDeclarationIndex: contributionIndex,
            finalExecutionIndex: -1,
          }),
        });
      } else {
        const declaration = Object.freeze({
          domain: "client-presentation" as const,
          phase: phase as ClientPresentationPhase,
          priority: priority as number,
          featureId,
          featureDeclarationIndex: featureIndex,
          systemId,
          withinFeatureDeclarationIndex: contributionIndex,
          run: run as (context: ClientPresentationSystemContext) => unknown,
        });
        presentation.push({
          declaration,
          report: Object.freeze({
            domain: declaration.domain,
            phase: declaration.phase,
            priority: declaration.priority,
            featureId,
            featureDeclarationIndex: featureIndex,
            systemId,
            withinFeatureDeclarationIndex: contributionIndex,
            finalExecutionIndex: -1,
          }),
        });
      }
    }
  }

  simulation.sort(compareSimulation);
  presentation.sort(comparePresentation);
  return ok(
    Object.freeze({
      simulation: Object.freeze(
        simulation.map((entry, finalExecutionIndex) =>
          Object.freeze({
            declaration: entry.declaration,
            report: Object.freeze({ ...entry.report, finalExecutionIndex }),
          }),
        ),
      ),
      presentation: Object.freeze(
        presentation.map((entry, finalExecutionIndex) =>
          Object.freeze({
            declaration: entry.declaration,
            report: Object.freeze({ ...entry.report, finalExecutionIndex }),
          }),
        ),
      ),
    }),
  );
}

class ClientScheduleImplementation implements ClientSchedule {
  private currentTick = 0;
  private currentAccumulator = 0;
  private discarded = 0;
  private currentFrame = 0;
  private currentTimestamp: number | null = null;
  private stopped = false;
  private generation = 1;
  private presentationStarted = false;
  private pending: PendingPresentationRequest | null = null;
  private pumpReport: WallClockPumpReport | null = null;
  private frameReport: OperationResult<PresentationFrameReport> | null = null;
  private readonly simulationReport: ClientSimulationScheduleReport;
  private readonly presentationReport: ClientPresentationScheduleReport;
  private readonly combinedReport: ClientScheduleReport;
  private readonly simulationExecutions: readonly ClientSimulationSystemDeclaration[];
  private readonly presentationExecutions: readonly ClientPresentationSystemDeclaration[];

  constructor(
    private readonly mode: SimulationDriver,
    private readonly world: World,
    systems: ValidatedSchedules,
    private readonly frameSource: PresentationFrameSource,
    private readonly telemetryStore: TelemetryStore<"client">,
    private readonly observationClock: () => number,
  ) {
    this.simulationReport = Object.freeze(
      systems.simulation.map((system) => system.report),
    );
    this.presentationReport = Object.freeze(
      systems.presentation.map((system) => system.report),
    );
    this.combinedReport = Object.freeze([
      ...this.simulationReport,
      ...this.presentationReport,
    ]);
    this.simulationExecutions = Object.freeze(
      systems.simulation.map((system) => system.declaration),
    );
    this.presentationExecutions = Object.freeze(
      systems.presentation.map((system) => system.declaration),
    );
    this.telemetryStore.observeClientSchedule(this.combinedReport);
  }

  get driver(): SimulationDriver {
    return this.mode;
  }
  get tick(): number {
    return this.currentTick;
  }
  get accumulatorSeconds(): number {
    return this.currentAccumulator;
  }
  get cumulativeDiscardedSeconds(): number {
    return this.discarded;
  }
  get presentationFrameCount(): number {
    return this.currentFrame;
  }
  get lastPresentationTimestampMs(): number | null {
    return this.currentTimestamp;
  }
  get simulationScheduleReport(): ClientSimulationScheduleReport {
    return this.simulationReport;
  }
  get presentationScheduleReport(): ClientPresentationScheduleReport {
    return this.presentationReport;
  }
  get scheduleReport(): ClientScheduleReport {
    return this.combinedReport;
  }
  get errors(): readonly RuntimeErrorRecord[] {
    return this.telemetryStore.snapshotTelemetry().structuredRuntimeErrors;
  }
  get lastPump(): WallClockPumpReport | null {
    return this.pumpReport;
  }
  get lastPresentationFrame(): OperationResult<PresentationFrameReport> | null {
    return this.frameReport;
  }

  stepExact(count: number): OperationResult<number> {
    if (this.stopped)
      return fail(
        this.record(
          "runtime-stopped",
          "expected",
          "step-exact",
          "Stopped schedules cannot advance",
        ),
      );
    if (this.mode !== "exact")
      return fail(
        this.record(
          "driver-mode",
          "expected",
          "step-exact",
          "Exact stepping is unavailable for a wall-clock schedule",
        ),
      );
    if (!Number.isSafeInteger(count) || count < 0)
      return fail(
        this.record(
          "invalid-step-count",
          "expected",
          "step-exact",
          "Step count must be a non-negative safe integer",
        ),
      );
    if (count > Number.MAX_SAFE_INTEGER - this.currentTick)
      return fail(
        this.record(
          "tick-overflow",
          "invariant",
          "step-exact",
          "Simulation tick would exceed Number.MAX_SAFE_INTEGER",
        ),
      );
    for (let index = 0; index < count; index += 1) {
      const result = this.executeTick();
      if (!result.ok) return result;
    }
    return ok(this.currentTick);
  }

  pumpWallClock(elapsedSeconds: number): OperationResult<WallClockPumpReport> {
    if (this.stopped)
      return fail(
        this.record(
          "runtime-stopped",
          "expected",
          "pump-wall-clock",
          "Stopped schedules cannot pump",
        ),
      );
    if (this.mode !== "wall-clock")
      return fail(
        this.record(
          "driver-mode",
          "expected",
          "pump-wall-clock",
          "Wall-clock pumping is unavailable for an exact schedule",
        ),
      );
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0)
      return fail(
        this.record(
          "clock-failure",
          "expected",
          "pump-wall-clock",
          "Elapsed time must be finite and non-negative",
        ),
      );
    const available =
      WALL_CLOCK_ACCUMULATOR_CAP_SECONDS - this.currentAccumulator;
    const inputDiscarded =
      elapsedSeconds > available ? elapsedSeconds - available : 0;
    const nextDiscarded = this.discarded + inputDiscarded;
    if (!Number.isFinite(nextDiscarded))
      return fail(
        this.record(
          "telemetry-overflow",
          "invariant",
          "pump-wall-clock",
          "Discarded-time telemetry would become non-finite",
        ),
      );
    this.currentAccumulator =
      elapsedSeconds >= available
        ? WALL_CLOCK_ACCUMULATOR_CAP_SECONDS
        : this.currentAccumulator + elapsedSeconds;
    this.discarded = nextDiscarded;
    const backlog = this.currentAccumulator;
    let ticksExecuted = 0;
    while (
      this.currentAccumulator >= SIMULATION_DT_SECONDS &&
      ticksExecuted < MAX_WALL_CLOCK_TICKS_PER_PUMP
    ) {
      this.currentAccumulator -= SIMULATION_DT_SECONDS;
      const result = this.executeTick();
      if (!result.ok) return result;
      ticksExecuted += 1;
    }
    let budgetDiscarded = 0;
    if (ticksExecuted === MAX_WALL_CLOCK_TICKS_PER_PUMP) {
      const wholeTicks = Math.floor(
        this.currentAccumulator / SIMULATION_DT_SECONDS,
      );
      budgetDiscarded = wholeTicks * SIMULATION_DT_SECONDS;
      this.currentAccumulator -= budgetDiscarded;
      this.discarded += budgetDiscarded;
    }
    const report = Object.freeze({
      elapsedSeconds,
      backlogBeforeExecutionSeconds: backlog,
      ticksExecuted,
      accumulatorSeconds: this.currentAccumulator,
      discardedSeconds: inputDiscarded + budgetDiscarded,
      cumulativeDiscardedSeconds: this.discarded,
    });
    this.pumpReport = report;
    this.telemetryStore.observeClientPump(this.discarded);
    return ok(report);
  }

  startPresentation(): OperationResult<boolean> {
    if (this.stopped)
      return fail(
        this.record(
          "runtime-stopped",
          "expected",
          "start-presentation",
          "Stopped schedules cannot request presentation frames",
        ),
      );
    if (this.presentationStarted) return ok(false);
    this.presentationStarted = true;
    const requested = this.requestNextFrame();
    if (!requested.ok) {
      this.presentationStarted = false;
      return requested;
    }
    return ok(true);
  }

  inspectScheduling(): ClientSchedulingInspection {
    return Object.freeze({
      tick: this.currentTick,
      driver: this.mode,
      accumulatorSeconds: this.currentAccumulator,
      cumulativeDiscardedSeconds: this.discarded,
      lastPump: this.pumpReport,
      presentationFrameCount: this.currentFrame,
      lastPresentationTimestampMs: this.currentTimestamp,
      hasOutstandingPresentationRequest: this.pending !== null,
      simulationScheduleReport: this.simulationReport,
      presentationScheduleReport: this.presentationReport,
      scheduleReport: this.combinedReport,
      lastPresentationFrame: this.frameReport,
      runtimeErrors: this.errors,
    });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.generation += 1;
    const pending = this.pending;
    this.pending = null;
    if (pending?.request === null || pending === null) return;
    try {
      this.frameSource.cancel(pending.request);
    } catch (cause) {
      this.record(
        "frame-source-cancel-threw",
        "invariant",
        "cancel-presentation-frame",
        "Presentation frame cancellation threw",
        undefined,
        undefined,
        undefined,
        cause,
      );
    }
  }

  private executeTick(): OperationResult<number> {
    if (this.stopped)
      return fail(
        this.record(
          "runtime-stopped",
          "expected",
          "execute-tick",
          "Stopped schedules cannot advance",
        ),
      );
    if (this.currentTick === Number.MAX_SAFE_INTEGER)
      return fail(
        this.record(
          "tick-overflow",
          "invariant",
          "execute-tick",
          "Simulation tick would exceed Number.MAX_SAFE_INTEGER",
        ),
      );
    this.currentTick += 1;
    const context = Object.freeze({
      world: this.world,
      tick: this.currentTick,
      dt: SIMULATION_DT_SECONDS,
    });
    for (const system of this.simulationExecutions) {
      if (this.stopped) break;
      const error = this.invokeSystem(
        system.run,
        context,
        this.currentTick,
        system.featureId,
        system.phase,
        system.systemId,
      );
      if (error !== null) {
        this.telemetryStore.observeClientTick(
          this.currentTick,
          this.world.entityCount,
        );
        return fail(error);
      }
    }
    this.telemetryStore.observeClientTick(
      this.currentTick,
      this.world.entityCount,
    );
    return ok(this.currentTick);
  }

  private executePresentationFrame(
    timestampMs: number,
  ): OperationResult<PresentationFrameReport> {
    if (
      !Number.isFinite(timestampMs) ||
      (this.currentTimestamp !== null && timestampMs < this.currentTimestamp)
    )
      return fail(
        this.record(
          "frame-source-failure",
          "expected",
          "deliver-presentation-frame",
          "Presentation timestamps must be finite and non-decreasing",
        ),
      );
    if (this.currentFrame === Number.MAX_SAFE_INTEGER)
      return fail(
        this.record(
          "presentation-frame-overflow",
          "invariant",
          "deliver-presentation-frame",
          "Presentation frame count would exceed Number.MAX_SAFE_INTEGER",
        ),
      );
    this.currentFrame += 1;
    this.currentTimestamp = timestampMs;
    const context = Object.freeze({
      frame: this.currentFrame,
      timestampMs,
    });
    const started = this.readObservationClock();
    for (const system of this.presentationExecutions) {
      if (this.stopped) break;
      const error = this.invokeSystem(
        system.run,
        context,
        undefined,
        system.featureId,
        system.phase,
        system.systemId,
      );
      if (error !== null) return fail(error);
    }
    const ended = this.readObservationClock();
    if (!started.ok || !ended.ok || ended.value < started.value) {
      const cause = !started.ok
        ? started.cause
        : !ended.ok
          ? ended.cause
          : undefined;
      return fail(
        this.record(
          "observation-clock-failure",
          "invariant",
          "observe-client-frame",
          "The monotonic observation clock produced an invalid sample",
          undefined,
          undefined,
          undefined,
          cause,
        ),
      );
    }
    this.telemetryStore.observeClientFrame(
      this.currentFrame,
      ended.value - started.value,
    );
    return ok(
      Object.freeze({
        frame: this.currentFrame,
        timestampMs,
      }),
    );
  }

  private readObservationClock(): ObservationRead {
    try {
      const value = this.observationClock();
      return Number.isFinite(value) && value >= 0
        ? Object.freeze({ ok: true, value })
        : Object.freeze({ ok: false });
    } catch (cause) {
      return Object.freeze({ ok: false, cause });
    }
  }

  private invokeSystem<TContext>(
    run: (context: TContext) => unknown,
    context: TContext,
    tick: number | undefined,
    featureId: string,
    phase: string,
    systemId: string,
  ): RuntimeErrorRecord | null {
    try {
      const output = run(context);
      if (
        (typeof output === "object" && output !== null) ||
        typeof output === "function"
      ) {
        const then = (output as { readonly then?: unknown }).then;
        if (typeof then === "function") {
          if (output instanceof Promise) void output.catch(() => undefined);
          return this.record(
            "system-returned-thenable",
            "invariant",
            "execute-system",
            "Synchronous systems must not return thenables",
            tick,
            featureId,
            [
              { key: "phase", value: phase },
              { key: "systemId", value: systemId },
            ],
          );
        }
      }
      return null;
    } catch (cause) {
      return this.record(
        "system-threw",
        "invariant",
        "execute-system",
        "Synchronous system threw",
        tick,
        featureId,
        [
          { key: "phase", value: phase },
          { key: "systemId", value: systemId },
        ],
        cause,
      );
    }
  }

  private requestNextFrame(): OperationResult<boolean> {
    if (this.stopped || this.pending !== null) return ok(false);
    const pending: PendingPresentationRequest = {
      generation: this.generation,
      request: null,
    };
    const callback = (timestampMs: number): void => {
      if (
        this.stopped ||
        pending.generation !== this.generation ||
        this.pending !== pending
      )
        return;
      this.pending = null;
      this.frameReport = this.executePresentationFrame(timestampMs);
      if (!this.stopped && pending.generation === this.generation)
        this.requestNextFrame();
    };
    try {
      pending.request = this.frameSource.request(callback);
      this.pending = pending;
      return ok(true);
    } catch (cause) {
      return fail(
        this.record(
          "frame-source-request-threw",
          "invariant",
          "request-presentation-frame",
          "Presentation frame request threw",
          undefined,
          undefined,
          undefined,
          cause,
        ),
      );
    }
  }

  private record(
    code: string,
    category: RuntimeErrorCategory,
    operation: string,
    message: string,
    tick?: number,
    featureId?: string,
    context?: readonly RuntimeErrorContextEntry[],
    cause?: unknown,
  ): RuntimeErrorRecord {
    const input: RuntimeErrorInput = {
      code,
      category,
      runtime: "client",
      operation,
      message,
      ...(tick === undefined ? {} : { tick }),
      ...(featureId === undefined ? {} : { featureId }),
      ...(context === undefined ? {} : { context }),
      ...(cause === undefined ? {} : { cause }),
    };
    return this.telemetryStore.recordRuntimeError(input);
  }
}

export function createClientSchedule(
  options: CreateClientScheduleOptions,
): CreateClientScheduleResult {
  const source =
    (typeof options === "object" && options !== null) ||
    typeof options === "function"
      ? (options as unknown as object)
      : Object.freeze({});
  const supplied = safeGet(source, "telemetryStore");
  const telemetryStore = isClientStore(supplied)
    ? supplied
    : createTelemetryStore({ runtime: "client" });
  const validated = validate(options, telemetryStore);
  if (!validated.ok) return validated;
  const rawClock = safeGet(source, "observationClock");
  const observationClock =
    typeof rawClock === "function"
      ? (rawClock as () => number)
      : createDefaultObservationClock();
  return ok(
    new ClientScheduleImplementation(
      options.driver,
      options.world,
      validated.value,
      options.frameSource,
      telemetryStore,
      observationClock,
    ),
  );
}

export interface DeterministicPresentationFrameSource
  extends PresentationFrameSource {
  readonly outstandingRequestCount: number;
  readonly requestCount: number;
  readonly cancellationCount: number;
  readonly deliveryCount: number;
  deliver(timestampMs: number): boolean;
}

class DeterministicRequest implements PresentationFrameRequest {
  declare readonly [presentationFrameRequestBrand]: never;
  active = true;
  constructor(public callback: ((timestampMs: number) => void) | null) {}
}

class DeterministicPresentationFrameSourceImplementation
  implements DeterministicPresentationFrameSource
{
  private readonly requests = new Map<
    PresentationFrameRequest,
    DeterministicRequest
  >();
  private requested = 0;
  private cancelled = 0;
  private delivered = 0;

  get outstandingRequestCount(): number {
    return this.requests.size;
  }
  get requestCount(): number {
    return this.requested;
  }
  get cancellationCount(): number {
    return this.cancelled;
  }
  get deliveryCount(): number {
    return this.delivered;
  }

  request(callback: (timestampMs: number) => void): PresentationFrameRequest {
    if (typeof callback !== "function")
      throw new TypeError("Presentation callback must be a function");
    const request = new DeterministicRequest(callback);
    this.requests.set(request, request);
    this.requested += 1;
    return request;
  }

  cancel(request: PresentationFrameRequest): void {
    const owned = this.requests.get(request);
    if (owned === undefined || !owned.active) return;
    owned.active = false;
    owned.callback = null;
    this.requests.delete(request);
    this.cancelled += 1;
  }

  deliver(timestampMs: number): boolean {
    const next = this.requests.values().next();
    if (next.done) return false;
    const request = next.value;
    const callback = request.callback;
    request.active = false;
    request.callback = null;
    this.requests.delete(request);
    this.delivered += 1;
    if (callback !== null) callback(timestampMs);
    return true;
  }
}

export function createDeterministicPresentationFrameSource(): DeterministicPresentationFrameSource {
  return new DeterministicPresentationFrameSourceImplementation();
}
