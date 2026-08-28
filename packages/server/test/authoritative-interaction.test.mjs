import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_SNAPSHOT_ENTITIES,
  PROTOCOL_VERSION,
} from "@three-game-kit/protocol";
import { createAuthoritativeServer } from "@three-game-kit/server/authoritative";

const JOIN = Object.freeze({
  protocolVersion: PROTOCOL_VERSION,
  kind: "join",
});

function valueOf(outcome) {
  assert.equal(outcome.ok, true);
  return outcome.value;
}

function interactionCommand(sequence, intendedTick, targetEntityId) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "command",
    sequence,
    intendedTick,
    action: { kind: "interact", targetEntityId },
  };
}

function createCollisionAdapter() {
  const avatars = new Map();
  let disposed = false;
  let moveCallCount = 0;
  let disposeCallCount = 0;
  const succeeded = Object.freeze({ ok: true, value: undefined });
  return {
    get disposed() {
      return disposed;
    },
    get moveCallCount() {
      return moveCallCount;
    },
    get disposeCallCount() {
      return disposeCallCount;
    },
    createAvatar(avatarId, position) {
      avatars.set(avatarId, { ...position });
      return succeeded;
    },
    removeAvatar(avatarId) {
      avatars.delete(avatarId);
      return succeeded;
    },
    setAvatarPosition(avatarId, position) {
      avatars.set(avatarId, { ...position });
      return succeeded;
    },
    moveAvatar() {
      moveCallCount += 1;
      throw new Error("interaction commands must not reach collision");
    },
    inspect() {
      return {
        disposed,
        avatarCount: avatars.size,
        avatars: Array.from(avatars, ([avatarId, position]) => ({
          avatarId,
          position: { ...position },
        })),
      };
    },
    dispose() {
      disposeCallCount += 1;
      disposed = true;
      avatars.clear();
    },
  };
}

function createHarness(t, interactionAdapter, options = {}) {
  const collisionAdapter = createCollisionAdapter();
  const server = createAuthoritativeServer({
    spawnPosition: options.spawnPosition ?? { x: 0, y: 1, z: 0 },
    spawnPositionsByConnectionOrdinal:
      options.spawnPositionsByConnectionOrdinal,
    movementSpeedMetersPerSecond: 6,
    collisionAdapter,
    ...(interactionAdapter === undefined ? {} : { interactionAdapter }),
  });
  t.after(() => server.shutdown());
  return { server, collisionAdapter };
}

function join(server) {
  const messages = [];
  const connection = valueOf(
    server.acceptConnection({ emit: (message) => messages.push(message) }),
  );
  assert.deepEqual(connection.markReady(), { ok: true, value: undefined });
  assert.deepEqual(connection.receive(JOIN), { ok: true, value: undefined });
  const joined = messages.findLast((message) => message.kind === "joined");
  assert.ok(joined !== undefined);
  return { connection, joined, messages };
}

function rejected(messages) {
  return messages.filter((message) => message.kind === "rejected");
}

function snapshots(messages) {
  return messages.filter((message) => message.kind === "snapshot");
}

function invariantErrors(server, operation) {
  return server
    .inspect()
    .structuredRuntimeErrors.filter(
      (record) =>
        record.category === "invariant" && record.operation === operation,
    );
}

function assertFrozenInteractionInput(input) {
  assert.equal(Object.isFrozen(input), true);
  assert.equal(Object.isFrozen(input.actorPosition), true);
  assert.deepEqual(Reflect.ownKeys(input).sort(), [
    "actorEntityId",
    "actorPosition",
    "serverTick",
    "targetEntityId",
  ]);
  assert.deepEqual(Reflect.ownKeys(input.actorPosition).sort(), ["x", "y", "z"]);
  assert.throws(() => {
    input.actorPosition.x = 99;
  }, TypeError);
}

function interactable(entityId, position = { x: 4, y: 1, z: 0 }) {
  return {
    entityKind: "interactable",
    entityId,
    position,
    active: true,
  };
}

test("no interaction adapter retains phase-invalid behavior", (t) => {
  const { server } = createHarness(t);
  const { connection, messages } = join(server);

  assert.deepEqual(
    connection.receive(interactionCommand(1, 1, "target")),
    { ok: true, value: undefined },
  );
  assert.equal(valueOf(server.stepExact()), 1);
  assert.deepEqual(rejected(messages).at(-1), {
    protocolVersion: PROTOCOL_VERSION,
    kind: "rejected",
    sequence: 1,
    reason: "phase-invalid",
  });
  assert.equal(connection.inspect().acceptedSequence, null);
  assert.equal(connection.inspect().acknowledgedSequence, null);
  assert.equal(server.inspect().interaction.active, false);
});

test("two joined connections validate and apply interactions deterministically", (t) => {
  const validations = [];
  const applications = [];
  let server;
  const suppliedPosition = { x: 8, y: 1, z: 2 };
  const suppliedEntity = interactable("lever", suppliedPosition);
  const suppliedSnapshot = [suppliedEntity];
  const interactionAdapter = {
    validate(input) {
      assert.equal(server.inspect().currentPhase, "validate-bind");
      assertFrozenInteractionInput(input);
      const connection = server
        .inspect()
        .connections.find(
          (candidate) => candidate.ownedEntityId === input.actorEntityId,
        );
      assert.ok(connection !== undefined);
      const priorValidationCount = validations.filter(
        (validation) =>
          validation.actorEntityId === input.actorEntityId,
      ).length;
      assert.equal(
        connection.acknowledgedSequence,
        priorValidationCount === 0 ? null : priorValidationCount,
      );
      validations.push(input);
      return "accepted";
    },
    apply(input) {
      assert.equal(server.inspect().currentPhase, "gameplay");
      const connection = server
        .inspect()
        .connections.find(
          (candidate) => candidate.ownedEntityId === input.actorEntityId,
        );
      assert.ok(connection !== undefined);
      const priorApplicationCount = applications.filter(
        (application) =>
          application.actorEntityId === input.actorEntityId,
      ).length;
      assert.equal(
        connection.acknowledgedSequence,
        priorApplicationCount === 0 ? null : priorApplicationCount,
      );
      assert.equal(validations.includes(input), true);
      applications.push(input);
    },
    snapshot() {
      assert.equal(server.inspect().currentPhase, "snapshot-build");
      return suppliedSnapshot;
    },
  };
  const spawnPositions = [
    { x: 1, y: 2, z: 3 },
    { x: -1, y: 4, z: -3 },
  ];
  const harness = createHarness(t, interactionAdapter, {
    spawnPositionsByConnectionOrdinal: spawnPositions,
  });
  server = harness.server;
  const first = join(server);
  const second = join(server);
  spawnPositions[0].x = 999;
  spawnPositions[1].z = 999;

  assert.deepEqual(
    second.connection.receive(interactionCommand(1, 1, "second-1")),
    { ok: true, value: undefined },
  );
  assert.deepEqual(
    first.connection.receive(interactionCommand(1, 1, "first-1")),
    { ok: true, value: undefined },
  );
  assert.equal(valueOf(server.stepExact()), 1);
  assert.deepEqual(
    validations.map(({ actorEntityId, targetEntityId, serverTick }) => ({
      actorEntityId,
      targetEntityId,
      serverTick,
    })),
    [
      {
        actorEntityId: first.joined.ownedEntityId,
        targetEntityId: "first-1",
        serverTick: 1,
      },
      {
        actorEntityId: second.joined.ownedEntityId,
        targetEntityId: "second-1",
        serverTick: 1,
      },
    ],
  );
  assert.deepEqual(
    validations.map(({ actorPosition }) => actorPosition),
    [
      { x: 1, y: 2, z: 3 },
      { x: -1, y: 4, z: -3 },
    ],
  );
  assert.deepEqual(applications, validations);
  assert.equal(first.connection.inspect().acknowledgedSequence, 1);
  assert.equal(second.connection.inspect().acknowledgedSequence, 1);

  assert.deepEqual(
    second.connection.receive(interactionCommand(2, 2, "second-2")),
    { ok: true, value: undefined },
  );
  assert.deepEqual(
    first.connection.receive(interactionCommand(2, 2, "first-2")),
    { ok: true, value: undefined },
  );
  assert.equal(valueOf(server.stepExact(2)), 3);
  assert.deepEqual(
    applications.map(({ actorEntityId, targetEntityId }) => ({
      actorEntityId,
      targetEntityId,
    })),
    [
      { actorEntityId: first.joined.ownedEntityId, targetEntityId: "first-1" },
      { actorEntityId: second.joined.ownedEntityId, targetEntityId: "second-1" },
      { actorEntityId: first.joined.ownedEntityId, targetEntityId: "first-2" },
      { actorEntityId: second.joined.ownedEntityId, targetEntityId: "second-2" },
    ],
  );
  assert.equal(new Set(applications).size, 4);
  assert.equal(first.connection.inspect().acknowledgedSequence, 2);
  assert.equal(second.connection.inspect().acknowledgedSequence, 2);
  assert.equal(server.inspect().sharedMovementCallCount, 0);
  assert.equal(server.inspect().authoritativeCollisionCallCount, 0);
  assert.equal(harness.collisionAdapter.moveCallCount, 0);

  suppliedPosition.x = 999;
  suppliedEntity.active = false;
  suppliedSnapshot.push(interactable("forged"));
  for (const fixture of [first, second]) {
    const snapshot = snapshots(fixture.messages).find(
      (message) => message.serverTick === 3,
    );
    assert.ok(snapshot !== undefined);
    assert.equal(snapshot.acknowledgedSequence, 2);
    assert.deepEqual(
      snapshot.entities.find((entity) => entity.entityKind === "interactable"),
      interactable("lever", { x: 8, y: 1, z: 2 }),
    );
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.entities), true);
    for (const entity of snapshot.entities) {
      assert.equal(Object.isFrozen(entity), true);
      assert.equal(Object.isFrozen(entity.position), true);
    }
  }
});

test("adapter rejection results reject exactly once without admission or apply", (t) => {
  for (const reason of ["unknown-target", "interaction-out-of-range"]) {
    let applyCalls = 0;
    const interactionAdapter = {
      validate() {
        return reason;
      },
      apply() {
        applyCalls += 1;
      },
      snapshot() {
        return [];
      },
    };
    const { server } = createHarness(t, interactionAdapter);
    const { connection, messages } = join(server);
    assert.deepEqual(
      connection.receive(interactionCommand(1, 1, "target")),
      { ok: true, value: undefined },
    );
    assert.equal(valueOf(server.stepExact()), 1);
    assert.deepEqual(rejected(messages), [
      {
        protocolVersion: PROTOCOL_VERSION,
        kind: "rejected",
        sequence: 1,
        reason,
      },
    ]);
    assert.equal(connection.inspect().rejectedCommandCounts[reason], 1);
    assert.equal(server.inspect().rejectedCommandCounts[reason], 1);
    assert.equal(connection.inspect().acceptedSequence, null);
    assert.equal(connection.inspect().acknowledgedSequence, null);
    assert.equal(applyCalls, 0);
    assert.equal(server.inspect().interaction.applyCallCount, 0);
  }
});

test("ownership fixture and duplicate sequence reject before the adapter", (t) => {
  let validationCalls = 0;
  let applyCalls = 0;
  const interactionAdapter = {
    validate() {
      validationCalls += 1;
      return "accepted";
    },
    apply() {
      applyCalls += 1;
    },
    snapshot() {
      return [];
    },
  };
  const { server } = createHarness(t, interactionAdapter);
  const { connection, joined, messages } = join(server);
  assert.deepEqual(
    server.armNextValidationFixture(joined.ownedEntityId, {
      kind: "ownership-violation",
    }),
    { ok: true, value: undefined },
  );
  assert.deepEqual(
    connection.receive(interactionCommand(1, 1, "target")),
    { ok: true, value: undefined },
  );
  assert.equal(valueOf(server.stepExact()), 1);
  assert.equal(rejected(messages).at(-1).reason, "ownership-violation");
  assert.equal(validationCalls, 0);
  assert.equal(applyCalls, 0);

  assert.deepEqual(
    connection.receive(interactionCommand(1, 2, "target")),
    { ok: true, value: undefined },
  );
  assert.equal(valueOf(server.stepExact()), 2);
  assert.equal(validationCalls, 1);
  assert.equal(applyCalls, 1);
  assert.equal(connection.inspect().acceptedSequence, 1);

  assert.deepEqual(
    connection.receive(interactionCommand(1, 3, "target")),
    { ok: true, value: undefined },
  );
  assert.equal(valueOf(server.stepExact()), 3);
  assert.equal(rejected(messages).at(-1).reason, "sequence-invalid");
  assert.equal(validationCalls, 1);
  assert.equal(applyCalls, 1);
});

test("validation throws and invalid results become phase-invalid invariants", (t) => {
  for (const validate of [
    () => {
      throw new Error("validation failure");
    },
    () => "not-a-public-result",
  ]) {
    let applyCalls = 0;
    const { server } = createHarness(t, {
      validate,
      apply() {
        applyCalls += 1;
      },
      snapshot() {
        return [];
      },
    });
    const { connection, messages } = join(server);
    assert.deepEqual(
      connection.receive(interactionCommand(1, 1, "target")),
      { ok: true, value: undefined },
    );
    assert.equal(valueOf(server.stepExact()), 1);
    assert.deepEqual(rejected(messages).at(-1), {
      protocolVersion: PROTOCOL_VERSION,
      kind: "rejected",
      sequence: 1,
      reason: "phase-invalid",
    });
    assert.equal(connection.inspect().acceptedSequence, null);
    assert.equal(connection.inspect().acknowledgedSequence, null);
    assert.equal(applyCalls, 0);
    const errors = invariantErrors(server, "interaction-validation");
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, "interaction-adapter-failure");
    assert.equal(errors[0].runtime, "server");
  }
});

test("apply failure records one invariant and completes the accepted sequence once", (t) => {
  let applyCalls = 0;
  const { server } = createHarness(t, {
    validate() {
      return "accepted";
    },
    apply() {
      applyCalls += 1;
      throw new Error("apply failure");
    },
    snapshot() {
      return [];
    },
  });
  const { connection, messages } = join(server);
  assert.deepEqual(
    connection.receive(interactionCommand(1, 1, "target")),
    { ok: true, value: undefined },
  );
  assert.equal(valueOf(server.stepExact()), 1);
  assert.equal(applyCalls, 1);
  assert.equal(connection.inspect().acceptedSequence, 1);
  assert.equal(connection.inspect().acknowledgedSequence, 1);
  assert.equal(connection.inspect().pendingCommandCount, 0);
  assert.equal(rejected(messages).length, 0);
  assert.equal(invariantErrors(server, "interaction-apply").length, 1);
  assert.equal(valueOf(server.stepExact()), 2);
  assert.equal(applyCalls, 1);
  assert.equal(connection.inspect().acknowledgedSequence, 1);
});

test("bad adapter snapshots emit avatars only and one invariant per call", (t) => {
  const cases = [
    { name: "throw", make: () => () => { throw new Error("snapshot failure"); } },
    { name: "invalid shape", make: () => () => [{ entityKind: "interactable" }] },
    { name: "nonfinite", make: () => () => [interactable("bad", { x: Infinity, y: 0, z: 0 })] },
    { name: "duplicate", make: () => () => [interactable("same"), interactable("same")] },
    {
      name: "avatar collision",
      make: (joined) => () => [interactable(joined.ownedEntityId)],
    },
    {
      name: "over cap",
      make: () => () => Array.from(
        { length: MAX_SNAPSHOT_ENTITIES },
        (_, index) => interactable(`target-${index}`),
      ),
    },
  ];

  for (const fixture of cases) {
    let snapshotImplementation = () => [];
    const { server } = createHarness(t, {
      validate() {
        return "accepted";
      },
      apply() {},
      snapshot() {
        return snapshotImplementation();
      },
    });
    const first = join(server);
    const second = join(server);
    snapshotImplementation = fixture.make(first.joined);
    assert.equal(valueOf(server.stepExact(3)), 3, fixture.name);
    for (const peer of [first, second]) {
      const snapshot = snapshots(peer.messages).at(-1);
      assert.ok(snapshot !== undefined, fixture.name);
      assert.equal(snapshot.serverTick, 3);
      assert.equal(snapshot.entities.length, 2);
      assert.equal(
        snapshot.entities.every((entity) => entity.entityKind === "avatar"),
        true,
      );
    }
    assert.equal(
      invariantErrors(server, "interaction-snapshot").length,
      1,
      fixture.name,
    );
    assert.equal(server.inspect().interaction.snapshotCallCount, 1);
    assert.equal(server.inspect().interaction.currentInteractableCount, 0);
  }
});

test("valid adapter snapshots are detached and deeply frozen", (t) => {
  const position = { x: 2, y: 3, z: 4 };
  const entity = interactable("switch", position);
  const supplied = [entity];
  const { server } = createHarness(t, {
    validate() {
      return "accepted";
    },
    apply() {},
    snapshot() {
      return supplied;
    },
  });
  const { messages } = join(server);
  assert.equal(valueOf(server.stepExact(3)), 3);
  const snapshot = snapshots(messages).at(-1);
  const captured = snapshot.entities.find(
    (candidate) => candidate.entityKind === "interactable",
  );
  assert.ok(captured !== undefined);
  assert.notEqual(snapshot.entities, supplied);
  assert.notEqual(captured, entity);
  assert.notEqual(captured.position, position);
  position.x = 100;
  entity.active = false;
  supplied.length = 0;
  assert.deepEqual(captured, interactable("switch", { x: 2, y: 3, z: 4 }));
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.entities), true);
  assert.equal(Object.isFrozen(captured), true);
  assert.equal(Object.isFrozen(captured.position), true);
  assert.throws(() => {
    captured.position.x = 5;
  }, TypeError);
  assert.throws(() => snapshot.entities.pop(), TypeError);
  assert.equal(invariantErrors(server, "interaction-snapshot").length, 0);
});

test("shutdown is idempotent, clears interaction state, and never disposes it", () => {
  let adapterDisposeCalls = 0;
  const interactionAdapter = {
    validate() {
      return "accepted";
    },
    apply() {},
    snapshot() {
      return [interactable("target")];
    },
    dispose() {
      adapterDisposeCalls += 1;
    },
  };
  const collisionAdapter = createCollisionAdapter();
  const server = createAuthoritativeServer({
    spawnPosition: { x: 0, y: 1, z: 0 },
    movementSpeedMetersPerSecond: 6,
    collisionAdapter,
    interactionAdapter,
  });
  const { connection } = join(server);
  assert.deepEqual(
    connection.receive(interactionCommand(1, 1, "target")),
    { ok: true, value: undefined },
  );
  assert.equal(valueOf(server.stepExact(3)), 3);
  assert.deepEqual(server.inspect().interaction, {
    active: true,
    validationCallCount: 1,
    applyCallCount: 1,
    snapshotCallCount: 1,
    currentInteractableCount: 1,
    liveResourceCount: 1,
  });

  const first = server.shutdown();
  const second = server.shutdown();
  assert.equal(second, first);
  assert.deepEqual(first, { ok: true, value: undefined });
  assert.deepEqual(server.inspect().interaction, {
    active: false,
    validationCallCount: 0,
    applyCallCount: 0,
    snapshotCallCount: 0,
    currentInteractableCount: 0,
    liveResourceCount: 0,
  });
  assert.deepEqual(server.inspect().liveResourceCounts, {
    connections: 0,
    bindings: 0,
    avatars: 0,
    capsules: 0,
    pendingCommands: 0,
    scheduledCommands: 0,
  });
  assert.equal(adapterDisposeCalls, 0);
  assert.equal(collisionAdapter.disposeCallCount, 1);
});
