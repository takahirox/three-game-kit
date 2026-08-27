import {
  createServerFeatureRuntime,
  type FeatureDescriptor,
  type FeatureLifecycleInspection,
  type FeatureLifecycleState,
  type FeatureStoppedResult,
  type OperationResult,
  type ServerFeatureBootResult,
  type ServerFeatureRuntime,
  type ServerScheduleReport,
  type ServerTelemetrySnapshot,
  type TelemetryStore,
  type WallClockPumpReport,
} from "@three-game-kit/core";

export interface RuntimeOptions {
  readonly features: readonly FeatureDescriptor<unknown>[];
  readonly configuration?: Readonly<Record<string, unknown>>;
  readonly driver?: "exact" | "wall-clock";
  readonly telemetryStore?: TelemetryStore<"server">;
  readonly observationClock?: () => number;
  readonly hostServices?: Readonly<Record<string, unknown>>;
}

/**
 * Headless Server host for one immutable Feature composition and one Core World.
 * Construction does not boot Features; call start() or boot() before stepping.
 */
export class Runtime {
  readonly driver: "exact" | "wall-clock";
  private readonly delegate: ServerFeatureRuntime;

  constructor(options: RuntimeOptions) {
    this.driver = options.driver ?? "exact";
    this.delegate = createServerFeatureRuntime(options);
  }

  get state(): FeatureLifecycleState {
    return this.delegate.state;
  }

  get tick(): number {
    return this.delegate.snapshotTelemetry().simulationTick;
  }

  get scheduleReport(): ServerScheduleReport {
    return this.delegate.inspectLifecycle().scheduleReport;
  }

  get telemetryStore(): TelemetryStore<"server"> {
    return this.delegate.telemetryStore;
  }

  start(): Promise<ServerFeatureBootResult> {
    return this.delegate.boot();
  }

  boot(): Promise<ServerFeatureBootResult> {
    return this.delegate.boot();
  }

  stepExact(count: number): OperationResult<number> {
    return this.delegate.stepExact(count);
  }

  pumpWallClock(
    elapsedSeconds: number,
  ): OperationResult<WallClockPumpReport> {
    return this.delegate.pumpWallClock(elapsedSeconds);
  }

  snapshotTelemetry(): ServerTelemetrySnapshot {
    return this.delegate.snapshotTelemetry();
  }

  inspectLifecycle(): FeatureLifecycleInspection {
    return this.delegate.inspectLifecycle();
  }

  shutdown(): Promise<FeatureStoppedResult> {
    return this.delegate.shutdown();
  }
}

export { Runtime as ServerRuntime };

export function createRuntime(options: RuntimeOptions): Runtime {
  return new Runtime(options);
}

export function createServerRuntime(options: RuntimeOptions): Runtime {
  return new Runtime(options);
}
