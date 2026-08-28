import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import {
  PROTOCOL_VERSION,
  encodeClientMessage,
  encodeServerMessage,
} from "@three-game-kit/protocol";
import { createNativeClientTransport } from "@three-game-kit/client/networking";

const originalWebSocket = Object.getOwnPropertyDescriptor(
  globalThis,
  "WebSocket",
);

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this.readyState = 0;
    this.extensions = "";
    this.sentText = [];
    this.closeCount = 0;
    FakeWebSocket.instances.push(this);
  }

  send(text) {
    this.sentText.push(text);
  }

  close() {
    this.closeCount += 1;
    this.readyState = 2;
  }

  deliverOpen() {
    this.readyState = 1;
    this.onopen?.({});
  }

  deliverMessage(data) {
    this.onmessage?.({ data });
  }

  deliverClose() {
    this.readyState = 3;
    this.onclose?.({});
  }

  deliverError() {
    this.onerror?.({});
  }
}

before(() => {
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    enumerable: originalWebSocket?.enumerable ?? false,
    writable: true,
    value: FakeWebSocket,
  });
});

after(() => {
  if (originalWebSocket === undefined) {
    delete globalThis.WebSocket;
  } else {
    Object.defineProperty(globalThis, "WebSocket", originalWebSocket);
  }
});

const ERROR_CODES = Object.freeze([
  "invalid-state",
  "connect-failed",
  "extensions-negotiated",
  "binary-frame",
  "message-too-large",
  "invalid-utf8",
  "invalid-json",
  "not-json-object",
  "unsupported-version",
  "unknown-kind",
  "wrong-direction",
  "schema-invalid",
  "phase-invalid",
  "send-failed",
  "peer-error",
  "shutdown-failed",
]);

const JOINED_MESSAGE = Object.freeze({
  protocolVersion: PROTOCOL_VERSION,
  kind: "joined",
  connectionId: "connection_alpha",
  playerId: "player_alpha",
  ownedEntityId: "avatar_alpha",
  serverTick: 10,
});

const SNAPSHOT_MESSAGE = {
  protocolVersion: PROTOCOL_VERSION,
  kind: "snapshot",
  serverTick: 13,
  acknowledgedSequence: 7,
  entities: [
    {
      entityKind: "avatar",
      entityId: "avatar_alpha",
      playerId: "player_alpha",
      position: { x: 1, y: 2, z: 3 },
    },
  ],
};

function valueOf(outcome) {
  assert.equal(outcome.ok, true);
  if (!outcome.ok) assert.fail(outcome.failure);
  return outcome.value;
}

function clientText(message) {
  return valueOf(encodeClientMessage(message)).text;
}

function serverText(message) {
  return valueOf(encodeServerMessage(message)).text;
}

function expectOk(outcome) {
  assertDeepFrozen(outcome);
  assert.deepEqual(outcome, { ok: true, value: undefined });
}

function expectedErrorCounts(code) {
  return Object.fromEntries(
    ERROR_CODES.map((candidate) => [candidate, candidate === code ? 1 : 0]),
  );
}

function assertDeepFrozen(value, seen = new Set()) {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    assertDeepFrozen(value[key], seen);
  }
}

function containsFakeWebSocket(value, seen = new Set()) {
  if (value instanceof FakeWebSocket) return true;
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return false;
  }
  seen.add(value);
  return Reflect.ownKeys(value).some((key) =>
    containsFakeWebSocket(value[key], seen),
  );
}

function inspectSafely(transport, rawPayloads = []) {
  const inspection = transport.inspect();
  assertDeepFrozen(inspection);
  assert.equal(containsFakeWebSocket(inspection), false);
  const serialized = JSON.stringify(inspection);
  for (const payload of rawPayloads) {
    assert.equal(serialized.includes(payload), false);
  }
  return inspection;
}

function latestSocket() {
  const socket = FakeWebSocket.instances.at(-1);
  assert.ok(socket instanceof FakeWebSocket);
  return socket;
}

function createJoinedTransport(receive = () => {}) {
  const transport = createNativeClientTransport({
    url: "ws://example.test/game",
    receive,
  });
  expectOk(transport.connect());
  const socket = latestSocket();
  socket.deliverOpen();
  expectOk(transport.join());
  socket.deliverMessage(serverText(JOINED_MESSAGE));
  assert.equal(transport.state, "joined");
  return { socket, transport };
}

test("normal lifecycle uses exact Protocol text and detached inspection", async (t) => {
  const received = [];
  const transport = createNativeClientTransport({
    url: "ws://example.test/game",
    receive(message) {
      received.push(message);
    },
  });
  let socket;

  t.after(async () => {
    const shutdown = transport.shutdown();
    if (socket !== undefined && socket.readyState !== 3) socket.deliverClose();
    await shutdown;
  });

  const idleInspection = inspectSafely(transport);
  assert.equal(idleInspection.state, "idle");
  assert.deepEqual(idleInspection.liveResourceCounts, {
    nativeReferences: 0,
    callbacks: 0,
    bindings: 0,
    queuedItems: 0,
    timers: 0,
    retainedReferences: 1,
  });

  const connected = transport.connect();
  socket = latestSocket();
  expectOk(connected);
  assert.equal(socket.url, "ws://example.test/game");
  assert.equal(socket.readyState, 0);
  assert.equal(socket.extensions, "");
  assert.equal(transport.state, "connecting");

  socket.deliverOpen();
  assert.equal(socket.readyState, 1);
  assert.equal(transport.state, "ready");
  const readyInspection = inspectSafely(transport);

  const joinMessage = {
    protocolVersion: PROTOCOL_VERSION,
    kind: "join",
  };
  const joinText = clientText(joinMessage);
  assert.equal(
    joinText,
    `{"protocolVersion":${PROTOCOL_VERSION},"kind":"join"}`,
  );
  expectOk(transport.join());
  assert.equal(transport.state, "joining");
  assert.deepEqual(socket.sentText, [joinText]);

  const joinedText = serverText(JOINED_MESSAGE);
  socket.deliverMessage(joinedText);
  assert.equal(transport.state, "joined");
  assert.deepEqual(transport.binding, {
    connectionId: "connection_alpha",
    playerId: "player_alpha",
    ownedEntityId: "avatar_alpha",
    serverTick: 10,
  });
  assert.deepEqual(received, [JOINED_MESSAGE]);

  const command = {
    protocolVersion: PROTOCOL_VERSION,
    kind: "command",
    sequence: 7,
    intendedTick: 12,
    action: { kind: "move", x: 0.6, z: -0.8 },
  };
  const commandText = clientText(command);
  assert.equal(
    commandText,
    `{"protocolVersion":${PROTOCOL_VERSION},"kind":"command","sequence":7,"intendedTick":12,"action":{"kind":"move","x":0.6,"z":-0.8}}`,
  );
  expectOk(transport.command(command));
  assert.deepEqual(socket.sentText, [joinText, commandText]);

  const snapshotText = serverText(SNAPSHOT_MESSAGE);
  socket.deliverMessage(snapshotText);
  assert.deepEqual(received, [JOINED_MESSAGE, SNAPSHOT_MESSAGE]);

  const inspection = inspectSafely(transport, [
    joinText,
    commandText,
    joinedText,
    snapshotText,
  ]);
  assert.deepEqual(inspection, {
    state: "joined",
    binding: {
      connectionId: "connection_alpha",
      playerId: "player_alpha",
      ownedEntityId: "avatar_alpha",
      serverTick: 10,
    },
    transitionCount: 4,
    evictedTransitionCount: 0,
    transitions: [
      {
        sequence: 1,
        runtime: "client",
        scope: "transport",
        previousState: "idle",
        nextState: "connecting",
        operation: "connect",
        connectionId: null,
      },
      {
        sequence: 2,
        runtime: "client",
        scope: "transport",
        previousState: "connecting",
        nextState: "ready",
        operation: "connect",
        connectionId: null,
      },
      {
        sequence: 3,
        runtime: "client",
        scope: "transport",
        previousState: "ready",
        nextState: "joining",
        operation: "join",
        connectionId: null,
      },
      {
        sequence: 4,
        runtime: "client",
        scope: "transport",
        previousState: "joining",
        nextState: "joined",
        operation: "receive",
        connectionId: "connection_alpha",
      },
    ],
    errorCount: 0,
    evictedErrorCount: 0,
    errors: [],
    errorCounts: expectedErrorCounts(),
    liveResourceCounts: {
      nativeReferences: 1,
      callbacks: 4,
      bindings: 1,
      queuedItems: 0,
      timers: 0,
      retainedReferences: 2,
    },
  });

  const secondInspection = inspectSafely(transport);
  assert.deepEqual(secondInspection, inspection);
  assert.notStrictEqual(secondInspection, inspection);
  for (const key of [
    "binding",
    "transitions",
    "errors",
    "errorCounts",
    "liveResourceCounts",
  ]) {
    assert.notStrictEqual(secondInspection[key], inspection[key]);
  }
  assert.equal(readyInspection.state, "ready");
  assert.equal(readyInspection.transitionCount, 2);
  assert.equal(readyInspection.transitions.length, 2);
  assert.notStrictEqual(transport.binding, inspection.binding);
  assertDeepFrozen(transport.binding);
});

test("fatal inbound failures count once, close, and fence stale callbacks", () => {
  const joinedText = serverText(JOINED_MESSAGE);
  const cases = [
    {
      code: "binary-frame",
      data: { marker: "raw-binary-payload" },
      raw: "raw-binary-payload",
    },
    {
      code: "invalid-json",
      data: "raw-invalid-json{",
      raw: "raw-invalid-json{",
    },
    {
      code: "unknown-kind",
      data: `{"protocolVersion":${PROTOCOL_VERSION},"kind":"raw_unknown_kind"}`,
      raw: `{"protocolVersion":${PROTOCOL_VERSION},"kind":"raw_unknown_kind"}`,
    },
  ];

  for (const { code, data, raw } of cases) {
    const received = [];
    const transport = createNativeClientTransport({
      url: "ws://example.test/game",
      receive(message) {
        received.push(message);
      },
    });
    expectOk(transport.connect());
    const socket = latestSocket();
    socket.deliverOpen();
    const staleMessage = socket.onmessage;
    assert.equal(typeof staleMessage, "function");

    socket.deliverMessage(data);
    assert.equal(transport.state, "disconnecting");
    assert.equal(socket.readyState, 2);
    assert.equal(socket.closeCount, 1);
    assert.equal(socket.onopen, null);
    assert.equal(socket.onmessage, null);

    staleMessage({ data: joinedText });
    socket.deliverMessage(joinedText);
    socket.deliverError();
    assert.deepEqual(received, []);

    const disconnecting = inspectSafely(transport, [raw, joinedText]);
    assert.equal(disconnecting.transitionCount, 3);
    assert.equal(disconnecting.errorCount, 1);
    assert.deepEqual(disconnecting.errors, [
      {
        sequence: 1,
        runtime: "client",
        operation: "receive",
        state: "ready",
        code,
        expected: true,
        connectionId: null,
      },
    ]);
    assert.deepEqual(disconnecting.errorCounts, expectedErrorCounts(code));

    socket.deliverClose();
    socket.deliverClose();
    assert.equal(transport.state, "closed");
    assert.equal(socket.onclose, null);
    assert.equal(socket.onerror, null);

    const closed = inspectSafely(transport, [raw, joinedText]);
    assert.equal(closed.transitionCount, 4);
    assert.deepEqual(
      closed.transitions.map(
        ({ previousState, nextState, operation }) => ({
          previousState,
          nextState,
          operation,
        }),
      ),
      [
        {
          previousState: "idle",
          nextState: "connecting",
          operation: "connect",
        },
        {
          previousState: "connecting",
          nextState: "ready",
          operation: "connect",
        },
        {
          previousState: "ready",
          nextState: "disconnecting",
          operation: "receive",
        },
        {
          previousState: "disconnecting",
          nextState: "closed",
          operation: "disconnect",
        },
      ],
    );
    assert.equal(closed.errorCount, 1);
    assert.deepEqual(closed.errorCounts, expectedErrorCounts(code));
    assert.ok(
      Object.values(closed.liveResourceCounts).every((count) => count === 0),
    );
  }
});

test("disconnect closes once and command after closed is invalid", () => {
  const { socket, transport } = createJoinedTransport();

  expectOk(transport.disconnect());
  assert.equal(transport.state, "disconnecting");
  assert.equal(socket.closeCount, 1);
  assert.equal(socket.readyState, 2);

  socket.deliverClose();
  assert.equal(transport.state, "closed");
  assert.equal(transport.binding, null);

  const command = {
    protocolVersion: PROTOCOL_VERSION,
    kind: "command",
    sequence: 8,
    intendedTick: 14,
    action: { kind: "move", x: 0, z: 1 },
  };
  const outcome = transport.command(command);
  assertDeepFrozen(outcome);
  assert.deepEqual(outcome, {
    ok: false,
    failure: {
      code: "invalid-state",
      operation: "command",
      state: "closed",
    },
  });

  const inspection = inspectSafely(transport, [
    clientText(command),
    serverText(JOINED_MESSAGE),
  ]);
  assert.equal(inspection.state, "closed");
  assert.equal(inspection.errorCount, 1);
  assert.deepEqual(inspection.errorCounts, expectedErrorCounts("invalid-state"));
  assert.ok(
    Object.values(inspection.liveResourceCounts).every((count) => count === 0),
  );
});

test("live shutdown is identical, waits for close, and clears all resources", async () => {
  const received = [];
  const { socket, transport } = createJoinedTransport((message) => {
    received.push(message);
  });
  const staleMessage = socket.onmessage;
  const snapshotText = serverText(SNAPSHOT_MESSAGE);
  assert.deepEqual(received, [JOINED_MESSAGE]);

  let settled = false;
  const firstShutdown = transport.shutdown();
  firstShutdown.then(() => {
    settled = true;
  });
  const secondShutdown = transport.shutdown();

  assert.equal(firstShutdown, secondShutdown);
  assert.equal(transport.state, "shutting-down");
  assert.equal(transport.binding, null);
  assert.equal(socket.closeCount, 1);
  assert.equal(socket.readyState, 2);
  assert.equal(socket.onopen, null);
  assert.equal(socket.onmessage, null);

  staleMessage({ data: snapshotText });
  assert.deepEqual(received, [JOINED_MESSAGE]);
  await Promise.resolve();
  assert.equal(settled, false);

  const shuttingDown = inspectSafely(transport, [
    serverText(JOINED_MESSAGE),
    snapshotText,
  ]);
  assert.deepEqual(shuttingDown.liveResourceCounts, {
    nativeReferences: 1,
    callbacks: 2,
    bindings: 0,
    queuedItems: 0,
    timers: 0,
    retainedReferences: 1,
  });

  socket.deliverClose();
  assert.deepEqual(await firstShutdown, { ok: true, value: undefined });
  assert.equal(settled, true);
  assert.equal(transport.state, "shutdown");
  assert.equal(transport.binding, null);
  assert.equal(socket.closeCount, 1);
  assert.equal(socket.onopen, null);
  assert.equal(socket.onmessage, null);
  assert.equal(socket.onclose, null);
  assert.equal(socket.onerror, null);

  const shutdown = inspectSafely(transport, [
    serverText(JOINED_MESSAGE),
    snapshotText,
  ]);
  assert.deepEqual(shutdown.liveResourceCounts, {
    nativeReferences: 0,
    callbacks: 0,
    bindings: 0,
    queuedItems: 0,
    timers: 0,
    retainedReferences: 0,
  });
  assert.ok(
    Object.values(shutdown.liveResourceCounts).every((count) => count === 0),
  );
});

test("outbound gate receives frozen detached encoded metadata with stable ordinals", async () => {
  const observed = [];
  const transport = createNativeClientTransport({
    url: "ws://example.test/game",
    receive() {},
    routeOrdinal: 7,
    outboundGate(metadata) {
      observed.push(metadata);
    },
  });
  expectOk(transport.connect());
  const socket = latestSocket();
  socket.deliverOpen();

  const joinText = clientText({
    protocolVersion: PROTOCOL_VERSION,
    kind: "join",
  });
  expectOk(transport.join());
  socket.deliverMessage(serverText(JOINED_MESSAGE));

  const command = {
    protocolVersion: PROTOCOL_VERSION,
    kind: "command",
    sequence: 21,
    intendedTick: 22,
    action: { kind: "move", x: 1, z: 0 },
  };
  const commandText = clientText(command);
  expectOk(transport.command(command));

  assert.deepEqual(observed, [
    {
      direction: "c2s",
      routeOrdinal: 7,
      messageOrdinal: 1,
      operation: "join",
      text: joinText,
    },
    {
      direction: "c2s",
      routeOrdinal: 7,
      messageOrdinal: 2,
      operation: "command",
      text: commandText,
    },
  ]);
  for (const metadata of observed) {
    assert.equal(Object.isFrozen(metadata), true);
    assert.equal(containsFakeWebSocket(metadata), false);
  }
  assert.deepEqual(socket.sentText, [joinText, commandText]);

  const shutdown = transport.shutdown();
  socket.deliverClose();
  await shutdown;
});

test("route ordinal is validated only when an outbound gate is supplied", async () => {
  const withoutGate = createNativeClientTransport({
    url: "ws://example.test/game",
    receive() {},
    routeOrdinal: -1,
  });
  assert.throws(
    () =>
      createNativeClientTransport({
        url: "ws://example.test/game",
        receive() {},
        outboundGate() {},
      }),
    TypeError,
  );
  assert.throws(
    () =>
      createNativeClientTransport({
        url: "ws://example.test/game",
        receive() {},
        routeOrdinal: 0,
        outboundGate() {},
      }),
    TypeError,
  );
  assert.deepEqual(await withoutGate.shutdown(), {
    ok: true,
    value: undefined,
  });
});

test("pending outbound gates account, deliver once, and fence shutdown", async () => {
  const resolvers = [];
  const transport = createNativeClientTransport({
    url: "ws://example.test/game",
    receive() {},
    routeOrdinal: 3,
    outboundGate(metadata) {
      if (metadata.operation === "join") return;
      return new Promise((resolve) => resolvers.push(resolve));
    },
  });
  expectOk(transport.connect());
  const socket = latestSocket();
  socket.deliverOpen();
  expectOk(transport.join());
  socket.deliverMessage(serverText(JOINED_MESSAGE));

  const first = {
    protocolVersion: PROTOCOL_VERSION,
    kind: "command",
    sequence: 31,
    intendedTick: 32,
    action: { kind: "move", x: 0, z: 1 },
  };
  expectOk(transport.command(first));
  assert.equal(transport.inspect().liveResourceCounts.queuedItems, 1);
  assert.deepEqual(socket.sentText, [
    clientText({ protocolVersion: PROTOCOL_VERSION, kind: "join" }),
  ]);
  resolvers.shift()();
  await Promise.resolve();
  assert.equal(transport.inspect().liveResourceCounts.queuedItems, 0);
  assert.deepEqual(socket.sentText.at(-1), clientText(first));

  const second = {
    ...first,
    sequence: 33,
    intendedTick: 34,
  };
  expectOk(transport.command(second));
  const firstShutdown = transport.shutdown();
  const secondShutdown = transport.shutdown();
  assert.equal(firstShutdown, secondShutdown);
  resolvers.shift()();
  await Promise.resolve();
  assert.equal(transport.inspect().liveResourceCounts.queuedItems, 0);
  assert.equal(socket.sentText.includes(clientText(second)), false);
  assert.equal(transport.inspect().errorCount, 0);
  socket.deliverClose();
  await firstShutdown;
});

test("outbound gate rejection after shutdown only releases its queued item", async () => {
  let rejectGate;
  const transport = createNativeClientTransport({
    url: "ws://example.test/game",
    receive() {},
    routeOrdinal: 4,
    outboundGate(metadata) {
      if (metadata.operation === "join") return;
      return new Promise((resolve, reject) => {
        rejectGate = reject;
      });
    },
  });
  expectOk(transport.connect());
  const socket = latestSocket();
  socket.deliverOpen();
  expectOk(transport.join());
  socket.deliverMessage(serverText(JOINED_MESSAGE));

  expectOk(
    transport.command({
      protocolVersion: PROTOCOL_VERSION,
      kind: "command",
      sequence: 35,
      intendedTick: 36,
      action: { kind: "move", x: 1, z: 0 },
    }),
  );
  assert.equal(transport.inspect().liveResourceCounts.queuedItems, 1);

  const shutdown = transport.shutdown();
  socket.deliverClose();
  const shutdownOutcome = await shutdown;
  const beforeRejection = transport.inspect();
  const sentText = socket.sentText.slice();
  const closeCount = socket.closeCount;

  rejectGate(new Error("late rejection"));
  await Promise.resolve();
  await Promise.resolve();

  const afterRejection = transport.inspect();
  assert.deepEqual(afterRejection, {
    ...beforeRejection,
    liveResourceCounts: {
      ...beforeRejection.liveResourceCounts,
      queuedItems: 0,
    },
  });
  assert.deepEqual(socket.sentText, sentText);
  assert.equal(socket.closeCount, closeCount);
  assert.equal(transport.shutdown(), shutdown);
  assert.deepEqual(await transport.shutdown(), shutdownOutcome);
});

test("two pending command gate rejections perform send-failed cleanup once", async () => {
  const rejectors = [];
  const transport = createNativeClientTransport({
    url: "ws://example.test/game",
    receive() {},
    routeOrdinal: 6,
    outboundGate(metadata) {
      if (metadata.operation === "join") return;
      return new Promise((resolve, reject) => rejectors.push(reject));
    },
  });
  expectOk(transport.connect());
  const socket = latestSocket();
  socket.deliverOpen();
  expectOk(transport.join());
  socket.deliverMessage(serverText(JOINED_MESSAGE));

  for (const sequence of [37, 39]) {
    expectOk(
      transport.command({
        protocolVersion: PROTOCOL_VERSION,
        kind: "command",
        sequence,
        intendedTick: sequence + 1,
        action: { kind: "move", x: 0, z: -1 },
      }),
    );
  }
  assert.equal(transport.inspect().liveResourceCounts.queuedItems, 2);

  for (const reject of rejectors) reject(new Error("blocked"));
  await Promise.resolve();
  await Promise.resolve();

  const inspection = transport.inspect();
  assert.equal(inspection.state, "disconnecting");
  assert.equal(inspection.errorCount, 1);
  assert.deepEqual(inspection.errorCounts, expectedErrorCounts("send-failed"));
  assert.equal(inspection.liveResourceCounts.queuedItems, 0);
  assert.equal(socket.sentText.length, 1);
  assert.equal(socket.closeCount, 1);
  socket.deliverClose();
  assert.equal(transport.inspect().errorCount, 1);
});

test("outbound gate throws and rejections use send-failed fatal cleanup once", async () => {
  for (const rejectAsynchronously of [false, true]) {
    const transport = createNativeClientTransport({
      url: "ws://example.test/game",
      receive() {},
      routeOrdinal: 5,
      outboundGate() {
        if (rejectAsynchronously) return Promise.reject(new Error("blocked"));
        throw new Error("blocked");
      },
    });
    expectOk(transport.connect());
    const socket = latestSocket();
    socket.deliverOpen();
    const outcome = transport.join();
    if (rejectAsynchronously) {
      expectOk(outcome);
      await Promise.resolve();
      await Promise.resolve();
    } else {
      assert.deepEqual(outcome, {
        ok: false,
        failure: {
          code: "send-failed",
          operation: "join",
          state: "joining",
        },
      });
    }
    const inspection = transport.inspect();
    assert.equal(inspection.state, "disconnecting");
    assert.equal(inspection.errorCount, 1);
    assert.deepEqual(inspection.errorCounts, expectedErrorCounts("send-failed"));
    assert.equal(inspection.liveResourceCounts.queuedItems, 0);
    assert.equal(socket.sentText.length, 0);
    assert.equal(socket.closeCount, 1);
    socket.deliverClose();
    assert.equal(transport.inspect().errorCount, 1);
  }
});
