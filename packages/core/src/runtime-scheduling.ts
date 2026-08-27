import type { World } from "./index.js";
import {
  createTelemetryStore,
  type RuntimeErrorCategory,
  type RuntimeErrorContextEntry,
  type RuntimeErrorInput,
  type RuntimeErrorRecord,
  type ServerTelemetrySnapshot,
  type TelemetryStore,
} from "./telemetry.js";
export const SIMULATION_DT_SECONDS = 1 / 60;
export const WALL_CLOCK_ACCUMULATOR_CAP_SECONDS = 0.25;
export const MAX_WALL_CLOCK_TICKS_PER_PUMP = 5;
export const SERVER_SIMULATION_PHASES = Object.freeze([
  "ingress",
  "validate-bind",
  "command-apply",
  "shared-movement",
  "authoritative-collision",
  "gameplay",
  "snapshot-build",
  "telemetry",
] as const);
export type ServerSimulationPhase = (typeof SERVER_SIMULATION_PHASES)[number];
export type SimulationDriver = "exact" | "wall-clock";
export type OperationResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: RuntimeErrorRecord }>;
export interface ServerSystemContext {
  readonly world: World;
  readonly tick: number;
  readonly dt: typeof SIMULATION_DT_SECONDS;
}
export interface ServerSystemDeclaration {
  readonly domain: "server-simulation";
  readonly phase: ServerSimulationPhase;
  readonly priority: number;
  readonly featureId: string;
  readonly featureDeclarationIndex: number;
  readonly systemId: string;
  readonly withinFeatureDeclarationIndex: number;
  readonly run: (context: ServerSystemContext) => unknown;
}
export interface ServerScheduleReportEntry {
  readonly domain: "server-simulation";
  readonly phase: ServerSimulationPhase;
  readonly priority: number;
  readonly featureId: string;
  readonly featureDeclarationIndex: number;
  readonly systemId: string;
  readonly withinFeatureDeclarationIndex: number;
  readonly finalExecutionIndex: number;
}
export type ServerScheduleReport = readonly ServerScheduleReportEntry[];
export interface WallClockPumpReport {
  readonly elapsedSeconds: number;
  readonly backlogBeforeExecutionSeconds: number;
  readonly ticksExecuted: number;
  readonly accumulatorSeconds: number;
  readonly discardedSeconds: number;
  readonly cumulativeDiscardedSeconds: number;
}
export interface ServerSchedulingTelemetry {
  readonly tick: number;
  readonly driver: SimulationDriver;
  readonly accumulatorSeconds: number;
  readonly cumulativeDiscardedSeconds: number;
  readonly lastPump: WallClockPumpReport | null;
  readonly runtimeErrors: readonly RuntimeErrorRecord[];
}
export interface CreateServerScheduleOptions {
  readonly driver: SimulationDriver;
  readonly world: World;
  readonly systems: readonly ServerSystemDeclaration[];
  readonly telemetryStore?: TelemetryStore<"server">;
  readonly observationClock?: () => number;
}
export interface ServerSchedule {
  readonly driver: SimulationDriver;
  readonly tick: number;
  readonly accumulatorSeconds: number;
  readonly cumulativeDiscardedSeconds: number;
  readonly scheduleReport: ServerScheduleReport;
  readonly telemetryStore: TelemetryStore<"server">;
  readonly errors: readonly RuntimeErrorRecord[];
  readonly lastPump: WallClockPumpReport | null;
  stepExact(count: number): OperationResult<number>;
  pumpWallClock(elapsedSeconds: number): OperationResult<WallClockPumpReport>;
  inspectScheduling(): ServerSchedulingTelemetry;
  snapshotTelemetry(): ServerTelemetrySnapshot;
  stop(): void;
}
export type CreateServerScheduleResult = OperationResult<ServerSchedule>;
interface InternalSystem {
  readonly declaration: ServerSystemDeclaration;
  readonly report: ServerScheduleReportEntry;
}
type ObservationRead =
  | Readonly<{ ok: true; value: number }>
  | Readonly<{ ok: false; cause?: unknown }>;
function safeGet(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}
function isServerStore(value: unknown): value is TelemetryStore<"server"> {
  if (
    (typeof value !== "object" || value === null) &&
    typeof value !== "function"
  )
    return false;
  return (
    safeGet(value as object, "runtime") === "server" &&
    typeof safeGet(value as object, "recordRuntimeError") === "function" &&
    typeof safeGet(value as object, "snapshotTelemetry") === "function"
  );
}
function ok<T>(value: T): OperationResult<T> {
  return Object.freeze({ ok: true, value });
}
function fail<T>(error: RuntimeErrorRecord): OperationResult<T> {
  return Object.freeze({ ok: false, error });
}
function validationFailure(
  store: TelemetryStore<"server">,
  code: string,
  message: string,
  featureId?: string,
): OperationResult<never> {
  return fail(
    store.recordRuntimeError({
      code,
      category: "expected",
      runtime: "server",
      operation: "create-server-schedule",
      message,
      ...(featureId === undefined ? {} : { featureId }),
      context: Object.freeze([]),
    }),
  );
}
function phaseRank(phase: ServerSimulationPhase): number {
  return SERVER_SIMULATION_PHASES.indexOf(phase);
}
function compareSystems(left: InternalSystem, right: InternalSystem): number {
  const leftPhase = phaseRank(left.declaration.phase);
  const rightPhase = phaseRank(right.declaration.phase);
  if (leftPhase !== rightPhase) return leftPhase - rightPhase;
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
  options: CreateServerScheduleOptions,
  store: TelemetryStore<"server">,
): OperationResult<readonly InternalSystem[]> {
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
  if (!Array.isArray(rawOptions["systems"]))
    return validationFailure(
      store,
      "invalid-schedule",
      "Systems must be an array",
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
  const collected: InternalSystem[] = [];
  for (const candidate of rawOptions["systems"]) {
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
    const withinFeatureDeclarationIndex = raw["withinFeatureDeclarationIndex"];
    const run = raw["run"];
    if (domain !== "server-simulation")
      return validationFailure(
        store,
        "wrong-schedule-domain",
        "Server systems must use the server-simulation domain",
        typeof featureId === "string" ? featureId : undefined,
      );
    if (!(SERVER_SIMULATION_PHASES as readonly unknown[]).includes(phase))
      return validationFailure(
        store,
        "invalid-system-phase",
        "System phase is not a Server simulation phase",
        typeof featureId === "string" ? featureId : undefined,
      );
    if (!Number.isSafeInteger(priority))
      return validationFailure(
        store,
        "invalid-system-priority",
        "System priority must be a signed safe integer",
        typeof featureId === "string" ? featureId : undefined,
      );
    if (
      typeof featureId !== "string" ||
      featureId.length === 0 ||
      featureId.trim() !== featureId
    )
      return validationFailure(
        store,
        "invalid-system-declaration",
        "Feature ID must be stable and non-empty",
      );
    if (
      typeof systemId !== "string" ||
      systemId.length === 0 ||
      systemId.trim() !== systemId
    )
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
    const knownFeature = featureByIndex.get(featureDeclarationIndex as number);
    const knownIndex = indexByFeature.get(featureId);
    if (
      (knownFeature !== undefined && knownFeature !== featureId) ||
      (knownIndex !== undefined && knownIndex !== featureDeclarationIndex)
    )
      return validationFailure(
        store,
        "invalid-system-declaration",
        "Feature declaration indices must identify one Feature",
        featureId,
      );
    featureByIndex.set(featureDeclarationIndex as number, featureId);
    indexByFeature.set(featureId, featureDeclarationIndex as number);
    const withinKey =
      featureId + "\u0000" + String(withinFeatureDeclarationIndex);
    if (within.has(withinKey))
      return validationFailure(
        store,
        "invalid-system-declaration",
        "Within-Feature declaration indices must be unique",
        featureId,
      );
    within.add(withinKey);
    const declaration = Object.freeze({
      domain: "server-simulation" as const,
      phase: phase as ServerSimulationPhase,
      priority: priority as number,
      featureId,
      featureDeclarationIndex: featureDeclarationIndex as number,
      systemId,
      withinFeatureDeclarationIndex: withinFeatureDeclarationIndex as number,
      run: run as (context: ServerSystemContext) => unknown,
    });
    collected.push({
      declaration,
      report: Object.freeze({
        domain: "server-simulation",
        phase: declaration.phase,
        priority: declaration.priority,
        featureId,
        featureDeclarationIndex: declaration.featureDeclarationIndex,
        systemId,
        withinFeatureDeclarationIndex:
          declaration.withinFeatureDeclarationIndex,
        finalExecutionIndex: -1,
      }),
    });
  }
  collected.sort(compareSystems);
  return ok(
    Object.freeze(
      collected.map((entry, finalExecutionIndex) =>
        Object.freeze({
          declaration: entry.declaration,
          report: Object.freeze({ ...entry.report, finalExecutionIndex }),
        }),
      ),
    ),
  );
}
class ServerScheduleImplementation implements ServerSchedule {
  private currentTick = 0;
  private currentAccumulator = 0;
  private discarded = 0;
  private stopped = false;
  private pumpReport: WallClockPumpReport | null = null;
  private readonly report: ServerScheduleReport;
  private readonly executions: readonly ServerSystemDeclaration[];
  constructor(
    private readonly mode: SimulationDriver,
    private readonly world: World,
    systems: readonly InternalSystem[],
    readonly telemetryStore: TelemetryStore<"server">,
    private readonly observationClock: () => number,
  ) {
    this.report = Object.freeze(systems.map((system) => system.report));
    this.executions = Object.freeze(
      systems.map((system) => system.declaration),
    );
    telemetryStore.observeEntityCount(world.entityCount);
    telemetryStore.observeServerSchedule(this.report);
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
  get scheduleReport(): ServerScheduleReport {
    return this.report;
  }
  get errors(): readonly RuntimeErrorRecord[] {
    return this.snapshotTelemetry().structuredRuntimeErrors;
  }
  get lastPump(): WallClockPumpReport | null {
    return this.pumpReport;
  }
  stop(): void {
    this.stopped = true;
  }
  snapshotTelemetry(): ServerTelemetrySnapshot {
    return this.telemetryStore.snapshotTelemetry();
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
    this.telemetryStore.observeServerPump(backlog, this.discarded);
    return ok(report);
  }
  inspectScheduling(): ServerSchedulingTelemetry {
    return Object.freeze({
      tick: this.currentTick,
      driver: this.mode,
      accumulatorSeconds: this.currentAccumulator,
      cumulativeDiscardedSeconds: this.discarded,
      lastPump: this.pumpReport,
      runtimeErrors: this.errors,
    });
  }
  private executeTick(): OperationResult<number> {
    if (this.currentTick === Number.MAX_SAFE_INTEGER)
      return fail(
        this.record(
          "tick-overflow",
          "invariant",
          "execute-tick",
          "Simulation tick would exceed Number.MAX_SAFE_INTEGER",
        ),
      );
    const started = this.readObservationClock();
    this.currentTick += 1;
    const context = Object.freeze({
      world: this.world,
      tick: this.currentTick,
      dt: SIMULATION_DT_SECONDS,
    });
    for (const system of this.executions) {
      try {
        const output = system.run(context);
        if (
          (typeof output === "object" && output !== null) ||
          typeof output === "function"
        ) {
          const then = (output as { readonly then?: unknown }).then;
          if (typeof then === "function") {
            if (output instanceof Promise) void output.catch(() => undefined);
            this.telemetryStore.observeServerTickAttempt(
              this.currentTick,
              this.world.entityCount,
            );
            return fail(
              this.record(
                "system-returned-thenable",
                "invariant",
                "execute-system",
                "Synchronous systems must not return thenables",
                this.currentTick,
                system.featureId,
                [
                  { key: "phase", value: system.phase },
                  { key: "systemId", value: system.systemId },
                ],
              ),
            );
          }
        }
      } catch (cause) {
        this.telemetryStore.observeServerTickAttempt(
          this.currentTick,
          this.world.entityCount,
        );
        return fail(
          this.record(
            "system-threw",
            "invariant",
            "execute-system",
            "Synchronous system threw",
            this.currentTick,
            system.featureId,
            [
              { key: "phase", value: system.phase },
              { key: "systemId", value: system.systemId },
            ],
            cause,
          ),
        );
      }
    }
    const ended = this.readObservationClock();
    if (!started.ok || !ended.ok || ended.value < started.value) {
      this.telemetryStore.observeServerTickAttempt(
        this.currentTick,
        this.world.entityCount,
      );
      const cause = !started.ok
        ? started.cause
        : !ended.ok
          ? ended.cause
          : undefined;
      return fail(
        this.telemetryStore.recordRuntimeError({
          code: "observation-clock-failure",
          category: "invariant",
          runtime: "server",
          operation: "observe-server-tick",
          message: "The monotonic observation clock produced an invalid sample",
          tick: this.currentTick,
          context: Object.freeze([]),
          ...(cause === undefined ? {} : { cause }),
        }),
      );
    }
    const duration = ended.value - started.value;
    this.telemetryStore.observeServerTick(
      this.currentTick,
      duration,
      this.world.entityCount,
    );
    return ok(this.currentTick);
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
      runtime: "server",
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
export function createServerSchedule(
  options: CreateServerScheduleOptions,
): CreateServerScheduleResult {
  const source =
    (typeof options === "object" && options !== null) ||
    typeof options === "function"
      ? (options as unknown as object)
      : Object.freeze({});
  const supplied = safeGet(source, "telemetryStore");
  const telemetryStore = isServerStore(supplied)
    ? supplied
    : createTelemetryStore({ runtime: "server" });
  const validated = validate(options, telemetryStore);
  if (!validated.ok) return validated;
  const rawClock = safeGet(source, "observationClock");
  const observationClock =
    typeof rawClock === "function" ? (rawClock as () => number) : () => 0;
  return ok(
    new ServerScheduleImplementation(
      options.driver,
      options.world,
      validated.value,
      telemetryStore,
      observationClock,
    ),
  );
}
