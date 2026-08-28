import {
  freezeFeatureConfigurationIssues,
  hasFeatureConfigurationDefinition,
  parseFeatureConfigurationProvider,
  type FeatureConfigurationIssue,
} from "./feature-configuration.js";
import { createWorld, type ResourceType, type World } from "./index.js";
import {
  CLIENT_PRESENTATION_PHASES,
  CLIENT_SIMULATION_PHASES,
  createClientSchedule,
  type ClientPresentationPhase,
  type ClientPresentationSystemContext,
  type ClientSchedule,
  type ClientScheduleReport,
  type ClientSimulationPhase,
  type ClientSimulationSystemContext,
  type PresentationFrameSource,
} from "./client-runtime-scheduling.js";
import { createRuntimeLiveFence, type RuntimeLiveFence } from "./mailbox.js";
import type {
  OperationResult,
  WallClockPumpReport,
} from "./runtime-scheduling.js";
import {
  LIVE_RESOURCE_KINDS,
  createTelemetryStore,
  type ClientTelemetrySnapshot,
  type LiveResourceKind,
  type RuntimeCauseSummary,
  type TelemetryStore,
} from "./telemetry.js";
import type {
  BorrowedFeatureValue,
  FeatureAbortSignal,
  FeatureDependencies,
  FeatureDescriptor,
  FeatureLifecycleEvent,
  FeatureLifecycleFailureCode,
  FeatureLifecycleOperation,
  FeatureLifecycleState,
  FeatureLedgerObservation,
  FeatureMailbox,
  FeatureOwnedResourceOptions,
  FeatureOwnershipLedger,
  FeatureSetupContext,
  HostOwnershipTransferToken,
  OwnedFeatureValue,
} from "./feature-lifecycle.js";
export interface ClientSimulationSystemContribution {
  readonly kind: "system";
  readonly id: string;
  readonly domain: "client-simulation";
  readonly phase: ClientSimulationPhase;
  readonly priority: number;
  readonly run: (context: ClientSimulationSystemContext) => unknown;
}
export interface ClientPresentationSystemContribution {
  readonly kind: "system";
  readonly id: string;
  readonly domain: "client-presentation";
  readonly phase: ClientPresentationPhase;
  readonly priority: number;
  readonly run: (context: ClientPresentationSystemContext) => unknown;
}
export type ClientSystemContribution =
  | ClientSimulationSystemContribution
  | ClientPresentationSystemContribution;
export interface ClientResourceContribution {
  readonly kind: "resource";
  readonly id: string;
  readonly resourceType: ResourceType<unknown>;
}
export interface ClientMailboxContribution {
  readonly kind: "mailbox";
  readonly id: string;
}
export type ClientRuntimeContribution =
  | ClientSystemContribution
  | ClientResourceContribution
  | ClientMailboxContribution;
export type ClientFeatureDescriptor<TConfiguration = unknown> =
  FeatureDescriptor<TConfiguration, ClientRuntimeContribution>;
export type ClientFeatureOwnershipLedger = FeatureOwnershipLedger;
export type ClientFeatureSetupContext<TConfiguration> =
  FeatureSetupContext<TConfiguration>;
export interface ClientFeatureLifecycleFailure {
  readonly kind: "feature-lifecycle-failure";
  readonly code: FeatureLifecycleFailureCode;
  readonly runtime: "client";
  readonly featureId: string | null;
  readonly operation: FeatureLifecycleOperation;
  readonly state: FeatureLifecycleState;
  readonly expected: boolean;
  readonly details: readonly FeatureConfigurationIssue[];
  readonly cause: RuntimeCauseSummary | null;
}
export interface ClientFeatureContributionInventoryEntry {
  readonly featureId: string;
  readonly featureDeclarationIndex: number;
  readonly contributionId: string;
  readonly contributionDeclarationIndex: number;
  readonly kind: ClientRuntimeContribution["kind"];
}
export interface ClientFeatureValidationReport {
  readonly originalFeatureIds: readonly string[];
  readonly resolvedFeatureIds: readonly string[];
  readonly contributionInventory: readonly ClientFeatureContributionInventoryEntry[];
  readonly failures: readonly ClientFeatureLifecycleFailure[];
}
export interface ClientFeatureLifecycleTransition {
  readonly runtime: "client";
  readonly previousState: FeatureLifecycleState;
  readonly nextState: FeatureLifecycleState;
  readonly operation: "boot" | "validate" | "setup" | "rollback" | "shutdown";
  readonly sequence: number;
}
export interface ClientFeatureStoppedResult {
  readonly state: "stopped";
  readonly runtime: "client";
  readonly reason:
    | "shutdown"
    | "validation-failed"
    | "setup-failed"
    | "setup-cancelled";
  readonly clean: boolean;
  readonly setupOrder: readonly string[];
  readonly disposedOrder: readonly string[];
  readonly failures: readonly ClientFeatureLifecycleFailure[];
}
export interface ClientFeatureRunningResult {
  readonly state: "running";
  readonly runtime: "client";
  readonly originalFeatureIds: readonly string[];
  readonly resolvedFeatureIds: readonly string[];
  readonly installedFeatureIds: readonly string[];
  readonly scheduleReport: ClientScheduleReport;
}
export type ClientFeatureBootResult =
  | ClientFeatureRunningResult
  | ClientFeatureStoppedResult;
export interface ClientFeatureLifecycleInspection {
  readonly state: FeatureLifecycleState;
  readonly transitions: readonly ClientFeatureLifecycleTransition[];
  readonly events: readonly FeatureLifecycleEvent[];
  readonly validationReport: ClientFeatureValidationReport | null;
  readonly ledger: FeatureLedgerObservation;
  readonly installedFeatureIds: readonly string[];
  readonly scheduleReport: ClientScheduleReport;
  readonly stoppedResult: ClientFeatureStoppedResult | null;
}
export interface ClientFeatureRuntimeOptions {
  readonly features: readonly ClientFeatureDescriptor<unknown>[];
  readonly frameSource: PresentationFrameSource;
  readonly configuration?: Readonly<Record<string, unknown>>;
  readonly driver?: "exact" | "wall-clock";
  readonly telemetryStore?: TelemetryStore<"client">;
  readonly observationClock?: () => number;
  readonly hostServices?: Readonly<Record<string, unknown>>;
}
export interface ClientFeatureRuntime {
  readonly state: FeatureLifecycleState;
  readonly telemetryStore: TelemetryStore<"client">;
  boot(): Promise<ClientFeatureBootResult>;
  shutdown(): Promise<ClientFeatureStoppedResult>;
  stepExact(count: number): OperationResult<number>;
  pumpWallClock(elapsedSeconds: number): OperationResult<WallClockPumpReport>;
  startPresentation(): OperationResult<boolean>;
  snapshotTelemetry(): ClientTelemetrySnapshot;
  inspectLifecycle(): ClientFeatureLifecycleInspection;
  createHostTransferToken<T>(
    targetFeatureId: string,
    options: FeatureOwnedResourceOptions<T>,
  ): HostOwnershipTransferToken<T>;
}
interface InternalContribution {
  readonly declaration: ClientRuntimeContribution;
  readonly declarationIndex: number;
}
interface InternalFeature {
  readonly descriptor: ClientFeatureDescriptor<unknown>;
  readonly id: string;
  readonly declarationIndex: number;
  readonly requires: readonly string[];
  readonly conflicts: readonly string[];
  readonly contributions: ReadonlyMap<string, InternalContribution>;
}
interface PublishedValue {
  readonly owner: string;
  readonly value: unknown;
  readonly record: LedgerRecord;
}
interface TransferEntry {
  readonly targetFeatureId: string;
  readonly resourceId: string;
  readonly kind: LiveResourceKind;
  readonly value: unknown;
  readonly release: () => void | Promise<void>;
  consumed: boolean;
  released: boolean;
}
interface Preflight {
  readonly resolved: readonly InternalFeature[];
  readonly configurations: Readonly<Record<string, unknown>>;
  readonly report: ClientFeatureValidationReport;
}
const DESCRIPTOR_KEYS =
  "configuration|conflicts|description|dispose|id|requires|runtimeContributions|setup";
const SYSTEM_KEYS = "domain|id|kind|phase|priority|run";
const RESOURCE_KEYS = "id|kind|resourceType";
const MAILBOX_KEYS = "id|kind";
function objectLike(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}
function safeValue(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}
function exactKeys(value: object, expected: string): boolean {
  try {
    return Object.keys(value).sort().join("|") === expected;
  } catch {
    return false;
  }
}
function stableId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value.trim() === value
  );
}
function boundedText(value: string, limit: number): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0xfffd;
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? " " : character;
    })
    .join("")
    .slice(0, limit);
}
function summarize(cause: unknown): RuntimeCauseSummary {
  if (cause instanceof Error) {
    const code = (cause as Error & { readonly code?: unknown }).code;
    return Object.freeze({
      name: boundedText(cause.name || "Error", 64),
      code: typeof code === "string" ? boundedText(code, 64) : null,
      message: boundedText(cause.message || "Runtime operation threw", 512),
    });
  }
  if (cause === null)
    return Object.freeze({
      name: "null",
      code: null,
      message: "Null thrown value",
    });
  const type = typeof cause;
  return Object.freeze({
    name: type,
    code: null,
    message:
      type === "number" || type === "boolean" || type === "bigint"
        ? boundedText(String(cause), 512)
        : `${type[0]?.toUpperCase() ?? "U"}${type.slice(1)} thrown value`,
  });
}
function isClientStore(value: unknown): value is TelemetryStore<"client"> {
  return (
    objectLike(value) &&
    safeValue(value, "runtime") === "client" &&
    typeof safeValue(value, "recordRuntimeError") === "function" &&
    typeof safeValue(value, "snapshotTelemetry") === "function"
  );
}
class OwnershipViolation extends Error {
  readonly code = "ownership-violation";
  constructor(message: string) {
    super(message);
    this.name = "FeatureOwnershipViolation";
  }
}
class AbortSignalImplementation implements FeatureAbortSignal {
  private currentReason: "setup-cancelled" | null = null;
  private readonly listeners = new Set<() => void>();
  get aborted(): boolean {
    return this.currentReason !== null;
  }
  get reason(): "setup-cancelled" | null {
    return this.currentReason;
  }
  throwIfAborted(): void {
    if (this.aborted)
      throw new OwnershipViolation("Feature setup was cancelled");
  }
  onAbort(listener: () => void): () => void {
    if (typeof listener !== "function")
      throw new TypeError("Abort listener must be a function");
    if (this.aborted) {
      listener();
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  abort(): void {
    if (this.aborted) return;
    this.currentReason = "setup-cancelled";
    const listeners = [...this.listeners];
    this.listeners.clear();
    for (const listener of listeners) {
      try {
        listener();
      } catch {}
    }
  }
}
class LedgerRecord {
  state: "staged" | "committed" | "unpublished" | "released" = "staged";
  private published = false;
  private releasePromise: Promise<void> | null = null;
  constructor(
    readonly resourceId: string,
    private readonly host: ClientFeatureRuntimeImplementation,
    private readonly liveKind: LiveResourceKind | null,
    private readonly publishAction: (() => void) | null,
    private readonly unpublishAction: (() => void) | null,
    private readonly releaseAction: () => void | Promise<void>,
    private readonly retainKind = true,
  ) {
    host.retainRecord(liveKind, retainKind);
  }
  publish(): void {
    if (this.state === "released") return;
    this.publishAction?.();
    this.published = this.publishAction !== null;
    this.state = "committed";
  }
  unpublish(): void {
    if (!this.published || this.state === "released") return;
    this.unpublishAction?.();
    this.published = false;
    this.state = "unpublished";
    this.host.ledgerUnpublish();
  }
  release(): Promise<void> {
    this.releasePromise ??= this.performRelease();
    return this.releasePromise;
  }
  private async performRelease(): Promise<void> {
    if (this.state === "released") return;
    this.unpublish();
    let threw = false;
    let cause: unknown;
    try {
      await this.releaseAction();
    } catch (error) {
      threw = true;
      cause = error;
    } finally {
      this.state = "released";
      this.host.releaseRecord(this.liveKind, this.retainKind);
    }
    if (threw) throw cause;
  }
}
class FeatureScope implements FeatureOwnershipLedger, FeatureDependencies {
  private readonly records: LedgerRecord[] = [];
  private readonly staged = new Set<string>();
  private committed = false;
  constructor(
    readonly feature: InternalFeature,
    private readonly host: ClientFeatureRuntimeImplementation,
    private readonly signal: AbortSignalImplementation,
  ) {}
  acquire<T>(options: FeatureOwnedResourceOptions<T>): OwnedFeatureValue<T> {
    this.requireActive();
    if (
      !objectLike(options) ||
      !stableId(options.resourceId) ||
      !(LIVE_RESOURCE_KINDS as readonly string[]).includes(options.kind) ||
      typeof options.release !== "function"
    )
      throw new OwnershipViolation("Owned resource declaration is invalid");
    return this.addOwned(
      options.resourceId,
      options.kind,
      options.value,
      null,
      null,
      options.release,
    );
  }
  activateSystem(contributionId: string): void {
    this.requireActive();
    const contribution = this.requireContribution(contributionId, "system");
    let record: LedgerRecord;
    record = this.addRecord(
      contributionId,
      "systems",
      () => this.host.publishSystem(this.feature, contribution, record),
      () => this.host.unpublishSystem(contributionId, record),
      () => undefined,
    );
  }
  publishResource<T>(
    contributionId: string,
    value: T,
    release: () => void | Promise<void> = () => undefined,
  ): OwnedFeatureValue<T> {
    this.requireActive();
    const contribution = this.requireContribution(contributionId, "resource");
    const declaration = contribution.declaration as ClientResourceContribution;
    let record: LedgerRecord;
    const handle = this.addOwned(
      contributionId,
      "worldValues",
      value,
      () =>
        this.host.publishResource(this.feature.id, declaration, value, record),
      () => this.host.unpublishResource(declaration, record),
      release,
    );
    record = this.records[this.records.length - 1] as LedgerRecord;
    return handle;
  }
  publishMailbox<T extends FeatureMailbox>(
    contributionId: string,
    mailbox: T,
  ): OwnedFeatureValue<T> {
    this.requireActive();
    this.requireContribution(contributionId, "mailbox");
    if (
      !objectLike(mailbox) ||
      typeof mailbox.clear !== "function" ||
      typeof mailbox.stop !== "function"
    )
      throw new OwnershipViolation("Mailbox publication is invalid");
    let record: LedgerRecord;
    const handle = this.addOwned(
      contributionId,
      "mailboxes",
      mailbox,
      () =>
        this.host.publishMailbox(
          this.feature.id,
          contributionId,
          mailbox,
          record,
        ),
      () => this.host.unpublishMailbox(contributionId, record),
      () => {
        mailbox.stop();
        mailbox.clear();
      },
    );
    record = this.records[this.records.length - 1] as LedgerRecord;
    return handle;
  }
  consumeHostTransfer<T>(
    token: HostOwnershipTransferToken<T>,
  ): OwnedFeatureValue<T> {
    this.requireActive();
    const entry = this.host.consumeTransfer(this.feature.id, token);
    const record = this.addRecord(
      entry.resourceId,
      null,
      null,
      null,
      () => this.host.releaseTransfer(entry),
      false,
    );
    return Object.freeze({
      resourceId: entry.resourceId,
      value: entry.value as T,
      release: () => record.release(),
    });
  }
  borrow<T = unknown>(
    requiredFeatureId: string,
    resourceId: string,
  ): BorrowedFeatureValue<T> {
    this.requireActive();
    if (!this.feature.requires.includes(requiredFeatureId))
      throw new OwnershipViolation(
        "A Feature may borrow only from a direct requirement",
      );
    return this.addBorrow<T>(
      requiredFeatureId,
      resourceId,
      this.host.borrowPublished(requiredFeatureId, resourceId),
    );
  }
  borrowHost<T = unknown>(resourceId: string): BorrowedFeatureValue<T> {
    this.requireActive();
    return this.addBorrow<T>(null, resourceId, {
      owner: "",
      value: this.host.borrowHost(resourceId),
      record: null as unknown as LedgerRecord,
    });
  }
  commit(): void {
    this.requireActive();
    const published: LedgerRecord[] = [];
    try {
      for (const record of this.records) {
        record.publish();
        if (record.state === "committed") published.push(record);
      }
      this.committed = true;
      this.host.ledgerCommit(published.length);
    } catch (cause) {
      for (let index = published.length - 1; index >= 0; index -= 1)
        published[index]?.unpublish();
      throw cause;
    }
  }
  fenceAndUnpublish(): void {
    this.host.ledgerFence(this.records.length);
    for (let index = this.records.length - 1; index >= 0; index -= 1)
      this.records[index]?.unpublish();
  }
  async releaseAll(
    operation: "rollback-release" | "shutdown-release",
    failures: ClientFeatureLifecycleFailure[],
  ): Promise<void> {
    for (let index = this.records.length - 1; index >= 0; index -= 1) {
      const record = this.records[index];
      if (record === undefined || record.state === "released") continue;
      try {
        await record.release();
      } catch (cause) {
        const failure = this.host.makeFailure(
          "resource-release-failed",
          this.feature.id,
          operation,
          false,
          [{ path: ["resource", record.resourceId], code: "release-threw" }],
          cause,
        );
        failures.push(failure);
        this.host.emitFailure(failure);
      }
    }
  }
  private addOwned<T>(
    resourceId: string,
    kind: LiveResourceKind,
    value: T,
    publish: (() => void) | null,
    unpublish: (() => void) | null,
    release: () => void | Promise<void>,
  ): OwnedFeatureValue<T> {
    const record = this.addRecord(
      resourceId,
      kind,
      publish,
      unpublish,
      release,
    );
    return Object.freeze({
      resourceId,
      value,
      release: () => record.release(),
    });
  }
  private addRecord(
    resourceId: string,
    kind: LiveResourceKind | null,
    publish: (() => void) | null,
    unpublish: (() => void) | null,
    release: () => void | Promise<void>,
    retainKind = true,
  ): LedgerRecord {
    const record = new LedgerRecord(
      resourceId,
      this.host,
      kind,
      publish,
      unpublish,
      release,
      retainKind,
    );
    this.records.push(record);
    this.host.ledgerAcquire();
    return record;
  }
  private addBorrow<T>(
    ownerFeatureId: string | null,
    resourceId: string,
    published: PublishedValue,
  ): BorrowedFeatureValue<T> {
    const record = this.addRecord(
      resourceId,
      null,
      null,
      null,
      () => undefined,
    );
    this.host.ledgerBorrow();
    const handle = Object.create(null) as {
      ownerFeatureId: string | null;
      resourceId: string;
      value: T;
    };
    Object.defineProperties(handle, {
      ownerFeatureId: { value: ownerFeatureId, enumerable: true },
      resourceId: { value: resourceId, enumerable: true },
      value: {
        enumerable: true,
        get: () => {
          if (record.state === "released")
            throw new OwnershipViolation(
              "Borrowed value is no longer retained",
            );
          return published.value as T;
        },
      },
    });
    return Object.freeze(handle);
  }
  private requireContribution(
    contributionId: string,
    kind: ClientRuntimeContribution["kind"],
  ): InternalContribution {
    if (!stableId(contributionId) || this.staged.has(contributionId))
      throw new OwnershipViolation(
        "Contribution was not declared or was already staged",
      );
    const contribution = this.feature.contributions.get(contributionId);
    if (contribution === undefined || contribution.declaration.kind !== kind)
      throw new OwnershipViolation(
        "Contribution kind or ownership does not match its declaration",
      );
    this.staged.add(contributionId);
    return contribution;
  }
  private requireActive(): void {
    if (this.committed || this.signal.aborted || !this.host.scopeIsActive(this))
      throw new OwnershipViolation("The Feature setup scope is not active");
  }
}
export function createClientFeatureRuntime(
  options: ClientFeatureRuntimeOptions,
): ClientFeatureRuntime {
  return new ClientFeatureRuntimeImplementation(options);
}
class ClientFeatureRuntimeImplementation implements ClientFeatureRuntime {
  private currentState: FeatureLifecycleState = "created";
  private readonly world: World = createWorld();
  private readonly fence: RuntimeLiveFence = createRuntimeLiveFence();
  private readonly features: readonly ClientFeatureDescriptor<unknown>[];
  private readonly frameSource: PresentationFrameSource;
  private readonly configuration: Readonly<Record<string, unknown>>;
  private readonly driver: "exact" | "wall-clock";
  private readonly observationClock: (() => number) | undefined;
  private readonly hostServices: Readonly<Record<string, unknown>>;
  private schedule: ClientSchedule | null = null;
  private preflight: Preflight | null = null;
  private bootPromise: Promise<ClientFeatureBootResult> | null = null;
  private stoppedResult: ClientFeatureStoppedResult | null = null;
  private resolveStopped!: (result: ClientFeatureStoppedResult) => void;
  private readonly stoppedPromise: Promise<ClientFeatureStoppedResult>;
  private readonly transitions: ClientFeatureLifecycleTransition[] = [];
  private readonly events: FeatureLifecycleEvent[] = [];
  private sequence = 0;
  private ledgerCounts = {
    acquisitions: 0,
    commits: 0,
    borrows: 0,
    fences: 0,
    unpublishes: 0,
    releases: 0,
  };
  private readonly completed: Array<{
    feature: InternalFeature;
    scope: FeatureScope;
  }> = [];
  private activeScope: FeatureScope | null = null;
  private activeSignal: AbortSignalImplementation | null = null;
  private readonly published = new Map<string, PublishedValue>();
  private readonly systems = new Map<
    string,
    {
      feature: InternalFeature;
      contribution: InternalContribution;
      record: LedgerRecord;
    }
  >();
  private readonly mailboxes = new Map<
    string,
    { mailbox: FeatureMailbox; record: LedgerRecord }
  >();
  private readonly transfers = new WeakMap<object, TransferEntry>();
  private readonly transferOrder: TransferEntry[] = [];
  private installedIds: readonly string[] = Object.freeze([]);
  private hostCleaned = false;
  private readonly emittedFailures = new WeakSet<object>();
  readonly telemetryStore: TelemetryStore<"client">;
  constructor(options: ClientFeatureRuntimeOptions) {
    if (!objectLike(options) || !Array.isArray(options.features))
      throw new TypeError("Client Feature runtime options are invalid");
    const frameSource = options.frameSource;
    if (
      !objectLike(frameSource) ||
      typeof safeValue(frameSource, "request") !== "function" ||
      typeof safeValue(frameSource, "cancel") !== "function"
    )
      throw new TypeError("Client Feature runtime frame source is invalid");
    this.features = Object.freeze([...options.features]);
    this.frameSource = frameSource;
    this.configuration =
      options.configuration ?? Object.freeze(Object.create(null));
    this.driver = options.driver ?? "exact";
    if (this.driver !== "exact" && this.driver !== "wall-clock")
      throw new TypeError("Client Feature runtime driver is invalid");
    this.observationClock = options.observationClock;
    this.hostServices =
      options.hostServices ?? Object.freeze(Object.create(null));
    this.telemetryStore = isClientStore(options.telemetryStore)
      ? options.telemetryStore
      : createTelemetryStore({ runtime: "client" });
    this.telemetryStore.retainLiveResource("worlds");
    this.telemetryStore.retainLiveResource("retainedReferences");
    this.stoppedPromise = new Promise((resolve) => {
      this.resolveStopped = resolve;
    });
  }
  get state(): FeatureLifecycleState {
    return this.currentState;
  }
  boot(): Promise<ClientFeatureBootResult> {
    if (this.bootPromise !== null) return this.bootPromise;
    let resolveBoot!: (result: ClientFeatureBootResult) => void;
    this.bootPromise = new Promise((resolve) => {
      resolveBoot = resolve;
    });
    void this.performBoot().then(resolveBoot, async (cause: unknown) => {
      const failures = [
        this.makeFailure("invariant-failed", null, "state", false, [], cause),
      ];
      if (this.currentState === "setting-up") {
        this.transition("rolling-back", "rollback");
        this.fenceRuntime();
        this.activeSignal?.abort();
        await this.rollback(failures);
      } else await this.cleanupHost("rollback-release", failures);
      resolveBoot(this.finishStopped("setup-failed", failures));
    });
    return this.bootPromise;
  }
  shutdown(): Promise<ClientFeatureStoppedResult> {
    if (this.currentState === "stopped") return this.stoppedPromise;
    if (this.currentState === "created" || this.currentState === "running") {
      this.transition("shutting-down", "shutdown");
      this.fenceRuntime();
      void this.shutdownRunning([]);
    } else if (this.currentState === "setting-up") {
      this.transition("rolling-back", "rollback");
      this.fenceRuntime();
      this.activeSignal?.abort();
    } else if (this.currentState === "validating")
      this.emitFailure(
        this.makeFailure("lifecycle-busy", null, "state", true, [], null),
      );
    return this.stoppedPromise;
  }
  stepExact(count: number): OperationResult<number> {
    return this.currentState === "running" && this.schedule !== null
      ? this.schedule.stepExact(count)
      : this.invalidState("step-exact");
  }
  pumpWallClock(elapsedSeconds: number): OperationResult<WallClockPumpReport> {
    return this.currentState === "running" && this.schedule !== null
      ? this.schedule.pumpWallClock(elapsedSeconds)
      : this.invalidState("pump-wall-clock");
  }
  startPresentation(): OperationResult<boolean> {
    return this.currentState === "running" && this.schedule !== null
      ? this.schedule.startPresentation()
      : this.invalidState("start-presentation");
  }
  snapshotTelemetry(): ClientTelemetrySnapshot {
    return this.telemetryStore.snapshotTelemetry();
  }
  inspectLifecycle(): ClientFeatureLifecycleInspection {
    return Object.freeze({
      state: this.currentState,
      transitions: Object.freeze([...this.transitions]),
      events: Object.freeze([...this.events]),
      validationReport: this.preflight?.report ?? null,
      ledger: Object.freeze({ ...this.ledgerCounts }),
      installedFeatureIds: Object.freeze([...this.installedIds]),
      scheduleReport: this.schedule?.scheduleReport ?? Object.freeze([]),
      stoppedResult: this.stoppedResult,
    });
  }
  createHostTransferToken<T>(
    targetFeatureId: string,
    options: FeatureOwnedResourceOptions<T>,
  ): HostOwnershipTransferToken<T> {
    if (
      this.currentState !== "created" ||
      !stableId(targetFeatureId) ||
      !objectLike(options) ||
      !stableId(options.resourceId) ||
      !(LIVE_RESOURCE_KINDS as readonly string[]).includes(options.kind) ||
      typeof options.release !== "function"
    )
      throw new OwnershipViolation(
        "Host transfer token request is invalid or late",
      );
    const token = Object.freeze({
      resourceId: options.resourceId,
    }) as HostOwnershipTransferToken<T>;
    const entry: TransferEntry = {
      targetFeatureId,
      resourceId: options.resourceId,
      kind: options.kind,
      value: options.value,
      release: options.release,
      consumed: false,
      released: false,
    };
    this.transfers.set(token, entry);
    this.transferOrder.push(entry);
    this.retainKinds(entry.kind);
    return token;
  }
  scopeIsActive(scope: FeatureScope): boolean {
    return this.currentState === "setting-up" && this.activeScope === scope;
  }
  retainRecord(kind: LiveResourceKind | null, retainKind: boolean): void {
    this.telemetryStore.retainLiveResource("ledgerRecords");
    if (retainKind) this.retainKinds(kind);
  }
  releaseRecord(kind: LiveResourceKind | null, retainedKind: boolean): void {
    this.telemetryStore.releaseLiveResource("ledgerRecords");
    if (retainedKind) this.releaseKinds(kind);
    this.ledgerCounts.releases += 1;
  }
  ledgerAcquire(): void {
    this.ledgerCounts.acquisitions += 1;
  }
  ledgerCommit(amount: number): void {
    this.ledgerCounts.commits += amount;
  }
  ledgerBorrow(): void {
    this.ledgerCounts.borrows += 1;
  }
  ledgerFence(amount: number): void {
    this.ledgerCounts.fences += amount;
  }
  ledgerUnpublish(): void {
    this.ledgerCounts.unpublishes += 1;
  }
  publishSystem(
    feature: InternalFeature,
    contribution: InternalContribution,
    record: LedgerRecord,
  ): void {
    this.systems.set(contribution.declaration.id, {
      feature,
      contribution,
      record,
    });
  }
  unpublishSystem(id: string, record: LedgerRecord): void {
    if (this.systems.get(id)?.record === record) this.systems.delete(id);
  }
  publishResource(
    owner: string,
    declaration: ClientResourceContribution,
    value: unknown,
    record: LedgerRecord,
  ): void {
    this.world.addResource(declaration.resourceType, value);
    this.published.set(declaration.id, { owner, value, record });
  }
  unpublishResource(
    declaration: ClientResourceContribution,
    record: LedgerRecord,
  ): void {
    if (this.published.get(declaration.id)?.record !== record) return;
    this.published.delete(declaration.id);
    this.world.removeResource(declaration.resourceType);
  }
  publishMailbox(
    owner: string,
    id: string,
    mailbox: FeatureMailbox,
    record: LedgerRecord,
  ): void {
    this.mailboxes.set(id, { mailbox, record });
    this.published.set(id, { owner, value: mailbox, record });
  }
  unpublishMailbox(id: string, record: LedgerRecord): void {
    if (this.mailboxes.get(id)?.record === record) this.mailboxes.delete(id);
    if (this.published.get(id)?.record === record) this.published.delete(id);
  }
  borrowPublished(owner: string, id: string): PublishedValue {
    const published = this.published.get(id);
    if (
      published === undefined ||
      published.owner !== owner ||
      published.record.state !== "committed"
    )
      throw new OwnershipViolation(
        "Required Feature value is not committed or owned by that Feature",
      );
    return published;
  }
  borrowHost(id: string): unknown {
    if (!Object.prototype.hasOwnProperty.call(this.hostServices, id))
      throw new OwnershipViolation("Host service is not declared");
    return this.hostServices[id];
  }
  consumeTransfer(
    featureId: string,
    token: HostOwnershipTransferToken<unknown>,
  ): TransferEntry {
    if (!objectLike(token))
      throw new OwnershipViolation("Transfer token is invalid");
    const entry = this.transfers.get(token);
    if (
      entry === undefined ||
      entry.consumed ||
      entry.released ||
      entry.targetFeatureId !== featureId
    )
      throw new OwnershipViolation(
        "Transfer token is invalid, reused, or belongs to another Feature",
      );
    entry.consumed = true;
    return entry;
  }
  async releaseTransfer(entry: TransferEntry): Promise<void> {
    if (entry.released) return;
    entry.released = true;
    try {
      await entry.release();
    } finally {
      this.releaseKinds(entry.kind);
    }
  }
  makeFailure(
    code: FeatureLifecycleFailureCode,
    featureId: string | null,
    operation: FeatureLifecycleOperation,
    expected: boolean,
    details: readonly FeatureConfigurationIssue[],
    cause: unknown,
    state = this.currentState,
  ): ClientFeatureLifecycleFailure {
    return Object.freeze({
      kind: "feature-lifecycle-failure",
      code,
      runtime: "client",
      featureId,
      operation,
      state,
      expected,
      details: freezeFeatureConfigurationIssues(details),
      cause: cause === null ? null : summarize(cause),
    });
  }
  emitFailure(failure: ClientFeatureLifecycleFailure): void {
    if (this.emittedFailures.has(failure)) return;
    this.emittedFailures.add(failure);
    this.telemetryStore.recordRuntimeError({
      code: failure.code,
      category: failure.expected ? "expected" : "invariant",
      runtime: "client",
      operation: failure.operation,
      message: `Feature lifecycle failure: ${failure.code}`,
      ...(failure.featureId === null ? {} : { featureId: failure.featureId }),
      context: Object.freeze(
        failure.details.map((detail, index) =>
          Object.freeze({ key: `issue-${index}`, value: detail.code }),
        ),
      ),
      ...(failure.cause === null
        ? {}
        : { cause: new Error(failure.cause.message) }),
    });
  }
  private invalidState(operation: string): OperationResult<never> {
    return Object.freeze({
      ok: false,
      error: this.telemetryStore.recordRuntimeError({
        code: "invalid-state",
        category: "expected",
        runtime: "client",
        operation,
        message: "Client Feature runtime is not running",
        context: Object.freeze([]),
      }),
    });
  }
  private readState(): FeatureLifecycleState {
    return this.currentState;
  }
  private async performBoot(): Promise<ClientFeatureBootResult> {
    if (this.currentState !== "created") return this.stoppedPromise;
    this.transition("validating", "boot");
    const preflight = this.validate();
    this.preflight = preflight;
    if (preflight.report.failures.length > 0) {
      for (const failure of preflight.report.failures)
        this.emitFailure(failure);
      const failures = [...preflight.report.failures];
      this.fenceRuntime();
      await this.cleanupHost("rollback-release", failures);
      return this.finishStopped("validation-failed", failures);
    }
    this.transition("setting-up", "validate");
    for (const feature of preflight.resolved) {
      if (this.readState() !== "setting-up") break;
      const signal = new AbortSignalImplementation();
      const scope = new FeatureScope(feature, this, signal);
      this.activeSignal = signal;
      this.activeScope = scope;
      this.event("setup-start", feature);
      let setupThrew = false;
      let setupCause: unknown;
      let invalidResult = false;
      try {
        const raw = feature.descriptor.setup(
          Object.freeze({
            configuration: preflight.configurations[feature.id],
            dependencies: scope,
            signal,
            ledger: scope,
          }),
        );
        const output =
          objectLike(raw) && typeof safeValue(raw, "then") === "function"
            ? await raw
            : raw;
        invalidResult = output !== undefined;
      } catch (cause) {
        setupThrew = true;
        setupCause = cause;
      }
      if (this.readState() !== "setting-up" || signal.aborted) {
        const failures = [
          this.makeFailure(
            "setup-cancelled",
            feature.id,
            "setup",
            true,
            [],
            null,
            "setting-up",
          ),
        ];
        this.emitFailure(failures[0] as ClientFeatureLifecycleFailure);
        this.event("setup-failure", feature);
        await scope.releaseAll("rollback-release", failures);
        this.activeScope = null;
        this.activeSignal = null;
        await this.rollbackCompleted(failures);
        await this.cleanupHost("rollback-release", failures);
        return this.finishStopped("setup-cancelled", failures);
      }
      if (setupThrew || invalidResult) {
        const code =
          setupCause instanceof OwnershipViolation
            ? "ownership-violation"
            : "setup-failed";
        const failures = [
          this.makeFailure(
            code,
            feature.id,
            "setup",
            false,
            invalidResult
              ? [{ path: ["result"], code: "invalid-setup-result" }]
              : [],
            setupThrew ? setupCause : null,
          ),
        ];
        this.emitFailure(failures[0] as ClientFeatureLifecycleFailure);
        this.event("setup-failure", feature);
        this.transition("rolling-back", "rollback");
        this.fenceRuntime();
        signal.abort();
        await scope.releaseAll("rollback-release", failures);
        this.activeScope = null;
        this.activeSignal = null;
        await this.rollbackCompleted(failures);
        await this.cleanupHost("rollback-release", failures);
        return this.finishStopped("setup-failed", failures);
      }
      try {
        scope.commit();
      } catch (cause) {
        const failures = [
          this.makeFailure(
            "invariant-failed",
            feature.id,
            "setup",
            false,
            [],
            cause,
          ),
        ];
        this.emitFailure(failures[0] as ClientFeatureLifecycleFailure);
        this.event("setup-failure", feature);
        this.transition("rolling-back", "rollback");
        this.fenceRuntime();
        signal.abort();
        await scope.releaseAll("rollback-release", failures);
        this.activeScope = null;
        this.activeSignal = null;
        await this.rollbackCompleted(failures);
        await this.cleanupHost("rollback-release", failures);
        return this.finishStopped("setup-failed", failures);
      }
      this.completed.push({ feature, scope });
      this.activeScope = null;
      this.activeSignal = null;
      this.event("setup-success", feature);
    }
    if (this.readState() !== "setting-up") return this.stoppedPromise;
    const simulationSystems: Parameters<
      typeof createClientSchedule
    >[0]["simulationSystems"][number][] = [];
    const presentationSystems: Parameters<
      typeof createClientSchedule
    >[0]["presentationSystems"][number][] = [];
    for (const { feature, contribution, record } of this.systems.values()) {
      const declaration = contribution.declaration as ClientSystemContribution;
      const common = {
        priority: declaration.priority,
        featureId: feature.id,
        featureDeclarationIndex: feature.declarationIndex,
        systemId: declaration.id,
        withinFeatureDeclarationIndex: contribution.declarationIndex,
      };
      if (declaration.domain === "client-simulation")
        simulationSystems.push(
          Object.freeze({
            ...common,
            domain: "client-simulation" as const,
            phase: declaration.phase,
            run: (context: ClientSimulationSystemContext) =>
              this.currentState === "running" && record.state === "committed"
                ? declaration.run(context)
                : undefined,
          }),
        );
      else
        presentationSystems.push(
          Object.freeze({
            ...common,
            domain: "client-presentation" as const,
            phase: declaration.phase,
            run: (context: ClientPresentationSystemContext) =>
              this.currentState === "running" && record.state === "committed"
                ? declaration.run(context)
                : undefined,
          }),
        );
    }
    const scheduleResult = createClientSchedule({
      driver: this.driver,
      world: this.world,
      simulationSystems,
      presentationSystems,
      frameSource: this.frameSource,
      telemetryStore: this.telemetryStore,
      ...(this.observationClock === undefined
        ? {}
        : { observationClock: this.observationClock }),
    });
    if (!scheduleResult.ok) {
      const failures = [
        this.makeFailure(
          "invariant-failed",
          null,
          "setup",
          false,
          [],
          scheduleResult.error,
        ),
      ];
      this.emitFailure(failures[0] as ClientFeatureLifecycleFailure);
      this.transition("rolling-back", "rollback");
      this.fenceRuntime();
      await this.rollbackCompleted(failures);
      await this.cleanupHost("rollback-release", failures);
      return this.finishStopped("setup-failed", failures);
    }
    this.schedule = scheduleResult.value;
    this.installedIds = Object.freeze(
      this.completed.map(({ feature }) => feature.id),
    );
    this.telemetryStore.observeInstalledFeatureIds(this.installedIds);
    this.transition("running", "setup");
    return Object.freeze({
      state: "running",
      runtime: "client",
      originalFeatureIds: preflight.report.originalFeatureIds,
      resolvedFeatureIds: preflight.report.resolvedFeatureIds,
      installedFeatureIds: this.installedIds,
      scheduleReport: this.schedule.scheduleReport,
    });
  }
  private validate(): Preflight {
    const pending: Array<{
      featureIndex: number;
      position: number;
      failure: ClientFeatureLifecycleFailure;
    }> = [];
    const originalIds = Object.freeze(
      this.features.map((feature) =>
        objectLike(feature) && typeof safeValue(feature, "id") === "string"
          ? (safeValue(feature, "id") as string)
          : "",
      ),
    );
    const internal: InternalFeature[] = [];
    const idPositions = new Map<string, number>();
    const allContributions: Array<{
      feature: InternalFeature;
      contribution: InternalContribution;
    }> = [];
    const inventory: ClientFeatureContributionInventoryEntry[] = [];
    const add = (
      featureIndex: number,
      position: number,
      code: FeatureLifecycleFailureCode,
      featureId: string | null,
      details: readonly FeatureConfigurationIssue[] = [],
    ): void => {
      pending.push({
        featureIndex,
        position,
        failure: this.makeFailure(
          code,
          featureId,
          "validate",
          true,
          details,
          null,
        ),
      });
    };
    for (
      let featureIndex = 0;
      featureIndex < this.features.length;
      featureIndex += 1
    ) {
      const candidate = this.features[featureIndex];
      if (!objectLike(candidate) || !exactKeys(candidate, DESCRIPTOR_KEYS)) {
        add(featureIndex, -1, "invalid-descriptor", null, [
          { path: [], code: "invalid-descriptor-shape" },
        ]);
        continue;
      }
      const rawId = safeValue(candidate, "id");
      if (!stableId(rawId)) {
        add(
          featureIndex,
          -1,
          "invalid-feature-id",
          typeof rawId === "string" ? rawId : null,
        );
        continue;
      }
      const id = rawId;
      if (idPositions.has(id))
        add(featureIndex, -1, "duplicate-feature-id", id);
      else idPositions.set(id, featureIndex);
      const description = safeValue(candidate, "description");
      const requiresRaw = safeValue(candidate, "requires");
      const conflictsRaw = safeValue(candidate, "conflicts");
      const contributionsRaw = safeValue(candidate, "runtimeContributions");
      const provider = safeValue(candidate, "configuration");
      if (
        typeof description !== "string" ||
        description.trim().length === 0 ||
        !Array.isArray(requiresRaw) ||
        !Array.isArray(conflictsRaw) ||
        !Array.isArray(contributionsRaw) ||
        !objectLike(provider) ||
        !hasFeatureConfigurationDefinition(provider) ||
        typeof safeValue(candidate, "setup") !== "function" ||
        typeof safeValue(candidate, "dispose") !== "function"
      )
        add(featureIndex, -1, "invalid-descriptor", id);
      const requires: string[] = [];
      const conflicts: string[] = [];
      for (const [listName, rawList, target] of [
        ["requires", requiresRaw, requires],
        ["conflicts", conflictsRaw, conflicts],
      ] as const) {
        if (!Array.isArray(rawList)) continue;
        const seen = new Set<string>();
        for (let position = 0; position < rawList.length; position += 1) {
          const entry = rawList[position];
          if (!stableId(entry) || entry === id || seen.has(entry))
            add(featureIndex, position, "invalid-descriptor", id, [
              {
                path: [listName, position],
                code:
                  entry === id
                    ? "self-reference"
                    : seen.has(entry as string)
                      ? "duplicate-list-id"
                      : "invalid-list-id",
              },
            ]);
          else target.push(entry);
          if (typeof entry === "string") seen.add(entry);
        }
      }
      const contributionMap = new Map<string, InternalContribution>();
      const validContributions: InternalContribution[] = [];
      if (Array.isArray(contributionsRaw))
        for (
          let position = 0;
          position < contributionsRaw.length;
          position += 1
        ) {
          const raw = contributionsRaw[position];
          let valid = objectLike(raw);
          const kind = valid ? safeValue(raw as object, "kind") : undefined;
          const contributionId = valid
            ? safeValue(raw as object, "id")
            : undefined;
          if (kind === "system") {
            const domain = safeValue(raw as object, "domain");
            const phase = safeValue(raw as object, "phase");
            valid =
              exactKeys(raw as object, SYSTEM_KEYS) &&
              ((domain === "client-simulation" &&
                (CLIENT_SIMULATION_PHASES as readonly unknown[]).includes(
                  phase,
                )) ||
                (domain === "client-presentation" &&
                  (CLIENT_PRESENTATION_PHASES as readonly unknown[]).includes(
                    phase,
                  ))) &&
              Number.isSafeInteger(safeValue(raw as object, "priority")) &&
              typeof safeValue(raw as object, "run") === "function";
          } else if (kind === "resource") {
            valid =
              exactKeys(raw as object, RESOURCE_KEYS) &&
              objectLike(safeValue(raw as object, "resourceType"));
            if (valid)
              try {
                this.world.hasResource(
                  safeValue(
                    raw as object,
                    "resourceType",
                  ) as ResourceType<unknown>,
                );
              } catch {
                valid = false;
              }
          } else if (kind === "mailbox")
            valid = exactKeys(raw as object, MAILBOX_KEYS);
          else valid = false;
          if (!valid || !stableId(contributionId)) {
            add(featureIndex, position, "invalid-contribution", id, [
              {
                path: ["runtimeContributions", position],
                code: "invalid-contribution",
              },
            ]);
            continue;
          }
          const contribution = Object.freeze({
            declaration: Object.freeze({
              ...(raw as ClientRuntimeContribution),
            }),
            declarationIndex: position,
          });
          validContributions.push(contribution);
          if (!contributionMap.has(contributionId))
            contributionMap.set(contributionId, contribution);
          inventory.push(
            Object.freeze({
              featureId: id,
              featureDeclarationIndex: featureIndex,
              contributionId,
              contributionDeclarationIndex: position,
              kind: kind as ClientRuntimeContribution["kind"],
            }),
          );
        }
      const feature = Object.freeze({
        descriptor: candidate as ClientFeatureDescriptor<unknown>,
        id,
        declarationIndex: featureIndex,
        requires: Object.freeze(requires),
        conflicts: Object.freeze(conflicts),
        contributions: contributionMap as ReadonlyMap<
          string,
          InternalContribution
        >,
      });
      internal.push(feature);
      for (const contribution of validContributions)
        allContributions.push({ feature, contribution });
    }
    const byId = new Map<string, InternalFeature>();
    for (const feature of internal)
      if (!byId.has(feature.id)) byId.set(feature.id, feature);
    const contributionIds = new Map<
      string,
      ClientRuntimeContribution["kind"]
    >();
    const resourceTypes = new Set<object>();
    for (const { feature, contribution } of allContributions) {
      const id = contribution.declaration.id;
      const previous = contributionIds.get(id);
      if (previous !== undefined)
        add(
          feature.declarationIndex,
          contribution.declarationIndex,
          previous === "system" && contribution.declaration.kind === "system"
            ? "duplicate-system-id"
            : "duplicate-contribution-id",
          feature.id,
        );
      else contributionIds.set(id, contribution.declaration.kind);
      if (contribution.declaration.kind === "resource") {
        const token = contribution.declaration.resourceType as object;
        if (resourceTypes.has(token))
          add(
            feature.declarationIndex,
            contribution.declarationIndex,
            "invalid-contribution",
            feature.id,
            [
              {
                path: ["runtimeContributions", contribution.declarationIndex],
                code: "duplicate-resource-type",
              },
            ],
          );
        resourceTypes.add(token);
      }
    }
    for (const feature of internal) {
      for (let position = 0; position < feature.requires.length; position += 1)
        if (!byId.has(feature.requires[position] as string))
          add(
            feature.declarationIndex,
            position,
            "missing-requirement",
            feature.id,
            [{ path: ["requires", position], code: "missing-requirement" }],
          );
      for (let position = 0; position < feature.conflicts.length; position += 1)
        if (byId.has(feature.conflicts[position] as string))
          add(
            feature.declarationIndex,
            position,
            "feature-conflict",
            feature.id,
            [{ path: ["conflicts", position], code: "feature-conflict" }],
          );
    }
    const reaches = (
      start: string,
      current: string,
      seen: Set<string>,
    ): boolean => {
      const feature = byId.get(current);
      if (feature === undefined) return false;
      for (const required of feature.requires) {
        if (required === start) return true;
        if (!seen.has(required)) {
          seen.add(required);
          if (reaches(start, required, seen)) return true;
        }
      }
      return false;
    };
    for (const feature of internal)
      if (reaches(feature.id, feature.id, new Set([feature.id])))
        add(feature.declarationIndex, 0, "dependency-cycle", feature.id);
    const configObject =
      typeof this.configuration === "object" &&
      this.configuration !== null &&
      !Array.isArray(this.configuration);
    if (!configObject)
      add(Number.MAX_SAFE_INTEGER, 0, "invalid-configuration", null, [
        { path: [], code: "configuration-map-required" },
      ]);
    let configKeys: string[] = [];
    if (configObject)
      try {
        configKeys = Object.keys(this.configuration);
      } catch {
        add(Number.MAX_SAFE_INTEGER, 0, "invalid-configuration", null, [
          { path: [], code: "configuration-map-required" },
        ]);
      }
    for (const [position, key] of [...configKeys].sort().entries())
      if (!byId.has(key))
        add(Number.MAX_SAFE_INTEGER, position, "unknown-configuration", null, [
          { path: [key], code: "unknown-configuration" },
        ]);
    const parsed: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const feature of internal) {
      const provider = feature.descriptor.configuration as object;
      if (!objectLike(provider) || !hasFeatureConfigurationDefinition(provider))
        continue;
      const present =
        configObject &&
        Object.prototype.hasOwnProperty.call(this.configuration, feature.id);
      const result = parseFeatureConfigurationProvider(
        provider,
        present,
        present ? safeValue(this.configuration, feature.id) : undefined,
      );
      if (result.ok) parsed[feature.id] = result.value;
      else
        add(
          feature.declarationIndex,
          0,
          "invalid-configuration",
          feature.id,
          result.issues,
        );
    }
    pending.sort((left, right) =>
      left.featureIndex !== right.featureIndex
        ? left.featureIndex - right.featureIndex
        : left.position !== right.position
          ? left.position - right.position
          : left.failure.code.localeCompare(right.failure.code),
    );
    const failures = Object.freeze(pending.map(({ failure }) => failure));
    const resolved =
      failures.length === 0
        ? this.resolveStable(internal, byId)
        : Object.freeze([]);
    const report = Object.freeze({
      originalFeatureIds: originalIds,
      resolvedFeatureIds: Object.freeze(resolved.map(({ id }) => id)),
      contributionInventory: Object.freeze(inventory),
      failures,
    });
    return Object.freeze({
      resolved,
      configurations: Object.freeze(parsed),
      report,
    });
  }
  private resolveStable(
    features: readonly InternalFeature[],
    byId: ReadonlyMap<string, InternalFeature>,
  ): readonly InternalFeature[] {
    const indegree = new Map<string, number>();
    const dependents = new Map<string, InternalFeature[]>();
    for (const feature of features) {
      indegree.set(feature.id, feature.requires.length);
      for (const required of feature.requires) {
        const list = dependents.get(required) ?? [];
        list.push(feature);
        dependents.set(required, list);
      }
    }
    const eligible = features.filter(
      (feature) => indegree.get(feature.id) === 0,
    );
    const output: InternalFeature[] = [];
    while (eligible.length > 0) {
      eligible.sort(
        (left, right) => left.declarationIndex - right.declarationIndex,
      );
      const feature = eligible.shift();
      if (feature === undefined || !byId.has(feature.id)) continue;
      output.push(feature);
      for (const dependent of dependents.get(feature.id) ?? []) {
        const next = (indegree.get(dependent.id) ?? 1) - 1;
        indegree.set(dependent.id, next);
        if (next === 0) eligible.push(dependent);
      }
    }
    return Object.freeze(output);
  }
  private async rollback(
    failures: ClientFeatureLifecycleFailure[],
  ): Promise<void> {
    if (this.activeScope !== null) {
      await this.activeScope.releaseAll("rollback-release", failures);
      this.activeScope = null;
      this.activeSignal = null;
    }
    await this.rollbackCompleted(failures);
    await this.cleanupHost("rollback-release", failures);
  }
  private async rollbackCompleted(
    failures: ClientFeatureLifecycleFailure[],
  ): Promise<void> {
    for (let index = this.completed.length - 1; index >= 0; index -= 1) {
      const completed = this.completed[index];
      if (completed !== undefined)
        await this.cleanupFeature(completed, "rollback", failures);
    }
    this.completed.length = 0;
  }
  private async shutdownRunning(
    failures: ClientFeatureLifecycleFailure[],
  ): Promise<void> {
    for (let index = this.completed.length - 1; index >= 0; index -= 1) {
      const completed = this.completed[index];
      if (completed !== undefined)
        await this.cleanupFeature(completed, "shutdown", failures);
    }
    this.completed.length = 0;
    await this.cleanupHost("shutdown-release", failures);
    this.finishStopped("shutdown", failures);
  }
  private async cleanupFeature(
    completed: { feature: InternalFeature; scope: FeatureScope },
    mode: "rollback" | "shutdown",
    failures: ClientFeatureLifecycleFailure[],
  ): Promise<void> {
    const { feature, scope } = completed;
    scope.fenceAndUnpublish();
    this.event("dispose-start", feature);
    let disposeThrew = false;
    let disposeCause: unknown;
    try {
      const raw = feature.descriptor.dispose();
      const output =
        objectLike(raw) && typeof safeValue(raw, "then") === "function"
          ? await raw
          : raw;
      if (output !== undefined)
        throw new TypeError("Dispose returned an invalid result");
    } catch (cause) {
      disposeThrew = true;
      disposeCause = cause;
    }
    if (!disposeThrew) this.event("dispose-success", feature);
    else {
      const failure = this.makeFailure(
        "dispose-failed",
        feature.id,
        mode === "rollback" ? "rollback-dispose" : "shutdown-dispose",
        false,
        [],
        disposeCause,
      );
      failures.push(failure);
      this.emitFailure(failure);
      this.event("dispose-failure", feature);
    }
    await scope.releaseAll(
      mode === "rollback" ? "rollback-release" : "shutdown-release",
      failures,
    );
  }
  private async cleanupHost(
    operation: "rollback-release" | "shutdown-release",
    failures: ClientFeatureLifecycleFailure[],
  ): Promise<void> {
    if (this.hostCleaned) return;
    this.hostCleaned = true;
    this.schedule?.stop();
    this.schedule = null;
    for (let index = this.transferOrder.length - 1; index >= 0; index -= 1) {
      const entry = this.transferOrder[index];
      if (entry === undefined || entry.released || entry.consumed) continue;
      try {
        await this.releaseTransfer(entry);
      } catch (cause) {
        const failure = this.makeFailure(
          "resource-release-failed",
          null,
          operation,
          false,
          [
            {
              path: ["host-resource", entry.resourceId],
              code: "release-threw",
            },
          ],
          cause,
        );
        failures.push(failure);
        this.emitFailure(failure);
      }
    }
    this.systems.clear();
    this.published.clear();
    this.mailboxes.clear();
    try {
      this.world.dispose();
    } catch (cause) {
      const failure = this.makeFailure(
        "resource-release-failed",
        null,
        operation,
        false,
        [{ path: ["host", "world"], code: "dispose-threw" }],
        cause,
      );
      failures.push(failure);
      this.emitFailure(failure);
    }
    this.telemetryStore.releaseLiveResource("worlds");
    this.telemetryStore.releaseLiveResource("retainedReferences");
  }
  private fenceRuntime(): void {
    this.fence.stop();
    this.schedule?.stop();
    for (const { mailbox } of this.mailboxes.values()) {
      mailbox.stop();
      mailbox.clear();
    }
    this.installedIds = Object.freeze([]);
    this.telemetryStore.observeInstalledFeatureIds(this.installedIds);
  }
  private finishStopped(
    reason: ClientFeatureStoppedResult["reason"],
    failures: readonly ClientFeatureLifecycleFailure[],
  ): ClientFeatureStoppedResult {
    if (this.stoppedResult !== null) return this.stoppedResult;
    if (this.currentState !== "stopped")
      this.transition(
        "stopped",
        this.currentState === "validating"
          ? "validate"
          : this.currentState === "shutting-down"
            ? "shutdown"
            : "rollback",
      );
    this.stoppedResult = Object.freeze({
      state: "stopped",
      runtime: "client",
      reason,
      clean: failures.length === 0,
      setupOrder: Object.freeze(
        this.events
          .filter(({ kind }) => kind === "setup-success")
          .map(({ featureId }) => featureId),
      ),
      disposedOrder: Object.freeze(
        this.events
          .filter(({ kind }) => kind === "dispose-start")
          .map(({ featureId }) => featureId),
      ),
      failures: Object.freeze([...failures]),
    });
    this.resolveStopped(this.stoppedResult);
    return this.stoppedResult;
  }
  private transition(
    nextState: FeatureLifecycleState,
    operation: ClientFeatureLifecycleTransition["operation"],
  ): void {
    const previousState = this.currentState;
    this.currentState = nextState;
    this.transitions.push(
      Object.freeze({
        runtime: "client",
        previousState,
        nextState,
        operation,
        sequence: this.nextSequence(),
      }),
    );
  }
  private event(
    kind: FeatureLifecycleEvent["kind"],
    feature: InternalFeature,
  ): void {
    this.events.push(
      Object.freeze({
        kind,
        featureId: feature.id,
        featureDeclarationIndex: feature.declarationIndex,
        sequence: this.nextSequence(),
      }),
    );
  }
  private nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }
  private retainKinds(kind: LiveResourceKind | null): void {
    const kinds = new Set<LiveResourceKind>(["retainedReferences"]);
    if (kind !== null) kinds.add(kind);
    for (const current of kinds)
      this.telemetryStore.retainLiveResource(current);
  }
  private releaseKinds(kind: LiveResourceKind | null): void {
    const kinds = new Set<LiveResourceKind>(["retainedReferences"]);
    if (kind !== null) kinds.add(kind);
    for (const current of kinds)
      this.telemetryStore.releaseLiveResource(current);
  }
}
