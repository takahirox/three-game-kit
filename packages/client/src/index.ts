import {
  createClientFeatureRuntime,
  type ClientFeatureBootResult,
  type ClientFeatureDescriptor,
  type ClientFeatureLifecycleInspection,
  type ClientFeatureRuntime as CoreClientFeatureRuntime,
  type ClientFeatureStoppedResult,
  type ClientScheduleReport,
  type ClientTelemetrySnapshot,
  type FeatureLifecycleState,
  type OperationResult,
  type PresentationFrameRequest,
  type PresentationFrameSource,
  type TelemetryStore,
  type WallClockPumpReport,
} from "@three-game-kit/core";

export interface RuntimeOptions {
  readonly features: readonly ClientFeatureDescriptor<unknown>[];
  readonly frameSource: PresentationFrameSource;
  readonly configuration?: Readonly<Record<string, unknown>>;
  readonly driver?: "exact" | "wall-clock";
  readonly telemetryStore?: TelemetryStore<"client">;
  readonly observationClock?: () => number;
  readonly hostServices?: Readonly<Record<string, unknown>>;
}

/**
 * Client host for one immutable Feature composition and the single Core World
 * owned by its delegated Client Feature runtime.
 */
export class Runtime {
  readonly driver: "exact" | "wall-clock";
  private readonly delegate: CoreClientFeatureRuntime;

  constructor(options: RuntimeOptions) {
    this.driver = options.driver ?? "exact";
    this.delegate = createClientFeatureRuntime(options);
  }

  get state(): FeatureLifecycleState {
    return this.delegate.state;
  }

  get tick(): number {
    return this.delegate.snapshotTelemetry().simulationTick;
  }

  get scheduleReport(): ClientScheduleReport {
    return this.delegate.inspectLifecycle().scheduleReport;
  }

  get telemetryStore(): TelemetryStore<"client"> {
    return this.delegate.telemetryStore;
  }

  start(): Promise<ClientFeatureBootResult> {
    return this.delegate.boot();
  }

  boot(): Promise<ClientFeatureBootResult> {
    return this.delegate.boot();
  }

  stepExact(count: number): OperationResult<number> {
    return this.delegate.stepExact(count);
  }

  pumpWallClock(elapsedSeconds: number): OperationResult<WallClockPumpReport> {
    return this.delegate.pumpWallClock(elapsedSeconds);
  }

  startPresentation(): OperationResult<boolean> {
    return this.delegate.startPresentation();
  }

  snapshotTelemetry(): ClientTelemetrySnapshot {
    return this.delegate.snapshotTelemetry();
  }

  inspectLifecycle(): ClientFeatureLifecycleInspection {
    return this.delegate.inspectLifecycle();
  }

  shutdown(): Promise<ClientFeatureStoppedResult> {
    return this.delegate.shutdown();
  }
}

export { Runtime as ClientRuntime };

export function createRuntime(options: RuntimeOptions): Runtime {
  return new Runtime(options);
}

export function createClientRuntime(options: RuntimeOptions): Runtime {
  return new Runtime(options);
}

/**
 * Adapts caller-supplied browser frame functions without reading browser
 * globals or exposing their request-handle type.
 */
export function createBrowserPresentationFrameSource<TRequest>(
  requestAnimationFrame: (
    callback: (timestampMs: number) => void,
  ) => TRequest,
  cancelAnimationFrame: (request: TRequest) => void,
): PresentationFrameSource {
  if (
    typeof requestAnimationFrame !== "function" ||
    typeof cancelAnimationFrame !== "function"
  ) {
    throw new TypeError("Browser presentation frame functions are invalid");
  }

  const requestFrame = requestAnimationFrame;
  const cancelFrame = cancelAnimationFrame;
  const activeRequests = new Map<PresentationFrameRequest, TRequest>();
  return Object.freeze({
    request(callback: (timestampMs: number) => void): PresentationFrameRequest {
      if (typeof callback !== "function") {
        throw new TypeError("Presentation frame callback is invalid");
      }
      const request = Object.freeze({}) as PresentationFrameRequest;
      const browserRequest = requestFrame((timestampMs) => {
        if (!activeRequests.has(request)) return;
        activeRequests.delete(request);
        callback(timestampMs);
      });
      activeRequests.set(request, browserRequest);
      return request;
    },
    cancel(request: PresentationFrameRequest): void {
      if (!activeRequests.has(request)) return;
      const browserRequest = activeRequests.get(request) as TRequest;
      activeRequests.delete(request);
      cancelFrame(browserRequest);
    },
  });
}
