import {
  MAX_BUFFERED_SNAPSHOTS,
  MAX_ID_LENGTH,
  MAX_MOVEMENT_SPEED,
  MAX_PENDING_COMMANDS,
  MAX_SEQUENCE,
  MAX_TICK,
  PROTOCOL_VERSION,
  type ClientMessage,
  type CommandMessage,
  type ServerMessage,
  type SnapshotEntity,
  type SnapshotMessage,
} from "@three-game-kit/protocol";
import {
  computeDesiredMovementTranslation,
  createMovementCommand,
  type MovementVector,
} from "@three-game-kit/shared";
import type { ClientCollisionAdapter } from "./collision.js";

const TICKS_PER_SECOND = 60;
const DT_SECONDS = 1 / TICKS_PER_SECOND;
const CORRECTION_DURATION_MS = 500;
const REMOTE_DELAY_TICKS = 6;
const MAX_PHASE_TRACE_ENTRIES = 4_096;

export type ClientReplicationState =
  | "ready"
  | "joining"
  | "joined"
  | "disconnecting"
  | "closed";

export type ClientReplicationPhase =
  | "snapshot-ingest"
  | "reconcile"
  | "action-sample"
  | "command-send"
  | "shared-predict"
  | "predictive-collision"
  | "presentation-publish"
  | "telemetry";

export type ClientPresentationPhase =
  | "remote-interpolation"
  | "camera-view"
  | "render"
  | "frame-telemetry";

export type ClientReplicationFailureCode =
  | "phase-invalid"
  | "tick-exhausted"
  | "sequence-exhausted"
  | "pending-history-full"
  | "emit-failed"
  | "collision-failed"
  | "clock-invalid"
  | "frame-time-invalid";

export interface ClientReplicationFailure {
  readonly code: ClientReplicationFailureCode;
}

export type ClientReplicationOutcome<Value = undefined> =
  | Readonly<{ readonly ok: true; readonly value: Value }>
  | Readonly<{
      readonly ok: false;
      readonly failure: ClientReplicationFailure;
    }>;

export interface ClientMoveIntent {
  readonly kind: "move";
  readonly x: number;
  readonly z: number;
}

export interface ClientInteractIntent {
  readonly kind: "interact";
  readonly targetEntityId: string;
}

export type ClientActionIntent = ClientMoveIntent | ClientInteractIntent;

export interface ClientReplicationOptions {
  readonly movementSpeedMetersPerSecond: number;
  readonly initialPosition: MovementVector;
  readonly collisionAdapter: ClientCollisionAdapter;
  readonly emit: (message: ClientMessage) => void;
  readonly observationClock?: () => number;
}

export interface ClientReplicationPhaseInspection {
  readonly clientTick: number;
  readonly phase: ClientReplicationPhase;
}

export interface ClientPresentationPhaseInspection {
  readonly frame: number;
  readonly phase: ClientPresentationPhase;
}

export type ClientRemoteInterpolationMode =
  | "oldest-hold"
  | "interpolated"
  | "sample-hold"
  | "newest-hold";

export interface ClientRemotePresentationInspection {
  readonly entityId: string;
  readonly playerId: string;
  readonly position: MovementVector;
  readonly provenance: "snapshot";
  readonly mode: ClientRemoteInterpolationMode;
  readonly sourceServerTicks: readonly number[];
}

export interface ClientInteractablePresentationInspection {
  readonly entityId: string;
  readonly position: MovementVector;
  readonly active: boolean;
  readonly provenance: "snapshot";
  readonly sourceServerTick: number;
}

export interface ClientPresentationState {
  readonly frame: number;
  readonly nowMs: number;
  readonly localPosition: MovementVector;
  readonly remoteAvatars: readonly ClientRemotePresentationInspection[];
  readonly interactables: readonly ClientInteractablePresentationInspection[];
  readonly phaseTrace: readonly ClientPresentationPhase[];
}

export interface ClientReplicationCounters {
  readonly receivedSnapshotCount: number;
  readonly admittedSnapshotCount: number;
  readonly discardedSnapshotCount: number;
  readonly inboxEvictionCount: number;
  readonly bufferEvictionCount: number;
  readonly rejectedCount: number;
  readonly reconcileCount: number;
  readonly sendCount: number;
  readonly predictCount: number;
  readonly replayPredictCount: number;
  readonly collisionCount: number;
  readonly interpolationCount: number;
  readonly interpolatedAvatarCount: number;
  readonly frameCount: number;
}

export interface ClientReplicationLiveResourceCounts {
  readonly bindings: number;
  readonly queuedActions: number;
  readonly decodedSnapshots: number;
  readonly bufferedSnapshots: number;
  readonly predictionHistory: number;
  readonly remoteAvatars: number;
  readonly interactables: number;
  readonly collisionAdapters: number;
  readonly retainedReferences: number;
}

export interface ClientReplicationInspection {
  readonly state: ClientReplicationState;
  readonly stateTrace: readonly ClientReplicationState[];
  readonly clientTick: number;
  readonly currentPhase: ClientReplicationPhase | null;
  readonly currentFramePhase: ClientPresentationPhase | null;
  readonly connectionId: string | null;
  readonly playerId: string | null;
  readonly ownedEntityId: string | null;
  readonly simulationPosition: MovementVector | null;
  readonly localPresentationPosition: MovementVector | null;
  readonly remoteAvatars: readonly ClientRemotePresentationInspection[];
  readonly interactables: readonly ClientInteractablePresentationInspection[];
  readonly estimatedServerTick: number | null;
  readonly interpolationTargetTick: number | null;
  readonly snapshotBufferTicks: readonly number[];
  readonly snapshotBufferCount: number;
  readonly decodedInboxTicks: readonly number[];
  readonly decodedInboxCount: number;
  readonly historySequences: readonly number[];
  readonly nextSequence: number;
  readonly acknowledgedSequence: number | null;
  readonly simulationPhaseTrace: readonly ClientReplicationPhaseInspection[];
  readonly presentationPhaseTrace: readonly ClientPresentationPhaseInspection[];
  readonly counters: ClientReplicationCounters;
  readonly liveResourceCounts: ClientReplicationLiveResourceCounts;
}

export interface ClientReplicationEngine {
  readonly state: ClientReplicationState;
  readonly clientTick: number;
  beginJoin(): ClientReplicationOutcome;
  receive(message: ServerMessage): ClientReplicationOutcome;
  queueMove(intent: ClientMoveIntent): ClientReplicationOutcome;
  queueMove(x: number, z: number): ClientReplicationOutcome;
  queueInteract(intent: ClientInteractIntent): ClientReplicationOutcome;
  queueInteract(
    targetEntityId: string,
  ): ClientReplicationOutcome;
  stepExact(count?: number): ClientReplicationOutcome<number>;
  frame(nowMs: number): ClientReplicationOutcome<ClientPresentationState>;
  disconnect(): ClientReplicationOutcome;
  shutdown(): ClientReplicationOutcome;
  inspect(): ClientReplicationInspection;
}

interface ObservedSnapshot {
  readonly message: SnapshotMessage;
  readonly observedAtMs: number | null;
}

interface PredictionAttempt {
  readonly sequence: number;
  readonly intendedTick: number;
  readonly action: ClientActionIntent;
}

interface MutableCounters {
  receivedSnapshotCount: number;
  admittedSnapshotCount: number;
  discardedSnapshotCount: number;
  inboxEvictionCount: number;
  bufferEvictionCount: number;
  rejectedCount: number;
  reconcileCount: number;
  sendCount: number;
  predictCount: number;
  replayPredictCount: number;
  collisionCount: number;
  interpolationCount: number;
  interpolatedAvatarCount: number;
  frameCount: number;
}

function succeeded<Value>(value: Value): ClientReplicationOutcome<Value> {
  return Object.freeze({ ok: true, value });
}

function failed(
  code: ClientReplicationFailureCode,
): ClientReplicationOutcome<never> {
  return Object.freeze({
    ok: false,
    failure: Object.freeze({ code }),
  });
}

function copyFiniteVector(value: MovementVector, label: string): MovementVector {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const { x, y, z } = value;
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    typeof y !== "number" ||
    !Number.isFinite(y) ||
    typeof z !== "number" ||
    !Number.isFinite(z)
  ) {
    throw new RangeError(`${label} must contain finite coordinates`);
  }
  return Object.freeze({ x, y, z });
}

function addVectors(left: MovementVector, right: MovementVector): MovementVector {
  return copyFiniteVector(
    { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z },
    "Presented position",
  );
}

function subtractVectors(
  left: MovementVector,
  right: MovementVector,
): MovementVector {
  return copyFiniteVector(
    { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z },
    "Presentation correction",
  );
}

function scaleVector(vector: MovementVector, scale: number): MovementVector {
  return copyFiniteVector(
    { x: vector.x * scale, y: vector.y * scale, z: vector.z * scale },
    "Presentation correction",
  );
}

function zeroVector(): MovementVector {
  return Object.freeze({ x: 0, y: 0, z: 0 });
}

function copySnapshot(message: SnapshotMessage): SnapshotMessage {
  const entities = Object.freeze(
    message.entities.map((entity): SnapshotEntity => {
      const position = copyFiniteVector(entity.position, "Snapshot position");
      if (entity.entityKind === "avatar") {
        return Object.freeze({
          entityKind: "avatar",
          entityId: entity.entityId,
          playerId: entity.playerId,
          position,
        });
      }
      return Object.freeze({
        entityKind: "interactable",
        entityId: entity.entityId,
        position,
        active: entity.active,
      });
    }),
  );
  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    kind: "snapshot",
    serverTick: message.serverTick,
    acknowledgedSequence: message.acknowledgedSequence,
    entities,
  });
}

function createEngine(options: ClientReplicationOptions): ClientReplicationEngine {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Client replication options must be an object");
  }
  const speed = options.movementSpeedMetersPerSecond;
  if (!Number.isFinite(speed) || speed <= 0 || speed > MAX_MOVEMENT_SPEED) {
    throw new RangeError(
      `Movement speed must be positive and at most ${MAX_MOVEMENT_SPEED}`,
    );
  }
  if (typeof options.emit !== "function") {
    throw new TypeError("Client replication requires an emitter");
  }
  if (
    typeof options.collisionAdapter !== "object" ||
    options.collisionAdapter === null ||
    typeof options.collisionAdapter.move !== "function" ||
    typeof options.collisionAdapter.dispose !== "function"
  ) {
    throw new TypeError("Client replication requires a collision adapter");
  }
  if (
    options.observationClock !== undefined &&
    typeof options.observationClock !== "function"
  ) {
    throw new TypeError("The observation clock must be a function");
  }

  let emit: ((message: ClientMessage) => void) | null = options.emit;
  let observationClock: (() => number) | null = options.observationClock ?? null;
  let collisionAdapter: ClientCollisionAdapter | null = options.collisionAdapter;
  let state: ClientReplicationState = "ready";
  const stateTrace: ClientReplicationState[] = ["ready"];
  let live = true;
  let clientTick = 0;
  let currentPhase: ClientReplicationPhase | null = null;
  let currentFramePhase: ClientPresentationPhase | null = null;
  let connectionId: string | null = null;
  let playerId: string | null = null;
  let ownedEntityId: string | null = null;
  let simulationPosition: MovementVector | null = copyFiniteVector(
    options.initialPosition,
    "Initial position",
  );
  let localPresentationPosition: MovementVector | null = simulationPosition;
  let correctionBase = zeroVector();
  let correctionOffset = zeroVector();
  let correctionStartedAtMs: number | null = null;
  let queuedMove: ClientActionIntent | null = null;
  const decodedInbox: ObservedSnapshot[] = [];
  const snapshotBuffer: ObservedSnapshot[] = [];
  const predictionHistory: PredictionAttempt[] = [];
  let nextSequence = 1;
  let acknowledgedSequence: number | null = null;
  const remoteAvatars = new Map<string, ClientRemotePresentationInspection>();
  const interactables = new Map<
    string,
    ClientInteractablePresentationInspection
  >();
  let estimatedServerTick: number | null = null;
  let interpolationTargetTick: number | null = null;
  let lastObservationMs: number | null = null;
  let lastFrameMs: number | null = null;
  let frameNumber = 0;
  const simulationPhaseTrace: ClientReplicationPhaseInspection[] = [];
  const presentationPhaseTrace: ClientPresentationPhaseInspection[] = [];
  const counters: MutableCounters = {
    receivedSnapshotCount: 0,
    admittedSnapshotCount: 0,
    discardedSnapshotCount: 0,
    inboxEvictionCount: 0,
    bufferEvictionCount: 0,
    rejectedCount: 0,
    reconcileCount: 0,
    sendCount: 0,
    predictCount: 0,
    replayPredictCount: 0,
    collisionCount: 0,
    interpolationCount: 0,
    interpolatedAvatarCount: 0,
    frameCount: 0,
  };
  let cachedCloseOutcome: ClientReplicationOutcome | undefined;

  function transition(next: ClientReplicationState): void {
    if (state === next) return;
    state = next;
    stateTrace.push(next);
  }

  function observeNow(): ClientReplicationOutcome<number | null> {
    const clock = observationClock;
    if (clock === null) return succeeded(null);
    let value: number;
    try {
      value = clock();
    } catch {
      return failed("clock-invalid");
    }
    if (
      !Number.isFinite(value) ||
      (lastObservationMs !== null && value < lastObservationMs)
    ) {
      return failed("clock-invalid");
    }
    lastObservationMs = value;
    return succeeded(value);
  }

  function recordSimulationPhase(phase: ClientReplicationPhase): void {
    currentPhase = phase;
    simulationPhaseTrace.push(Object.freeze({ clientTick, phase }));
    if (simulationPhaseTrace.length > MAX_PHASE_TRACE_ENTRIES) {
      simulationPhaseTrace.shift();
    }
  }

  function recordPresentationPhase(phase: ClientPresentationPhase): void {
    currentFramePhase = phase;
    presentationPhaseTrace.push(Object.freeze({ frame: frameNumber, phase }));
    if (presentationPhaseTrace.length > MAX_PHASE_TRACE_ENTRIES) {
      presentationPhaseTrace.shift();
    }
  }

  function removeRejectedAndLater(sequence: number): void {
    for (let index = predictionHistory.length - 1; index >= 0; index -= 1) {
      const attempt = predictionHistory[index];
      if (attempt !== undefined && attempt.sequence >= sequence) {
        predictionHistory.splice(index, 1);
      }
    }
    const newestRemaining =
      predictionHistory[predictionHistory.length - 1];
    nextSequence =
      (newestRemaining?.sequence ?? acknowledgedSequence ?? 0) + 1;
  }

  function queueDecodedSnapshot(snapshot: ObservedSnapshot): void {
    if (
      decodedInbox.some(
        (pending) =>
          pending.message.serverTick === snapshot.message.serverTick,
      )
    ) {
      counters.discardedSnapshotCount += 1;
      return;
    }
    decodedInbox.push(snapshot);
    if (decodedInbox.length <= MAX_BUFFERED_SNAPSHOTS) return;

    let oldestIndex = 0;
    for (let index = 1; index < decodedInbox.length; index += 1) {
      const candidate = decodedInbox[index];
      const oldest = decodedInbox[oldestIndex];
      if (
        candidate !== undefined &&
        oldest !== undefined &&
        candidate.message.serverTick < oldest.message.serverTick
      ) {
        oldestIndex = index;
      }
    }
    decodedInbox.splice(oldestIndex, 1);
    counters.inboxEvictionCount += 1;
  }

  function desiredFor(
    action: ClientMoveIntent,
    replay: boolean,
  ): ClientReplicationOutcome<MovementVector> {
    try {
      const desired = computeDesiredMovementTranslation(action, {
        speedMetersPerSecond: speed,
        dtSeconds: DT_SECONDS,
        downwardMetersPerTick: Math.min(0.001, speed * DT_SECONDS),
      });
      counters.predictCount += 1;
      if (replay) counters.replayPredictCount += 1;
      return succeeded(desired);
    } catch {
      return failed("collision-failed");
    }
  }

  function collide(
    start: MovementVector,
    desired: MovementVector,
  ): ClientReplicationOutcome<MovementVector> {
    const adapter = collisionAdapter;
    if (adapter === null) return failed("collision-failed");
    counters.collisionCount += 1;
    try {
      const moved = adapter.move(start, desired);
      if (!moved.ok) return failed("collision-failed");
      return succeeded(copyFiniteVector(moved.value.position, "Predicted position"));
    } catch {
      return failed("collision-failed");
    }
  }

  function replayMove(
    start: MovementVector,
    action: ClientMoveIntent,
  ): ClientReplicationOutcome<MovementVector> {
    const desired = desiredFor(action, true);
    if (!desired.ok) return desired;
    return collide(start, desired.value);
  }

  function rebuildSimulation(
    authoritativePosition: MovementVector,
    observedAtMs: number | null,
  ): ClientReplicationOutcome {
    const previousDisplay = localPresentationPosition;
    let replayed = copyFiniteVector(
      authoritativePosition,
      "Authoritative position",
    );
    for (const attempt of predictionHistory) {
      if (attempt.action.kind !== "move") continue;
      const result = replayMove(replayed, attempt.action);
      if (!result.ok) return result;
      replayed = result.value;
    }
    simulationPosition = replayed;
    if (previousDisplay !== null) {
      correctionBase = subtractVectors(previousDisplay, replayed);
      correctionOffset = correctionBase;
      correctionStartedAtMs = observedAtMs;
      localPresentationPosition = addVectors(replayed, correctionOffset);
    }
    return succeeded(undefined);
  }

  function newestBufferedOwnedPosition(): MovementVector | null {
    const binding = ownedEntityId;
    if (binding === null) return null;
    for (let index = snapshotBuffer.length - 1; index >= 0; index -= 1) {
      const observed = snapshotBuffer[index];
      const owned = observed?.message.entities.find(
        (entity) =>
          entity.entityKind === "avatar" && entity.entityId === binding,
      );
      if (owned !== undefined && owned.entityKind === "avatar") {
        return copyFiniteVector(owned.position, "Authoritative position");
      }
    }
    return null;
  }

  function ingestSnapshots(): readonly ObservedSnapshot[] {
    const pending = decodedInbox
      .splice(0, decodedInbox.length)
      .sort(
        (left, right) =>
          left.message.serverTick - right.message.serverTick,
      );
    const admitted: ObservedSnapshot[] = [];
    for (const snapshot of pending) {
      const newest = snapshotBuffer[snapshotBuffer.length - 1];
      if (
        newest !== undefined &&
        snapshot.message.serverTick <= newest.message.serverTick
      ) {
        counters.discardedSnapshotCount += 1;
        continue;
      }
      snapshotBuffer.push(snapshot);
      counters.admittedSnapshotCount += 1;
      admitted.push(snapshot);
      if (snapshotBuffer.length > MAX_BUFFERED_SNAPSHOTS) {
        snapshotBuffer.shift();
        counters.bufferEvictionCount += 1;
      }
    }
    return Object.freeze(admitted);
  }

  function reconcileSnapshot(
    observed: ObservedSnapshot,
  ): ClientReplicationOutcome {
    counters.reconcileCount += 1;
    const binding = ownedEntityId;
    if (binding === null) return succeeded(undefined);
    const owned = observed.message.entities.find(
      (entity) => entity.entityKind === "avatar" && entity.entityId === binding,
    );
    if (owned === undefined || owned.entityKind !== "avatar") {
      return succeeded(undefined);
    }

    const acknowledged = observed.message.acknowledgedSequence;
    if (
      acknowledged !== null &&
      (acknowledgedSequence === null || acknowledged > acknowledgedSequence)
    ) {
      acknowledgedSequence = acknowledged;
      nextSequence = Math.max(nextSequence, acknowledged + 1);
    }
    if (acknowledged !== null) {
      for (let index = predictionHistory.length - 1; index >= 0; index -= 1) {
        const attempt = predictionHistory[index];
        if (attempt !== undefined && attempt.sequence <= acknowledged) {
          predictionHistory.splice(index, 1);
        }
      }
    }

    return rebuildSimulation(owned.position, observed.observedAtMs);
  }

  function publishPresentation(): void {
    if (simulationPosition !== null) {
      localPresentationPosition = addVectors(
        simulationPosition,
        correctionOffset,
      );
    }
  }

  function freezeRemote(
    remote: ClientRemotePresentationInspection,
  ): ClientRemotePresentationInspection {
    return Object.freeze({
      entityId: remote.entityId,
      playerId: remote.playerId,
      position: copyFiniteVector(remote.position, "Remote presented position"),
      provenance: "snapshot",
      mode: remote.mode,
      sourceServerTicks: Object.freeze(Array.from(remote.sourceServerTicks)),
    });
  }

  function freezeInteractable(
    interactable: ClientInteractablePresentationInspection,
  ): ClientInteractablePresentationInspection {
    return Object.freeze({
      entityId: interactable.entityId,
      position: copyFiniteVector(
        interactable.position,
        "Interactable presented position",
      ),
      active: interactable.active,
      provenance: "snapshot",
      sourceServerTick: interactable.sourceServerTick,
    });
  }

  function sortedInteractables(): readonly ClientInteractablePresentationInspection[] {
    return Object.freeze(
      Array.from(interactables.values(), freezeInteractable).sort(
        (left, right) =>
          left.entityId < right.entityId
            ? -1
            : left.entityId > right.entityId
              ? 1
              : 0,
      ),
    );
  }

  function presentNewestInteractables(): void {
    interactables.clear();
    const newest = snapshotBuffer[snapshotBuffer.length - 1];
    if (newest === undefined) return;
    for (const entity of newest.message.entities) {
      if (entity.entityKind !== "interactable") continue;
      interactables.set(
        entity.entityId,
        freezeInteractable({
          entityId: entity.entityId,
          position: entity.position,
          active: entity.active,
          provenance: "snapshot",
          sourceServerTick: newest.message.serverTick,
        }),
      );
    }
  }

  function interpolateRemoteAvatars(nowMs: number): void {
    counters.interpolationCount += 1;
    remoteAvatars.clear();
    const newest = snapshotBuffer[snapshotBuffer.length - 1];
    if (newest === undefined) {
      interpolationTargetTick = null;
      return;
    }

    let estimate = newest.message.serverTick;
    if (newest.observedAtMs !== null) {
      estimate +=
        Math.max(0, nowMs - newest.observedAtMs) *
        (TICKS_PER_SECOND / 1_000);
    }
    estimate = Math.min(MAX_TICK, estimate);
    estimatedServerTick = Math.max(estimatedServerTick ?? 0, estimate);
    const target = estimatedServerTick - REMOTE_DELAY_TICKS;
    interpolationTargetTick = target;

    const latestRemoteIds = newest.message.entities
      .filter(
        (entity) =>
          entity.entityKind === "avatar" && entity.entityId !== ownedEntityId,
      )
      .map((entity) => entity.entityId);

    for (const entityId of latestRemoteIds) {
      const samples = snapshotBuffer.flatMap((observed) => {
        const entity = observed.message.entities.find(
          (candidate) =>
            candidate.entityKind === "avatar" &&
            candidate.entityId === entityId,
        );
        return entity === undefined || entity.entityKind !== "avatar"
          ? []
          : [{ tick: observed.message.serverTick, entity }];
      });
      const first = samples[0];
      const last = samples[samples.length - 1];
      if (first === undefined || last === undefined) continue;

      let position: MovementVector;
      let mode: ClientRemoteInterpolationMode;
      let sourceTicks: readonly number[];
      let presentedPlayerId = last.entity.playerId;
      if (target <= first.tick) {
        position = first.entity.position;
        mode = "oldest-hold";
        sourceTicks = [first.tick];
        presentedPlayerId = first.entity.playerId;
      } else if (target >= last.tick) {
        position = last.entity.position;
        mode = target === last.tick ? "sample-hold" : "newest-hold";
        sourceTicks = [last.tick];
      } else {
        const rightIndex = samples.findIndex((sample) => sample.tick >= target);
        const right = samples[rightIndex];
        const left = samples[rightIndex - 1];
        if (right === undefined || left === undefined) continue;
        if (right.tick === target) {
          position = right.entity.position;
          mode = "sample-hold";
          sourceTicks = [right.tick];
          presentedPlayerId = right.entity.playerId;
        } else {
          const alpha = (target - left.tick) / (right.tick - left.tick);
          position = copyFiniteVector(
            {
              x:
                left.entity.position.x +
                (right.entity.position.x - left.entity.position.x) * alpha,
              y:
                left.entity.position.y +
                (right.entity.position.y - left.entity.position.y) * alpha,
              z:
                left.entity.position.z +
                (right.entity.position.z - left.entity.position.z) * alpha,
            },
            "Interpolated remote position",
          );
          mode = "interpolated";
          sourceTicks = [left.tick, right.tick];
          presentedPlayerId = right.entity.playerId;
          counters.interpolatedAvatarCount += 1;
        }
      }
      remoteAvatars.set(
        entityId,
        freezeRemote({
          entityId,
          playerId: presentedPlayerId,
          position,
          provenance: "snapshot",
          mode,
          sourceServerTicks: sourceTicks,
        }),
      );
    }
  }

  function teardown(): ClientReplicationOutcome {
    if (cachedCloseOutcome !== undefined) return cachedCloseOutcome;
    live = false;
    transition("disconnecting");
    emit = null;
    observationClock = null;
    queuedMove = null;
    decodedInbox.splice(0);
    snapshotBuffer.splice(0);
    predictionHistory.splice(0);
    remoteAvatars.clear();
    interactables.clear();
    connectionId = null;
    playerId = null;
    ownedEntityId = null;
    acknowledgedSequence = null;
    nextSequence = 1;
    simulationPosition = null;
    localPresentationPosition = null;
    correctionBase = zeroVector();
    correctionOffset = zeroVector();
    correctionStartedAtMs = null;
    estimatedServerTick = null;
    interpolationTargetTick = null;
    currentPhase = null;
    currentFramePhase = null;
    const adapter = collisionAdapter;
    collisionAdapter = null;
    if (adapter !== null) {
      try {
        adapter.dispose();
      } catch {
        // Terminal cleanup still releases all kit-owned references.
      }
    }
    transition("closed");
    cachedCloseOutcome = succeeded(undefined);
    return cachedCloseOutcome;
  }

  function queueMove(intent: ClientMoveIntent): ClientReplicationOutcome;
  function queueMove(x: number, z: number): ClientReplicationOutcome;
  function queueMove(
    intentOrX: ClientMoveIntent | number,
    z?: number,
  ): ClientReplicationOutcome {
    if (!live || state !== "joined") return failed("phase-invalid");
    if (queuedMove !== null) return failed("pending-history-full");
    if (predictionHistory.length >= MAX_PENDING_COMMANDS) {
      return failed("pending-history-full");
    }
    if (nextSequence > MAX_SEQUENCE) return failed("sequence-exhausted");
    const command =
      typeof intentOrX === "number"
        ? createMovementCommand(intentOrX, z as number)
        : createMovementCommand(intentOrX.x, intentOrX.z);
    queuedMove = Object.freeze({
      kind: "move",
      x: command.x,
      z: command.z,
    });
    return succeeded(undefined);
  }

  function queueInteract(
    intent: ClientInteractIntent,
  ): ClientReplicationOutcome;
  function queueInteract(targetEntityId: string): ClientReplicationOutcome;
  function queueInteract(
    intentOrTargetEntityId: ClientInteractIntent | string,
  ): ClientReplicationOutcome {
    if (!live || state !== "joined") return failed("phase-invalid");
    if (queuedMove !== null) return failed("pending-history-full");
    if (predictionHistory.length >= MAX_PENDING_COMMANDS) {
      return failed("pending-history-full");
    }
    if (nextSequence > MAX_SEQUENCE) return failed("sequence-exhausted");
    const targetEntityId =
      typeof intentOrTargetEntityId === "string"
        ? intentOrTargetEntityId
        : intentOrTargetEntityId.targetEntityId;
    if (
      typeof targetEntityId !== "string" ||
      targetEntityId.length > MAX_ID_LENGTH ||
      !/^[A-Za-z0-9_-]+$/.test(targetEntityId)
    ) {
      throw new RangeError("Interaction target entity ID is invalid");
    }
    queuedMove = Object.freeze({ kind: "interact", targetEntityId });
    return succeeded(undefined);
  }

  const engine: ClientReplicationEngine = Object.freeze({
    get state(): ClientReplicationState {
      return state;
    },
    get clientTick(): number {
      return clientTick;
    },
    beginJoin(): ClientReplicationOutcome {
      if (!live || state !== "ready") return failed("phase-invalid");
      const sender = emit;
      if (sender === null) return failed("phase-invalid");
      transition("joining");
      const message = Object.freeze({
        protocolVersion: PROTOCOL_VERSION,
        kind: "join" as const,
      });
      try {
        sender(message);
      } catch {
        return failed("emit-failed");
      }
      return succeeded(undefined);
    },
    receive(message: ServerMessage): ClientReplicationOutcome {
      if (!live || state === "disconnecting" || state === "closed") {
        return failed("phase-invalid");
      }
      const observed = observeNow();
      if (!observed.ok) return observed;
      switch (message.kind) {
        case "joined":
          if (state !== "joining") return failed("phase-invalid");
          connectionId = message.connectionId;
          playerId = message.playerId;
          ownedEntityId = message.ownedEntityId;
          clientTick = message.serverTick;
          estimatedServerTick = message.serverTick;
          nextSequence = 1;
          acknowledgedSequence = null;
          transition("joined");
          return succeeded(undefined);
        case "rejected":
          if (state !== "joined") return failed("phase-invalid");
          counters.rejectedCount += 1;
          if (message.sequence !== null) {
            removeRejectedAndLater(message.sequence);
            const authoritativePosition = newestBufferedOwnedPosition();
            if (authoritativePosition !== null) {
              const rebuilt = rebuildSimulation(
                authoritativePosition,
                observed.value,
              );
              if (!rebuilt.ok) return rebuilt;
            }
          }
          return succeeded(undefined);
        case "snapshot":
          if (state !== "joined") return failed("phase-invalid");
          counters.receivedSnapshotCount += 1;
          queueDecodedSnapshot(
            Object.freeze({
              message: copySnapshot(message),
              observedAtMs: observed.value,
            }),
          );
          return succeeded(undefined);
      }
    },
    queueMove,
    queueInteract,
    stepExact(count = 1): ClientReplicationOutcome<number> {
      if (!live || state !== "joined") return failed("phase-invalid");
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new RangeError("Exact step count must be a non-negative integer");
      }
      if (count > MAX_TICK - clientTick) return failed("tick-exhausted");

      for (let step = 0; step < count; step += 1) {
        clientTick += 1;
        let tickFailure: ClientReplicationOutcome<never> | null = null;
        let sampled: ClientActionIntent | null = null;
        let attempt: PredictionAttempt | null = null;
        let predictionStart: MovementVector | null = null;
        let desiredTranslation: MovementVector | null = null;

        recordSimulationPhase("snapshot-ingest");
        const admitted = ingestSnapshots();

        recordSimulationPhase("reconcile");
        const newestAdmitted = admitted[admitted.length - 1];
        if (newestAdmitted !== undefined) {
          const result = reconcileSnapshot(newestAdmitted);
          if (!result.ok) {
            tickFailure = result;
          }
        }

        recordSimulationPhase("action-sample");
        if (tickFailure === null) {
          sampled = queuedMove;
          queuedMove = null;
        }

        recordSimulationPhase("command-send");
        if (tickFailure === null && sampled !== null) {
          if (predictionHistory.length >= MAX_PENDING_COMMANDS) {
            tickFailure = failed("pending-history-full");
          } else if (nextSequence > MAX_SEQUENCE) {
            tickFailure = failed("sequence-exhausted");
          } else {
            attempt = Object.freeze({
              sequence: nextSequence,
              intendedTick: clientTick,
              action: sampled,
            });
            predictionHistory.push(attempt);
            nextSequence += 1;
            const command: CommandMessage = Object.freeze({
              protocolVersion: PROTOCOL_VERSION,
              kind: "command",
              sequence: attempt.sequence,
              intendedTick: attempt.intendedTick,
              action: attempt.action,
            });
            const sender = emit;
            if (sender === null || !live || state !== "joined") {
              removeRejectedAndLater(attempt.sequence);
              tickFailure = failed("phase-invalid");
            } else {
              try {
                sender(command);
                counters.sendCount += 1;
              } catch {
                removeRejectedAndLater(attempt.sequence);
                tickFailure = failed("emit-failed");
              }
            }
          }
        }

        recordSimulationPhase("shared-predict");
        if (
          tickFailure === null &&
          attempt !== null &&
          predictionHistory.includes(attempt) &&
          simulationPosition !== null &&
          attempt.action.kind === "move" &&
          live &&
          state === "joined"
        ) {
          predictionStart = simulationPosition;
          const desired = desiredFor(attempt.action, false);
          if (desired.ok) desiredTranslation = desired.value;
          else tickFailure = desired;
        }

        recordSimulationPhase("predictive-collision");
        if (
          tickFailure === null &&
          predictionStart !== null &&
          desiredTranslation !== null
        ) {
          const result = collide(predictionStart, desiredTranslation);
          if (result.ok) simulationPosition = result.value;
          else tickFailure = result;
        }

        recordSimulationPhase("presentation-publish");
        publishPresentation();
        recordSimulationPhase("telemetry");
        currentPhase = null;
        if (tickFailure !== null) return tickFailure;
      }
      return succeeded(clientTick);
    },
    frame(nowMs: number): ClientReplicationOutcome<ClientPresentationState> {
      if (!live || state !== "joined" || localPresentationPosition === null) {
        return failed("phase-invalid");
      }
      if (
        !Number.isFinite(nowMs) ||
        (lastFrameMs !== null && nowMs < lastFrameMs) ||
        (lastObservationMs !== null && nowMs < lastObservationMs)
      ) {
        return failed("frame-time-invalid");
      }
      lastFrameMs = nowMs;
      lastObservationMs = nowMs;
      frameNumber += 1;

      recordPresentationPhase("remote-interpolation");
      interpolateRemoteAvatars(nowMs);
      presentNewestInteractables();

      if (correctionStartedAtMs === null) correctionStartedAtMs = nowMs;
      const elapsed = Math.max(0, nowMs - correctionStartedAtMs);
      const remaining = Math.max(0, 1 - elapsed / CORRECTION_DURATION_MS);
      correctionOffset = scaleVector(correctionBase, remaining);
      publishPresentation();

      recordPresentationPhase("camera-view");
      recordPresentationPhase("render");
      recordPresentationPhase("frame-telemetry");
      counters.frameCount += 1;
      currentFramePhase = null;

      const presented = localPresentationPosition;
      if (presented === null) return failed("phase-invalid");
      const frameTrace = Object.freeze([
        "remote-interpolation",
        "camera-view",
        "render",
        "frame-telemetry",
      ] as const);
      const remotes = Object.freeze(
        Array.from(remoteAvatars.values(), freezeRemote),
      );
      return succeeded(
        Object.freeze({
          frame: frameNumber,
          nowMs,
          localPosition: copyFiniteVector(
            presented,
            "Local presented position",
          ),
          remoteAvatars: remotes,
          interactables: sortedInteractables(),
          phaseTrace: frameTrace,
        }),
      );
    },
    disconnect(): ClientReplicationOutcome {
      return teardown();
    },
    shutdown(): ClientReplicationOutcome {
      return teardown();
    },
    inspect(): ClientReplicationInspection {
      const remotes = Object.freeze(
        Array.from(remoteAvatars.values(), freezeRemote),
      );
      const inspectedInteractables = sortedInteractables();
      const inspectedCounters: ClientReplicationCounters = Object.freeze({
        ...counters,
      });
      const bindingCount = connectionId === null ? 0 : 1;
      const retainedReferences =
        Number(emit !== null) +
        Number(observationClock !== null) +
        Number(collisionAdapter !== null) +
        Number(simulationPosition !== null) +
        Number(localPresentationPosition !== null);
      return Object.freeze({
        state,
        stateTrace: Object.freeze(Array.from(stateTrace)),
        clientTick,
        currentPhase,
        currentFramePhase,
        connectionId,
        playerId,
        ownedEntityId,
        simulationPosition:
          simulationPosition === null
            ? null
            : copyFiniteVector(
                simulationPosition,
                "Inspected simulation position",
              ),
        localPresentationPosition:
          localPresentationPosition === null
            ? null
            : copyFiniteVector(
                localPresentationPosition,
                "Inspected presentation position",
              ),
        remoteAvatars: remotes,
        interactables: inspectedInteractables,
        estimatedServerTick,
        interpolationTargetTick,
        snapshotBufferTicks: Object.freeze(
          snapshotBuffer.map((entry) => entry.message.serverTick),
        ),
        snapshotBufferCount: snapshotBuffer.length,
        decodedInboxTicks: Object.freeze(
          decodedInbox.map((entry) => entry.message.serverTick),
        ),
        decodedInboxCount: decodedInbox.length,
        historySequences: Object.freeze(
          predictionHistory.map((attempt) => attempt.sequence),
        ),
        nextSequence,
        acknowledgedSequence,
        simulationPhaseTrace: Object.freeze(
          simulationPhaseTrace.map(({ clientTick: tick, phase }) =>
            Object.freeze({ clientTick: tick, phase }),
          ),
        ),
        presentationPhaseTrace: Object.freeze(
          presentationPhaseTrace.map(({ frame, phase }) =>
            Object.freeze({ frame, phase }),
          ),
        ),
        counters: inspectedCounters,
        liveResourceCounts: Object.freeze({
          bindings: bindingCount,
          queuedActions: queuedMove === null ? 0 : 1,
          decodedSnapshots: decodedInbox.length,
          bufferedSnapshots: snapshotBuffer.length,
          predictionHistory: predictionHistory.length,
          remoteAvatars: remotes.length,
          interactables: inspectedInteractables.length,
          collisionAdapters: collisionAdapter === null ? 0 : 1,
          retainedReferences,
        }),
      });
    },
  });

  return engine;
}

export function createClientReplicationEngine(
  options: ClientReplicationOptions,
): ClientReplicationEngine {
  return createEngine(options);
}
