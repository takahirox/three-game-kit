import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { once } from "node:events";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import {
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  decodeServerMessage,
  encodeClientMessage,
} from "@three-game-kit/protocol";
import { createAuthoritativeServer } from "@three-game-kit/server/authoritative";
import { createRapierServerCollisionAdapter } from "@three-game-kit/server/collision";
import { createAuthoritativeWebSocketServer } from "@three-game-kit/server/networking";
import WebSocket from "ws";

function valueOf(outcome) {
  assert.equal(outcome.ok, true);
  if (!outcome.ok) assert.fail(outcome.failure);
  return outcome.value;
}

function decodeTextMessage([data, isBinary]) {
  assert.equal(isBinary, false, "Server data frames must be text");

  let bytes;
  if (Array.isArray(data)) {
    bytes = Uint8Array.from(Buffer.concat(data));
  } else if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  } else {
    bytes = Uint8Array.from(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
  }

  return valueOf(decodeServerMessage({ kind: "text", bytes }));
}

function floorScene() {
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

async function waitFor(predicate, message) {
  for (let turn = 0; turn < 40; turn += 1) {
    if (predicate()) return;
    await setImmediate();
  }
  assert.fail(message);
}

async function waitForTransportCounts(networking, connections, sockets) {
  await waitFor(() => {
    const inspection = networking.inspect();
    return (
      inspection.connectionCount === connections &&
      inspection.socketCount === sockets
    );
  }, `transport did not settle at ${connections} connections and ${sockets} sockets`);
}

function commandState(authority) {
  const inspection = authority.inspect();
  return {
    connections: inspection.connections.map((connection) => ({
      connectionId: connection.connectionId,
      acceptedSequence: connection.acceptedSequence,
      pendingCommandCount: connection.pendingCommandCount,
      scheduledCommandCount: connection.scheduledCommandCount,
    })),
    avatars: inspection.avatars.map((avatar) => ({
      entityId: avatar.entityId,
      playerId: avatar.playerId,
      position: { ...avatar.position },
    })),
    rejectedCommandCounts: { ...inspection.rejectedCommandCounts },
  };
}

async function openClient(url) {
  const client = new WebSocket(url);
  await once(client, "open");
  return client;
}

async function joinClient(client) {
  const joinedEvent = once(client, "message");
  client.send(
    valueOf(
      encodeClientMessage({
        protocolVersion: PROTOCOL_VERSION,
        kind: "join",
      }),
    ).text,
  );
  const joined = decodeTextMessage(await joinedEvent);
  assert.equal(joined.kind, "joined");
  return joined;
}

test("live WebSocket networking edge behavior is isolated and leak-free", async (t) => {
  const collisionAdapter = createRapierServerCollisionAdapter(floorScene());
  const authority = createAuthoritativeServer({
    spawnPosition: { x: 0, y: 1, z: 0 },
    movementSpeedMetersPerSecond: 6,
    collisionAdapter,
  });
  const networking = createAuthoritativeWebSocketServer({
    authoritativeServer: authority,
    host: "127.0.0.1",
    port: 0,
    path: "/three-game-kit",
  });

  const clients = new Set();
  let clientA;
  let clientB;
  let joinedA;
  let joinedB;
  let listening;
  let completed = false;
  let watchdogTimer;

  const exercise = async () => {
    await t.test("listens on the requested loopback path", async () => {
      listening = valueOf(await networking.listen());
      assert.deepEqual(Object.keys(listening).sort(), ["path", "url"]);
      assert.equal(listening.path, "/three-game-kit");
      assert.match(
        listening.url,
        /^ws:\/\/127\.0\.0\.1:\d+\/three-game-kit$/,
      );
    });

    await t.test("joins A then B with distinct identities", async () => {
      clientA = await openClient(listening.url);
      clients.add(clientA);
      joinedA = await joinClient(clientA);

      clientB = await openClient(listening.url);
      clients.add(clientB);
      joinedB = await joinClient(clientB);

      assert.notEqual(joinedA.connectionId, joinedB.connectionId);
      assert.notEqual(joinedA.playerId, joinedB.playerId);
      assert.notEqual(joinedA.ownedEntityId, joinedB.ownedEntityId);
      assert.equal(networking.inspect().connectionCount, 2);
      assert.deepEqual(authority.inspect().liveResourceCounts, {
        connections: 2,
        bindings: 2,
        avatars: 2,
        capsules: 2,
        pendingCommands: 0,
        scheduledCommands: 0,
      });
    });

    await t.test("counts invalid JSON without mutating authority", async () => {
      const beforeCount = networking.inspect().decodeFailureCounts["invalid-json"];
      const beforeAuthority = commandState(authority);
      const beforeRuntimeErrors = authority.inspect().structuredRuntimeErrors;

      clientA.send("{");
      await waitFor(
        () =>
          networking.inspect().decodeFailureCounts["invalid-json"] ===
          beforeCount + 1,
        "invalid-json counter was not incremented",
      );

      const afterAuthority = commandState(authority);
      const afterRuntimeErrors = authority.inspect().structuredRuntimeErrors;
      assert.deepEqual(afterAuthority.connections, beforeAuthority.connections);
      assert.deepEqual(afterAuthority.avatars, beforeAuthority.avatars);
      assert.deepEqual(afterAuthority.rejectedCommandCounts, {
        ...beforeAuthority.rejectedCommandCounts,
        "schema-invalid":
          beforeAuthority.rejectedCommandCounts["schema-invalid"] + 1,
      });
      assert.equal(afterRuntimeErrors.length, beforeRuntimeErrors.length + 1);
      const runtimeError = afterRuntimeErrors.at(-1);
      assert.equal(runtimeError.code, "decode-ingress-rejected");
      assert.equal(runtimeError.reasonCode, "schema-invalid");
      assert.equal(
        runtimeError.sequence,
        (beforeRuntimeErrors.at(-1)?.sequence ?? 0) + 1,
      );
      assert.equal(clientA.readyState, WebSocket.OPEN);
      assert.equal(clientB.readyState, WebSocket.OPEN);
    });

    await t.test("counts an unknown v1 kind without mutating authority", async () => {
      const beforeCount = networking.inspect().decodeFailureCounts["unknown-kind"];
      const beforeAuthority = commandState(authority);
      const beforeRuntimeErrors = authority.inspect().structuredRuntimeErrors;

      clientA.send(
        JSON.stringify({
          protocolVersion: 1,
          kind: "unknown-for-v1",
        }),
      );
      await waitFor(
        () =>
          networking.inspect().decodeFailureCounts["unknown-kind"] ===
          beforeCount + 1,
        "unknown-kind counter was not incremented",
      );

      const afterAuthority = commandState(authority);
      const afterRuntimeErrors = authority.inspect().structuredRuntimeErrors;
      assert.deepEqual(afterAuthority.connections, beforeAuthority.connections);
      assert.deepEqual(afterAuthority.avatars, beforeAuthority.avatars);
      assert.deepEqual(afterAuthority.rejectedCommandCounts, {
        ...beforeAuthority.rejectedCommandCounts,
        "unknown-kind": beforeAuthority.rejectedCommandCounts["unknown-kind"] + 1,
      });
      assert.equal(afterRuntimeErrors.length, beforeRuntimeErrors.length + 1);
      const runtimeError = afterRuntimeErrors.at(-1);
      assert.equal(runtimeError.code, "decode-ingress-rejected");
      assert.equal(runtimeError.reasonCode, "unknown-kind");
      assert.equal(
        runtimeError.sequence,
        (beforeRuntimeErrors.at(-1)?.sequence ?? 0) + 1,
      );
      assert.equal(clientA.readyState, WebSocket.OPEN);
      assert.equal(clientB.readyState, WebSocket.OPEN);
    });

    await t.test("closes only A after a binary frame", async () => {
      const beforeCount = networking.inspect().decodeFailureCounts["binary-frame"];
      const closed = once(clientA, "close");
      clientA.send(new Uint8Array([1, 2, 3]));
      await closed;
      clients.delete(clientA);
      await waitForTransportCounts(networking, 1, 1);

      assert.equal(
        networking.inspect().decodeFailureCounts["binary-frame"],
        beforeCount + 1,
      );
      assert.equal(clientB.readyState, WebSocket.OPEN);
      assert.deepEqual(authority.inspect().liveResourceCounts, {
        connections: 1,
        bindings: 1,
        avatars: 1,
        capsules: 1,
        pendingCommands: 0,
        scheduledCommands: 0,
      });
      assert.deepEqual(
        authority.inspect().avatars.map((avatar) => avatar.entityId),
        [joinedB.ownedEntityId],
      );
    });

    await t.test("moves B and acknowledges sequence one", async () => {
      const before = authority
        .inspect()
        .avatars.find((avatar) => avatar.entityId === joinedB.ownedEntityId);
      assert.ok(before);

      const pongEvent = once(clientB, "pong");
      clientB.send(
        valueOf(
          encodeClientMessage({
            protocolVersion: PROTOCOL_VERSION,
            kind: "command",
            sequence: 1,
            intendedTick: 1,
            action: { kind: "move", x: 1, z: 0 },
          }),
        ).text,
      );
      clientB.ping();
      await pongEvent;

      const snapshotEvent = once(clientB, "message");
      assert.deepEqual(authority.stepExact(3), { ok: true, value: 3 });
      const snapshot = decodeTextMessage(await snapshotEvent);
      assert.equal(snapshot.kind, "snapshot");
      assert.equal(snapshot.serverTick, 3);
      assert.equal(snapshot.acknowledgedSequence, 1);
      const avatar = snapshot.entities.find(
        (entity) =>
          entity.entityKind === "avatar" &&
          entity.entityId === joinedB.ownedEntityId,
      );
      assert.ok(avatar);
      assert.ok(Number.isFinite(avatar.position.x));
      assert.ok(Number.isFinite(avatar.position.y));
      assert.ok(Number.isFinite(avatar.position.z));
      assert.notDeepEqual(avatar.position, before.position);
    });

    await t.test("rejects an oversized text message without cross-counting", async () => {
      const baselineState = commandState(authority);
      const baselineResources = authority.inspect().liveResourceCounts;
      const before = networking.inspect().decodeFailureCounts;
      const oversizedClient = await openClient(listening.url);
      clients.add(oversizedClient);
      await joinClient(oversizedClient);
      const closed = once(oversizedClient, "close");

      oversizedClient.send("x".repeat(MAX_MESSAGE_BYTES + 1));
      await closed;
      clients.delete(oversizedClient);
      await waitForTransportCounts(networking, 1, 1);

      const after = networking.inspect().decodeFailureCounts;
      assert.equal(after["message-too-large"], before["message-too-large"] + 1);
      assert.equal(after["invalid-json"], before["invalid-json"]);
      assert.equal(after["unknown-kind"], before["unknown-kind"]);
      assert.deepEqual(authority.inspect().liveResourceCounts, baselineResources);
      const afterState = commandState(authority);
      assert.deepEqual(afterState.avatars, baselineState.avatars);
      assert.deepEqual(
        afterState.connections.find(
          (connection) => connection.connectionId === joinedB.connectionId,
        ),
        baselineState.connections.find(
          (connection) => connection.connectionId === joinedB.connectionId,
        ),
      );
      assert.deepEqual(
        afterState.rejectedCommandCounts,
        baselineState.rejectedCommandCounts,
      );
    });

    await t.test("rejects a query-suffixed path and shuts down exactly", async () => {
      const beforeConnections = networking.inspect().connectionCount;
      const rejected = new WebSocket(`${listening.url}?query=1`);
      clients.add(rejected);
      await once(rejected, "error");
      await waitFor(
        () => rejected.readyState === WebSocket.CLOSED,
        "query-suffixed client did not close",
      );
      clients.delete(rejected);
      assert.equal(networking.inspect().connectionCount, beforeConnections);

      const closed = once(clientB, "close");
      clientB.close();
      await closed;
      clients.delete(clientB);
      await waitForTransportCounts(networking, 0, 0);

      const firstShutdown = networking.shutdown();
      const secondShutdown = networking.shutdown();
      assert.equal(firstShutdown, secondShutdown);
      assert.deepEqual(await firstShutdown, { ok: true, value: undefined });

      const finalTransport = networking.inspect();
      assert.deepEqual(
        {
          connectionCount: finalTransport.connectionCount,
          socketCount: finalTransport.socketCount,
          listenerCount: finalTransport.listenerCount,
          queuedItemCount: finalTransport.queuedItemCount,
          timerCount: finalTransport.timerCount,
        },
        {
          connectionCount: 0,
          socketCount: 0,
          listenerCount: 0,
          queuedItemCount: 0,
          timerCount: 0,
        },
      );
      assert.deepEqual(authority.shutdown(), { ok: true, value: undefined });
      assert.deepEqual(authority.inspect().liveResourceCounts, {
        connections: 0,
        bindings: 0,
        avatars: 0,
        capsules: 0,
        pendingCommands: 0,
        scheduledCommands: 0,
      });
      completed = true;
    });
  };

  const watchdog = new Promise((_, reject) => {
    watchdogTimer = setTimeout(
      () => reject(new Error("networking edge tests exceeded 4 seconds")),
      4_000,
    );
  });

  try {
    await Promise.race([exercise(), watchdog]);
  } finally {
    clearTimeout(watchdogTimer);
    if (!completed) {
      for (const client of clients) {
        if (client.readyState !== WebSocket.CLOSED) client.terminate();
      }
      await networking.shutdown();
      authority.shutdown();
    }
  }
});
