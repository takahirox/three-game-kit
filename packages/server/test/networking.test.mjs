import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { once } from "node:events";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import {
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

async function waitForNetworkingClose(networking) {
  let transport = networking.inspect();
  for (
    let turn = 0;
    turn < 20 &&
    (transport.connectionCount !== 0 || transport.socketCount !== 0);
    turn += 1
  ) {
    await setImmediate();
    transport = networking.inspect();
  }

  assert.equal(transport.connectionCount, 0);
  assert.equal(transport.socketCount, 0);
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

test("live WebSocket transport joins, moves, snapshots, and cleans up", async () => {
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

  let client;
  let completed = false;
  let watchdogTimer;

  const exercise = async () => {
    const listening = valueOf(await networking.listen());
    assert.equal(listening.path, "/three-game-kit");
    assert.match(listening.url, /^ws:\/\/127\.0\.0\.1:\d+\/three-game-kit$/);

    client = new WebSocket(listening.url);
    await once(client, "open");

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
    assert.equal(joined.serverTick, 0);

    const pongEvent = once(client, "pong");
    client.send(
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
    client.ping();
    await pongEvent;

    const transportLive = networking.inspect();
    assert.equal(transportLive.connectionCount, 1);
    assert.equal(transportLive.socketCount, 1);
    assert.deepEqual(authority.inspect().liveResourceCounts, {
      connections: 1,
      bindings: 1,
      avatars: 1,
      capsules: 1,
      pendingCommands: 1,
      scheduledCommands: 0,
    });

    const snapshotEvent = once(client, "message");
    assert.deepEqual(authority.stepExact(3), { ok: true, value: 3 });
    const snapshot = decodeTextMessage(await snapshotEvent);
    assert.equal(snapshot.kind, "snapshot");
    assert.equal(snapshot.serverTick, 3);
    assert.equal(snapshot.acknowledgedSequence, 1);
    const avatar = snapshot.entities.find(
      (entity) =>
        entity.entityKind === "avatar" &&
        entity.entityId === joined.ownedEntityId,
    );
    assert.ok(avatar);
    assert.ok(Number.isFinite(avatar.position.x));
    assert.ok(Number.isFinite(avatar.position.y));
    assert.ok(Number.isFinite(avatar.position.z));
    assert.ok(avatar.position.x > 0);

    const closedEvent = once(client, "close");
    client.close();
    await closedEvent;
    await waitForNetworkingClose(networking);

    const transportClosed = networking.inspect();
    assert.equal(transportClosed.connectionCount, 0);
    assert.equal(transportClosed.socketCount, 0);
    assert.deepEqual(authority.inspect().liveResourceCounts, {
      connections: 0,
      bindings: 0,
      avatars: 0,
      capsules: 0,
      pendingCommands: 0,
      scheduledCommands: 0,
    });

    const firstShutdown = networking.shutdown();
    const secondShutdown = networking.shutdown();
    assert.equal(firstShutdown, secondShutdown);
    assert.deepEqual(await firstShutdown, { ok: true, value: undefined });

    const shutdown = networking.inspect();
    assert.equal(shutdown.listenerCount, 0);
    assert.equal(shutdown.queuedItemCount, 0);
    assert.equal(shutdown.timerCount, 0);
    assert.deepEqual(authority.shutdown(), { ok: true, value: undefined });
    completed = true;
  };

  const watchdog = new Promise((_, reject) => {
    watchdogTimer = setTimeout(
      () => reject(new Error("live socket test exceeded 2 seconds")),
      2_000,
    );
  });

  try {
    await Promise.race([exercise(), watchdog]);
  } finally {
    clearTimeout(watchdogTimer);
    if (!completed) {
      if (client !== undefined && client.readyState !== WebSocket.CLOSED) {
        client.terminate();
      }
      await networking.shutdown();
      authority.shutdown();
    }
  }
});

test("live outbound gate isolates failures and ignores stale resolutions", async () => {
  const collisionAdapter = createRapierServerCollisionAdapter(floorScene());
  const authority = createAuthoritativeServer({ spawnPosition: { x: 0, y: 1, z: 0 }, movementSpeedMetersPerSecond: 6, collisionAdapter });
  const pending = new Map();
  const observed = [];
  const defer = (key) => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); pending.set(key, { resolve, reject }); return promise; };
  const networking = createAuthoritativeWebSocketServer({ authoritativeServer: authority, host: "127.0.0.1", port: 0, path: "/three-game-kit", outboundGate(message) { const decoded = valueOf(decodeServerMessage({ kind: "text", bytes: Buffer.from(message.encoded) })); observed.push({ message, decoded }); assert.equal(Object.isFrozen(message), true); assert.ok(message.connectionOrdinal > 0); if (message.connectionOrdinal === 1 || (message.connectionOrdinal === 3 && message.operation === "joined") || (message.connectionOrdinal === 2 && decoded.kind === "snapshot" && decoded.serverTick === 15)) return defer(`${message.connectionOrdinal}:${message.messageOrdinal}`); } });
  const clients = [];
  let completed = false;
  let watchdogTimer;
  const waitFor = async (predicate, description) => { for (let turn = 0; turn < 20 && !predicate(); turn += 1) await setImmediate(); assert.equal(predicate(), true, description); };
  const rawText = ([data, isBinary]) => { assert.equal(isBinary, false); if (Array.isArray(data)) return Buffer.concat(data).toString("utf8"); if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8"); return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8"); };
  const open = async (url) => { const client = new WebSocket(url); clients.push(client); await once(client, "open"); return client; };
  const sendJoin = (client) => client.send(valueOf(encodeClientMessage({ protocolVersion: PROTOCOL_VERSION, kind: "join" })).text);
  const exercise = async () => {
    const listening = valueOf(await networking.listen());
    assert.equal(authority.inspect().serverTick, 0);
    const connection1 = await open(listening.url);
    const connection1Messages = [];
    connection1.on("message", (...event) => connection1Messages.push(rawText(event)));
    const joinedEvent1 = once(connection1, "message");
    sendJoin(connection1);
    await waitFor(() => pending.has("1:1"), "connection 1 joined message was not gated");
    const joinedGate1 = observed.find(({ message }) => message.connectionOrdinal === 1 && message.messageOrdinal === 1);
    assert.deepEqual({ ...joinedGate1.message }, { direction: "s2c", connectionOrdinal: 1, messageOrdinal: 1, operation: "joined", encoded: joinedGate1.message.encoded });
    pending.get("1:1").resolve();
    const joinedText1 = rawText(await joinedEvent1);
    assert.equal(joinedText1, joinedGate1.message.encoded);
    assert.equal(valueOf(decodeServerMessage({ kind: "text", bytes: Buffer.from(joinedText1) })).serverTick, 0);
    const snapshotEvent1 = once(connection1, "message");
    assert.deepEqual(authority.stepExact(3), { ok: true, value: 3 });
    await waitFor(() => pending.has("1:2"), "tick 3 snapshot was not gated");
    const snapshotGate1 = observed.find(({ message }) => message.connectionOrdinal === 1 && message.messageOrdinal === 2);
    assert.equal(snapshotGate1.decoded.serverTick, 3);
    pending.get("1:2").resolve();
    const snapshotText1 = rawText(await snapshotEvent1);
    assert.equal(snapshotText1, snapshotGate1.message.encoded);
    assert.equal(valueOf(decodeServerMessage({ kind: "text", bytes: Buffer.from(snapshotText1) })).serverTick, 3);
    const connection2 = await open(listening.url);
    const joinedEvent2 = once(connection2, "message"); sendJoin(connection2);
    const joined2 = valueOf(decodeServerMessage({ kind: "text", bytes: Buffer.from(rawText(await joinedEvent2)) }));
    assert.equal(joined2.kind, "joined"); assert.equal(observed.find(({ message }) => message.connectionOrdinal === 2).message.messageOrdinal, 1);
    assert.deepEqual(authority.stepExact(3), { ok: true, value: 6 });
    assert.deepEqual(authority.stepExact(3), { ok: true, value: 9 });
    assert.equal(networking.inspect().queuedItemCount, 2);
    let connection1CloseCount = 0; connection1.on("close", () => { connection1CloseCount += 1; });
    pending.get("1:3").reject(new Error("first snapshot rejected")); pending.get("1:4").reject(new Error("second snapshot rejected"));
    await waitFor(() => connection1CloseCount === 1, "connection 1 did not close exactly once");
    assert.equal(networking.inspect().queuedItemCount, 0); assert.equal(connection2.readyState, WebSocket.OPEN); assert.deepEqual(authority.inspect().liveResourceCounts, { connections: 1, bindings: 1, avatars: 1, capsules: 1, pendingCommands: 0, scheduledCommands: 0 });
    await setImmediate(); assert.equal(connection1CloseCount, 1); assert.equal(connection1Messages.length, 2);
    const peerSnapshotEvent = once(connection2, "message");
    assert.deepEqual(authority.stepExact(3), { ok: true, value: 12 });
    const peerSnapshotText = rawText(await peerSnapshotEvent); const peerSnapshot = valueOf(decodeServerMessage({ kind: "text", bytes: Buffer.from(peerSnapshotText) }));
    assert.equal(peerSnapshot.kind, "snapshot"); assert.equal(peerSnapshot.serverTick, 12); assert.equal(peerSnapshotText, observed.find(({ message, decoded }) => message.connectionOrdinal === 2 && decoded.kind === "snapshot" && decoded.serverTick === 12).message.encoded);
    const connection3 = await open(listening.url); let connection3Messages = 0; connection3.on("message", () => { connection3Messages += 1; });
    sendJoin(connection3); await waitFor(() => pending.has("3:1"), "connection 3 joined message was not gated");
    const connection3Closed = once(connection3, "close"); connection3.close(); await connection3Closed;
    pending.get("3:1").resolve();
    await setImmediate(); assert.equal(connection3Messages, 0); assert.equal(networking.inspect().queuedItemCount, 0);
    let staleConnection2Messages = 0; connection2.on("message", () => { staleConnection2Messages += 1; });
    assert.deepEqual(authority.stepExact(3), { ok: true, value: 15 });
    await waitFor(() => pending.has("2:5"), "tick 15 snapshot was not gated");
    assert.equal(networking.inspect().queuedItemCount, 1);
    const firstShutdown = networking.shutdown(); const secondShutdown = networking.shutdown(); assert.equal(firstShutdown, secondShutdown);
    assert.deepEqual(await firstShutdown, { ok: true, value: undefined });
    pending.get("2:5").resolve();
    await setImmediate();
    assert.equal(staleConnection2Messages, 0); assert.deepEqual({ connectionCount: networking.inspect().connectionCount, socketCount: networking.inspect().socketCount, listenerCount: networking.inspect().listenerCount, queuedItemCount: networking.inspect().queuedItemCount, timerCount: networking.inspect().timerCount }, { connectionCount: 0, socketCount: 0, listenerCount: 0, queuedItemCount: 0, timerCount: 0 });
    assert.deepEqual(authority.shutdown(), { ok: true, value: undefined });
    assert.deepEqual(authority.inspect().liveResourceCounts, { connections: 0, bindings: 0, avatars: 0, capsules: 0, pendingCommands: 0, scheduledCommands: 0 });
    completed = true;
  };
  const watchdog = new Promise((_, reject) => { watchdogTimer = setTimeout(() => reject(new Error("outbound gate loopback test exceeded 2 seconds")), 2_000); });
  try { await Promise.race([exercise(), watchdog]); }
  finally { clearTimeout(watchdogTimer); if (!completed) { for (const client of clients) if (client.readyState !== WebSocket.CLOSED) client.terminate(); await networking.shutdown(); authority.shutdown(); } }
});
