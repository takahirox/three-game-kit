import assert from "node:assert/strict";
import test from "node:test";

import {
  DeterministicMessageInjector,
  INJECTOR_ALGORITHM,
  MessageDirection,
  type InjectorProfile,
} from "./deterministic-message-injector.ts";

const canonicalProfile: InjectorProfile = {
  seed: 0x5eed0007,
  baseRoundTripDelayMs: 100,
  jitterMinMs: 0,
  jitterMaxMs: 20,
  dropRate: 0,
};

const noop = (): void => {};

function canonicalSchedule() {
  const injector = new DeterministicMessageInjector(canonicalProfile);
  injector.enqueue(1, MessageDirection.ClientToServer, noop);
  injector.enqueue(1, MessageDirection.ServerToClient, noop);
  injector.enqueue(1, MessageDirection.ClientToServer, noop);
  injector.enqueue(1, MessageDirection.ServerToClient, noop);
  return injector.getSchedule();
}

test("matches the canonical xorshift32-v1 anchors and freezes the full schedule", () => {
  const schedule = canonicalSchedule();

  assert.equal(INJECTOR_ALGORITHM, "xorshift32-v1");
  assert.deepEqual(
    schedule.map(({ jitterMs: _jitterMs, dropDraw: _dropDraw, ...entry }) => entry),
    [
    {
      algorithm: "xorshift32-v1",
      connectionOrdinal: 1,
      direction: "c2s",
      messageOrdinal: 1,
      enqueueTimeMs: 0,
      scheduledDelayMs: 57,
      dueTimeMs: 57,
      dropped: false,
    },
    {
      algorithm: "xorshift32-v1",
      connectionOrdinal: 1,
      direction: "s2c",
      messageOrdinal: 1,
      enqueueTimeMs: 0,
      scheduledDelayMs: 58,
      dueTimeMs: 58,
      dropped: false,
    },
    {
      algorithm: "xorshift32-v1",
      connectionOrdinal: 1,
      direction: "c2s",
      messageOrdinal: 2,
      enqueueTimeMs: 0,
      scheduledDelayMs: 65,
      dueTimeMs: 65,
      dropped: false,
    },
    {
      algorithm: "xorshift32-v1",
      connectionOrdinal: 1,
      direction: "s2c",
      messageOrdinal: 2,
      enqueueTimeMs: 0,
      scheduledDelayMs: 70,
      dueTimeMs: 70,
      dropped: false,
    },
    ],
  );
  assert.deepEqual(
    schedule.map((entry) => entry.jitterMs),
    [7, 8, 15, 20],
  );
  assert.equal(
    schedule.every(
      (entry) =>
        Number.isFinite(entry.jitterMs) &&
        entry.jitterMs >= canonicalProfile.jitterMinMs &&
        entry.jitterMs <= canonicalProfile.jitterMaxMs,
    ),
    true,
  );
  assert.equal(
    schedule.every(
      (entry) =>
        Number.isFinite(entry.dropDraw) &&
        entry.dropDraw >= 0 &&
        entry.dropDraw < 1,
    ),
    true,
  );
  assert.equal(Object.isFrozen(schedule), true);
  assert.equal(schedule.every(Object.isFrozen), true);
  assert.throws(
    () => (schedule as Array<unknown>).push({}),
    TypeError,
  );
});

test("replays deterministic route streams independently of enqueue interleaving", () => {
  const first = canonicalSchedule();
  const injector = new DeterministicMessageInjector(canonicalProfile);

  injector.enqueue(1, MessageDirection.ServerToClient, noop);
  injector.enqueue(1, MessageDirection.ServerToClient, noop);
  injector.enqueue(1, MessageDirection.ClientToServer, noop);
  injector.enqueue(1, MessageDirection.ClientToServer, noop);

  const byRouteAndOrdinal = (entry: (typeof first)[number]) =>
    `${entry.direction}:${entry.messageOrdinal}`;
  assert.deepEqual(
    [...injector.getSchedule()].sort((left, right) =>
      byRouteAndOrdinal(left).localeCompare(byRouteAndOrdinal(right)),
    ),
    [...first].sort((left, right) =>
      byRouteAndOrdinal(left).localeCompare(byRouteAndOrdinal(right)),
    ),
  );
});

test("uses each delivery time for synchronous response enqueue and drains newly due work", () => {
  const injector = new DeterministicMessageInjector(canonicalProfile);
  const delivered: string[] = [];
  let responseEnqueueTimeMs: number | undefined;
  let responseDueTimeMs: number | undefined;

  const request = injector.enqueue(
    1,
    MessageDirection.ClientToServer,
    () => {
      delivered.push("request");
      const response = injector.enqueue(
        1,
        MessageDirection.ServerToClient,
        () => delivered.push("response"),
      );
      responseEnqueueTimeMs = response.enqueueTimeMs;
      responseDueTimeMs = response.dueTimeMs;
    },
  );

  assert.equal(injector.nowMs, 0);
  assert.equal(request.dueTimeMs, 57);
  injector.advanceTo(200);

  assert.equal(responseEnqueueTimeMs, 57);
  assert.equal(responseDueTimeMs, 115);
  assert.deepEqual(delivered, ["request", "response"]);
  assert.equal(injector.pendingCount, 0);
  assert.equal(injector.nowMs, 200);
});

test("releases a connection incrementally and reports its next due time", () => {
  const injector = new DeterministicMessageInjector(canonicalProfile);
  const delivered: string[] = [];

  injector.enqueue(1, MessageDirection.ClientToServer, () => {
    delivered.push("request");
    injector.enqueue(1, MessageDirection.ServerToClient, () => {
      delivered.push("response");
    });
  });

  assert.equal(injector.nextDueTimeMs, 57);
  assert.equal(injector.releaseConnection(1), 1);
  assert.deepEqual(delivered, ["request"]);
  assert.equal(injector.nowMs, 57);
  assert.equal(injector.nextDueTimeMs, 115);

  assert.equal(injector.releaseConnection(1), 1);
  assert.deepEqual(delivered, ["request", "response"]);
  assert.equal(injector.nowMs, 115);
  assert.equal(injector.nextDueTimeMs, null);
});

test("releases only the selected connection in canonical order", () => {
  const injector = new DeterministicMessageInjector({
    seed: 1,
    baseRoundTripDelayMs: 0,
    jitterMinMs: 0,
    jitterMaxMs: 0,
    dropRate: 0,
  });
  const delivered: string[] = [];

  injector.enqueue(2, MessageDirection.ClientToServer, () => delivered.push("2-c2s-1"));
  injector.enqueue(1, MessageDirection.ServerToClient, () => delivered.push("1-s2c-1"));
  injector.enqueue(1, MessageDirection.ClientToServer, () => delivered.push("1-c2s-1"));
  injector.enqueue(1, MessageDirection.ClientToServer, () => delivered.push("1-c2s-2"));

  assert.equal(injector.releaseConnection(1), 3);
  assert.deepEqual(delivered, ["1-c2s-1", "1-c2s-2", "1-s2c-1"]);
  assert.equal(injector.pendingCount, 1);

  assert.equal(injector.releaseConnection(2), 1);
  assert.deepEqual(delivered, [
    "1-c2s-1",
    "1-c2s-2",
    "1-s2c-1",
    "2-c2s-1",
  ]);
});

test("preserves uninvoked selected deliveries when release callback throws", () => {
  const injector = new DeterministicMessageInjector({
    seed: 1,
    baseRoundTripDelayMs: 20,
    jitterMinMs: 0,
    jitterMaxMs: 0,
    dropRate: 0,
  });
  let laterDelivered = false;

  injector.enqueue(1, MessageDirection.ClientToServer, () => {
    throw new Error("release failed");
  });
  injector.enqueue(1, MessageDirection.ServerToClient, () => {
    laterDelivered = true;
  });

  assert.throws(() => injector.releaseConnection(1), /release failed/);
  assert.equal(injector.nowMs, 10);
  assert.equal(injector.pendingCount, 1);
  assert.equal(laterDelivered, false);

  assert.equal(injector.releaseConnection(1), 1);
  assert.equal(laterDelivered, true);
  assert.equal(injector.pendingCount, 0);
});

test("releasing a connection with no pending deliveries returns zero", () => {
  const injector = new DeterministicMessageInjector(canonicalProfile);

  assert.equal(injector.nextDueTimeMs, null);
  assert.equal(injector.releaseConnection(1), 0);
  assert.equal(injector.nowMs, 0);
});

test("orders equal due times by connection, direction, then route ordinal", () => {
  const injector = new DeterministicMessageInjector({
    seed: 1,
    baseRoundTripDelayMs: 0,
    jitterMinMs: 0,
    jitterMaxMs: 0,
    dropRate: 0,
  });
  const delivered: string[] = [];

  injector.enqueue(2, MessageDirection.ClientToServer, () => delivered.push("2-c2s-1"));
  injector.enqueue(1, MessageDirection.ServerToClient, () => delivered.push("1-s2c-1"));
  injector.enqueue(1, MessageDirection.ClientToServer, () => delivered.push("1-c2s-1"));
  injector.enqueue(1, MessageDirection.ClientToServer, () => delivered.push("1-c2s-2"));
  injector.advanceTo(0);

  assert.deepEqual(delivered, [
    "1-c2s-1",
    "1-c2s-2",
    "1-s2c-1",
    "2-c2s-1",
  ]);
});

test("leaves delivery time and remaining messages intact when a callback throws", () => {
  const injector = new DeterministicMessageInjector({
    seed: 1,
    baseRoundTripDelayMs: 20,
    jitterMinMs: 0,
    jitterMaxMs: 0,
    dropRate: 0,
  });
  let laterDelivered = false;

  injector.enqueue(1, MessageDirection.ClientToServer, () => {
    throw new Error("delivery failed");
  });
  injector.enqueue(1, MessageDirection.ServerToClient, () => {
    laterDelivered = true;
  });

  assert.throws(() => injector.advanceTo(100), /delivery failed/);
  assert.equal(injector.nowMs, 10);
  assert.equal(injector.pendingCount, 1);
  assert.equal(laterDelivered, false);

  injector.advanceTo(100);
  assert.equal(laterDelivered, true);
  assert.equal(injector.nowMs, 100);
});

test("supports drop rates zero and one while retaining every schedule record", () => {
  let zeroDropDeliveries = 0;
  const zeroDrop = new DeterministicMessageInjector({
    ...canonicalProfile,
    dropRate: 0,
  });
  zeroDrop.enqueue(1, MessageDirection.ClientToServer, () => zeroDropDeliveries++);
  zeroDrop.enqueue(1, MessageDirection.ClientToServer, () => zeroDropDeliveries++);
  zeroDrop.advanceTo(1_000);
  assert.equal(zeroDropDeliveries, 2);
  assert.deepEqual(
    zeroDrop.getSchedule().map((entry) => entry.dropped),
    [false, false],
  );

  let fullDropDeliveries = 0;
  const fullDrop = new DeterministicMessageInjector({
    ...canonicalProfile,
    dropRate: 1,
  });
  fullDrop.enqueue(1, MessageDirection.ClientToServer, () => fullDropDeliveries++);
  fullDrop.enqueue(1, MessageDirection.ClientToServer, () => fullDropDeliveries++);
  fullDrop.advanceTo(1_000);
  assert.equal(fullDropDeliveries, 0);
  assert.equal(fullDrop.pendingCount, 0);
  assert.deepEqual(
    fullDrop.getSchedule().map((entry) => entry.dropped),
    [true, true],
  );
  assert.deepEqual(
    fullDrop.getSchedule().map((entry) => entry.scheduledDelayMs),
    [57, 65],
  );
});

test("requires a positive safe connection ordinal", () => {
  const injector = new DeterministicMessageInjector(canonicalProfile);

  assert.throws(
    () => injector.enqueue(0, MessageDirection.ClientToServer, noop),
    /positive safe integer/,
  );
  assert.throws(
    () => injector.enqueue(Number.MAX_SAFE_INTEGER + 1, MessageDirection.ClientToServer, noop),
    /positive safe integer/,
  );
  assert.throws(() => injector.releaseConnection(0), /positive safe integer/);
  assert.throws(
    () => injector.releaseConnection(Number.MAX_SAFE_INTEGER + 1),
    /positive safe integer/,
  );
});

test("shutdown is idempotent and clears pending deliveries", () => {
  const injector = new DeterministicMessageInjector(canonicalProfile);
  let delivered = false;
  injector.enqueue(1, MessageDirection.ClientToServer, () => {
    delivered = true;
  });

  injector.shutdown();
  injector.shutdown();

  assert.equal(injector.isShutdown, true);
  assert.equal(injector.pendingCount, 0);
  injector.advanceTo(1_000);
  assert.equal(delivered, false);
  assert.throws(
    () => injector.enqueue(1, MessageDirection.ClientToServer, noop),
    /shut down/,
  );
});
