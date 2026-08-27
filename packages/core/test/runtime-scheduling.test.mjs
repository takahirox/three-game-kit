import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_WALL_CLOCK_TICKS_PER_PUMP,
  SERVER_SIMULATION_PHASES,
  SIMULATION_DT_SECONDS,
  WALL_CLOCK_ACCUMULATOR_CAP_SECONDS,
  createBoundedMailbox,
  createRuntimeLiveFence,
  createServerSchedule,
  createTelemetryStore,
  createWorld,
} from "@three-game-kit/core";
function system({
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
function schedule(driver, systems, options = {}) {
  const result = createServerSchedule({
    driver,
    world: createWorld(),
    systems,
    ...options,
  });
  assert.equal(result.ok, true);
  return result.value;
}
test("exact steps use every Server phase, increment before running, and carry exact dt", () => {
  const trace = [];
  const systems = SERVER_SIMULATION_PHASES.map((phase, within) =>
    system({
      id: phase,
      phase,
      within,
      run: ({ tick, dt }) => trace.push({ phase, tick, dt }),
    }),
  );
  const runtime = schedule("exact", systems);
  const result = runtime.stepExact(60);
  assert.deepEqual(result, { ok: true, value: 60 });
  assert.equal(trace.length, 60 * SERVER_SIMULATION_PHASES.length);
  for (let tick = 1; tick <= 60; tick += 1) {
    const slice = trace.slice((tick - 1) * 8, tick * 8);
    assert.deepEqual(
      slice.map((entry) => entry.phase),
      SERVER_SIMULATION_PHASES,
    );
    assert.ok(
      slice.every((entry) => entry.tick === tick && entry.dt === 1 / 60),
    );
  }
  assert.equal(runtime.tick, 60);
  assert.equal(runtime.accumulatorSeconds, 0);
  assert.equal(Object.isFrozen(runtime.scheduleReport), true);
  assert.ok(runtime.scheduleReport.every(Object.isFrozen));
});
test("reports and execution use phase, signed priority, Feature order, and within-Feature order", () => {
  const observed = [];
  const systems = [
    system({
      id: "gameplay-first-priority",
      phase: "gameplay",
      priority: Number.MIN_SAFE_INTEGER,
      featureId: "c",
      featureDeclarationIndex: 2,
      within: 1,
      run: () => observed.push("gameplay-first-priority"),
    }),
    system({
      id: "late",
      priority: 5,
      featureId: "a",
      run: () => observed.push("late"),
      within: 5,
    }),
    system({
      id: "b",
      featureId: "b",
      featureDeclarationIndex: 1,
      run: () => observed.push("b"),
    }),
    system({
      id: "a-second",
      featureId: "a",
      featureDeclarationIndex: 0,
      within: 1,
      run: () => observed.push("a-second"),
    }),
    system({
      id: "c",
      featureId: "c",
      featureDeclarationIndex: 2,
      run: () => observed.push("c"),
    }),
    system({
      id: "a-first",
      featureId: "a",
      featureDeclarationIndex: 0,
      run: () => observed.push("a-first"),
    }),
    system({
      id: "negative",
      priority: -2,
      featureId: "a",
      within: 4,
      run: () => observed.push("negative"),
    }),
  ];
  const runtime = schedule("exact", systems);
  assert.equal(runtime.stepExact(1).ok, true);
  assert.deepEqual(observed, [
    "negative",
    "a-first",
    "a-second",
    "b",
    "c",
    "late",
    "gameplay-first-priority",
  ]);
  assert.deepEqual(
    runtime.scheduleReport.map((entry) => entry.systemId),
    observed,
  );
  assert.deepEqual(
    runtime.scheduleReport.map((entry) => entry.finalExecutionIndex),
    [0, 1, 2, 3, 4, 5, 6],
  );
  let calls = 0;
  const invalid = [
    [
      system({ id: "duplicate", run: () => (calls += 1) }),
      system({ id: "duplicate" }),
    ],
    [{ ...system(), domain: "client-simulation" }],
    [{ ...system(), phase: "reconcile" }],
    [{ ...system(), priority: Number.MAX_SAFE_INTEGER + 1 }],
    [{ ...system(), priority: 1.5 }],
    [{ ...system(), before: "another-system" }],
  ];
  for (const declarations of invalid) {
    const result = createServerSchedule({
      driver: "exact",
      world: createWorld(),
      systems: declarations,
    });
    assert.equal(result.ok, false);
    assert.equal(Object.isFrozen(result.error), true);
  }
  assert.equal(calls, 0);
});
test("driver choice is immutable and exact zero-step is a clock-free no-op", () => {
  const exact = schedule("exact", [system()]);
  const before = exact.inspectScheduling();
  assert.deepEqual(exact.stepExact(0), { ok: true, value: 0 });
  assert.equal(exact.accumulatorSeconds, 0);
  const wrongPump = exact.pumpWallClock(0);
  assert.equal(wrongPump.ok, false);
  assert.equal(wrongPump.error.code, "driver-mode");
  assert.equal(exact.tick, before.tick);
  const wall = schedule("wall-clock", [system()]);
  const wrongStep = wall.stepExact(1);
  assert.equal(wrongStep.ok, false);
  assert.equal(wrongStep.error.code, "driver-mode");
});
test("wall-clock pumps cap backlog, run five ticks, discard whole ticks, and retain remainders", () => {
  const runtime = schedule("wall-clock", [system()]);
  const pumped = runtime.pumpWallClock(1);
  assert.equal(pumped.ok, true);
  assert.equal(
    pumped.value.backlogBeforeExecutionSeconds,
    WALL_CLOCK_ACCUMULATOR_CAP_SECONDS,
  );
  assert.equal(pumped.value.ticksExecuted, MAX_WALL_CLOCK_TICKS_PER_PUMP);
  assert.equal(runtime.tick, 5);
  assert.ok(
    pumped.value.accumulatorSeconds >= 0 &&
      pumped.value.accumulatorSeconds < SIMULATION_DT_SECONDS,
  );
  assert.ok(Math.abs(pumped.value.discardedSeconds - 11 / 12) < 1e-12);
  assert.equal(Object.isFrozen(pumped.value), true);
  assert.equal(runtime.lastPump, pumped.value);
  const repeated = schedule("wall-clock", [system()]);
  assert.equal(
    repeated.pumpWallClock(SIMULATION_DT_SECONDS / 2).value.ticksExecuted,
    0,
  );
  assert.equal(
    repeated.pumpWallClock(SIMULATION_DT_SECONDS / 2).value.ticksExecuted,
    1,
  );
  const state = repeated.inspectScheduling();
  for (const elapsed of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const rejected = repeated.pumpWallClock(elapsed);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, "clock-failure");
    assert.equal(repeated.tick, state.tick);
    assert.equal(repeated.accumulatorSeconds, state.accumulatorSeconds);
  }
});
test("throwing and thenable systems emit one invariant and abort later systems", () => {
  const thenTrace = [];
  const thenable = schedule("exact", [
    system({ id: "before", within: 0, run: () => thenTrace.push("before") }),
    system({ id: "thenable", within: 1, run: () => ({ then() {} }) }),
    system({ id: "later", within: 2, run: () => thenTrace.push("later") }),
  ]);
  const thenResult = thenable.stepExact(1);
  assert.equal(thenResult.ok, false);
  assert.equal(thenResult.error.code, "system-returned-thenable");
  assert.equal(thenResult.error.category, "invariant");
  assert.equal(thenResult.error.tick, 1);
  assert.deepEqual(thenTrace, ["before"]);
  assert.equal(thenable.errors.length, 1);
  const thrown = schedule("exact", [
    system({
      run: () => {
        throw new Error("boom");
      },
    }),
  ]);
  const throwResult = thrown.stepExact(1);
  assert.equal(throwResult.ok, false);
  assert.equal(throwResult.error.code, "system-threw");
  assert.equal(throwResult.error.cause.message, "boom");
  assert.equal(thrown.errors.length, 1);
});
test("tick overflow and stop reject before another system executes", () => {
  let calls = 0;
  const runtime = schedule("exact", [system({ run: () => (calls += 1) })]);
  assert.equal(runtime.stepExact(1).ok, true);
  const overflow = runtime.stepExact(Number.MAX_SAFE_INTEGER);
  assert.equal(overflow.ok, false);
  assert.equal(overflow.error.code, "tick-overflow");
  assert.equal(runtime.tick, 1);
  assert.equal(calls, 1);
  runtime.stop();
  runtime.stop();
  const stopped = runtime.stepExact(1);
  assert.equal(stopped.ok, false);
  assert.equal(stopped.error.code, "runtime-stopped");
  assert.equal(calls, 1);
  const wall = schedule("wall-clock", [system({ run: () => (calls += 1) })]);
  wall.stop();
  assert.equal(wall.pumpWallClock(1).error.code, "runtime-stopped");
  assert.equal(calls, 1);
});
test("copied mailbox values drain only at a phase boundary and overflow cannot mutate state", () => {
  const fence = createRuntimeLiveFence(7);
  const token = fence.capture();
  const mailbox = createBoundedMailbox({
    capacity: 1,
    fence,
    copySnapshot: (value) => Object.freeze({ value: value.value }),
  });
  const input = { value: 1 };
  assert.equal(mailbox.enqueue(input, token).status, "accepted");
  input.value = 99;
  assert.equal(mailbox.enqueue({ value: 500 }, token).status, "overflow");
  const applied = [];
  const runtime = schedule("exact", [
    system({
      id: "ingress-drain",
      phase: "ingress",
      run: ({ tick }) => {
        for (const value of mailbox.drainPhase()) applied.push(value.value);
        if (tick === 1)
          assert.equal(mailbox.enqueue({ value: 2 }, token).status, "accepted");
      },
    }),
  ]);
  assert.deepEqual(applied, []);
  assert.equal(runtime.stepExact(1).ok, true);
  assert.deepEqual(applied, [1]);
  assert.equal(mailbox.size, 1);
  assert.equal(runtime.stepExact(1).ok, true);
  assert.deepEqual(applied, [1, 2]);
  const telemetry = mailbox.inspect();
  assert.equal(telemetry.overflowCount, 1);
  assert.equal(telemetry.acceptedCount, 2);
  assert.equal(telemetry.drainedCount, 2);
  assert.equal(Object.isFrozen(telemetry), true);
});
test("mailbox generation fences, stop, clear, and zero capacity are explicit", () => {
  const fence = createRuntimeLiveFence(3);
  const token = fence.capture();
  const mailbox = createBoundedMailbox({
    capacity: 2,
    fence,
    copySnapshot: (value) => value,
  });
  assert.equal(mailbox.enqueue("forged", { generation: 3 }).status, "fenced");
  assert.equal(mailbox.enqueue("kept", token).status, "accepted");
  fence.stop();
  assert.equal(mailbox.enqueue("late", token).status, "fenced");
  assert.equal(mailbox.size, 1);
  mailbox.stop();
  mailbox.stop();
  assert.equal(mailbox.enqueue("stopped", token).status, "stopped");
  assert.equal(mailbox.clear(), 1);
  assert.equal(mailbox.clear(), 0);
  assert.deepEqual(mailbox.drainPhase(), []);
  assert.deepEqual(mailbox.inspect(), {
    capacity: 2,
    size: 0,
    acceptedCount: 1,
    overflowCount: 0,
    fencedCount: 2,
    stoppedCount: 1,
    drainedCount: 0,
    clearedCount: 1,
    live: false,
    generation: 3,
  });
  const zeroFence = createRuntimeLiveFence();
  const zero = createBoundedMailbox({
    capacity: 0,
    fence: zeroFence,
    copySnapshot: (value) => value,
  });
  assert.equal(zero.enqueue(1, zeroFence.capture()).status, "overflow");
});
test("scheduler telemetry uses one capture boundary and deterministic observation timing", () => {
  const observed = [];
  const store = createTelemetryStore({
    runtime: "server",
    observeRuntimeError: (record) => observed.push(record),
  });
  let time = 0;
  const runtime = schedule(
    "exact",
    [
      system({
        featureId: "thrower",
        run: () => {
          throw new Error("bounded boom");
        },
      }),
    ],
    {
      telemetryStore: store,
      observationClock: () => {
        time += 0.25;
        return time;
      },
    },
  );
  const failed = runtime.stepExact(1);
  assert.equal(failed.ok, false);
  assert.equal(failed.error, observed[0]);
  assert.equal(observed.length, 1);
  assert.equal(runtime.errors.length, 1);
  assert.equal(runtime.snapshotTelemetry().structuredRuntimeErrorCount, 1);
  assert.equal(failed.error.featureId, "thrower");
  assert.equal(failed.error.tick, 1);
});
test("invalid schedules publish one expected record through a supplied store", () => {
  const observed = [];
  const store = createTelemetryStore({
    runtime: "server",
    observeRuntimeError: (record) => observed.push(record),
  });
  const result = createServerSchedule({
    driver: "exact",
    world: createWorld(),
    systems: [{ ...system(), phase: "render" }],
    telemetryStore: store,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.category, "expected");
  assert.equal(result.error.expected, true);
  assert.equal(result.error, observed[0]);
  assert.equal(observed.length, 1);
  assert.equal(store.snapshotTelemetry().structuredRuntimeErrorCount, 1);
});
