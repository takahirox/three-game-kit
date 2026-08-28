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
function clientScheduleReport() {
  return [
    {
      domain: "client-simulation",
      phase: "telemetry",
      priority: 0,
      featureId: "simulation-feature",
      featureDeclarationIndex: 0,
      systemId: "simulation-telemetry",
      withinFeatureDeclarationIndex: 0,
      finalExecutionIndex: 0,
    },
    {
      domain: "client-presentation",
      phase: "frame-telemetry",
      priority: 0,
      featureId: "presentation-feature",
      featureDeclarationIndex: 1,
      systemId: "presentation-telemetry",
      withinFeatureDeclarationIndex: 0,
      finalExecutionIndex: 0,
    },
  ];
}
test("Client observations publish detached immutable scheduling and measurement snapshots", () => {
  const store = createTelemetryStore({ runtime: "client" });
  const report = clientScheduleReport();
  const expectedReport = report.map((entry) => ({ ...entry }));
  store.observeClientSchedule(report);
  store.observeClientTick(12, 3);
  store.observeClientPump(0.25);
  store.observeClientFrame(9, 0.004);
  report[0].featureId = "mutated-after-observation";
  const first = store.snapshotTelemetry();
  const second = store.snapshotTelemetry();
  assert.deepEqual(first.scheduleReport, expectedReport);
  assert.equal(first.simulationTick, 12);
  assert.equal(first.entityCount, 3);
  assert.equal(first.droppedWallTimeSeconds, 0.25);
  assert.equal(first.presentationFrameCount, 9);
  assert.equal(first.clientFrameDurationSeconds, 0.004);
  assert.notEqual(first, second);
  assert.notEqual(first.scheduleReport, second.scheduleReport);
  assert.notEqual(first.scheduleReport[0], second.scheduleReport[0]);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.scheduleReport), true);
  assert.ok(first.scheduleReport.every(Object.isFrozen));
});
test("repeated identical Client observations are inert", () => {
  const store = createTelemetryStore({ runtime: "client" });
  const report = clientScheduleReport();
  store.observeClientSchedule(report);
  store.observeClientTick(4, 2);
  store.observeClientPump(0.5);
  store.observeClientFrame(2, 0.01);
  const before = store.snapshotTelemetry();
  store.observeClientSchedule(report.map((entry) => ({ ...entry })));
  store.observeClientTick(4, 2);
  store.observeClientPump(0.5);
  store.observeClientFrame(2, 0.01);
  const after = store.snapshotTelemetry();
  assert.equal(after.telemetrySequence, before.telemetrySequence);
  assert.equal(after.structuredRuntimeErrorCount, 0);
});
test("invalid Client observations record one invariant and preserve prior values", () => {
  const store = createTelemetryStore({ runtime: "client" });
  const report = clientScheduleReport();
  store.observeClientSchedule(report);
  store.observeClientTick(8, 5);
  store.observeClientPump(1.5);
  store.observeClientFrame(6, 0.02);
  const invalidObservations = [
    ["observe-client-schedule", () => store.observeClientSchedule(null)],
    ["observe-client-tick", () => store.observeClientTick(7, 99)],
    ["observe-client-tick", () => store.observeClientTick(8, -1)],
    ["observe-client-tick", () => store.observeClientTick(Infinity, 99)],
    ["observe-client-pump", () => store.observeClientPump(1)],
    ["observe-client-pump", () => store.observeClientPump(NaN)],
    ["observe-client-frame", () => store.observeClientFrame(5, 1)],
    ["observe-client-frame", () => store.observeClientFrame(6, Infinity)],
    ["observe-client-frame", () => store.observeClientFrame(Infinity, 1)],
  ];
  for (const [operation, observe] of invalidObservations) {
    const beforeCount = store.snapshotTelemetry().structuredRuntimeErrorCount;
    observe();
    const current = store.snapshotTelemetry();
    assert.equal(current.structuredRuntimeErrorCount, beforeCount + 1);
    const record = current.structuredRuntimeErrors.at(-1);
    assert.equal(record.code, "invalid-telemetry-state");
    assert.equal(record.category, "invariant");
    assert.equal(record.operation, operation);
  }
  const snapshot = store.snapshotTelemetry();
  assert.deepEqual(snapshot.scheduleReport, report);
  assert.equal(snapshot.simulationTick, 8);
  assert.equal(snapshot.entityCount, 5);
  assert.equal(snapshot.droppedWallTimeSeconds, 1.5);
  assert.equal(snapshot.presentationFrameCount, 6);
  assert.equal(snapshot.clientFrameDurationSeconds, 0.02);
});
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
