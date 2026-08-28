import assert from "node:assert/strict";
import test from "node:test";
import { PROTOCOL_VERSION } from "@three-game-kit/protocol";
import { createAuthoritativeServer } from "@three-game-kit/server/authoritative";
import { createRapierServerCollisionAdapter } from "@three-game-kit/server/collision";

const PHASES = Object.freeze([
  "ingress",
  "validate-bind",
  "command-apply",
  "shared-movement",
  "authoritative-collision",
  "gameplay",
  "snapshot-build",
  "telemetry",
]);
const JOIN = Object.freeze({
  protocolVersion: PROTOCOL_VERSION,
  kind: "join",
});

function trustedFloorAndWallScene() {
  return {
    capsuleRadius: 0.1,
    capsuleHalfHeight: 0.1,
    controllerOffset: 0.01,
    boxes: [
      {
        id: "floor",
        center: { x: 0, y: -0.5, z: 0 },
        halfExtents: { x: 10, y: 0.5, z: 10 },
      },
      {
        id: "wall",
        center: { x: 0.25, y: 1, z: 0 },
        halfExtents: { x: 0.1, y: 2, z: 10 },
      },
    ],
  };
}

function valueOf(outcome) {
  assert.equal(outcome.ok, true);
  return outcome.value;
}

function messagesOfKind(messages, kind) {
  return messages.filter((message) => message.kind === kind);
}

function assertFinitePosition(position) {
  assert.ok(position !== null);
  assert.ok(Number.isFinite(position.x));
  assert.ok(Number.isFinite(position.y));
  assert.ok(Number.isFinite(position.z));
}

function assertSnapshotFrozen(snapshot) {
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.entities), true);
  for (const entity of snapshot.entities) {
    assert.equal(Object.isFrozen(entity), true);
    assert.equal(Object.isFrozen(entity.position), true);
  }
  assert.throws(() => snapshot.entities.push(snapshot.entities[0]), TypeError);
  assert.throws(() => {
    snapshot.entities[0].position.x = 99;
  }, TypeError);
}

function expectedPhaseTrace(lastTick) {
  return Array.from({ length: lastTick }, (_, index) =>
    PHASES.map((phase) => ({ serverTick: index + 1, phase })),
  ).flat();
}

function createJoinedFixture(t) {
  const messages = [];
  const collisionAdapter = createRapierServerCollisionAdapter(
    trustedFloorAndWallScene(),
  );
  const server = createAuthoritativeServer({
    spawnPosition: { x: 0, y: 1, z: 0 },
    movementSpeedMetersPerSecond: 6,
    collisionAdapter,
  });
  t.after(() => server.shutdown());

  const connection = valueOf(
    server.acceptConnection({ emit: (message) => messages.push(message) }),
  );
  assert.deepEqual(connection.markReady(), { ok: true, value: undefined });
  assert.deepEqual(connection.receive(JOIN), { ok: true, value: undefined });
  const joined = messages[0];
  assert.equal(joined.kind, "joined");
  return { server, connection, collisionAdapter, messages, joined };
}

test("authoritative Server owns identity, movement, snapshots, and cleanup", (t) => {
  const firstMessages = [];
  const secondMessages = [];
  const mutableSpawn = { x: 0, y: 1, z: 0 };
  const collisionAdapter = createRapierServerCollisionAdapter(
    trustedFloorAndWallScene(),
  );
  const server = createAuthoritativeServer({
    spawnPosition: mutableSpawn,
    movementSpeedMetersPerSecond: 6,
    collisionAdapter,
  });
  t.after(() => server.shutdown());
  mutableSpawn.x = 999;

  const first = valueOf(
    server.acceptConnection({ emit: (message) => firstMessages.push(message) }),
  );
  const second = valueOf(
    server.acceptConnection({ emit: (message) => secondMessages.push(message) }),
  );
  assert.deepEqual(first.inspect().phaseTrace, ["connected"]);
  assert.deepEqual(second.inspect().phaseTrace, ["connected"]);
  assert.deepEqual(first.markReady(), { ok: true, value: undefined });
  assert.deepEqual(second.markReady(), { ok: true, value: undefined });
  assert.deepEqual(first.receive(JOIN), { ok: true, value: undefined });
  assert.deepEqual(second.receive(JOIN), { ok: true, value: undefined });

  assert.deepEqual(Object.keys(JOIN), ["protocolVersion", "kind"]);
  for (const clientOwnedName of [
    "connectionId",
    "playerId",
    "ownedEntityId",
    "position",
  ]) {
    assert.equal(clientOwnedName in JOIN, false);
  }
  assert.deepEqual(first.inspect().phaseTrace, [
    "connected",
    "ready",
    "joining",
    "joined",
  ]);
  assert.deepEqual(second.inspect().phaseTrace, [
    "connected",
    "ready",
    "joining",
    "joined",
  ]);
  assert.equal(firstMessages.length, 1);
  assert.equal(secondMessages.length, 1);

  const firstJoined = firstMessages[0];
  const secondJoined = secondMessages[0];
  assert.equal(firstJoined.kind, "joined");
  assert.equal(secondJoined.kind, "joined");
  assert.equal(firstJoined.serverTick, 0);
  assert.equal(secondJoined.serverTick, 0);
  assert.equal(Object.isFrozen(firstJoined), true);
  assert.equal(Object.isFrozen(secondJoined), true);
  const productionIds = [
    firstJoined.connectionId,
    firstJoined.playerId,
    firstJoined.ownedEntityId,
    secondJoined.connectionId,
    secondJoined.playerId,
    secondJoined.ownedEntityId,
  ];
  assert.equal(new Set(productionIds).size, 6);
  for (const id of productionIds) assert.match(id, /^[A-Za-z0-9_-]{22}$/);

  const joinedInspection = server.inspect();
  const firstJoinedInspection = first.inspect();
  const joinedCapsules = collisionAdapter.inspect();
  assert.deepEqual(joinedInspection.liveResourceCounts, {
    connections: 2,
    bindings: 2,
    avatars: 2,
    capsules: 2,
    pendingCommands: 0,
    scheduledCommands: 0,
  });
  assert.deepEqual(
    joinedInspection.avatars.map(({ entityId }) => entityId),
    [firstJoined.ownedEntityId, secondJoined.ownedEntityId],
  );
  assert.deepEqual(
    joinedCapsules.avatars.map(({ avatarId }) => avatarId),
    [firstJoined.ownedEntityId, secondJoined.ownedEntityId],
  );
  assert.deepEqual(firstJoinedInspection.position, { x: 0, y: 1, z: 0 });
  assert.notEqual(server.inspect(), joinedInspection);
  assert.notEqual(server.inspect().connections, joinedInspection.connections);
  assert.notEqual(server.inspect().avatars, joinedInspection.avatars);
  assert.notEqual(collisionAdapter.inspect(), joinedCapsules);
  assert.notEqual(collisionAdapter.inspect().avatars, joinedCapsules.avatars);

  const emissionsAtZero = [firstMessages.length, secondMessages.length];
  assert.deepEqual(server.stepExact(0), { ok: true, value: 0 });
  assert.deepEqual(server.inspect().phaseTrace, []);
  assert.deepEqual(
    [firstMessages.length, secondMessages.length],
    emissionsAtZero,
  );
  assert.throws(() => server.stepExact(-1), /non-negative integer/);
  assert.throws(() => server.stepExact(1.5), /non-negative integer/);

  const firstMove = Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    kind: "command",
    sequence: 1,
    intendedTick: 1,
    action: Object.freeze({ kind: "move", x: 1, z: 0 }),
  });
  assert.equal("position" in firstMove, false);
  assert.equal("position" in firstMove.action, false);
  assert.deepEqual(first.receive(firstMove), { ok: true, value: undefined });
  assert.equal(first.inspect().pendingCommandCount, 1);
  assert.deepEqual(server.stepExact(), { ok: true, value: 1 });

  const afterFirstCollision = first.inspect().position;
  assertFinitePosition(afterFirstCollision);
  assert.notDeepEqual(afterFirstCollision, firstJoinedInspection.position);
  assert.ok(afterFirstCollision.x > 0);
  assert.ok(afterFirstCollision.x < 0.1);
  assert.equal(first.inspect().acceptedSequence, 1);
  assert.equal(first.inspect().acknowledgedSequence, 1);
  assert.equal(second.inspect().acknowledgedSequence, null);
  assert.equal(messagesOfKind(firstMessages, "snapshot").length, 0);
  assert.equal(messagesOfKind(secondMessages, "snapshot").length, 0);
  assert.deepEqual(
    collisionAdapter
      .inspect()
      .avatars.find(({ avatarId }) => avatarId === firstJoined.ownedEntityId)
      .position,
    afterFirstCollision,
  );

  const futureSecond = {
    protocolVersion: PROTOCOL_VERSION,
    kind: "command",
    sequence: 2,
    intendedTick: 3,
    action: { kind: "move", x: 1, z: 0 },
  };
  const dueThird = {
    protocolVersion: PROTOCOL_VERSION,
    kind: "command",
    sequence: 3,
    intendedTick: 2,
    action: { kind: "move", x: 0, z: 1 },
  };
  assert.deepEqual(first.receive(futureSecond), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(first.receive(dueThird), { ok: true, value: undefined });
  assert.deepEqual(server.stepExact(), { ok: true, value: 2 });
  assert.equal(first.inspect().acceptedSequence, 3);
  assert.equal(first.inspect().acknowledgedSequence, 1);
  assert.equal(first.inspect().pendingCommandCount, 1);
  assert.equal(first.inspect().scheduledCommandCount, 1);

  assert.deepEqual(server.stepExact(), { ok: true, value: 3 });
  assert.equal(first.inspect().acknowledgedSequence, 3);
  assert.equal(first.inspect().pendingCommandCount, 0);
  assert.equal(first.inspect().scheduledCommandCount, 0);
  const firstTickThree = messagesOfKind(firstMessages, "snapshot")[0];
  const secondTickThree = messagesOfKind(secondMessages, "snapshot")[0];
  assert.equal(firstTickThree.serverTick, 3);
  assert.equal(secondTickThree.serverTick, 3);
  assert.equal(firstTickThree.acknowledgedSequence, 3);
  assert.equal(secondTickThree.acknowledgedSequence, null);
  assert.notEqual(firstTickThree, secondTickThree);
  assert.deepEqual(
    firstTickThree.entities.map(({ entityId }) => entityId),
    [firstJoined.ownedEntityId, secondJoined.ownedEntityId],
  );
  assert.deepEqual(
    secondTickThree.entities.map(({ entityId }) => entityId),
    [firstJoined.ownedEntityId, secondJoined.ownedEntityId],
  );
  const firstPeer = firstTickThree.entities.find(
    ({ entityId }) => entityId === secondJoined.ownedEntityId,
  );
  const secondPeer = secondTickThree.entities.find(
    ({ entityId }) => entityId === firstJoined.ownedEntityId,
  );
  assert.deepEqual(firstPeer.position, second.inspect().position);
  assert.deepEqual(secondPeer.position, first.inspect().position);
  assert.notEqual(firstPeer.position, second.inspect().position);
  assert.notEqual(secondPeer.position, first.inspect().position);
  assertSnapshotFrozen(firstTickThree);
  assertSnapshotFrozen(secondTickThree);

  assert.deepEqual(server.stepExact(3), { ok: true, value: 6 });
  const firstSnapshots = messagesOfKind(firstMessages, "snapshot");
  const secondSnapshots = messagesOfKind(secondMessages, "snapshot");
  assert.deepEqual(
    firstSnapshots.map(({ serverTick }) => serverTick),
    [3, 6],
  );
  assert.deepEqual(
    secondSnapshots.map(({ serverTick }) => serverTick),
    [3, 6],
  );
  assert.deepEqual(
    firstSnapshots.map(({ acknowledgedSequence }) => acknowledgedSequence),
    [3, 3],
  );
  assert.deepEqual(
    secondSnapshots.map(({ acknowledgedSequence }) => acknowledgedSequence),
    [null, null],
  );
  for (const snapshot of [...firstSnapshots, ...secondSnapshots]) {
    assert.equal(snapshot.entities.length, 2);
    for (const entity of snapshot.entities) assertFinitePosition(entity.position);
    assertSnapshotFrozen(snapshot);
  }
  assert.deepEqual(server.inspect().phaseTrace, expectedPhaseTrace(6));
  assert.equal(server.inspect().currentPhase, null);
  assertFinitePosition(first.inspect().position);
  assertFinitePosition(second.inspect().position);
  assert.deepEqual(server.stepExact(Number.MAX_SAFE_INTEGER), {
    ok: false,
    failure: { code: "tick-exhausted" },
  });
  assert.equal(server.serverTick, 6);

  const detachedServerInspection = server.inspect();
  const detachedFirstInspection = first.inspect();
  const detachedCapsules = collisionAdapter.inspect();
  const firstShutdown = server.shutdown();
  const secondShutdown = server.shutdown();
  assert.equal(firstShutdown, secondShutdown);
  assert.deepEqual(firstShutdown, { ok: true, value: undefined });
  assert.equal(server.shutdownStarted, true);
  assert.equal(collisionAdapter.disposed, true);
  assert.deepEqual(server.inspect().liveResourceCounts, {
    connections: 0,
    bindings: 0,
    avatars: 0,
    capsules: 0,
    pendingCommands: 0,
    scheduledCommands: 0,
  });
  assert.deepEqual(server.inspect().connections, []);
  assert.deepEqual(server.inspect().avatars, []);
  assert.equal(detachedServerInspection.liveResourceCounts.connections, 2);
  assert.equal(detachedServerInspection.avatars.length, 2);
  assert.equal(detachedFirstInspection.connectionId, firstJoined.connectionId);
  assert.equal(detachedCapsules.avatarCount, 2);
  assert.deepEqual(first.inspect().phaseTrace, [
    "connected",
    "ready",
    "joining",
    "joined",
    "disconnecting",
    "closed",
  ]);
  assert.equal(first.inspect().connectionId, null);
  assert.equal(first.inspect().playerId, null);
  assert.equal(first.inspect().ownedEntityId, null);
  assert.deepEqual(first.disconnect(), { ok: true, value: undefined });
  assert.deepEqual(server.stepExact(), {
    ok: false,
    failure: { code: "server-shutdown" },
  });
  assert.deepEqual(server.acceptConnection({ emit() {} }), {
    ok: false,
    failure: { code: "server-shutdown" },
  });
});

test("scheduled forced positions apply during gameplay before snapshots", (t) => {
  const { server, connection, collisionAdapter, messages, joined } =
    createJoinedFixture(t);
  const forcedPosition = { x: 0.75, y: 1.01, z: 0 };
  const expectedPosition = { ...forcedPosition };

  assert.deepEqual(server.stepExact(60), { ok: true, value: 60 });
  assert.equal(server.serverTick, 60);
  assert.deepEqual(
    server.scheduleForcedPosition(joined.ownedEntityId, 61, forcedPosition),
    { ok: true, value: undefined },
  );
  forcedPosition.x = 99;
  assert.deepEqual(server.stepExact(3), { ok: true, value: 63 });
  assert.equal(server.serverTick, 63);

  const inspection = server.inspect();
  const avatar = inspection.avatars.find(
    ({ entityId }) => entityId === joined.ownedEntityId,
  );
  assert.deepEqual(avatar.position, expectedPosition);
  assert.deepEqual(connection.inspect().position, expectedPosition);
  assert.deepEqual(
    collisionAdapter
      .inspect()
      .avatars.find(
        ({ avatarId }) => avatarId === joined.ownedEntityId,
      ).position,
    expectedPosition,
  );
  const tick61Phases = inspection.phaseTrace
    .filter(({ serverTick }) => serverTick === 61)
    .map(({ phase }) => phase);
  assert.ok(
    tick61Phases.indexOf("gameplay") <
      tick61Phases.indexOf("snapshot-build"),
  );

  const snapshot = messagesOfKind(messages, "snapshot").find(
    ({ serverTick }) => serverTick === 63,
  );
  assert.ok(snapshot);
  const snappedAvatar = snapshot.entities.find(
    ({ entityId }) => entityId === joined.ownedEntityId,
  );
  assert.ok(snappedAvatar);
  assert.deepEqual(snappedAvatar.position, expectedPosition);

  const fixtures = inspection.forcedPositionFixtures;
  assert.equal(fixtures.scheduledCount, 1);
  assert.equal(fixtures.consumedCount, 1);
  const lastConsumed = fixtures.lastConsumed;
  assert.ok(lastConsumed);
  assert.deepEqual(lastConsumed, {
    entityId: joined.ownedEntityId,
    serverTick: 61,
    position: expectedPosition,
  });
  assert.equal(Object.isFrozen(lastConsumed), true);
  assert.equal(Object.isFrozen(lastConsumed.position), true);
  const detachedLastConsumed = server.inspect().forcedPositionFixtures.lastConsumed;
  assert.ok(detachedLastConsumed);
  assert.notEqual(lastConsumed, detachedLastConsumed);
  assert.notEqual(lastConsumed.position, detachedLastConsumed.position);
  assert.deepEqual(connection.inspect().position, expectedPosition);
  assert.equal(server.inspect().forcedPositionFixtures.consumedCount, 1);
});

test("scheduleForcedPosition rejects malformed and invalid schedules", (t) => {
  const { server, joined } = createJoinedFixture(t);
  const position = { x: 0, y: 1, z: 0 };

  assert.throws(
    () => server.scheduleForcedPosition(1, 1, position),
    /entity ID must be a string/,
  );
  assert.deepEqual(server.scheduleForcedPosition("", 1, position), {
    ok: false,
    failure: { code: "invalid-state" },
  });
  for (const malformed of [
    null,
    { x: 0, y: 1 },
    { x: 0, y: 1, z: 0, extra: true },
  ]) {
    assert.throws(
      () => server.scheduleForcedPosition(joined.ownedEntityId, 1, malformed),
      /Forced position/,
    );
  }
  assert.throws(
    () =>
      server.scheduleForcedPosition(joined.ownedEntityId, 1, {
        x: Number.POSITIVE_INFINITY,
        y: 1,
        z: 0,
      }),
    /bounded finite coordinates/,
  );
  assert.throws(
    () =>
      server.scheduleForcedPosition(joined.ownedEntityId, 1, {
        x: Number.MAX_VALUE,
        y: 1,
        z: 0,
      }),
    /bounded finite coordinates/,
  );
  for (const invalidTick of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () =>
        server.scheduleForcedPosition(
          joined.ownedEntityId,
          invalidTick,
          position,
        ),
      /bounded safe integer/,
    );
  }
  assert.deepEqual(server.scheduleForcedPosition(joined.ownedEntityId, 0, position), {
    ok: false,
    failure: { code: "invalid-state" },
  });
  assert.deepEqual(server.scheduleForcedPosition("unknown-entity", 1, position), {
    ok: false,
    failure: { code: "invalid-state" },
  });
  assert.deepEqual(server.scheduleForcedPosition(joined.ownedEntityId, 1, position), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(server.scheduleForcedPosition(joined.ownedEntityId, 1, position), {
    ok: false,
    failure: { code: "invalid-state" },
  });
});

test("disconnect purges scheduled forced positions before consumption", (t) => {
  const { server, connection, joined } = createJoinedFixture(t);
  assert.deepEqual(
    server.scheduleForcedPosition(joined.ownedEntityId, 2, { x: 1, y: 1, z: 0 }),
    { ok: true, value: undefined },
  );
  assert.equal(server.inspect().forcedPositionFixtures.scheduledCount, 1);
  assert.deepEqual(connection.disconnect(), { ok: true, value: undefined });
  assert.deepEqual(server.stepExact(2), { ok: true, value: 2 });
  const fixtures = server.inspect().forcedPositionFixtures;
  assert.equal(fixtures.scheduledCount, 1);
  assert.equal(fixtures.consumedCount, 0);
  assert.equal(fixtures.lastConsumed, null);
});

test("shutdown clears forced position schedules and remains idempotent", (t) => {
  const { server, joined } = createJoinedFixture(t);
  assert.deepEqual(
    server.scheduleForcedPosition(joined.ownedEntityId, 1, { x: 1, y: 1, z: 0 }),
    { ok: true, value: undefined },
  );
  const firstShutdown = server.shutdown();
  const secondShutdown = server.shutdown();
  assert.equal(firstShutdown, secondShutdown);
  assert.deepEqual(firstShutdown, { ok: true, value: undefined });
  assert.deepEqual(server.inspect().forcedPositionFixtures, {
    pendingCount: 0,
    scheduledCount: 1,
    consumedCount: 0,
    lastConsumed: null,
  });
  assert.deepEqual(
    server.scheduleForcedPosition(joined.ownedEntityId, 1, { x: 1, y: 1, z: 0 }),
    { ok: false, failure: { code: "server-shutdown" } },
  );
});
