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

const REJECTION_REASONS = Object.freeze([
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
]);

const JOIN = Object.freeze({
  protocolVersion: PROTOCOL_VERSION,
  kind: "join",
});

function trustedFloorScene() {
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
    ],
  };
}

function valueOf(outcome) {
  assert.equal(outcome.ok, true);
  return outcome.value;
}

function command(
  sequence,
  intendedTick,
  action = { kind: "move", x: 1, z: 0 },
) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "command",
    sequence,
    intendedTick,
    action,
  };
}

function createHarness(t, movementSpeedMetersPerSecond = 6) {
  const realCollisionAdapter = createRapierServerCollisionAdapter(
    trustedFloorScene(),
  );
  const collisionCalls = { moveAvatar: 0 };
  const collisionAdapter = Object.freeze({
    get disposed() {
      return realCollisionAdapter.disposed;
    },
    createAvatar(...args) {
      return realCollisionAdapter.createAvatar(...args);
    },
    removeAvatar(...args) {
      return realCollisionAdapter.removeAvatar(...args);
    },
    moveAvatar(...args) {
      collisionCalls.moveAvatar += 1;
      return realCollisionAdapter.moveAvatar(...args);
    },
    inspect() {
      return realCollisionAdapter.inspect();
    },
    dispose() {
      realCollisionAdapter.dispose();
    },
  });
  const server = createAuthoritativeServer({
    spawnPosition: { x: 0, y: 1, z: 0 },
    movementSpeedMetersPerSecond,
    collisionAdapter,
  });
  t.after(() => server.shutdown());
  return { server, collisionAdapter, collisionCalls };
}

function acceptConnection(server, messages) {
  return valueOf(
    server.acceptConnection({ emit: (message) => messages.push(message) }),
  );
}

function joinConnection(server, messages) {
  const connection = acceptConnection(server, messages);
  assert.deepEqual(connection.markReady(), { ok: true, value: undefined });
  assert.deepEqual(connection.receive(JOIN), { ok: true, value: undefined });
  const joined = messages.findLast((message) => message.kind === "joined");
  assert.ok(joined !== undefined);
  return { connection, joined };
}

function authorityDigest(server, collisionAdapter) {
  const inspection = server.inspect();
  return {
    shutdown: inspection.shutdown,
    connections: inspection.connections.map((connection) => ({
      phase: connection.phase,
      connectionId: connection.connectionId,
      playerId: connection.playerId,
      ownedEntityId: connection.ownedEntityId,
      position: connection.position,
      pendingCommandCount: connection.pendingCommandCount,
      scheduledCommandCount: connection.scheduledCommandCount,
      acceptedSequence: connection.acceptedSequence,
      acknowledgedSequence: connection.acknowledgedSequence,
    })),
    avatars: inspection.avatars,
    liveResourceCounts: inspection.liveResourceCounts,
    collision: collisionAdapter.inspect(),
  };
}

function rejectionCounts(server, connection) {
  return {
    server: server.inspect().rejectedCommandCounts,
    connection: connection.inspect().rejectedCommandCounts,
  };
}

function assertOnlyCounterDelta(before, after, expectedReason, delta = 1) {
  for (const reason of REJECTION_REASONS) {
    const expectedDelta = reason === expectedReason ? delta : 0;
    assert.equal(
      after[reason] - before[reason],
      expectedDelta,
      `${reason} counter delta`,
    );
  }
}

function assertRejectionCountDelta(
  before,
  after,
  expectedReason,
  delta = 1,
) {
  assertOnlyCounterDelta(
    before.server,
    after.server,
    expectedReason,
    delta,
  );
  assertOnlyCounterDelta(
    before.connection,
    after.connection,
    expectedReason,
    delta,
  );
}

function rejectedMessages(messages) {
  return messages.filter((message) => message.kind === "rejected");
}

function assertImmediateRejection({
  server,
  collisionAdapter,
  connection,
  messages,
  operation,
  reason,
  sequence,
}) {
  const beforeDigest = authorityDigest(server, collisionAdapter);
  const beforeCounts = rejectionCounts(server, connection);
  const beforeWireCount = rejectedMessages(messages).length;

  assert.deepEqual(operation(), { ok: false, failure: { code: reason } });

  assert.deepEqual(rejectedMessages(messages).at(-1), {
    protocolVersion: PROTOCOL_VERSION,
    kind: "rejected",
    sequence,
    reason,
  });
  assert.equal(rejectedMessages(messages).length, beforeWireCount + 1);
  assertRejectionCountDelta(
    beforeCounts,
    rejectionCounts(server, connection),
    reason,
  );
  assert.deepEqual(authorityDigest(server, collisionAdapter), beforeDigest);
}

function assertQueuedRejection({
  server,
  collisionAdapter,
  connection,
  messages,
  message,
  reason,
}) {
  const beforeDigest = authorityDigest(server, collisionAdapter);
  const beforeCounts = rejectionCounts(server, connection);
  const beforeWireCount = rejectedMessages(messages).length;
  const beforeTick = server.serverTick;

  assert.deepEqual(connection.receive(message), {
    ok: true,
    value: undefined,
  });
  assert.equal(valueOf(server.stepExact()), beforeTick + 1);

  assert.deepEqual(rejectedMessages(messages).at(-1), {
    protocolVersion: PROTOCOL_VERSION,
    kind: "rejected",
    sequence: message.sequence,
    reason,
  });
  assert.equal(rejectedMessages(messages).length, beforeWireCount + 1);
  assertRejectionCountDelta(
    beforeCounts,
    rejectionCounts(server, connection),
    reason,
  );
  assert.deepEqual(authorityDigest(server, collisionAdapter), beforeDigest);
}

test("decoded phase admission rejects commands before join and a second join", (t) => {
  const { server, collisionAdapter } = createHarness(t);
  const messages = [];
  const connection = acceptConnection(server, messages);

  assertImmediateRejection({
    server,
    collisionAdapter,
    connection,
    messages,
    operation: () => connection.receive(command(1, 0)),
    reason: "phase-invalid",
    sequence: 1,
  });

  assert.deepEqual(connection.markReady(), { ok: true, value: undefined });
  assert.deepEqual(connection.receive(JOIN), { ok: true, value: undefined });
  assert.equal(connection.phase, "joined");

  assertImmediateRejection({
    server,
    collisionAdapter,
    connection,
    messages,
    operation: () => connection.receive(JOIN),
    reason: "phase-invalid",
    sequence: null,
  });
  assert.equal(connection.inspect().acceptedSequence, null);
  assert.equal(connection.inspect().rejectedCommandCounts["phase-invalid"], 2);
});

test("sequence admission starts at one and advances only by exact next", (t) => {
  const { server, collisionAdapter } = createHarness(t);
  const messages = [];
  const { connection } = joinConnection(server, messages);

  assertQueuedRejection({
    server,
    collisionAdapter,
    connection,
    messages,
    message: command(2, 1),
    reason: "sequence-invalid",
  });
  assert.equal(connection.inspect().acceptedSequence, null);

  assert.deepEqual(connection.receive(command(1, 2)), {
    ok: true,
    value: undefined,
  });
  assert.equal(valueOf(server.stepExact()), 2);
  assert.equal(connection.inspect().acceptedSequence, 1);

  assertQueuedRejection({
    server,
    collisionAdapter,
    connection,
    messages,
    message: command(1, 3),
    reason: "sequence-invalid",
  });
  assertQueuedRejection({
    server,
    collisionAdapter,
    connection,
    messages,
    message: command(3, 4),
    reason: "sequence-invalid",
  });

  assert.deepEqual(connection.receive(command(2, 5)), {
    ok: true,
    value: undefined,
  });
  assert.equal(valueOf(server.stepExact()), 5);
  assert.equal(connection.inspect().acceptedSequence, 2);

  assertQueuedRejection({
    server,
    collisionAdapter,
    connection,
    messages,
    message: command(1, 6),
    reason: "sequence-invalid",
  });
  assert.equal(connection.inspect().acceptedSequence, 2);
  assert.equal(
    connection.inspect().rejectedCommandCounts["sequence-invalid"],
    4,
  );
});

test("tick admission uses the exact validation-tick window at tick 100", (t) => {
  for (const { intendedTick, accepted } of [
    { intendedTick: 94, accepted: true },
    { intendedTick: 102, accepted: true },
    { intendedTick: 93, accepted: false },
    { intendedTick: 103, accepted: false },
  ]) {
    const { server, collisionAdapter } = createHarness(t);
    const messages = [];
    const { connection } = joinConnection(server, messages);
    assert.equal(valueOf(server.stepExact(99)), 99);
    const candidate = command(1, intendedTick, {
      kind: "move",
      x: 0,
      z: 0,
    });

    if (!accepted) {
      assertQueuedRejection({
        server,
        collisionAdapter,
        connection,
        messages,
        message: candidate,
        reason: "tick-out-of-window",
      });
      continue;
    }

    assert.deepEqual(connection.receive(candidate), {
      ok: true,
      value: undefined,
    });
    assert.equal(valueOf(server.stepExact()), 100);
    assert.equal(connection.inspect().acceptedSequence, 1);
    assert.equal(
      connection.inspect().scheduledCommandCount,
      intendedTick === 102 ? 1 : 0,
    );
    assert.equal(
      connection.inspect().acknowledgedSequence,
      intendedTick === 102 ? null : 1,
    );
  }
});

test("unavailable interaction and authoritative movement limits reject without mutation", (t) => {
  {
    const { server, collisionAdapter } = createHarness(t);
    const messages = [];
    const { connection } = joinConnection(server, messages);
    assertQueuedRejection({
      server,
      collisionAdapter,
      connection,
      messages,
      message: command(1, 1, {
        kind: "interact",
        targetEntityId: "valid-target",
      }),
      reason: "phase-invalid",
    });
    assert.equal(connection.inspect().acceptedSequence, null);
  }

  {
    const { server, collisionAdapter, collisionCalls } = createHarness(
      t,
      10.000001,
    );
    const messages = [];
    const { connection } = joinConnection(server, messages);
    const positionBefore = connection.inspect().position;
    assertQueuedRejection({
      server,
      collisionAdapter,
      connection,
      messages,
      message: command(1, 1, { kind: "move", x: 1, z: 0 }),
      reason: "movement-limit",
    });
    assert.equal(connection.inspect().acceptedSequence, null);
    assert.equal(connection.inspect().scheduledCommandCount, 0);
    assert.deepEqual(connection.inspect().position, positionBefore);
    assert.equal(collisionCalls.moveAvatar, 0);
  }

  {
    const { server, collisionAdapter, collisionCalls } = createHarness(t);
    const messages = [];
    const { connection } = joinConnection(server, messages);
    assert.deepEqual(connection.receive(command(1, 1)), {
      ok: true,
      value: undefined,
    });
    assert.equal(valueOf(server.stepExact()), 1);
    assert.equal(connection.inspect().acceptedSequence, 1);
    assert.equal(collisionCalls.moveAvatar, 1);

    assertQueuedRejection({
      server,
      collisionAdapter,
      connection,
      messages,
      message: command(2, 1, { kind: "move", x: 0, z: 1 }),
      reason: "movement-limit",
    });
    assert.equal(connection.inspect().acceptedSequence, 1);
    assert.equal(collisionCalls.moveAvatar, 1);
  }
});

test("the bounded queue purges atomically on disconnect and preserves its peer", (t) => {
  const { server, collisionAdapter, collisionCalls } = createHarness(t);
  const victimMessages = [];
  const peerMessages = [];
  const { connection: victim } = joinConnection(server, victimMessages);
  const { connection: peer, joined: peerJoined } = joinConnection(
    server,
    peerMessages,
  );

  for (let sequence = 1; sequence <= 128; sequence += 1) {
    assert.deepEqual(victim.receive(command(sequence, 1)), {
      ok: true,
      value: undefined,
    });
  }
  assert.equal(victim.inspect().pendingCommandCount, 128);
  assert.equal(server.inspect().liveResourceCounts.pendingCommands, 128);

  assertImmediateRejection({
    server,
    collisionAdapter,
    connection: victim,
    messages: victimMessages,
    operation: () => victim.receive(command(129, 1)),
    reason: "queue-full",
    sequence: 129,
  });

  const beforeDisconnectCounts = rejectionCounts(server, victim);
  const victimWireCount = victimMessages.length;
  assert.deepEqual(victim.disconnect(), { ok: true, value: undefined });
  assert.equal(victimMessages.length, victimWireCount);
  assertRejectionCountDelta(
    beforeDisconnectCounts,
    rejectionCounts(server, victim),
    "stale-connection",
    128,
  );

  assert.deepEqual(victim.inspect(), {
    phase: "closed",
    phaseTrace: [
      "connected",
      "ready",
      "joining",
      "joined",
      "disconnecting",
      "closed",
    ],
    connectionId: null,
    playerId: null,
    ownedEntityId: null,
    position: null,
    pendingCommandCount: 0,
    scheduledCommandCount: 0,
    acceptedSequence: null,
    acknowledgedSequence: null,
    rejectedCommandCounts: {
      ...Object.fromEntries(REJECTION_REASONS.map((reason) => [reason, 0])),
      "queue-full": 1,
      "stale-connection": 128,
    },
  });
  assert.deepEqual(server.inspect().liveResourceCounts, {
    connections: 1,
    bindings: 1,
    avatars: 1,
    capsules: 1,
    pendingCommands: 0,
    scheduledCommands: 0,
  });
  assert.deepEqual(
    collisionAdapter.inspect().avatars.map(({ avatarId }) => avatarId),
    [peerJoined.ownedEntityId],
  );
  assert.equal(peer.phase, "joined");

  const peerPositionBefore = peer.inspect().position;
  assert.deepEqual(peer.receive(command(1, 1)), {
    ok: true,
    value: undefined,
  });
  assert.equal(valueOf(server.stepExact(3)), 3);
  assert.equal(peer.inspect().acceptedSequence, 1);
  assert.equal(peer.inspect().acknowledgedSequence, 1);
  assert.notDeepEqual(peer.inspect().position, peerPositionBefore);
  assert.equal(collisionCalls.moveAvatar, 1);

  const peerSnapshot = peerMessages.findLast(
    (message) => message.kind === "snapshot",
  );
  assert.ok(peerSnapshot !== undefined);
  assert.equal(peerSnapshot.serverTick, 3);
  assert.equal(peerSnapshot.acknowledgedSequence, 1);
  assert.deepEqual(
    peerSnapshot.entities.map(({ entityId }) => entityId),
    [peerJoined.ownedEntityId],
  );
  assert.equal(victimMessages.length, victimWireCount);
});

test("phase trace retains exactly the newest 4096 entries", (t) => {
  const { server } = createHarness(t);
  assert.equal(valueOf(server.stepExact(513)), 513);

  const trace = server.inspect().phaseTrace;
  const expected = Array.from({ length: 512 }, (_, tickOffset) =>
    PHASES.map((phase) => ({
      serverTick: tickOffset + 2,
      phase,
    })),
  ).flat();
  assert.equal(trace.length, 4096);
  assert.deepEqual(trace, expected);
  assert.deepEqual(trace[0], { serverTick: 2, phase: "ingress" });
  assert.deepEqual(trace.at(-1), { serverTick: 513, phase: "telemetry" });
});
