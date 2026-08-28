import type { ClientScheduleReport } from "./client-runtime-scheduling.js";
import type { ServerScheduleReport } from "./runtime-scheduling.js";
export const RUNTIME_ERROR_RING_CAPACITY = 256;
export const RUNTIME_ERROR_SERIALIZED_BYTE_LIMIT = 8_192;
export const REJECTED_COMMAND_REASONS = Object.freeze([
  "schema-invalid",
  "unsupported-version",
  "unknown-kind",
  "wrong-direction",
  "phase-invalid",
  "sequence-invalid",
  "tick-out-of-window",
  "queue-full",
  "ownership-violation",
  "movement-limit",
  "unknown-target",
  "interaction-out-of-range",
  "stale-connection",
] as const);
export const LIVE_RESOURCE_KINDS = Object.freeze([
  "worlds",
  "worldValues",
  "systems",
  "subscriptions",
  "listeners",
  "timers",
  "sockets",
  "serverListeners",
  "mailboxes",
  "queuedItems",
  "queuedDeliveries",
  "bindings",
  "ownedAvatars",
  "presentationRequests",
  "presentationCallbacks",
  "renderResources",
  "physicsWorlds",
  "physicsControllers",
  "physicsColliders",
  "physicsHandles",
  "ledgerRecords",
  "retainedReferences",
] as const);
export type RuntimeErrorCategory = "expected" | "invariant";
export type RuntimeLayer = "client" | "shared" | "server" | "transport";
export type HostRuntime = "client" | "server";
export type RejectedCommandReason = (typeof REJECTED_COMMAND_REASONS)[number];
export type LiveResourceKind = (typeof LIVE_RESOURCE_KINDS)[number];
export type RuntimeErrorContextValue = string | number | boolean | null;
export interface RuntimeErrorContextEntry {
  readonly key: string;
  readonly value: RuntimeErrorContextValue;
}
export interface RuntimeCauseSummary {
  readonly name: string;
  readonly code: string | null;
  readonly message: string;
}
export interface RuntimeErrorRecord {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly code: string;
  readonly category: RuntimeErrorCategory;
  readonly expected: boolean;
  readonly runtime: RuntimeLayer;
  readonly operation: string;
  readonly message: string;
  readonly tick?: number;
  readonly featureId?: string;
  readonly entityId?: string;
  readonly connectionId?: string;
  readonly reasonCode?: RejectedCommandReason;
  readonly context: readonly RuntimeErrorContextEntry[];
  readonly cause: RuntimeCauseSummary | null;
}
export interface RuntimeErrorRecordInput {
  readonly sequence: number;
  readonly code: string;
  readonly category: RuntimeErrorCategory;
  readonly runtime: RuntimeLayer;
  readonly operation: string;
  readonly message: string;
  readonly tick?: number;
  readonly featureId?: string;
  readonly entityId?: string;
  readonly connectionId?: string;
  readonly reasonCode?: RejectedCommandReason;
  readonly context?: readonly RuntimeErrorContextEntry[];
  readonly cause?: unknown;
}
export type RuntimeErrorInput = Omit<RuntimeErrorRecordInput, "sequence">;
export type RuntimeErrorObserver = (record: RuntimeErrorRecord) => void;
export type RuntimeScheduleReport = ServerScheduleReport | ClientScheduleReport;
export type LiveResourceGauges = Readonly<Record<LiveResourceKind, number>>;
export type RejectedCommandCounts = Readonly<
  Record<RejectedCommandReason, number>
>;
export interface ClientConnectionSnapshot {
  readonly runtime: "client";
  readonly state:
    | "idle"
    | "connecting"
    | "ready"
    | "joining"
    | "joined"
    | "disconnecting"
    | "closed"
    | "shutting-down"
    | "shutdown";
  readonly transitionCount: number;
  readonly transitionEvictedCount: number;
  readonly recentTransitions: readonly unknown[];
}
export interface ServerConnectionSnapshot {
  readonly runtime: "server";
  readonly transportState: "idle" | "listening" | "shutting-down" | "shutdown";
  readonly connectionStateCounts: Readonly<
    Record<
      "connected" | "ready" | "joining" | "joined" | "disconnecting" | "closed",
      number
    >
  >;
  readonly transitionCount: number;
  readonly transitionEvictedCount: number;
  readonly recentTransitions: readonly unknown[];
}
interface CommonTelemetrySnapshot {
  readonly schemaVersion: 1;
  readonly telemetrySequence: number;
  readonly simulationTick: number;
  readonly entityCount: number;
  readonly installedFeatureIds: readonly string[];
  readonly droppedWallTimeSeconds: number;
  readonly scheduleReport: RuntimeScheduleReport | null;
  readonly liveResources: LiveResourceGauges;
  readonly structuredRuntimeErrorCount: number;
  readonly structuredRuntimeErrorEvictedCount: number;
  readonly structuredRuntimeErrors: readonly RuntimeErrorRecord[];
}
export interface ClientTelemetrySnapshot extends CommonTelemetrySnapshot {
  readonly runtime: "client";
  readonly connection: ClientConnectionSnapshot | null;
  readonly clientFrameDurationSeconds: number | null;
  readonly presentationFrameCount: number;
}
export interface ServerTelemetrySnapshot extends CommonTelemetrySnapshot {
  readonly runtime: "server";
  readonly connection: ServerConnectionSnapshot | null;
  readonly serverTickDurationSeconds: number | null;
  readonly serverBacklogSeconds: number;
  readonly rejectedCommandCounts: RejectedCommandCounts;
}
export type RuntimeTelemetrySnapshot =
  | ClientTelemetrySnapshot
  | ServerTelemetrySnapshot;
export type TelemetrySnapshotFor<TRuntime extends HostRuntime> =
  TRuntime extends "client" ? ClientTelemetrySnapshot : ServerTelemetrySnapshot;
export interface TelemetryStoreOptions<TRuntime extends HostRuntime> {
  readonly runtime: TRuntime;
  readonly observeRuntimeError?: RuntimeErrorObserver;
}
export interface TelemetryStore<TRuntime extends HostRuntime = HostRuntime> {
  readonly runtime: TRuntime;
  recordRuntimeError(input: RuntimeErrorInput): RuntimeErrorRecord;
  snapshotTelemetry(): TelemetrySnapshotFor<TRuntime>;
  observeClientSchedule(report: ClientScheduleReport): void;
  observeClientTick(tick: number, entityCount: number): void;
  observeClientPump(cumulativeDroppedSeconds: number): void;
  observeClientFrame(
    presentationFrameCount: number,
    durationSeconds: number,
  ): void;
  observeServerSchedule(report: ServerScheduleReport): void;
  observeServerTick(
    tick: number,
    durationSeconds: number,
    entityCount: number,
  ): void;
  observeServerTickAttempt(tick: number, entityCount: number): void;
  observeServerPump(
    backlogSeconds: number,
    cumulativeDroppedSeconds: number,
  ): void;
  observeEntityCount(entityCount: number): void;
  observeInstalledFeatureIds(featureIds: readonly string[]): void;
  retainLiveResource(kind: LiveResourceKind, amount?: number): void;
  releaseLiveResource(kind: LiveResourceKind, amount?: number): void;
}
const STABLE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const FORBIDDEN_CONTEXT_FRAGMENTS = Object.freeze([
  "password",
  "passwd",
  "pwd",
  "authorization",
  "auth",
  "cookie",
  "token",
  "secret",
  "credential",
  "apikey",
  "accesskey",
  "privatekey",
  "sessionkey",
  "csrf",
  "jwt",
  "bearer",
  "stack",
  "payload",
  "header",
  "configuration",
  "config",
  "origin",
  "useragent",
  "address",
  "rawnetwork",
  "completeurl",
  "fullurl",
]);
const RUNTIMES = Object.freeze([
  "client",
  "shared",
  "server",
  "transport",
] as const);
const CATEGORIES = Object.freeze(["expected", "invariant"] as const);
function isObjectLike(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}
function safeGet(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}
function safeHas(value: object, key: string): boolean {
  try {
    return Object.prototype.hasOwnProperty.call(value, key);
  } catch {
    return false;
  }
}
function utf8Length(value: string): number {
  let length = 0;
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0xfffd;
    length += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return length;
}
function truncateUtf8(value: string, limit: number): string {
  let output = "";
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0xfffd;
    const width =
      point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes + width > limit) break;
    output += character;
    bytes += width;
  }
  return output;
}
function sanitizeText(value: string, limit: number): string {
  let output = "";
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0xfffd;
    const replacement =
      point >= 0xd800 && point <= 0xdfff
        ? "�"
        : point <= 0x1f ||
            (point >= 0x7f && point <= 0x9f) ||
            point === 0x2028 ||
            point === 0x2029
          ? " "
          : character;
    if (utf8Length(output + replacement) > limit * 2) break;
    output += replacement;
  }
  output = output
    .replace(
      /\b(?:password|passwd|pwd|authorization|auth|cookie|token|secret|credential|api[-_ ]?key)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/giu,
      "[redacted]",
    )
    .replace(/\bbearer\s+\S+/giu, "[redacted]")
    .replace(/\bhttps?:\/\/[^\s]+/giu, "[url removed]");
  return truncateUtf8(output, limit);
}
function isStableName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    utf8Length(value) <= 64 &&
    STABLE_NAME.test(value)
  );
}
function isRuntime(value: unknown): value is RuntimeLayer {
  return (
    typeof value === "string" && (RUNTIMES as readonly string[]).includes(value)
  );
}
function isCategory(value: unknown): value is RuntimeErrorCategory {
  return (
    typeof value === "string" &&
    (CATEGORIES as readonly string[]).includes(value)
  );
}
function isReason(value: unknown): value is RejectedCommandReason {
  return (
    typeof value === "string" &&
    (REJECTED_COMMAND_REASONS as readonly string[]).includes(value)
  );
}
function forbiddenContextKey(value: string): boolean {
  const canonical = value.toLowerCase().replace(/[^a-z0-9]/gu, "");
  return FORBIDDEN_CONTEXT_FRAGMENTS.some((fragment) =>
    canonical.includes(fragment),
  );
}
function normalizeCause(value: unknown): RuntimeCauseSummary {
  let nativeError = false;
  try {
    nativeError = value instanceof Error;
  } catch {
    nativeError = false;
  }
  if (nativeError && isObjectLike(value)) {
    const rawName = safeGet(value, "name");
    const rawCode = safeGet(value, "code");
    const rawMessage = safeGet(value, "message");
    return Object.freeze({
      name: sanitizeText(typeof rawName === "string" ? rawName : "Error", 64),
      code: typeof rawCode === "string" ? sanitizeText(rawCode, 64) : null,
      message: sanitizeText(
        typeof rawMessage === "string" ? rawMessage : "Runtime operation threw",
        512,
      ),
    });
  }
  if (value === null)
    return Object.freeze({
      name: "null",
      code: null,
      message: "Null thrown value",
    });
  if (typeof value === "boolean")
    return Object.freeze({
      name: "boolean",
      code: null,
      message: String(value),
    });
  if (typeof value === "number")
    return Object.freeze({
      name: "number",
      code: null,
      message: Number.isFinite(value)
        ? String(value)
        : "Non-finite number thrown value",
    });
  if (typeof value === "bigint")
    return Object.freeze({
      name: "bigint",
      code: null,
      message: sanitizeText(String(value), 512),
    });
  if (typeof value === "undefined")
    return Object.freeze({
      name: "undefined",
      code: null,
      message: "Undefined thrown value",
    });
  if (typeof value === "string")
    return Object.freeze({
      name: "string",
      code: null,
      message: "String thrown value",
    });
  const name =
    typeof value === "function"
      ? "function"
      : typeof value === "symbol"
        ? "symbol"
        : "object";
  return Object.freeze({ name, code: null, message: "Non-Error thrown value" });
}
function sanitizeContext(value: unknown): readonly RuntimeErrorContextEntry[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const entries: RuntimeErrorContextEntry[] = [];
  for (let index = 0; index < value.length && entries.length < 16; index += 1) {
    let candidate: unknown;
    try {
      candidate = value[index];
    } catch {
      continue;
    }
    if (!isObjectLike(candidate)) continue;
    const rawKey = safeGet(candidate, "key");
    if (typeof rawKey !== "string") continue;
    const key = sanitizeText(rawKey, 64);
    if (key.length === 0 || forbiddenContextKey(key)) continue;
    const rawValue = safeGet(candidate, "value");
    let scalar: RuntimeErrorContextValue;
    if (rawValue === null || typeof rawValue === "boolean") scalar = rawValue;
    else if (typeof rawValue === "number" && Number.isFinite(rawValue))
      scalar = rawValue;
    else if (typeof rawValue === "string") scalar = sanitizeText(rawValue, 256);
    else continue;
    entries.push(Object.freeze({ key, value: scalar }));
  }
  entries.sort((left, right) =>
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
  );
  return Object.freeze(entries);
}
function serializedBytes(record: RuntimeErrorRecord): number {
  return utf8Length(JSON.stringify(record));
}
function fallbackRecord(
  sequence: number,
  runtime: RuntimeLayer,
): RuntimeErrorRecord {
  return Object.freeze({
    schemaVersion: 1,
    sequence,
    code: "invalid-runtime-error-input",
    category: "invariant",
    expected: false,
    runtime,
    operation: "create-runtime-error-record",
    message: "Runtime error input violated the structured error contract",
    context: Object.freeze([]),
    cause: null,
  });
}
export function createRuntimeErrorRecord(
  input: RuntimeErrorRecordInput,
): RuntimeErrorRecord {
  if (!isObjectLike(input)) return fallbackRecord(1, "server");
  const rawSequence = safeGet(input, "sequence");
  const rawRuntime = safeGet(input, "runtime");
  const sequence =
    Number.isSafeInteger(rawSequence) && (rawSequence as number) > 0
      ? (rawSequence as number)
      : 1;
  const runtime = isRuntime(rawRuntime) ? rawRuntime : "server";
  const rawCode = safeGet(input, "code");
  const rawCategory = safeGet(input, "category");
  const rawOperation = safeGet(input, "operation");
  const rawMessage = safeGet(input, "message");
  if (
    !(Number.isSafeInteger(rawSequence) && (rawSequence as number) > 0) ||
    !isStableName(rawCode) ||
    !isCategory(rawCategory) ||
    !isStableName(rawOperation) ||
    typeof rawMessage !== "string"
  )
    return fallbackRecord(sequence, runtime);
  const rawTick = safeGet(input, "tick");
  if (
    rawTick !== undefined &&
    (!Number.isSafeInteger(rawTick) || (rawTick as number) < 0)
  )
    return fallbackRecord(sequence, runtime);
  const rawReason = safeGet(input, "reasonCode");
  if (
    rawReason !== undefined &&
    (!isReason(rawReason) || rawCategory !== "expected")
  )
    return fallbackRecord(sequence, runtime);
  const optionalStrings: Record<string, string> = {};
  for (const [key, limit] of [
    ["featureId", 128],
    ["entityId", 128],
    ["connectionId", 128],
  ] as const) {
    const raw = safeGet(input, key);
    if (typeof raw === "string")
      optionalStrings[key] = sanitizeText(raw, limit);
    else if (raw !== undefined) return fallbackRecord(sequence, runtime);
  }
  let context = sanitizeContext(safeGet(input, "context"));
  const cause = safeHas(input, "cause")
    ? normalizeCause(safeGet(input, "cause"))
    : null;
  const build = (): RuntimeErrorRecord =>
    Object.freeze({
      schemaVersion: 1,
      sequence,
      code: rawCode,
      category: rawCategory,
      expected: rawCategory === "expected",
      runtime,
      operation: rawOperation,
      message: sanitizeText(rawMessage, 512),
      ...(rawTick === undefined ? {} : { tick: rawTick as number }),
      ...optionalStrings,
      ...(rawReason === undefined
        ? {}
        : { reasonCode: rawReason as RejectedCommandReason }),
      context,
      cause,
    });
  let record = build();
  while (
    serializedBytes(record) > RUNTIME_ERROR_SERIALIZED_BYTE_LIMIT &&
    context.length > 0
  ) {
    context = Object.freeze(context.slice(0, -1));
    record = build();
  }
  return serializedBytes(record) <= RUNTIME_ERROR_SERIALIZED_BYTE_LIMIT
    ? record
    : fallbackRecord(sequence, runtime);
}
function zeroLiveResources(): Record<LiveResourceKind, number> {
  return Object.fromEntries(
    LIVE_RESOURCE_KINDS.map((kind) => [kind, 0]),
  ) as Record<LiveResourceKind, number>;
}
function zeroRejectedCommands(): Record<RejectedCommandReason, number> {
  return Object.fromEntries(
    REJECTED_COMMAND_REASONS.map((reason) => [reason, 0]),
  ) as Record<RejectedCommandReason, number>;
}
function frozenRecord<T extends string>(
  keys: readonly T[],
  source: Readonly<Record<T, number>>,
): Readonly<Record<T, number>> {
  return Object.freeze(
    Object.fromEntries(keys.map((key) => [key, source[key]])),
  ) as Readonly<Record<T, number>>;
}
function sequenceInput(
  input: RuntimeErrorInput,
  sequence: number,
  fallbackRuntime: HostRuntime,
): RuntimeErrorRecordInput {
  const source = isObjectLike(input) ? input : Object.freeze({});
  const runtime = safeGet(source, "runtime");
  const tick = safeGet(source, "tick");
  const featureId = safeGet(source, "featureId");
  const entityId = safeGet(source, "entityId");
  const connectionId = safeGet(source, "connectionId");
  const reasonCode = safeGet(source, "reasonCode");
  const context = safeGet(source, "context");
  return {
    sequence,
    code: safeGet(source, "code") as string,
    category: safeGet(source, "category") as RuntimeErrorCategory,
    runtime: isRuntime(runtime) ? runtime : fallbackRuntime,
    operation: safeGet(source, "operation") as string,
    message: safeGet(source, "message") as string,
    ...(tick === undefined ? {} : { tick: tick as number }),
    ...(featureId === undefined ? {} : { featureId: featureId as string }),
    ...(entityId === undefined ? {} : { entityId: entityId as string }),
    ...(connectionId === undefined
      ? {}
      : { connectionId: connectionId as string }),
    ...(reasonCode === undefined
      ? {}
      : { reasonCode: reasonCode as RejectedCommandReason }),
    ...(context === undefined
      ? {}
      : { context: context as readonly RuntimeErrorContextEntry[] }),
    ...(safeHas(source, "cause") ? { cause: safeGet(source, "cause") } : {}),
  };
}
class TelemetryStoreImplementation<TRuntime extends HostRuntime>
  implements TelemetryStore<TRuntime>
{
  private telemetrySequence = 0;
  private simulationTick = 0;
  private entityCount = 0;
  private installedFeatureIds: readonly string[] = Object.freeze([]);
  private droppedWallTimeSeconds = 0;
  private scheduleReport: RuntimeScheduleReport | null = null;
  private readonly resources = zeroLiveResources();
  private errorCount = 0;
  private evictedErrorCount = 0;
  private readonly errors: RuntimeErrorRecord[] = [];
  private observer: RuntimeErrorObserver | null;
  private serverTickDurationSeconds: number | null = null;
  private serverBacklogSeconds = 0;
  private clientFrameDurationSeconds: number | null = null;
  private presentationFrameCount = 0;
  private readonly rejectedCommands = zeroRejectedCommands();
  constructor(
    readonly runtime: TRuntime,
    observer?: RuntimeErrorObserver,
  ) {
    this.observer = observer ?? null;
  }
  recordRuntimeError(input: RuntimeErrorInput): RuntimeErrorRecord {
    return this.append(input, true);
  }
  snapshotTelemetry(): TelemetrySnapshotFor<TRuntime> {
    const common = {
      schemaVersion: 1 as const,
      runtime: this.runtime,
      telemetrySequence: this.telemetrySequence,
      simulationTick: this.simulationTick,
      entityCount: this.entityCount,
      installedFeatureIds: Object.freeze([...this.installedFeatureIds]),
      droppedWallTimeSeconds: this.droppedWallTimeSeconds,
      scheduleReport:
        this.scheduleReport === null
          ? null
          : Object.freeze(
              this.scheduleReport.map((entry) => Object.freeze({ ...entry })),
            ),
      connection: null,
      liveResources: frozenRecord(LIVE_RESOURCE_KINDS, this.resources),
      structuredRuntimeErrorCount: this.errorCount,
      structuredRuntimeErrorEvictedCount: this.evictedErrorCount,
      structuredRuntimeErrors: Object.freeze([...this.errors]),
    };
    if (this.runtime === "server")
      return Object.freeze({
        ...common,
        runtime: "server",
        serverTickDurationSeconds: this.serverTickDurationSeconds,
        serverBacklogSeconds: this.serverBacklogSeconds,
        rejectedCommandCounts: frozenRecord(
          REJECTED_COMMAND_REASONS,
          this.rejectedCommands,
        ),
      }) as TelemetrySnapshotFor<TRuntime>;
    return Object.freeze({
      ...common,
      runtime: "client",
      clientFrameDurationSeconds: this.clientFrameDurationSeconds,
      presentationFrameCount: this.presentationFrameCount,
    }) as TelemetrySnapshotFor<TRuntime>;
  }
  observeClientSchedule(report: ClientScheduleReport): void {
    let copied: ClientScheduleReport;
    try {
      if (
        !Array.isArray(report) ||
        !report.every((entry) => isObjectLike(entry))
      ) {
        this.invalidTelemetry("observe-client-schedule");
        return;
      }
      copied = Object.freeze(
        report.map((entry) => Object.freeze({ ...entry })),
      ) as ClientScheduleReport;
    } catch {
      this.invalidTelemetry("observe-client-schedule");
      return;
    }
    if (JSON.stringify(copied) === JSON.stringify(this.scheduleReport)) return;
    this.scheduleReport = copied;
    this.bump();
  }
  observeClientTick(tick: number, entityCount: number): void {
    if (
      !this.validGauge(tick) ||
      !this.validGauge(entityCount) ||
      tick < this.simulationTick
    ) {
      this.invalidTelemetry("observe-client-tick");
      return;
    }
    if (tick === this.simulationTick && entityCount === this.entityCount)
      return;
    this.simulationTick = tick;
    this.entityCount = entityCount;
    this.bump();
  }
  observeClientPump(cumulativeDroppedSeconds: number): void {
    if (
      !Number.isFinite(cumulativeDroppedSeconds) ||
      cumulativeDroppedSeconds < this.droppedWallTimeSeconds
    ) {
      this.invalidTelemetry("observe-client-pump");
      return;
    }
    if (cumulativeDroppedSeconds === this.droppedWallTimeSeconds) return;
    this.droppedWallTimeSeconds = cumulativeDroppedSeconds;
    this.bump();
  }
  observeClientFrame(
    presentationFrameCount: number,
    durationSeconds: number,
  ): void {
    if (
      !this.validGauge(presentationFrameCount) ||
      presentationFrameCount < this.presentationFrameCount ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds < 0
    ) {
      this.invalidTelemetry("observe-client-frame");
      return;
    }
    if (
      presentationFrameCount === this.presentationFrameCount &&
      durationSeconds === this.clientFrameDurationSeconds
    )
      return;
    this.presentationFrameCount = presentationFrameCount;
    this.clientFrameDurationSeconds = durationSeconds;
    this.bump();
  }
  observeServerSchedule(report: ServerScheduleReport): void {
    const copied = Object.freeze(
      report.map((entry) => Object.freeze({ ...entry })),
    );
    if (JSON.stringify(copied) === JSON.stringify(this.scheduleReport)) return;
    this.scheduleReport = copied;
    this.bump();
  }
  observeServerTick(
    tick: number,
    durationSeconds: number,
    entityCount: number,
  ): void {
    if (
      !this.validGauge(tick) ||
      !this.validGauge(entityCount) ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds < 0 ||
      tick < this.simulationTick
    ) {
      this.invalidTelemetry("observe-server-tick");
      return;
    }
    this.simulationTick = tick;
    this.entityCount = entityCount;
    this.serverTickDurationSeconds = durationSeconds;
    this.serverBacklogSeconds = 0;
    this.bump();
  }
  observeServerTickAttempt(tick: number, entityCount: number): void {
    if (
      !this.validGauge(tick) ||
      !this.validGauge(entityCount) ||
      tick < this.simulationTick
    ) {
      this.invalidTelemetry("observe-server-tick-attempt");
      return;
    }
    if (tick === this.simulationTick && entityCount === this.entityCount)
      return;
    this.simulationTick = tick;
    this.entityCount = entityCount;
    this.bump();
  }
  observeServerPump(
    backlogSeconds: number,
    cumulativeDroppedSeconds: number,
  ): void {
    if (
      !Number.isFinite(backlogSeconds) ||
      backlogSeconds < 0 ||
      !Number.isFinite(cumulativeDroppedSeconds) ||
      cumulativeDroppedSeconds < this.droppedWallTimeSeconds
    ) {
      this.invalidTelemetry("observe-server-pump");
      return;
    }
    if (
      backlogSeconds === this.serverBacklogSeconds &&
      cumulativeDroppedSeconds === this.droppedWallTimeSeconds
    )
      return;
    this.serverBacklogSeconds = backlogSeconds;
    this.droppedWallTimeSeconds = cumulativeDroppedSeconds;
    this.bump();
  }
  observeEntityCount(entityCount: number): void {
    if (!this.validGauge(entityCount)) {
      this.invalidTelemetry("observe-entity-count");
      return;
    }
    if (entityCount === this.entityCount) return;
    this.entityCount = entityCount;
    this.bump();
  }
  observeInstalledFeatureIds(featureIds: readonly string[]): void {
    const copied = Object.freeze(featureIds.map((id) => sanitizeText(id, 128)));
    if (
      copied.length === this.installedFeatureIds.length &&
      copied.every((id, index) => id === this.installedFeatureIds[index])
    )
      return;
    this.installedFeatureIds = copied;
    this.bump();
  }
  retainLiveResource(kind: LiveResourceKind, amount = 1): void {
    if (
      !(LIVE_RESOURCE_KINDS as readonly string[]).includes(kind) ||
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      this.resources[kind] > Number.MAX_SAFE_INTEGER - amount
    ) {
      this.invalidTelemetry("retain-live-resource");
      return;
    }
    this.resources[kind] += amount;
    this.bump();
  }
  releaseLiveResource(kind: LiveResourceKind, amount = 1): void {
    if (
      !(LIVE_RESOURCE_KINDS as readonly string[]).includes(kind) ||
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      this.resources[kind] < amount
    ) {
      this.invalidTelemetry("release-live-resource");
      return;
    }
    this.resources[kind] -= amount;
    this.bump();
  }
  private append(
    input: RuntimeErrorInput,
    notify: boolean,
  ): RuntimeErrorRecord {
    if (this.errorCount === Number.MAX_SAFE_INTEGER)
      return fallbackRecord(Number.MAX_SAFE_INTEGER, this.runtime);
    const sequence = this.errorCount + 1;
    const record = createRuntimeErrorRecord(
      sequenceInput(input, sequence, this.runtime),
    );
    if (
      record.reasonCode !== undefined &&
      this.runtime === "server" &&
      record.expected
    ) {
      const count = this.rejectedCommands[record.reasonCode];
      if (count < Number.MAX_SAFE_INTEGER)
        this.rejectedCommands[record.reasonCode] = count + 1;
    }
    this.errorCount = sequence;
    if (this.errors.length === RUNTIME_ERROR_RING_CAPACITY) {
      this.errors.shift();
      this.evictedErrorCount += 1;
    }
    this.errors.push(record);
    this.bump();
    if (notify && this.observer !== null) {
      const observer = this.observer;
      try {
        observer(record);
      } catch (cause) {
        this.observer = null;
        this.append(
          {
            code: "runtime-error-observer-threw",
            category: "invariant",
            runtime: this.runtime,
            operation: "observe-runtime-error",
            message: "The structured runtime error observer threw",
            context: Object.freeze([]),
            cause,
          },
          false,
        );
      }
    }
    return record;
  }
  private bump(): void {
    if (this.telemetrySequence < Number.MAX_SAFE_INTEGER)
      this.telemetrySequence += 1;
  }
  private validGauge(value: number): boolean {
    return Number.isSafeInteger(value) && value >= 0;
  }
  private invalidTelemetry(operation: string): void {
    this.append(
      {
        code: "invalid-telemetry-state",
        category: "invariant",
        runtime: this.runtime,
        operation,
        message: "Telemetry input violated the finite bounded state contract",
        context: Object.freeze([]),
      },
      true,
    );
  }
}
export function createTelemetryStore(
  options: TelemetryStoreOptions<"client">,
): TelemetryStore<"client">;
export function createTelemetryStore(
  options: TelemetryStoreOptions<"server">,
): TelemetryStore<"server">;
export function createTelemetryStore<TRuntime extends HostRuntime>(
  options: TelemetryStoreOptions<TRuntime>,
): TelemetryStore<TRuntime> {
  return new TelemetryStoreImplementation(
    options.runtime,
    options.observeRuntimeError,
  );
}
export const createRuntimeTelemetryStore = createTelemetryStore;
