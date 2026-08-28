import {
  createRuntimeErrorRecord,
  RUNTIME_ERROR_RING_CAPACITY,
  type RuntimeErrorRecord,
} from "@three-game-kit/core";
import {
  MAX_FUTURE_TICKS,
  MAX_MOVEMENT_SPEED,
  MAX_PAST_TICKS,
  MAX_PENDING_COMMANDS,
  MAX_POSITION_ABS,
  MAX_SEQUENCE,
  MAX_SNAPSHOT_ENTITIES,
  MAX_TICK,
  PROTOCOL_VERSION,
  type AvatarSnapshotEntity,
  type ClientMessage,
  type CommandMessage,
  type JoinedMessage,
  type RejectedMessage,
  type RejectedReason,
  type ServerMessage,
  type SnapshotMessage,
} from "@three-game-kit/protocol";
import {
  computeDesiredMovementTranslation,
  type MovementVector,
} from "@three-game-kit/shared";
import type { ServerCollisionAdapter } from "./collision.js";

const TICKS_PER_SECOND = 60;
const DT_SECONDS = 1 / TICKS_PER_SECOND;
const ID_BYTE_LENGTH = 16;
const MAX_ID_ALLOCATION_ATTEMPTS = 1_024;
const MAX_PHASE_TRACE_ENTRIES = 4_096;
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export type AuthoritativeConnectionPhase =
  | "connected"
  | "ready"
  | "joining"
  | "joined"
  | "disconnecting"
  | "closed";

export type AuthoritativeServerPhase =
  | "ingress"
  | "validate-bind"
  | "command-apply"
  | "shared-movement"
  | "authoritative-collision"
  | "gameplay"
  | "snapshot-build"
  | "telemetry";

export type AuthoritativeFailureCode =
  | RejectedReason
  | "invalid-state"
  | "server-shutdown"
  | "tick-exhausted"
  | "join-failed";

export type AuthoritativeDecodeIngressRejectionReason =
  | "schema-invalid"
  | "unknown-kind";

export type AuthoritativeValidationFixture =
  | Readonly<{ readonly kind: "ownership-violation" }>
  | Readonly<{
      readonly kind: "movement-speed";
      readonly metersPerSecond: number;
    }>;

export interface AuthoritativeFailure {
  readonly code: AuthoritativeFailureCode;
}

export type AuthoritativeOutcome<Value = undefined> =
  | Readonly<{ readonly ok: true; readonly value: Value }>
  | Readonly<{
      readonly ok: false;
      readonly failure: AuthoritativeFailure;
    }>;

export type AuthoritativeRejectionCounts = Readonly<
  Record<RejectedReason, number>
>;

export interface AuthoritativeConnectionOptions {
  readonly emit: (message: ServerMessage) => void;
}

export interface AuthoritativeServerOptions {
  readonly spawnPosition: MovementVector;
  readonly spawnPositionsByConnectionOrdinal?: readonly MovementVector[];
  readonly movementSpeedMetersPerSecond: number;
  readonly collisionAdapter: ServerCollisionAdapter;
}

export interface AuthoritativeConnectionInspection {
  readonly phase: AuthoritativeConnectionPhase;
  readonly phaseTrace: readonly AuthoritativeConnectionPhase[];
  readonly connectionId: string | null;
  readonly playerId: string | null;
  readonly ownedEntityId: string | null;
  readonly position: MovementVector | null;
  readonly pendingCommandCount: number;
  readonly scheduledCommandCount: number;
  readonly acceptedSequence: number | null;
  readonly acknowledgedSequence: number | null;
  readonly rejectedCommandCounts: AuthoritativeRejectionCounts;
}

export interface AuthoritativePhaseInspection {
  readonly serverTick: number;
  readonly phase: AuthoritativeServerPhase;
}

export interface AuthoritativeAvatarInspection {
  readonly entityId: string;
  readonly playerId: string;
  readonly position: MovementVector;
}

export interface AuthoritativeForcedPositionFixtureInspection {
  readonly entityId: string;
  readonly serverTick: number;
  readonly position: MovementVector;
}

export interface AuthoritativeValidationFixtureInspection {
  readonly entityId: string;
  readonly kind: AuthoritativeValidationFixture["kind"];
  readonly metersPerSecond: number | null;
}

export interface AuthoritativeLiveResourceCounts {
  readonly connections: number;
  readonly bindings: number;
  readonly avatars: number;
  readonly capsules: number;
  readonly pendingCommands: number;
  readonly scheduledCommands: number;
}

export interface AuthoritativeServerInspection {
  readonly serverTick: number;
  readonly currentPhase: AuthoritativeServerPhase | null;
  readonly shutdown: boolean;
  readonly connections: readonly AuthoritativeConnectionInspection[];
  readonly avatars: readonly AuthoritativeAvatarInspection[];
  readonly phaseTrace: readonly AuthoritativePhaseInspection[];
  readonly rejectedCommandCounts: AuthoritativeRejectionCounts;
  readonly structuredRuntimeErrors: readonly RuntimeErrorRecord[];
  readonly sharedMovementCallCount: number;
  readonly authoritativeCollisionCallCount: number;
  readonly liveResourceCounts: AuthoritativeLiveResourceCounts;
  readonly forcedPositionFixtures: Readonly<{
    readonly pendingCount: number;
    readonly scheduledCount: number;
    readonly consumedCount: number;
    readonly lastConsumed: AuthoritativeForcedPositionFixtureInspection | null;
  }>;
  readonly validationFixtures: Readonly<{
    readonly pendingCount: number;
    readonly armedCount: number;
    readonly consumedCount: number;
    readonly lastConsumed: AuthoritativeValidationFixtureInspection | null;
  }>;
}

export interface AuthoritativeConnection {
  readonly phase: AuthoritativeConnectionPhase;
  markReady(): AuthoritativeOutcome;
  receive(message: ClientMessage): AuthoritativeOutcome;
  disconnect(): AuthoritativeOutcome;
  inspect(): AuthoritativeConnectionInspection;
}

export interface AuthoritativeServer {
  readonly serverTick: number;
  readonly shutdownStarted: boolean;
  acceptConnection(
    options: AuthoritativeConnectionOptions,
  ): AuthoritativeOutcome<AuthoritativeConnection>;
  scheduleForcedPosition(
    entityId: string,
    serverTick: number,
    position: MovementVector,
  ): AuthoritativeOutcome;
  armNextValidationFixture(
    entityId: string,
    fixture: AuthoritativeValidationFixture,
  ): AuthoritativeOutcome;
  recordDecodeIngressRejection(
    reason: AuthoritativeDecodeIngressRejectionReason,
  ): RuntimeErrorRecord;
  stepExact(count?: number): AuthoritativeOutcome<number>;
  inspect(): AuthoritativeServerInspection;
  shutdown(): AuthoritativeOutcome;
}

interface EntityRecord {
  readonly runtimeEntityId: number;
  readonly entityId: string;
  readonly playerId: string;
  readonly owner: ConnectionRecord;
  position: MovementVector;
}

interface ScheduledForcedPosition {
  readonly entityId: string;
  readonly serverTick: number;
  readonly position: MovementVector;
}

interface ArmedValidationFixture {
  readonly entityId: string;
  readonly fixture: AuthoritativeValidationFixture;
}

interface QueuedCommand {
  readonly owner: ConnectionRecord;
  readonly message: CommandMessage;
}

interface ScheduledCommand extends QueuedCommand {
  readonly ordinal: number;
}

interface MovementWork {
  readonly command: ScheduledCommand;
  desiredTranslation?: MovementVector;
}

interface ConnectionRecord {
  readonly ordinal: number;
  readonly emit: (message: ServerMessage) => void;
  phase: AuthoritativeConnectionPhase;
  readonly phaseTrace: AuthoritativeConnectionPhase[];
  live: boolean;
  connectionId: string | null;
  playerId: string | null;
  ownedEntityId: string | null;
  runtimeEntityId: number | null;
  acceptedSequence: number | null;
  acknowledgedSequence: number | null;
  readonly completedSequences: Set<number>;
  ingress: QueuedCommand[];
  validating: QueuedCommand[];
  scheduled: ScheduledCommand[];
  readonly movementSlots: Set<number>;
  pendingCommandCount: number;
  readonly rejectedCommandCounts: Record<RejectedReason, number>;
}

function createMutableRejectionCounts(): Record<RejectedReason, number> {
  return {
    "schema-invalid": 0,
    "unsupported-version": 0,
    "unknown-kind": 0,
    "wrong-direction": 0,
    "phase-invalid": 0,
    "sequence-invalid": 0,
    "tick-out-of-window": 0,
    "queue-full": 0,
    "ownership-violation": 0,
    "movement-limit": 0,
    "unknown-target": 0,
    "interaction-out-of-range": 0,
    "stale-connection": 0,
  };
}

function freezeRejectionCounts(
  source: Readonly<Record<RejectedReason, number>>,
): AuthoritativeRejectionCounts {
  return Object.freeze({ ...source });
}

function succeeded<Value>(value: Value): AuthoritativeOutcome<Value> {
  return Object.freeze({ ok: true, value });
}

function failed(code: AuthoritativeFailureCode): AuthoritativeOutcome<never> {
  return Object.freeze({
    ok: false,
    failure: Object.freeze({ code }),
  });
}

function copyFinitePosition(
  value: MovementVector,
  label: string,
): MovementVector {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const { x, y, z } = value;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 3 ||
    !keys.includes("x") ||
    !keys.includes("y") ||
    !keys.includes("z")
  ) {
    throw new TypeError(`${label} must contain exactly x, y, and z`);
  }
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    Math.abs(x) > MAX_POSITION_ABS ||
    typeof y !== "number" ||
    !Number.isFinite(y) ||
    Math.abs(y) > MAX_POSITION_ABS ||
    typeof z !== "number" ||
    !Number.isFinite(z) ||
    Math.abs(z) > MAX_POSITION_ABS
  ) {
    throw new RangeError(`${label} must contain bounded finite coordinates`);
  }
  return Object.freeze({ x, y, z });
}

function copyValidationFixture(
  value: AuthoritativeValidationFixture,
): AuthoritativeValidationFixture {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Authoritative validation fixture must be an object");
  }
  const keys = Reflect.ownKeys(value);
  if (value.kind === "ownership-violation") {
    if (keys.length !== 1 || !keys.includes("kind")) {
      throw new TypeError(
        "Ownership validation fixture must contain exactly kind",
      );
    }
    return Object.freeze({ kind: "ownership-violation" });
  }
  if (value.kind !== "movement-speed") {
    throw new TypeError("Authoritative validation fixture kind is invalid");
  }
  if (
    keys.length !== 2 ||
    !keys.includes("kind") ||
    !keys.includes("metersPerSecond") ||
    typeof value.metersPerSecond !== "number"
  ) {
    throw new TypeError(
      "Movement-speed validation fixture must contain numeric metersPerSecond",
    );
  }
  if (
    !Number.isFinite(value.metersPerSecond) ||
    value.metersPerSecond <= 0
  ) {
    throw new RangeError(
      "Movement-speed validation fixture must be finite and positive",
    );
  }
  return Object.freeze({
    kind: "movement-speed",
    metersPerSecond: value.metersPerSecond,
  });
}

function isBoundedFinitePosition(value: MovementVector): boolean {
  return (
    Number.isFinite(value.x) &&
    Math.abs(value.x) <= MAX_POSITION_ABS &&
    Number.isFinite(value.y) &&
    Math.abs(value.y) <= MAX_POSITION_ABS &&
    Number.isFinite(value.z) &&
    Math.abs(value.z) <= MAX_POSITION_ABS
  );
}

function copyCommand(message: CommandMessage): CommandMessage {
  const action =
    message.action.kind === "move"
      ? Object.freeze({
          kind: "move" as const,
          x: message.action.x,
          z: message.action.z,
        })
      : Object.freeze({
          kind: "interact" as const,
          targetEntityId: message.action.targetEntityId,
        });
  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    kind: "command",
    sequence: message.sequence,
    intendedTick: message.intendedTick,
    action,
  });
}

function productionIdBytes(): Uint8Array {
  const source = globalThis.crypto;
  if (source === undefined || typeof source.getRandomValues !== "function") {
    throw new Error("A cryptographically secure random source is required");
  }
  return source.getRandomValues(new Uint8Array(ID_BYTE_LENGTH));
}

function encodeBase64Url(bytes: Uint8Array): string {
  let encoded = "";
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset] ?? 0;
    const hasSecond = offset + 1 < bytes.length;
    const hasThird = offset + 2 < bytes.length;
    const second = bytes[offset + 1] ?? 0;
    const third = bytes[offset + 2] ?? 0;
    encoded += BASE64URL_ALPHABET[(first >>> 2) & 63] ?? "";
    encoded +=
      BASE64URL_ALPHABET[((first & 3) << 4) | ((second >>> 4) & 15)] ??
      "";
    if (hasSecond) {
      encoded +=
        BASE64URL_ALPHABET[((second & 15) << 2) | ((third >>> 6) & 3)] ??
        "";
    }
    if (hasThird) encoded += BASE64URL_ALPHABET[third & 63] ?? "";
  }
  return encoded;
}

function createEngine(
  options: AuthoritativeServerOptions,
): AuthoritativeServer {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Authoritative Server options must be an object");
  }
  if (
    typeof options.collisionAdapter !== "object" ||
    options.collisionAdapter === null
  ) {
    throw new TypeError("A Server collision adapter is required");
  }

  const spawnPosition = copyFinitePosition(
    options.spawnPosition,
    "Authoritative spawn position",
  );
  const configuredSpawnPositions = options.spawnPositionsByConnectionOrdinal;
  if (
    configuredSpawnPositions !== undefined &&
    !Array.isArray(configuredSpawnPositions)
  ) {
    throw new TypeError(
      "Authoritative spawn positions by connection ordinal must be an array",
    );
  }
  const spawnPositionsByConnectionOrdinal = Object.freeze(
    Array.from(configuredSpawnPositions ?? [], (position, index) =>
      copyFinitePosition(position, `Authoritative spawn position ${index + 1}`),
    ),
  );
  const movementSpeedMetersPerSecond = options.movementSpeedMetersPerSecond;
  const collisionAdapter = options.collisionAdapter;
  const records: ConnectionRecord[] = [];
  const connectionBindings = new Map<string, ConnectionRecord>();
  const playerBindings = new Map<string, ConnectionRecord>();
  const entities = new Map<string, EntityRecord>();
  const issuedIds = new Set<string>();
  const phaseTrace: AuthoritativePhaseInspection[] = [];
  const rejectedCommandCounts = createMutableRejectionCounts();
  const structuredRuntimeErrors: RuntimeErrorRecord[] = [];
  let runtimeErrorSequence = 0;
  let sharedMovementCallCount = 0;
  let authoritativeCollisionCallCount = 0;
  let nextOrdinal = 1;
  let nextRuntimeEntityId = 1;
  let tick = 0;
  let currentPhase: AuthoritativeServerPhase | null = null;
  let movementWork: MovementWork[] = [];
  let shutdownStarted = false;
  let cachedShutdownOutcome: AuthoritativeOutcome | undefined;
  let forcedPositionFixtures: ScheduledForcedPosition[] = [];
  let forcedPositionScheduledCount = 0;
  let forcedPositionConsumedCount = 0;
  let lastConsumedForcedPosition: ScheduledForcedPosition | null = null;
  const validationFixtures = new Map<string, ArmedValidationFixture>();
  let validationFixtureArmedCount = 0;
  let validationFixtureConsumedCount = 0;
  let lastConsumedValidationFixture: AuthoritativeValidationFixtureInspection | null =
    null;

  function allocateId(): string {
    for (
      let attempt = 0;
      attempt < MAX_ID_ALLOCATION_ATTEMPTS;
      attempt += 1
    ) {
      const generated = productionIdBytes();
      const id = encodeBase64Url(new Uint8Array(generated));
      if (id.length !== 22) {
        throw new Error("The ID encoder did not produce 22 characters");
      }
      if (!issuedIds.has(id)) {
        issuedIds.add(id);
        return id;
      }
    }
    throw new Error("Unable to allocate a unique authoritative ID");
  }

  function transition(
    record: ConnectionRecord,
    phase: AuthoritativeConnectionPhase,
  ): void {
    if (record.phase === phase) return;
    record.phase = phase;
    record.phaseTrace.push(phase);
  }

  function safelyEmit(record: ConnectionRecord, message: ServerMessage): void {
    if (!record.live || record.phase === "disconnecting" || record.phase === "closed") {
      return;
    }
    try {
      record.emit(message);
    } catch {
      // Transport send failures are owned by the later transport adapter.
    }
  }

  function incrementRejection(
    record: ConnectionRecord,
    reason: RejectedReason,
  ): void {
    rejectedCommandCounts[reason] = rejectedCommandCounts[reason] + 1;
    record.rejectedCommandCounts[reason] =
      record.rejectedCommandCounts[reason] + 1;
  }

  function reject(
    record: ConnectionRecord,
    reason: RejectedReason,
    sequence: number | null,
  ): AuthoritativeOutcome<never> {
    incrementRejection(record, reason);
    if (record.live) {
      const message: RejectedMessage = Object.freeze({
        protocolVersion: PROTOCOL_VERSION,
        kind: "rejected",
        sequence,
        reason,
      });
      safelyEmit(record, message);
    }
    return failed(reason);
  }

  function inspectConnection(
    record: ConnectionRecord,
  ): AuthoritativeConnectionInspection {
    const entity =
      record.ownedEntityId === null
        ? undefined
        : entities.get(record.ownedEntityId);
    return Object.freeze({
      phase: record.phase,
      phaseTrace: Object.freeze(Array.from(record.phaseTrace)),
      connectionId: record.connectionId,
      playerId: record.playerId,
      ownedEntityId: record.ownedEntityId,
      position:
        entity === undefined
          ? null
          : copyFinitePosition(entity.position, "Inspected avatar position"),
      pendingCommandCount: record.pendingCommandCount,
      scheduledCommandCount: record.scheduled.length,
      acceptedSequence: record.acceptedSequence,
      acknowledgedSequence: record.acknowledgedSequence,
      rejectedCommandCounts: freezeRejectionCounts(
        record.rejectedCommandCounts,
      ),
    });
  }

  function purgeCommands(record: ConnectionRecord): void {
    const activeCount = movementWork.reduce(
      (count, work) => count + (work.command.owner === record ? 1 : 0),
      0,
    );
    const purgedCount =
      record.ingress.length +
      record.validating.length +
      record.scheduled.length +
      activeCount;
    for (let index = 0; index < purgedCount; index += 1) {
      incrementRejection(record, "stale-connection");
      runtimeErrorSequence += 1;
      structuredRuntimeErrors.push(
        createRuntimeErrorRecord({
          sequence: runtimeErrorSequence,
          code: "command-rejected",
          category: "expected",
          runtime: "server",
          operation: "disconnect-fence",
          message: "Purged command was rejected by the disconnect fence",
          tick,
          reasonCode: "stale-connection",
        }),
      );
      if (structuredRuntimeErrors.length > RUNTIME_ERROR_RING_CAPACITY) {
        structuredRuntimeErrors.shift();
      }
    }
    movementWork = movementWork.filter(
      (work) => work.command.owner !== record,
    );
    record.ingress = [];
    record.validating = [];
    record.scheduled = [];
    record.movementSlots.clear();
    record.completedSequences.clear();
    record.pendingCommandCount = 0;
  }

  function purgeForcedPositionFixtures(entityId: string): void {
    forcedPositionFixtures = forcedPositionFixtures.filter(
      (fixture) => fixture.entityId !== entityId,
    );
  }

  function disconnectRecord(record: ConnectionRecord): AuthoritativeOutcome {
    if (record.phase === "closed") return succeeded(undefined);
    if (record.phase === "disconnecting") return succeeded(undefined);

    const connectionId = record.connectionId;
    const playerId = record.playerId;
    const ownedEntityId = record.ownedEntityId;
    transition(record, "disconnecting");
    record.live = false;
    record.acceptedSequence = null;
    record.acknowledgedSequence = null;
    purgeCommands(record);

    if (connectionId !== null) connectionBindings.delete(connectionId);
    if (playerId !== null) playerBindings.delete(playerId);
    if (ownedEntityId !== null) {
      purgeForcedPositionFixtures(ownedEntityId);
      validationFixtures.delete(ownedEntityId);
      entities.delete(ownedEntityId);
      try {
        collisionAdapter.removeAvatar(ownedEntityId);
      } catch {
        // Cleanup remains terminal even if an injected adapter fails.
      }
    }
    record.connectionId = null;
    record.playerId = null;
    record.ownedEntityId = null;
    record.runtimeEntityId = null;
    transition(record, "closed");
    return succeeded(undefined);
  }

  function join(record: ConnectionRecord): AuthoritativeOutcome {
    transition(record, "joining");
    if (entities.size >= MAX_SNAPSHOT_ENTITIES) {
      disconnectRecord(record);
      return failed("join-failed");
    }

    const allocatedIds: string[] = [];
    let ownedEntityId: string | undefined;
    let capsuleCreated = false;
    try {
      const connectionId = allocateId();
      allocatedIds.push(connectionId);
      const playerId = allocateId();
      allocatedIds.push(playerId);
      ownedEntityId = allocateId();
      allocatedIds.push(ownedEntityId);
      const runtimeEntityId = nextRuntimeEntityId;
      const spawnPositionIndex = record.ordinal - 1;
      const selectedSpawnPosition =
        spawnPositionIndex < spawnPositionsByConnectionOrdinal.length
          ? spawnPositionsByConnectionOrdinal[spawnPositionIndex]!
          : spawnPosition;

      const capsuleOutcome = collisionAdapter.createAvatar(
        ownedEntityId,
        selectedSpawnPosition,
      );
      if (!capsuleOutcome.ok) throw new Error(capsuleOutcome.failure.code);
      capsuleCreated = true;

      const entity: EntityRecord = {
        runtimeEntityId,
        entityId: ownedEntityId,
        playerId,
        owner: record,
        position: copyFinitePosition(
          selectedSpawnPosition,
          "Avatar spawn position",
        ),
      };
      connectionBindings.set(connectionId, record);
      playerBindings.set(playerId, record);
      entities.set(ownedEntityId, entity);
      record.connectionId = connectionId;
      record.playerId = playerId;
      record.ownedEntityId = ownedEntityId;
      record.runtimeEntityId = runtimeEntityId;
      nextRuntimeEntityId += 1;
      transition(record, "joined");

      const message: JoinedMessage = Object.freeze({
        protocolVersion: PROTOCOL_VERSION,
        kind: "joined",
        connectionId,
        playerId,
        ownedEntityId,
        serverTick: tick,
      });
      safelyEmit(record, message);
      return succeeded(undefined);
    } catch {
      if (ownedEntityId !== undefined) {
        entities.delete(ownedEntityId);
        if (capsuleCreated) {
          try {
            collisionAdapter.removeAvatar(ownedEntityId);
          } catch {
            // Continue transaction rollback.
          }
        }
      }
      for (const id of allocatedIds) issuedIds.delete(id);
      disconnectRecord(record);
      return failed("join-failed");
    }
  }

  function receive(
    record: ConnectionRecord,
    message: ClientMessage,
  ): AuthoritativeOutcome {
    if (!record.live || record.phase === "disconnecting" || record.phase === "closed") {
      return reject(
        record,
        "stale-connection",
        message.kind === "command" ? message.sequence : null,
      );
    }

    if (message.kind === "join") {
      if (record.phase !== "ready") {
        return reject(record, "phase-invalid", null);
      }
      return join(record);
    }

    if (record.phase !== "joined") {
      return reject(record, "phase-invalid", message.sequence);
    }
    if (record.pendingCommandCount >= MAX_PENDING_COMMANDS) {
      return reject(record, "queue-full", message.sequence);
    }

    const queued: QueuedCommand = Object.freeze({
      owner: record,
      message: copyCommand(message),
    });
    record.ingress.push(queued);
    record.pendingCommandCount += 1;
    return succeeded(undefined);
  }

  function createConnection(record: ConnectionRecord): AuthoritativeConnection {
    return Object.freeze({
      get phase(): AuthoritativeConnectionPhase {
        return record.phase;
      },
      markReady(): AuthoritativeOutcome {
        if (!record.live || record.phase !== "connected") {
          return failed("invalid-state");
        }
        transition(record, "ready");
        return succeeded(undefined);
      },
      receive(message: ClientMessage): AuthoritativeOutcome {
        return receive(record, message);
      },
      disconnect(): AuthoritativeOutcome {
        return disconnectRecord(record);
      },
      inspect(): AuthoritativeConnectionInspection {
        return inspectConnection(record);
      },
    });
  }

  function runIngress(): void {
    for (const record of records) {
      if (record.ingress.length === 0) continue;
      record.validating.push(...record.ingress);
      record.ingress = [];
    }
  }

  function hasLiveBinding(record: ConnectionRecord): boolean {
    if (
      record.connectionId === null ||
      record.playerId === null ||
      record.ownedEntityId === null ||
      record.runtimeEntityId === null ||
      connectionBindings.get(record.connectionId) !== record ||
      playerBindings.get(record.playerId) !== record
    ) {
      return false;
    }
    const entity = entities.get(record.ownedEntityId);
    if (
      entity === undefined ||
      entity.owner !== record ||
      entity.playerId !== record.playerId ||
      entity.runtimeEntityId !== record.runtimeEntityId
    ) {
      return false;
    }
    try {
      return (
        !collisionAdapter.disposed &&
        collisionAdapter
          .inspect()
          .avatars.some(({ avatarId }) => avatarId === record.ownedEntityId)
      );
    } catch {
      return false;
    }
  }

  function consumeValidationFixture(
    entityId: string,
    kind: AuthoritativeValidationFixture["kind"],
  ): AuthoritativeValidationFixture | undefined {
    const armed = validationFixtures.get(entityId);
    if (armed === undefined || armed.fixture.kind !== kind) return undefined;
    validationFixtures.delete(entityId);
    validationFixtureConsumedCount += 1;
    lastConsumedValidationFixture = Object.freeze({
      entityId,
      kind,
      metersPerSecond:
        armed.fixture.kind === "movement-speed"
          ? armed.fixture.metersPerSecond
          : null,
    });
    return armed.fixture;
  }

  function movementWithinLimit(
    message: CommandMessage,
    speedMetersPerSecond = movementSpeedMetersPerSecond,
  ): boolean {
    if (message.action.kind !== "move") return false;
    if (
      !Number.isFinite(speedMetersPerSecond) ||
      speedMetersPerSecond <= 0 ||
      speedMetersPerSecond > MAX_MOVEMENT_SPEED
    ) {
      return false;
    }
    const desiredHorizontalDistance =
      Math.hypot(message.action.x, message.action.z) *
      speedMetersPerSecond *
      DT_SECONDS;
    return (
      Number.isFinite(desiredHorizontalDistance) &&
      desiredHorizontalDistance <= MAX_MOVEMENT_SPEED * DT_SECONDS
    );
  }

  function validateCommand(command: QueuedCommand): void {
    const record = command.owner;
    const message = command.message;
    const release = (): void => {
      record.pendingCommandCount -= 1;
    };
    const rejectQueued = (reason: RejectedReason): void => {
      reject(record, reason, message.sequence);
      runtimeErrorSequence += 1;
      structuredRuntimeErrors.push(
        createRuntimeErrorRecord({
          sequence: runtimeErrorSequence,
          code: "command-rejected",
          category: "expected",
          runtime: "server",
          operation: "command-validation",
          message: "Decoded queued command was rejected during validation",
          tick,
          reasonCode: reason,
        }),
      );
      if (
        structuredRuntimeErrors.length > RUNTIME_ERROR_RING_CAPACITY
      ) {
        structuredRuntimeErrors.shift();
      }
      release();
    };

    if (!record.live) {
      rejectQueued("stale-connection");
      return;
    }
    if (record.phase !== "joined") {
      rejectQueued("phase-invalid");
      return;
    }
    const expectedSequence =
      record.acceptedSequence === null ? 1 : record.acceptedSequence + 1;
    if (
      expectedSequence > MAX_SEQUENCE ||
      message.sequence !== expectedSequence
    ) {
      rejectQueued("sequence-invalid");
      return;
    }
    const lowerTick = Math.max(0, tick - MAX_PAST_TICKS);
    const upperTick = Math.min(MAX_TICK, tick + MAX_FUTURE_TICKS);
    if (message.intendedTick < lowerTick || message.intendedTick > upperTick) {
      rejectQueued("tick-out-of-window");
      return;
    }
    const entityId = record.ownedEntityId;
    if (
      entityId !== null &&
      consumeValidationFixture(entityId, "ownership-violation") !== undefined
    ) {
      rejectQueued("ownership-violation");
      return;
    }
    if (!hasLiveBinding(record)) {
      rejectQueued("ownership-violation");
      return;
    }
    if (message.action.kind === "interact") {
      rejectQueued("phase-invalid");
      return;
    }
    const movementFixture =
      entityId === null
        ? undefined
        : consumeValidationFixture(entityId, "movement-speed");
    const movementIsWithinLimit = movementWithinLimit(
      message,
      movementFixture?.kind === "movement-speed"
        ? movementFixture.metersPerSecond
        : movementSpeedMetersPerSecond,
    );
    if (
      record.movementSlots.has(message.intendedTick) ||
      !movementIsWithinLimit
    ) {
      rejectQueued("movement-limit");
      return;
    }

    const scheduled: ScheduledCommand = Object.freeze({
      owner: record,
      ordinal: record.ordinal,
      message,
    });
    record.acceptedSequence = message.sequence;
    record.movementSlots.add(message.intendedTick);
    record.scheduled.push(scheduled);
  }

  function runValidation(): void {
    for (const record of records) {
      for (const intendedTick of record.movementSlots) {
        if (tick - intendedTick > MAX_PAST_TICKS) {
          record.movementSlots.delete(intendedTick);
        }
      }
      const commands = record.validating;
      record.validating = [];
      for (const command of commands) validateCommand(command);
    }
  }

  function compareScheduled(
    left: ScheduledCommand,
    right: ScheduledCommand,
  ): number {
    return (
      left.message.intendedTick - right.message.intendedTick ||
      left.ordinal - right.ordinal ||
      left.message.sequence - right.message.sequence
    );
  }

  function runCommandApply(): void {
    const due: ScheduledCommand[] = [];
    for (const record of records) {
      const future: ScheduledCommand[] = [];
      for (const command of record.scheduled) {
        if (command.message.intendedTick <= tick) due.push(command);
        else future.push(command);
      }
      record.scheduled = future;
    }
    due.sort(compareScheduled);
    movementWork = due.map((command) => ({ command }));
  }

  function runSharedMovement(): void {
    for (const work of movementWork) {
      const { action } = work.command.message;
      if (action.kind !== "move") continue;
      try {
        sharedMovementCallCount += 1;
        work.desiredTranslation = computeDesiredMovementTranslation(action, {
          speedMetersPerSecond: movementSpeedMetersPerSecond,
          dtSeconds: DT_SECONDS,
          downwardMetersPerTick: Math.min(
            0.001,
            movementSpeedMetersPerSecond * DT_SECONDS,
          ),
        });
      } catch {
        // Validation has already fenced malformed or impossible movement.
      }
    }
  }

  function completeSequence(record: ConnectionRecord, sequence: number): void {
    record.completedSequences.add(sequence);
    let candidate = (record.acknowledgedSequence ?? 0) + 1;
    while (record.completedSequences.has(candidate)) {
      record.completedSequences.delete(candidate);
      record.acknowledgedSequence = candidate;
      candidate += 1;
    }
  }

  function runAuthoritativeCollision(): void {
    for (const work of movementWork) {
      const record = work.command.owner;
      const sequence = work.command.message.sequence;
      const entity =
        record.ownedEntityId === null
          ? undefined
          : entities.get(record.ownedEntityId);
      if (
        record.live &&
        record.phase === "joined" &&
        entity !== undefined &&
        work.desiredTranslation !== undefined
      ) {
        try {
          authoritativeCollisionCallCount += 1;
          const moved = collisionAdapter.moveAvatar(
            entity.entityId,
            entity.position,
            work.desiredTranslation,
          );
          if (moved.ok && isBoundedFinitePosition(moved.value.position)) {
            entity.position = copyFinitePosition(
              moved.value.position,
              "Authoritative collision position",
            );
          }
        } catch {
          // The accepted command still completes without trusting bad output.
        }
      }
      record.pendingCommandCount = Math.max(
        0,
        record.pendingCommandCount - 1,
      );
      completeSequence(record, sequence);
    }
    movementWork = [];
  }

  function runGameplay(): void {
    const due: ScheduledForcedPosition[] = [];
    const future: ScheduledForcedPosition[] = [];
    for (const fixture of forcedPositionFixtures) {
      if (fixture.serverTick === tick) due.push(fixture);
      else future.push(fixture);
    }
    forcedPositionFixtures = future;

    for (const fixture of due) {
      forcedPositionConsumedCount += 1;
      lastConsumedForcedPosition = Object.freeze({
        entityId: fixture.entityId,
        serverTick: fixture.serverTick,
        position: copyFinitePosition(
          fixture.position,
          "Consumed forced position",
        ),
      });
      const entity = entities.get(fixture.entityId);
      if (entity === undefined) continue;
      try {
        const positioned = collisionAdapter.setAvatarPosition(
          fixture.entityId,
          fixture.position,
        );
        if (positioned.ok) {
          entity.position = copyFinitePosition(
            fixture.position,
            "Applied forced position",
          );
        }
      } catch {
        // A consumed fixture does not trust a failing injected adapter.
      }
    }
  }

  function snapshotEntities(): readonly AvatarSnapshotEntity[] {
    const snapshots: AvatarSnapshotEntity[] = [];
    for (const entity of entities.values()) {
      const position = copyFinitePosition(
        entity.position,
        "Snapshot avatar position",
      );
      snapshots.push(
        Object.freeze({
          entityKind: "avatar",
          entityId: entity.entityId,
          playerId: entity.playerId,
          position,
        }),
      );
    }
    return Object.freeze(snapshots);
  }

  function runSnapshotBuild(): void {
    if (tick % 3 !== 0) return;
    const snapshots = snapshotEntities();
    for (const record of records) {
      if (!record.live || record.phase !== "joined") continue;
      const message: SnapshotMessage = Object.freeze({
        protocolVersion: PROTOCOL_VERSION,
        kind: "snapshot",
        serverTick: tick,
        acknowledgedSequence: record.acknowledgedSequence,
        entities: snapshots,
      });
      safelyEmit(record, message);
    }
  }

  function runPhase(phase: AuthoritativeServerPhase): void {
    currentPhase = phase;
    phaseTrace.push(Object.freeze({ serverTick: tick, phase }));
    if (phaseTrace.length > MAX_PHASE_TRACE_ENTRIES) {
      phaseTrace.shift();
    }
    switch (phase) {
      case "ingress":
        runIngress();
        return;
      case "validate-bind":
        runValidation();
        return;
      case "command-apply":
        runCommandApply();
        return;
      case "shared-movement":
        runSharedMovement();
        return;
      case "authoritative-collision":
        runAuthoritativeCollision();
        return;
      case "telemetry":
        return;
      case "gameplay":
        runGameplay();
        return;
      case "snapshot-build":
        runSnapshotBuild();
    }
  }

  const server: AuthoritativeServer = Object.freeze({
    get serverTick(): number {
      return tick;
    },
    get shutdownStarted(): boolean {
      return shutdownStarted;
    },
    acceptConnection(
      connectionOptions: AuthoritativeConnectionOptions,
    ): AuthoritativeOutcome<AuthoritativeConnection> {
      if (shutdownStarted) return failed("server-shutdown");
      if (
        typeof connectionOptions !== "object" ||
        connectionOptions === null ||
        typeof connectionOptions.emit !== "function"
      ) {
        throw new TypeError("Authoritative connections require an emitter");
      }
      const record: ConnectionRecord = {
        ordinal: nextOrdinal,
        emit: connectionOptions.emit,
        phase: "connected",
        phaseTrace: ["connected"],
        live: true,
        connectionId: null,
        playerId: null,
        ownedEntityId: null,
        runtimeEntityId: null,
        acceptedSequence: null,
        acknowledgedSequence: null,
        completedSequences: new Set<number>(),
        ingress: [],
        validating: [],
        scheduled: [],
        movementSlots: new Set<number>(),
        pendingCommandCount: 0,
        rejectedCommandCounts: createMutableRejectionCounts(),
      };
      nextOrdinal += 1;
      records.push(record);
      return succeeded(createConnection(record));
    },
    scheduleForcedPosition(
      entityId: string,
      serverTick: number,
      position: MovementVector,
    ): AuthoritativeOutcome {
      if (shutdownStarted) return failed("server-shutdown");
      if (typeof entityId !== "string") {
        throw new TypeError("Forced position entity ID must be a string");
      }
      if (
        !Number.isSafeInteger(serverTick) ||
        serverTick < 0 ||
        serverTick > MAX_TICK
      ) {
        throw new RangeError(
          "Forced position tick must be a bounded safe integer",
        );
      }
      const detachedPosition = copyFinitePosition(
        position,
        "Forced position",
      );
      const entity = entities.get(entityId);
      if (
        serverTick <= tick ||
        entity === undefined ||
        !entity.owner.live ||
        entity.owner.phase !== "joined" ||
        !hasLiveBinding(entity.owner) ||
        forcedPositionFixtures.some(
          (fixture) =>
            fixture.entityId === entityId &&
            fixture.serverTick === serverTick,
        )
      ) {
        return failed("invalid-state");
      }
      forcedPositionFixtures.push(
        Object.freeze({ entityId, serverTick, position: detachedPosition }),
      );
      forcedPositionScheduledCount += 1;
      return succeeded(undefined);
    },
    armNextValidationFixture(
      entityId: string,
      fixture: AuthoritativeValidationFixture,
    ): AuthoritativeOutcome {
      if (shutdownStarted) return failed("server-shutdown");
      if (typeof entityId !== "string") {
        throw new TypeError("Validation fixture entity ID must be a string");
      }
      const detachedFixture = copyValidationFixture(fixture);
      const entity = entities.get(entityId);
      if (
        entity === undefined ||
        !entity.owner.live ||
        entity.owner.phase !== "joined" ||
        entity.owner.ownedEntityId !== entityId ||
        !hasLiveBinding(entity.owner) ||
        validationFixtures.has(entityId)
      ) {
        return failed("invalid-state");
      }
      validationFixtures.set(
        entityId,
        Object.freeze({ entityId, fixture: detachedFixture }),
      );
      validationFixtureArmedCount += 1;
      return succeeded(undefined);
    },
    recordDecodeIngressRejection(
      reason: AuthoritativeDecodeIngressRejectionReason,
    ): RuntimeErrorRecord {
      rejectedCommandCounts[reason] += 1;
      runtimeErrorSequence += 1;
      const record = createRuntimeErrorRecord({
        sequence: runtimeErrorSequence,
        code: "decode-ingress-rejected",
        category: "expected",
        runtime: "server",
        operation: "decode-ingress",
        message: "Client message was rejected during decode ingress",
        tick,
        reasonCode: reason,
      });
      structuredRuntimeErrors.push(record);
      if (
        structuredRuntimeErrors.length > RUNTIME_ERROR_RING_CAPACITY
      ) {
        structuredRuntimeErrors.shift();
      }
      return record;
    },
    stepExact(count = 1): AuthoritativeOutcome<number> {
      if (shutdownStarted) return failed("server-shutdown");
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new RangeError("Exact step count must be a non-negative integer");
      }
      if (count > MAX_TICK - tick) return failed("tick-exhausted");
      for (let index = 0; index < count; index += 1) {
        tick += 1;
        runPhase("ingress");
        runPhase("validate-bind");
        runPhase("command-apply");
        runPhase("shared-movement");
        runPhase("authoritative-collision");
        runPhase("gameplay");
        runPhase("snapshot-build");
        runPhase("telemetry");
        currentPhase = null;
      }
      return succeeded(tick);
    },
    inspect(): AuthoritativeServerInspection {
      const inspectedConnections = records.map(inspectConnection);
      const inspectedAvatars = Array.from(entities.values(), (entity) =>
        Object.freeze({
          entityId: entity.entityId,
          playerId: entity.playerId,
          position: copyFinitePosition(
            entity.position,
            "Inspected authoritative position",
          ),
        }),
      );
      const inspectedTrace = phaseTrace.map(({ serverTick, phase }) =>
        Object.freeze({ serverTick, phase }),
      );
      let capsuleCount = 0;
      try {
        capsuleCount = collisionAdapter.inspect().avatarCount;
      } catch {
        capsuleCount = 0;
      }
      const pendingCommands = records.reduce(
        (total, record) => total + record.pendingCommandCount,
        0,
      );
      const scheduledCommands = records.reduce(
        (total, record) => total + record.scheduled.length,
        0,
      );
      const bindings = records.reduce(
        (total, record) => total + (record.connectionId === null ? 0 : 1),
        0,
      );
      const liveConnections = records.reduce(
        (total, record) => total + (record.live ? 1 : 0),
        0,
      );
      return Object.freeze({
        serverTick: tick,
        currentPhase,
        shutdown: shutdownStarted,
        connections: Object.freeze(inspectedConnections),
        avatars: Object.freeze(inspectedAvatars),
        phaseTrace: Object.freeze(inspectedTrace),
        rejectedCommandCounts: freezeRejectionCounts(rejectedCommandCounts),
        structuredRuntimeErrors: Object.freeze([
          ...structuredRuntimeErrors,
        ]),
        sharedMovementCallCount,
        authoritativeCollisionCallCount,
        liveResourceCounts: Object.freeze({
          connections: liveConnections,
          bindings,
          avatars: inspectedAvatars.length,
          capsules: capsuleCount,
          pendingCommands,
          scheduledCommands,
        }),
        forcedPositionFixtures: Object.freeze({
          pendingCount: forcedPositionFixtures.length,
          scheduledCount: forcedPositionScheduledCount,
          consumedCount: forcedPositionConsumedCount,
          lastConsumed:
            lastConsumedForcedPosition === null
              ? null
              : Object.freeze({
                  entityId: lastConsumedForcedPosition.entityId,
                  serverTick: lastConsumedForcedPosition.serverTick,
                  position: copyFinitePosition(
                    lastConsumedForcedPosition.position,
                    "Inspected consumed forced position",
                  ),
                }),
        }),
        validationFixtures: Object.freeze({
          pendingCount: validationFixtures.size,
          armedCount: validationFixtureArmedCount,
          consumedCount: validationFixtureConsumedCount,
          lastConsumed:
            lastConsumedValidationFixture === null
              ? null
              : Object.freeze({
                  entityId: lastConsumedValidationFixture.entityId,
                  kind: lastConsumedValidationFixture.kind,
                  metersPerSecond:
                    lastConsumedValidationFixture.metersPerSecond,
                }),
        }),
      });
    },
    shutdown(): AuthoritativeOutcome {
      if (cachedShutdownOutcome !== undefined) return cachedShutdownOutcome;
      shutdownStarted = true;
      currentPhase = null;
      for (const record of records) disconnectRecord(record);
      forcedPositionFixtures = [];
      validationFixtures.clear();
      lastConsumedForcedPosition = null;
      movementWork = [];
      connectionBindings.clear();
      playerBindings.clear();
      entities.clear();
      issuedIds.clear();
      records.splice(0);
      try {
        collisionAdapter.dispose();
      } catch {
        // All kit-owned references are still released terminally.
      }
      cachedShutdownOutcome = succeeded(undefined);
      return cachedShutdownOutcome;
    },
  });

  return server;
}

export function createAuthoritativeServer(
  options: AuthoritativeServerOptions,
): AuthoritativeServer {
  return createEngine(options);
}
