import assert from "node:assert/strict";
import test from "node:test";
import {
  LIVE_RESOURCE_KINDS,
  REJECTED_COMMAND_REASONS,
  RUNTIME_ERROR_RING_CAPACITY,
  RUNTIME_ERROR_SERIALIZED_BYTE_LIMIT,
  WALL_CLOCK_ACCUMULATOR_CAP_SECONDS,
  createRuntimeErrorRecord,
  createServerSchedule,
  createTelemetryStore,
  createWorld,
} from "@three-game-kit/core";
function declaration({
  id = "system",
  phase = "ingress",
  priority = 0,
  featureId = "feature",
  featureDeclarationIndex = 0,
  within = 0,
  run = () => undefined,
} = {}) {
  return {
    domain: "server-simulation",
    phase,
    priority,
    featureId,
    featureDeclarationIndex,
    systemId: id,
    withinFeatureDeclarationIndex: within,
    run,
  };
}
function successfulSchedule(options) {
  const result = createServerSchedule(options);
  assert.equal(result.ok, true);
  return result.value;
}
const zeroResources = Object.fromEntries(
  LIVE_RESOURCE_KINDS.map((kind) => [kind, 0]),
);
const zeroRejections = Object.fromEntries(
  REJECTED_COMMAND_REASONS.map((reason) => [reason, 0]),
);
test("fresh Server snapshots have the exact zero schema and snapshotting is detached and inert", () => {
  const store = createTelemetryStore({ runtime: "server" });
  const first = store.snapshotTelemetry();
  const second = store.snapshotTelemetry();
  const expected = {
    schemaVersion: 1,
    runtime: "server",
    telemetrySequence: 0,
    simulationTick: 0,
    entityCount: 0,
    installedFeatureIds: [],
    droppedWallTimeSeconds: 0,
    scheduleReport: null,
    connection: null,
    liveResources: zeroResources,
    structuredRuntimeErrorCount: 0,
    structuredRuntimeErrorEvictedCount: 0,
    structuredRuntimeErrors: [],
    serverTickDurationSeconds: null,
    serverBacklogSeconds: 0,
    rejectedCommandCounts: zeroRejections,
  };
  assert.deepEqual(first, expected);
  assert.deepEqual(second, expected);
  assert.notEqual(first, second);
  assert.notEqual(first.liveResources, second.liveResources);
  assert.notEqual(
    first.structuredRuntimeErrors,
    second.structuredRuntimeErrors,
  );
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.liveResources), true);
  assert.equal(Object.isFrozen(first.structuredRuntimeErrors), true);
});
test("exact and wall-clock scheduling publish exact ticks, finite duration, backlog, and discarded time", () => {
  let observedTime = 0;
  const exact = successfulSchedule({
    driver: "exact",
    world: createWorld(),
    systems: [declaration({ run: ({ dt }) => assert.equal(dt, 1 / 60) })],
    observationClock: () => {
      const value = observedTime;
      observedTime += 0.001;
      return value;
    },
  });
  assert.equal(exact.stepExact(60).value, 60);
  const exactSnapshot = exact.snapshotTelemetry();
  assert.equal(exactSnapshot.simulationTick, 60);
  assert.ok(Number.isFinite(exactSnapshot.serverTickDurationSeconds));
  assert.ok(exactSnapshot.serverTickDurationSeconds >= 0);
  assert.equal(exactSnapshot.serverBacklogSeconds, 0);
  assert.equal(exactSnapshot.droppedWallTimeSeconds, 0);
  const wall = successfulSchedule({
    driver: "wall-clock",
    world: createWorld(),
    systems: [declaration()],
    observationClock: () => 0,
  });
  const report = wall.pumpWallClock(1).value;
  const wallSnapshot = wall.snapshotTelemetry();
  assert.equal(
    report.backlogBeforeExecutionSeconds,
    WALL_CLOCK_ACCUMULATOR_CAP_SECONDS,
  );
  assert.equal(
    wallSnapshot.serverBacklogSeconds,
    report.backlogBeforeExecutionSeconds,
  );
  assert.equal(
    wallSnapshot.droppedWallTimeSeconds,
    report.cumulativeDiscardedSeconds,
  );
  assert.ok(Math.abs(wallSnapshot.droppedWallTimeSeconds - 11 / 12) < 1e-12);
  assert.equal(wallSnapshot.simulationTick, 5);
});
test("telemetry schedule reports equal scheduler inspection and execution order", () => {
  const trace = [];
  const systems = [
    declaration({
      id: "b",
      featureId: "b",
      featureDeclarationIndex: 1,
      run: () => trace.push("b"),
    }),
    declaration({
      id: "a-later",
      featureId: "a",
      within: 1,
      run: () => trace.push("a-later"),
    }),
    declaration({
      id: "a-first",
      featureId: "a",
      run: () => trace.push("a-first"),
    }),
  ];
  const runtime = successfulSchedule({
    driver: "exact",
    world: createWorld(),
    systems,
  });
  assert.equal(runtime.stepExact(1).ok, true);
  const snapshot = runtime.snapshotTelemetry();
  assert.deepEqual(snapshot.scheduleReport, runtime.scheduleReport);
  assert.deepEqual(
    snapshot.scheduleReport.map((entry) => entry.systemId),
    trace,
  );
  assert.notEqual(snapshot.scheduleReport, runtime.scheduleReport);
  assert.ok(snapshot.scheduleReport.every(Object.isFrozen));
});
test("the immutable ring retains 256 records while total and eviction counts stay exact", () => {
  const store = createTelemetryStore({ runtime: "server" });
  for (let index = 0; index < RUNTIME_ERROR_RING_CAPACITY; index += 1)
    store.recordRuntimeError({
      code: "fixture-error",
      category: "expected",
      runtime: "server",
      operation: "fixture",
      message: "Fixture failure",
    });
  const earlier = store.snapshotTelemetry();
  store.recordRuntimeError({
    code: "fixture-error",
    category: "expected",
    runtime: "server",
    operation: "fixture",
    message: "Fixture failure",
  });
  const current = store.snapshotTelemetry();
  assert.equal(current.structuredRuntimeErrorCount, 257);
  assert.equal(current.structuredRuntimeErrorEvictedCount, 1);
  assert.equal(current.structuredRuntimeErrors.length, 256);
  assert.equal(current.structuredRuntimeErrors[0].sequence, 2);
  assert.equal(current.structuredRuntimeErrors.at(-1).sequence, 257);
  assert.deepEqual(
    current.structuredRuntimeErrors.map((record) => record.sequence),
    Array.from({ length: 256 }, (_, index) => index + 2),
  );
  assert.equal(earlier.structuredRuntimeErrorCount, 256);
  assert.equal(earlier.structuredRuntimeErrorEvictedCount, 0);
  assert.equal(earlier.structuredRuntimeErrors[0].sequence, 1);
  assert.equal(Object.isFrozen(current.structuredRuntimeErrors), true);
  assert.ok(current.structuredRuntimeErrors.every(Object.isFrozen));
});
test("record creation sanitizes malicious and over-bound input into bounded JSON-only values", () => {
  const cause = new Error("Authorization=Bearer raw-cause-secret");
  cause.code = "VENDOR\nCODE";
  cause.stack = "raw stack secret";
  const record = createRuntimeErrorRecord({
    sequence: 1,
    code: "malicious-fixture",
    category: "invariant",
    runtime: "server",
    operation: "sanitize-fixture",
    message: `password=hunter2 https://user:pass@example.test/path?q=secret#fragment ${'😀\\"'.repeat(1_000)}`,
    featureId: `${"é".repeat(200)}\n`,
    context: [
      { key: "password", value: "context-secret" },
      { key: "Authorization", value: "Bearer context-token" },
      { key: "stackTrace", value: "raw stack" },
      { key: "finite", value: 4 },
      { key: "nonFinite", value: Number.POSITIVE_INFINITY },
      { key: "vendor", value: { socket: true } },
      { key: "line\nbreak", value: "value\r\nnext" },
      ...Array.from({ length: 30 }, (_, index) => ({
        key: `safe-${index}`,
        value: `value-${index}-${"x".repeat(500)}`,
      })),
    ],
    cause,
  });
  const serialized = JSON.stringify(record);
  assert.ok(
    new TextEncoder().encode(serialized).byteLength <=
      RUNTIME_ERROR_SERIALIZED_BYTE_LIMIT,
  );
  for (const forbidden of [
    "hunter2",
    "user:pass",
    "q=secret",
    "context-secret",
    "context-token",
    "raw stack",
    "socket",
    "raw-cause-secret",
    '"stack"',
  ])
    assert.equal(serialized.includes(forbidden), false);
  assert.equal(record.context.length <= 16, true);
  assert.ok(
    record.context.every(
      (entry) =>
        Number.isFinite(entry.value) || typeof entry.value !== "number",
    ),
  );
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.context), true);
  assert.equal(Object.isFrozen(record.cause), true);
  assert.deepEqual(
    JSON.parse(serialized),
    JSON.parse(JSON.stringify(JSON.parse(serialized))),
  );
  const generic = createRuntimeErrorRecord({
    sequence: 2,
    code: "vendor-threw",
    category: "invariant",
    runtime: "transport",
    operation: "vendor-callback",
    message: "Vendor callback failed",
    cause: { password: "never-read", stack: "never-read" },
  });
  assert.deepEqual(generic.cause, {
    name: "object",
    code: null,
    message: "Non-Error thrown value",
  });
  assert.equal(JSON.stringify(generic).includes("never-read"), false);
});
test("reason codes increment the complete rejection map atomically and gauges remain fixed-vocabulary", () => {
  const store = createTelemetryStore({ runtime: "server" });
  const record = store.recordRuntimeError({
    code: "queue-full",
    category: "expected",
    runtime: "server",
    operation: "admit-command",
    message: "The decoded command queue is full",
    reasonCode: "queue-full",
  });
  const snapshot = store.snapshotTelemetry();
  assert.equal(record.reasonCode, "queue-full");
  assert.equal(snapshot.rejectedCommandCounts["queue-full"], 1);
  assert.equal(
    Object.keys(snapshot.rejectedCommandCounts).length,
    REJECTED_COMMAND_REASONS.length,
  );
  for (const reason of REJECTED_COMMAND_REASONS)
    assert.equal(
      snapshot.rejectedCommandCounts[reason],
      reason === "queue-full" ? 1 : 0,
    );
  assert.deepEqual(Object.keys(snapshot.liveResources), LIVE_RESOURCE_KINDS);
  assert.ok(
    Object.values(snapshot.liveResources).every((value) => value === 0),
  );
  assert.equal(snapshot.structuredRuntimeErrorCount, 1);
  assert.equal(snapshot.telemetrySequence, 1);
});
