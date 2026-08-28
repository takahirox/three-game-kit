import assert from "node:assert/strict";
import test from "node:test";
import { createWorld, defineFeatureConfiguration } from "@three-game-kit/core";
import { createRuntime as createServerRuntime } from "@three-game-kit/server";
import { createRuntime as createClientRuntime } from "@three-game-kit/client";
import { createAuthoritativeServer } from "@three-game-kit/server/authoritative";
import { createClientReplicationEngine } from "@three-game-kit/client/replication";
import { CommandMessageSchema, PROTOCOL_VERSION } from "@three-game-kit/protocol";
import { createMovementCommand } from "@three-game-kit/shared";
import {
  CLIENT_FEATURE_ID,
  CLIENT_HOST_SERVICE_ID,
  CLIENT_REQUIREMENT_ID,
  CONFLICT_ID,
  SERVER_FEATURE_ID,
  SERVER_HOST_SERVICE_ID,
  SERVER_REQUIREMENT_ID,
  createDeterministicAuthoritativeInteractionAdapter,
  createExternalClientInteractionFeature,
  createExternalServerInteractionFeature,
} from "../dist/interaction-feature.js";
import { clientOnlyFeature } from "../dist/client-only-feature.js";

const CONFIG = Object.freeze({
  targetEntityId: "switch_1",
  position: Object.freeze({ x: 2, y: 0, z: 0 }),
  range: 3,
  initialActive: false,
  forceSetupFailure: false,
});
const frameSource = Object.freeze({ request() { return 1; }, cancel() {} });

function emptyFeature(id, conflicts = []) {
  return {
    id,
    description: id,
    runtimeContributions: [],
    requires: [],
    conflicts,
    configuration: defineFeatureConfiguration({
      defaultValue: () => ({}),
      parse(value) {
        return value && typeof value === "object" && Object.keys(value).length === 0
          ? { ok: true, value: {} }
          : { ok: false, issues: [{ path: [], code: "invalid" }] };
      },
    }),
    setup() {},
    dispose() {},
  };
}

function assertZeroLive(runtime) {
  assert.ok(Object.values(runtime.snapshotTelemetry().liveResources).every((count) => count === 0));
}

test("compiled consumer uses all five packages and boots documented metadata/config", async () => {
  const world = createWorld();
  world.dispose();
  assert.equal(CommandMessageSchema.safeParse({}).success, false);
  assert.deepEqual(createMovementCommand(0, 0), { kind: "move", x: 0, z: 0 });

  let activated;
  const serverFeature = createExternalServerInteractionFeature();
  assert.deepEqual(serverFeature.requires, [SERVER_REQUIREMENT_ID]);
  assert.deepEqual(serverFeature.conflicts, [CONFLICT_ID]);
  const runtime = createServerRuntime({
    features: [emptyFeature(SERVER_REQUIREMENT_ID), serverFeature],
    configuration: { [SERVER_FEATURE_ID]: CONFIG },
    hostServices: { [SERVER_HOST_SERVICE_ID]: { activate(value) { activated = value; } } },
  });
  const boot = await runtime.boot();
  assert.equal(boot.state, "running");
  assert.deepEqual(boot.resolvedFeatureIds, [SERVER_REQUIREMENT_ID, SERVER_FEATURE_ID]);
  assert.ok(activated);
  const stopped = await runtime.shutdown();
  assert.equal(stopped.clean, true);
  assert.strictEqual(await runtime.shutdown(), stopped);
  assertZeroLive(runtime);

  const clientFeature = createExternalClientInteractionFeature();
  assert.deepEqual(clientFeature.requires, [CLIENT_REQUIREMENT_ID]);
  assert.deepEqual(clientFeature.conflicts, [CONFLICT_ID]);
  assert.equal(clientOnlyFeature.id, "external.client-only");
  const client = createClientRuntime({ features: [clientOnlyFeature], frameSource });
  assert.equal((await client.boot()).state, "running");
  await client.shutdown();
  assertZeroLive(client);
});

test("missing dependency, conflict, invalid config, and forced setup roll back cleanly", async () => {
  const missing = createServerRuntime({ features: [createExternalServerInteractionFeature()] });
  const missingResult = await missing.boot();
  assert.equal(missingResult.state, "stopped");
  assert.equal(missingResult.failures[0].code, "missing-requirement");
  assertZeroLive(missing);

  const conflict = createServerRuntime({
    features: [emptyFeature(SERVER_REQUIREMENT_ID), emptyFeature(CONFLICT_ID), createExternalServerInteractionFeature()],
  });
  const conflictResult = await conflict.boot();
  assert.equal(conflictResult.state, "stopped");
  assert.ok(conflictResult.failures.some(({ code }) => code === "feature-conflict"));
  assertZeroLive(conflict);

  const invalid = createServerRuntime({
    features: [emptyFeature(SERVER_REQUIREMENT_ID), createExternalServerInteractionFeature()],
    configuration: { [SERVER_FEATURE_ID]: { ...CONFIG, range: Number.POSITIVE_INFINITY } },
  });
  const invalidResult = await invalid.boot();
  assert.equal(invalidResult.state, "stopped");
  assert.ok(invalidResult.failures.some(({ code }) => code === "invalid-configuration"));
  assertZeroLive(invalid);

  let activationCount = 0;
  const forced = createServerRuntime({
    features: [emptyFeature(SERVER_REQUIREMENT_ID), createExternalServerInteractionFeature()],
    configuration: { [SERVER_FEATURE_ID]: { ...CONFIG, forceSetupFailure: true } },
    hostServices: { [SERVER_HOST_SERVICE_ID]: { activate() { activationCount += 1; } } },
  });
  const forcedResult = await forced.boot();
  assert.equal(forcedResult.state, "stopped");
  assert.ok(forcedResult.failures.some(({ code }) => code === "setup-failed"));
  assert.equal(activationCount, 0);
  assert.strictEqual(await forced.shutdown(), forcedResult);
  assertZeroLive(forced);
});

function collisionAdapter() {
  let disposed = false;
  const positions = new Map();
  return {
    createAvatar(id, position) { positions.set(id, { ...position }); return { ok: true, value: undefined }; },
    removeAvatar(id) { positions.delete(id); return { ok: true, value: undefined }; },
    setAvatarPosition(id, position) { positions.set(id, { ...position }); return { ok: true, value: undefined }; },
    moveAvatar(id, start, desired) {
      const position = { x: start.x + desired.x, y: start.y + desired.y, z: start.z + desired.z };
      positions.set(id, position);
      return { ok: true, value: { startPosition: start, desiredTranslation: desired, effectiveTranslation: desired, position, grounded: false, collided: false, collisionCount: 0 } };
    },
    inspect() { return { disposed, avatarCount: positions.size, avatars: Array.from(positions, ([avatarId, position]) => ({ avatarId, position: { ...position } })) }; },
    dispose() { disposed = true; positions.clear(); },
  };
}

function clientCollisionAdapter() {
  return {
    move(start, desired) {
      return { ok: true, value: { startPosition: start, desiredTranslation: desired, effectiveTranslation: desired,
        position: { x: start.x + desired.x, y: start.y + desired.y, z: start.z + desired.z },
        grounded: false, collided: false, collisionCount: 0 } };
    },
    dispose() {},
  };
}

function ok(result) {
  assert.equal(result.ok, true);
  return result.value;
}

function connect(server, client) {
  const connection = ok(server.acceptConnection({ emit: (message) => ok(client.receive(message)) }));
  ok(connection.markReady());
  ok(client.beginJoin());
  ok(connection.receive({ protocolVersion: PROTOCOL_VERSION, kind: "join" }));
  return connection;
}

test("two clients observe one server-authoritative toggle", () => {
  const adapter = createDeterministicAuthoritativeInteractionAdapter(CONFIG);
  const server = createAuthoritativeServer({
    spawnPosition: { x: 0, y: 0, z: 0 },
    spawnPositionsByConnectionOrdinal: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
    movementSpeedMetersPerSecond: 6,
    collisionAdapter: collisionAdapter(),
    interactionAdapter: adapter,
  });
  const emitted = [[], []];
  const clients = emitted.map((messages) => createClientReplicationEngine({
    movementSpeedMetersPerSecond: 6,
    initialPosition: { x: 0, y: 0, z: 0 },
    collisionAdapter: clientCollisionAdapter(),
    emit(message) { messages.push(message); },
  }));
  const connections = clients.map((client) => connect(server, client));
  ok(clients[0].queueInteract(CONFIG.targetEntityId));
  ok(clients[0].stepExact());
  ok(connections[0].receive(emitted[0].at(-1)));
  ok(server.stepExact(3));
  ok(clients[0].stepExact());
  ok(clients[1].stepExact());
  assert.equal(adapter.inspect().active, true);
  for (const client of clients) {
    assert.equal(ok(client.frame(16)).interactables.find(({ entityId }) => entityId === CONFIG.targetEntityId).active, true);
  }
  clients.forEach((client) => ok(client.shutdown()));
  ok(server.shutdown());
  assert.ok(clients.every((client) => Object.values(client.inspect().liveResourceCounts).every((count) => count === 0)));
  assert.ok(Object.values(server.inspect().liveResourceCounts).every((count) => count === 0));
  assert.equal(server.inspect().interaction.liveResourceCount, 0);
});

function command(sequence, intendedTick, targetEntityId) {
  return { protocolVersion: PROTOCOL_VERSION, kind: "command", sequence, intendedTick,
    action: { kind: "interact", targetEntityId } };
}

test("interaction rejection boundaries are deterministic", () => {
  const adapter = createDeterministicAuthoritativeInteractionAdapter(CONFIG);
  const server = createAuthoritativeServer({
    spawnPosition: { x: 100, y: 0, z: 0 },
    movementSpeedMetersPerSecond: 6,
    collisionAdapter: collisionAdapter(),
    interactionAdapter: adapter,
  });
  const messages = [];
  const connection = ok(server.acceptConnection({ emit: (message) => messages.push(message) }));
  ok(connection.markReady());
  ok(connection.receive({ protocolVersion: PROTOCOL_VERSION, kind: "join" }));

  ok(connection.receive(command(1, 1, "unknown")));
  ok(server.stepExact());
  assert.equal(messages.at(-1).reason, "unknown-target");
  ok(connection.receive(command(1, 2, CONFIG.targetEntityId)));
  ok(server.stepExact());
  assert.equal(messages.at(-1).reason, "interaction-out-of-range");

  const entityId = connection.inspect().ownedEntityId;
  ok(server.armNextValidationFixture(entityId, { kind: "ownership-violation" }));
  ok(connection.receive(command(1, 3, CONFIG.targetEntityId)));
  ok(server.stepExact());
  assert.equal(messages.filter(({ kind }) => kind === 'rejected').at(-1).reason, "ownership-violation");

  ok(server.scheduleForcedPosition(entityId, 4, CONFIG.position));
  ok(server.stepExact());
  ok(connection.receive(command(1, 5, CONFIG.targetEntityId)));
  ok(server.stepExact());
  assert.equal(adapter.inspect().applyCount, 1);
  ok(connection.receive(command(1, 6, CONFIG.targetEntityId)));
  ok(server.stepExact());
  assert.equal(messages.filter(({ kind }) => kind === 'rejected').at(-1).reason, "sequence-invalid");
  const malformed = { protocolVersion: PROTOCOL_VERSION, kind: "command", sequence: 2, intendedTick: 7,
    action: { kind: "interact", targetEntityId: "bad id" } };
  assert.equal(CommandMessageSchema.safeParse(malformed).success, false);
  const schemaInvalidBefore = server.inspect().rejectedCommandCounts['schema-invalid'];
  const decodeError = server.recordDecodeIngressRejection('schema-invalid');
  assert.equal(decodeError.reasonCode, 'schema-invalid');
  assert.equal(server.inspect().rejectedCommandCounts['schema-invalid'], schemaInvalidBefore + 1);
  ok(server.shutdown());
});

test("removing Interaction leaves a base movement loop runnable", async () => {
  let ticks = 0;
  const movement = {
    ...emptyFeature("base.movement"),
    runtimeContributions: [{
      kind: "system",
      id: "base.movement.loop",
      domain: "server-simulation",
      phase: "gameplay",
      priority: 0,
      run() { ticks += 1; },
    }],
    setup({ ledger }) { ledger.activateSystem("base.movement.loop"); },
  };
  const runtime = createServerRuntime({ features: [movement] });
  assert.equal((await runtime.boot()).state, "running");
  assert.deepEqual(runtime.stepExact(3), { ok: true, value: 3 });
  assert.equal(ticks, 3);
  assert.equal(runtime.inspectLifecycle().installedFeatureIds.includes(SERVER_FEATURE_ID), false);
  await runtime.shutdown();
  assertZeroLive(runtime);
});

test("client descriptor borrows replication and releases only owned state", async () => {
  let engineShutdowns = 0;
  const engine = {
    queueInteract() { return { ok: true, value: undefined }; },
    inspect() { return { interactables: [] }; },
    shutdown() { engineShutdowns += 1; return { ok: true, value: undefined }; },
  };
  const runtime = createClientRuntime({
    features: [emptyFeature(CLIENT_REQUIREMENT_ID), createExternalClientInteractionFeature()],
    frameSource,
    configuration: { [CLIENT_FEATURE_ID]: CONFIG },
    hostServices: { [CLIENT_HOST_SERVICE_ID]: engine },
  });
  assert.equal((await runtime.boot()).state, "running");
  const stopped = await runtime.shutdown();
  assert.strictEqual(await runtime.shutdown(), stopped);
  assert.equal(engineShutdowns, 0);
  assertZeroLive(runtime);
});
