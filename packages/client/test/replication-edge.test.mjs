import assert from "node:assert/strict";
import test from "node:test";
import { createClientReplicationEngine } from "@three-game-kit/client/replication";
import { PROTOCOL_VERSION } from "@three-game-kit/protocol";

const ZERO_COUNTERS = Object.freeze({
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
});

function counters(overrides = {}) {
  return { ...ZERO_COUNTERS, ...overrides };
}

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

function createHarness() {
  const emitted = [];
  let disposed = false;
  let moveCount = 0;
  const collisionAdapter = Object.freeze({
    get disposed() {
      return disposed;
    },
    move(start, desired) {
      moveCount += 1;
      const position = Object.freeze({
        x: start.x + desired.x,
        y: start.y + desired.y,
        z: start.z + desired.z,
      });
      return Object.freeze({
        ok: true,
        value: Object.freeze({ position }),
      });
    },
    dispose() {
      disposed = true;
    },
  });
  const engine = createClientReplicationEngine({
    movementSpeedMetersPerSecond: 6,
    initialPosition: { x: 0, y: 0, z: 0 },
    collisionAdapter,
    emit(message) {
      emitted.push(message);
    },
  });
  expectOk(engine.beginJoin(), undefined);
  expectOk(
    engine.receive({
      protocolVersion: PROTOCOL_VERSION,
      kind: "joined",
      connectionId: "connection_local",
      playerId: "player_local",
      ownedEntityId: "avatar_local",
      serverTick: 0,
    }),
    undefined,
  );
  return {
    engine,
    emitted,
    get moveCount() {
      return moveCount;
    },
  };
}

function snapshot(serverTick, x, acknowledgedSequence = null) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "snapshot",
    serverTick,
    acknowledgedSequence,
    entities: [
      {
        entityKind: "avatar",
        entityId: "avatar_local",
        playerId: "player_local",
        position: { x, y: 0, z: 0 },
      },
    ],
  };
}

test("out-of-order snapshots discard duplicates and older ticks and reconcile newest once", () => {
  const harness = createHarness();
  const { engine } = harness;

  expectOk(engine.receive(snapshot(10, 10)), undefined);
  expectOk(engine.stepExact(), 1);
  const baseline = engine.inspect();
  assertDeepFrozen(baseline);

  expectOk(engine.queueMove(1, 0), undefined);
  expectOk(engine.stepExact(), 2);
  for (const tick of [14, 12, 13, 13, 9]) {
    expectOk(engine.receive(snapshot(tick, tick)), undefined);
  }
  expectOk(engine.stepExact(), 3);

  const inspection = engine.inspect();
  assertDeepFrozen(inspection);
  assert.deepEqual(inspection.snapshotBufferTicks, [10, 12, 13, 14]);
  assert.deepEqual(inspection.simulationPosition, {
    x: 14.1,
    y: -0.001,
    z: 0,
  });
  assert.deepEqual(
    inspection.counters,
    counters({
      receivedSnapshotCount: 6,
      admittedSnapshotCount: 4,
      discardedSnapshotCount: 2,
      reconcileCount: 2,
      sendCount: 1,
      predictCount: 2,
      replayPredictCount: 1,
      collisionCount: 2,
    }),
  );
  assert.equal(harness.moveCount, 2);
  assert.deepEqual(baseline.snapshotBufferTicks, [10]);
  assert.deepEqual(baseline.simulationPosition, { x: 10, y: 0, z: 0 });
});

test("descending overflow retains exactly the newest 32 server ticks", () => {
  const { engine } = createHarness();

  for (let tick = 40; tick >= 1; tick -= 1) {
    expectOk(engine.receive(snapshot(tick, tick)), undefined);
  }
  expectOk(engine.stepExact(), 1);

  const inspection = engine.inspect();
  assertDeepFrozen(inspection);
  assert.deepEqual(
    inspection.snapshotBufferTicks,
    Array.from({ length: 32 }, (_, index) => index + 9),
  );
  assert.equal(inspection.snapshotBufferCount, 32);
  assert.deepEqual(inspection.simulationPosition, { x: 40, y: 0, z: 0 });
  assert.deepEqual(
    inspection.counters,
    counters({
      receivedSnapshotCount: 40,
      admittedSnapshotCount: 32,
      inboxEvictionCount: 8,
      reconcileCount: 1,
    }),
  );
});

test("rejection immediately rebuilds simulation and reuses the rejected sequence", () => {
  const harness = createHarness();
  const { engine, emitted } = harness;

  expectOk(engine.receive(snapshot(1, 0)), undefined);
  expectOk(engine.stepExact(), 1);
  for (let index = 0; index < 3; index += 1) {
    expectOk(engine.queueMove(1, 0), undefined);
    expectOk(engine.stepExact(), index + 2);
  }
  const speculative = engine.inspect();
  assertDeepFrozen(speculative);
  assert.deepEqual(speculative.historySequences, [1, 2, 3]);

  expectOk(
    engine.receive({
      protocolVersion: PROTOCOL_VERSION,
      kind: "rejected",
      sequence: 2,
      reason: "movement-limit",
    }),
    undefined,
  );

  const rebuilt = engine.inspect();
  assertDeepFrozen(rebuilt);
  assert.deepEqual(rebuilt.historySequences, [1]);
  assert.equal(rebuilt.nextSequence, 2);
  assert.deepEqual(rebuilt.simulationPosition, {
    x: 0.1,
    y: -0.001,
    z: 0,
  });
  assert.deepEqual(
    rebuilt.localPresentationPosition,
    speculative.localPresentationPosition,
  );
  assert.deepEqual(
    rebuilt.counters,
    counters({
      receivedSnapshotCount: 1,
      admittedSnapshotCount: 1,
      rejectedCount: 1,
      reconcileCount: 1,
      sendCount: 3,
      predictCount: 4,
      replayPredictCount: 1,
      collisionCount: 4,
    }),
  );
  assert.deepEqual(speculative.historySequences, [1, 2, 3]);

  expectOk(engine.queueMove(0, 1), undefined);
  expectOk(engine.stepExact(), 5);
  assert.deepEqual(
    emitted
      .filter((message) => message.kind === "command")
      .map((message) => message.sequence),
    [1, 2, 3, 2],
  );
  assert.deepEqual(engine.inspect().historySequences, [1, 2]);
});
