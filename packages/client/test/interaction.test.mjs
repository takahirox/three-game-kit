import assert from "node:assert/strict";
import test from "node:test";
import { createClientReplicationEngine } from "@three-game-kit/client/replication";
import { MAX_ID_LENGTH, PROTOCOL_VERSION } from "@three-game-kit/protocol";

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

function avatar(position = { x: 0, y: 0, z: 0 }) {
  return {
    entityKind: "avatar",
    entityId: "avatar_local",
    playerId: "player_local",
    position,
  };
}

function interactable(entityId, position, active = true) {
  return { entityKind: "interactable", entityId, position, active };
}

function snapshot(serverTick, acknowledgedSequence, entities = []) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "snapshot",
    serverTick,
    acknowledgedSequence,
    entities: [avatar(), ...entities],
  };
}

function createHarness() {
  const emitted = [];
  let collisionMoveCount = 0;
  let disposed = false;
  const collisionAdapter = Object.freeze({
    get disposed() {
      return disposed;
    },
    move(startPosition, desiredTranslation) {
      collisionMoveCount += 1;
      return Object.freeze({
        ok: true,
        value: Object.freeze({
          startPosition,
          desiredTranslation,
          effectiveTranslation: desiredTranslation,
          position: Object.freeze({
            x: startPosition.x + desiredTranslation.x,
            y: startPosition.y + desiredTranslation.y,
            z: startPosition.z + desiredTranslation.z,
          }),
          grounded: false,
          collided: false,
          collisionCount: 0,
        }),
      });
    },
    dispose() {
      disposed = true;
    },
  });
  const engine = createClientReplicationEngine({
    movementSpeedMetersPerSecond: 6,
    initialPosition: { x: 2, y: 3, z: 4 },
    collisionAdapter,
    emit(message) {
      emitted.push(message);
    },
  });
  expectOk(engine.beginJoin(), undefined);
  expectOk(engine.receive({
    protocolVersion: PROTOCOL_VERSION,
    kind: "joined",
    connectionId: "connection_local",
    playerId: "player_local",
    ownedEntityId: "avatar_local",
    serverTick: 0,
  }), undefined);
  return {
    engine,
    emitted,
    collisionAdapter,
    collisionMoveCount: () => collisionMoveCount,
  };
}

test("interactions emit without movement prediction and acknowledgements retire them", () => {
  const { engine, emitted, collisionMoveCount } = createHarness();
  const before = engine.inspect();

  expectOk(engine.queueInteract({
    kind: "interact",
    targetEntityId: "target_1",
  }), undefined);
  expectOk(engine.stepExact(), 1);

  const pending = engine.inspect();
  assert.deepEqual(emitted.at(-1), {
    protocolVersion: PROTOCOL_VERSION,
    kind: "command",
    sequence: 1,
    intendedTick: 1,
    action: { kind: "interact", targetEntityId: "target_1" },
  });
  assertDeepFrozen(emitted.at(-1));
  assert.deepEqual(pending.simulationPosition, before.simulationPosition);
  assert.deepEqual(
    pending.localPresentationPosition,
    before.localPresentationPosition,
  );
  assert.equal(collisionMoveCount(), 0);
  assert.equal(pending.counters.predictCount, 0);
  assert.equal(pending.counters.collisionCount, 0);
  assert.deepEqual(pending.historySequences, [1]);

  expectOk(engine.receive(snapshot(1, 1)), undefined);
  expectOk(engine.stepExact(), 2);
  const acknowledged = engine.inspect();
  assert.deepEqual(acknowledged.historySequences, []);
  assert.equal(acknowledged.acknowledgedSequence, 1);
  assert.equal(collisionMoveCount(), 0);
  assert.deepEqual(acknowledged.simulationPosition, { x: 0, y: 0, z: 0 });

  expectOk(engine.shutdown(), undefined);
});

test("matching interaction rejection removes history and permits sequence reuse", () => {
  const { engine, emitted, collisionMoveCount } = createHarness();

  expectOk(engine.queueInteract("target_1"), undefined);
  expectOk(engine.stepExact(), 1);
  assert.deepEqual(engine.inspect().historySequences, [1]);

  expectOk(engine.receive({
    protocolVersion: PROTOCOL_VERSION,
    kind: "rejected",
    sequence: 1,
    reason: "unknown-target",
  }), undefined);
  const rejected = engine.inspect();
  assert.deepEqual(rejected.historySequences, []);
  assert.equal(rejected.nextSequence, 1);
  assert.equal(rejected.counters.rejectedCount, 1);

  expectOk(engine.queueInteract("target_2"), undefined);
  expectOk(engine.stepExact(), 2);
  assert.deepEqual(
    emitted.filter((message) => message.kind === "command")
      .map(({ sequence, action }) => ({ sequence, action })),
    [
      { sequence: 1, action: { kind: "interact", targetEntityId: "target_1" } },
      { sequence: 1, action: { kind: "interact", targetEntityId: "target_2" } },
    ],
  );
  assert.deepEqual(engine.inspect().historySequences, [1]);
  assert.equal(collisionMoveCount(), 0);

  expectOk(engine.shutdown(), undefined);
});

test("invalid interaction target IDs fail synchronously without queuing", () => {
  const { engine, emitted } = createHarness();
  const commandCount = emitted.length;

  for (const targetEntityId of ["", "invalid target", "x".repeat(MAX_ID_LENGTH + 1)]) {
    assert.throws(
      () => engine.queueInteract(targetEntityId),
      { name: "RangeError", message: "Interaction target entity ID is invalid" },
    );
    assert.equal(engine.inspect().liveResourceCounts.queuedActions, 0);
  }
  assert.equal(emitted.length, commandCount);

  expectOk(engine.shutdown(), undefined);
});

test("newest snapshot interactables are exact, sorted, detached, and removed", () => {
  const { engine } = createHarness();
  const first = snapshot(10, 0, [
    interactable("target_z", { x: 10, y: 20, z: 30 }, false),
    interactable("target_a", { x: -1, y: -2, z: -3 }),
  ]);
  expectOk(engine.receive(first), undefined);
  first.entities[1].position.x = 999;
  first.entities[2].position.x = 999;
  first.entities.push(interactable("target_injected", { x: 9, y: 9, z: 9 }));
  expectOk(engine.stepExact(), 1);

  const frame = expectOk(engine.frame(0));
  const expected = [
    {
      entityId: "target_a",
      position: { x: -1, y: -2, z: -3 },
      active: true,
      provenance: "snapshot",
      sourceServerTick: 10,
    },
    {
      entityId: "target_z",
      position: { x: 10, y: 20, z: 30 },
      active: false,
      provenance: "snapshot",
      sourceServerTick: 10,
    },
  ];
  assert.deepEqual(frame.interactables, expected);
  assert.deepEqual(engine.inspect().interactables, expected);
  assertDeepFrozen(frame.interactables);
  assertDeepFrozen(engine.inspect().interactables);

  expectOk(engine.receive(snapshot(20, 0, [
    interactable("target_z", { x: 100, y: 200, z: 300 }),
  ])), undefined);
  expectOk(engine.stepExact(), 2);
  const later = expectOk(engine.frame(1_000));
  assert.deepEqual(later.interactables, [{
    entityId: "target_z",
    position: { x: 100, y: 200, z: 300 },
    active: true,
    provenance: "snapshot",
    sourceServerTick: 20,
  }]);
  assert.equal(later.interactables.some(({ entityId }) => entityId === "target_a"), false);

  expectOk(engine.shutdown(), undefined);
});

test("shutdown is idempotent and releases interactable resources", () => {
  const { engine, collisionAdapter } = createHarness();
  expectOk(engine.receive(snapshot(1, 0, [
    interactable("target_1", { x: 1, y: 2, z: 3 }),
  ])), undefined);
  expectOk(engine.stepExact(), 1);
  expectOk(engine.frame(0));
  assert.equal(engine.inspect().liveResourceCounts.interactables, 1);

  const first = engine.shutdown();
  const second = engine.shutdown();
  assert.strictEqual(second, first);
  expectOk(first, undefined);
  assert.equal(collisionAdapter.disposed, true);
  const closed = engine.inspect();
  assert.deepEqual(closed.interactables, []);
  assert.ok(Object.values(closed.liveResourceCounts).every((count) => count === 0));
  assert.equal(closed.liveResourceCounts.interactables, 0);
});
