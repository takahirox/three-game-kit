import assert from "node:assert/strict";
import test from "node:test";
import { createRapierCollisionAdapter } from "@three-game-kit/client/collision";
import { createClientReplicationEngine } from "@three-game-kit/client/replication";
import { PROTOCOL_VERSION } from "@three-game-kit/protocol";

const SIMULATION_PHASES = Object.freeze([
  "snapshot-ingest", "reconcile", "action-sample", "command-send",
  "shared-predict", "predictive-collision", "presentation-publish", "telemetry",
]);
const FRAME_PHASES = Object.freeze([
  "remote-interpolation", "camera-view", "render", "frame-telemetry",
]);
const ZERO_COUNTERS = Object.freeze({
  receivedSnapshotCount: 0, admittedSnapshotCount: 0, discardedSnapshotCount: 0,
  inboxEvictionCount: 0, bufferEvictionCount: 0, rejectedCount: 0,
  reconcileCount: 0, sendCount: 0, predictCount: 0, replayPredictCount: 0,
  collisionCount: 0, interpolationCount: 0, interpolatedAvatarCount: 0,
  frameCount: 0,
});

function assertDeepFrozen(value) {
  if (typeof value !== "object" || value === null) return;
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) assertDeepFrozen(value[key]);
}

function expectOk(result, expectedValue) {
  assertDeepFrozen(result);
  assert.equal(result.ok, true);
  if (arguments.length === 2) assert.deepEqual(result.value, expectedValue);
  return result.value;
}

function inspect(engine, previous) {
  const current = engine.inspect();
  assertDeepFrozen(current);
  if (previous !== undefined) {
    assert.notStrictEqual(current, previous);
    for (const key of [
      "stateTrace", "remoteAvatars", "snapshotBufferTicks",
      "decodedInboxTicks", "historySequences",
      "simulationPhaseTrace", "presentationPhaseTrace", "counters",
      "liveResourceCounts",
    ]) assert.notStrictEqual(current[key], previous[key]);
    if (current.simulationPosition !== null && previous.simulationPosition !== null) {
      assert.notStrictEqual(current.simulationPosition, previous.simulationPosition);
    }
    if (current.localPresentationPosition !== null &&
        previous.localPresentationPosition !== null) {
      assert.notStrictEqual(
        current.localPresentationPosition,
        previous.localPresentationPosition,
      );
    }
  }
  return current;
}

function counters(overrides) {
  return { ...ZERO_COUNTERS, ...overrides };
}

function avatar(entityId, playerId, position) {
  return { entityKind: "avatar", entityId, playerId, position };
}

function snapshot(serverTick, acknowledgedSequence, ownedPosition, remotePosition) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "snapshot",
    serverTick,
    acknowledgedSequence,
    entities: [
      avatar("avatar_local", "player_local", ownedPosition),
      avatar("avatar_remote", "player_remote", remotePosition),
    ],
  };
}

function assertNear(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon);
}

function assertVectorNear(actual, expected, epsilon = 1e-6) {
  assertNear(actual.x, expected.x, epsilon);
  assertNear(actual.y, expected.y, epsilon);
  assertNear(actual.z, expected.z, epsilon);
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function phasesAtTick(inspection, tick) {
  return inspection.simulationPhaseTrace
    .filter((entry) => entry.clientTick === tick)
    .map((entry) => entry.phase);
}

function expectFrame(engine, nowMs) {
  const frame = expectOk(engine.frame(nowMs));
  assert.deepEqual(frame.phaseTrace, FRAME_PHASES);
  return frame;
}

test("public replication predicts, reconciles, interpolates, and cleans up", (t) => {
  const emitted = [];
  let observedAtMs = 0;
  const adapter = createRapierCollisionAdapter({
    capsuleRadius: 0.5,
    capsuleHalfHeight: 0.5,
    controllerOffset: 0.01,
    boxes: [],
  });
  const engine = createClientReplicationEngine({
    movementSpeedMetersPerSecond: 6,
    initialPosition: { x: 0, y: 1, z: 0 },
    collisionAdapter: adapter,
    emit(message) { emitted.push(message); },
    observationClock: () => observedAtMs,
  });
  t.after(() => engine.shutdown());

  expectOk(engine.beginJoin(), undefined);
  assert.deepEqual(emitted, [
    { protocolVersion: PROTOCOL_VERSION, kind: "join" },
  ]);
  assert.deepEqual(Object.keys(emitted[0]), ["protocolVersion", "kind"]);
  assertDeepFrozen(emitted[0]);

  expectOk(engine.receive({
    protocolVersion: PROTOCOL_VERSION,
    kind: "joined",
    connectionId: "connection_local",
    playerId: "player_local",
    ownedEntityId: "avatar_local",
    serverTick: 0,
  }), undefined);
  const joined = inspect(engine);
  assert.deepEqual({
    state: joined.state,
    stateTrace: joined.stateTrace,
    clientTick: joined.clientTick,
    connectionId: joined.connectionId,
    playerId: joined.playerId,
    ownedEntityId: joined.ownedEntityId,
  }, {
    state: "joined",
    stateTrace: ["ready", "joining", "joined"],
    clientTick: 0,
    connectionId: "connection_local",
    playerId: "player_local",
    ownedEntityId: "avatar_local",
  });

  expectOk(engine.queueMove(1, 0), undefined);
  expectOk(engine.stepExact(), 1);
  const predicted = inspect(engine, joined);
  assert.deepEqual(phasesAtTick(predicted, 1), SIMULATION_PHASES);
  assert.equal(predicted.simulationPhaseTrace.length, 8);
  assert.deepEqual(emitted[1], {
    protocolVersion: PROTOCOL_VERSION,
    kind: "command",
    sequence: 1,
    intendedTick: 1,
    action: { kind: "move", x: 1, z: 0 },
  });
  assert.deepEqual(Object.keys(emitted[1].action), ["kind", "x", "z"]);
  assertDeepFrozen(emitted[1]);
  assertVectorNear(predicted.simulationPosition, { x: 0.1, y: 0.999, z: 0 });
  assert.deepEqual(predicted.localPresentationPosition, predicted.simulationPosition);
  assert.deepEqual(predicted.historySequences, [1]);
  assert.equal(predicted.nextSequence, 2);
  assert.equal(predicted.acknowledgedSequence, null);
  assert.deepEqual(predicted.counters, counters({
    sendCount: 1, predictCount: 1, collisionCount: 1,
  }));
  assert.deepEqual(predicted.liveResourceCounts, {
    bindings: 1, queuedActions: 0, decodedSnapshots: 0, bufferedSnapshots: 0,
    predictionHistory: 1, remoteAvatars: 0, collisionAdapters: 1,
    retainedReferences: 5,
  });

  const authoritative = Object.freeze({ x: 4, y: 2, z: -3 });
  const correctionSnapshot = snapshot(
    12, 1, { ...authoritative }, { x: -10, y: 1, z: 0 },
  );
  observedAtMs = 100;
  expectOk(engine.receive(correctionSnapshot), undefined);
  correctionSnapshot.entities[0].position.x = 999;
  correctionSnapshot.entities[1].position.x = 999;
  correctionSnapshot.entities.push(
    avatar("avatar_injected", "player_injected", { x: 999, y: 999, z: 999 }),
  );

  expectOk(engine.stepExact(), 2);
  const corrected = inspect(engine, predicted);
  assert.deepEqual(phasesAtTick(corrected, 2), SIMULATION_PHASES);
  assert.equal(corrected.simulationPhaseTrace.filter(
    ({ clientTick, phase }) => clientTick === 2 &&
      (phase === "snapshot-ingest" || phase === "reconcile"),
  ).length, 2);
  assertVectorNear(corrected.simulationPosition, authoritative);
  assert.deepEqual(
    corrected.localPresentationPosition,
    predicted.localPresentationPosition,
  );
  assert.ok(distance(corrected.localPresentationPosition, authoritative) > 0);
  assert.deepEqual(corrected.historySequences, []);
  assert.equal(corrected.acknowledgedSequence, 1);
  assert.equal(corrected.nextSequence, 2);
  assert.deepEqual(corrected.counters, counters({
    receivedSnapshotCount: 1, admittedSnapshotCount: 1, reconcileCount: 1,
    sendCount: 1, predictCount: 1, collisionCount: 1,
  }));
  assert.equal(emitted.length, 2);

  const correctionFrames = [
    expectFrame(engine, 100),
    expectFrame(engine, 350),
    expectFrame(engine, 600),
  ];
  const correctionDistances = correctionFrames.map(
    (frame) => distance(frame.localPosition, authoritative),
  );
  assert.ok(correctionDistances.every(Number.isFinite));
  assert.ok(correctionDistances[0] >= correctionDistances[1]);
  assert.ok(correctionDistances[1] >= correctionDistances[2]);
  assertNear(correctionDistances[1], correctionDistances[0] / 2);
  assert.ok(correctionDistances[2] <= 0.05);
  assert.equal(correctionDistances[2], 0);
  assert.deepEqual(correctionFrames[0].localPosition, predicted.localPresentationPosition);
  assert.deepEqual(correctionFrames[2].localPosition, authoritative);
  assert.deepEqual(correctionFrames[0].remoteAvatars, [{
    entityId: "avatar_remote",
    playerId: "player_remote",
    position: { x: -10, y: 1, z: 0 },
    provenance: "snapshot",
    mode: "oldest-hold",
    sourceServerTicks: [12],
  }]);
  for (let index = 1; index < correctionFrames.length; index += 1) {
    assert.notStrictEqual(correctionFrames[index], correctionFrames[index - 1]);
    assert.notStrictEqual(
      correctionFrames[index].localPosition,
      correctionFrames[index - 1].localPosition,
    );
    assert.notStrictEqual(
      correctionFrames[index].remoteAvatars,
      correctionFrames[index - 1].remoteAvatars,
    );
  }
  const afterCorrectionFrames = inspect(engine, corrected);
  assertVectorNear(afterCorrectionFrames.simulationPosition, authoritative);
  assert.deepEqual(afterCorrectionFrames.counters, counters({
    receivedSnapshotCount: 1, admittedSnapshotCount: 1, reconcileCount: 1,
    sendCount: 1, predictCount: 1, collisionCount: 1,
    interpolationCount: 3, frameCount: 3,
  }));
  assert.deepEqual(
    afterCorrectionFrames.presentationPhaseTrace.map(({ phase }) => phase),
    [...FRAME_PHASES, ...FRAME_PHASES, ...FRAME_PHASES],
  );

  expectOk(engine.queueMove({ kind: "move", x: 0, z: 1 }), undefined);
  expectOk(engine.stepExact(), 3);
  const unacknowledged = inspect(engine, afterCorrectionFrames);
  assert.deepEqual(unacknowledged.historySequences, [2]);
  assert.deepEqual(phasesAtTick(unacknowledged, 3), SIMULATION_PHASES);
  assert.deepEqual(emitted[2], {
    protocolVersion: PROTOCOL_VERSION,
    kind: "command",
    sequence: 2,
    intendedTick: 3,
    action: { kind: "move", x: 0, z: 1 },
  });
  assertVectorNear(
    unacknowledged.simulationPosition,
    { x: 4, y: 1.999, z: -2.9 },
  );

  const olderBracket = snapshot(
    40, 1, { x: 7, y: 1, z: 2 }, { x: 0, y: 1, z: 0 },
  );
  observedAtMs = 700;
  expectOk(engine.receive(olderBracket), undefined);
  const newerBracket = snapshot(
    50, 1, { x: 8, y: 1, z: 2 }, { x: 10, y: 1, z: 0 },
  );
  observedAtMs = 710;
  expectOk(engine.receive(newerBracket), undefined);
  olderBracket.entities[1].position.x = -999;
  newerBracket.entities[1].position.x = 999;

  const queued = inspect(engine, unacknowledged);
  assert.deepEqual(queued.decodedInboxTicks, [40, 50]);

  expectOk(engine.stepExact(), 4);
  const replayed = inspect(engine, queued);
  assert.deepEqual(phasesAtTick(replayed, 4), SIMULATION_PHASES);
  assert.deepEqual(replayed.snapshotBufferTicks, [12, 40, 50]);
  assert.deepEqual(replayed.historySequences, [2]);
  assert.equal(replayed.acknowledgedSequence, 1);
  assertVectorNear(replayed.simulationPosition, { x: 8, y: 0.999, z: 2.1 });
  assert.deepEqual(replayed.counters, counters({
    receivedSnapshotCount: 3, admittedSnapshotCount: 3, reconcileCount: 2,
    sendCount: 2, predictCount: 3, replayPredictCount: 1, collisionCount: 3,
    interpolationCount: 3, frameCount: 3,
  }));

  const interpolatedFrame = expectFrame(engine, 710);
  const afterInterpolatedFrame = inspect(engine, replayed);
  assertVectorNear(
    afterInterpolatedFrame.simulationPosition,
    { x: 8, y: 0.999, z: 2.1 },
  );
  assert.equal(interpolatedFrame.remoteAvatars.length, 1);
  const interpolated = interpolatedFrame.remoteAvatars[0];
  assert.deepEqual({
    entityId: interpolated.entityId,
    playerId: interpolated.playerId,
    provenance: interpolated.provenance,
    mode: interpolated.mode,
    sourceServerTicks: interpolated.sourceServerTicks,
  }, {
    entityId: "avatar_remote",
    playerId: "player_remote",
    provenance: "snapshot",
    mode: "interpolated",
    sourceServerTicks: [40, 50],
  });
  assert.equal(interpolated.sourceServerTicks.length, 2);
  assertVectorNear(interpolated.position, { x: 4, y: 1, z: 0 });
  assert.ok(interpolated.position.x >= 0 && interpolated.position.x <= 10);

  const newestHoldFrame = expectFrame(engine, 900);
  assert.deepEqual(newestHoldFrame.remoteAvatars, [{
    entityId: "avatar_remote",
    playerId: "player_remote",
    position: { x: 10, y: 1, z: 0 },
    provenance: "snapshot",
    mode: "newest-hold",
    sourceServerTicks: [50],
  }]);
  assert.notStrictEqual(newestHoldFrame, interpolatedFrame);
  assert.notStrictEqual(
    newestHoldFrame.remoteAvatars[0],
    interpolatedFrame.remoteAvatars[0],
  );

  const beforeShutdown = inspect(engine, afterInterpolatedFrame);
  assertVectorNear(beforeShutdown.simulationPosition, {
    x: 8, y: 0.999, z: 2.1,
  });
  assert.deepEqual(
    beforeShutdown.presentationPhaseTrace.slice(-8).map(({ phase }) => phase),
    [...FRAME_PHASES, ...FRAME_PHASES],
  );
  assert.equal(beforeShutdown.counters.interpolationCount, 5);
  assert.equal(beforeShutdown.counters.interpolatedAvatarCount, 1);
  assert.equal(beforeShutdown.counters.frameCount, 5);
  assert.deepEqual(beforeShutdown.historySequences, [2]);

  const firstShutdown = engine.shutdown();
  const secondShutdown = engine.shutdown();
  assert.strictEqual(secondShutdown, firstShutdown);
  expectOk(firstShutdown, undefined);
  assert.equal(adapter.disposed, true);
  const closed = inspect(engine, beforeShutdown);
  assert.deepEqual(closed.stateTrace, [
    "ready", "joining", "joined", "disconnecting", "closed",
  ]);
  assert.equal(closed.state, "closed");
  assert.ok(Object.values(closed.liveResourceCounts).every((count) => count === 0));
  assert.deepEqual(closed.historySequences, []);
  assert.deepEqual(closed.snapshotBufferTicks, []);
  assert.deepEqual(closed.remoteAvatars, []);
  assert.equal(beforeShutdown.remoteAvatars.length, 1);
  assertVectorNear(beforeShutdown.simulationPosition, {
    x: 8, y: 0.999, z: 2.1,
  });
});
