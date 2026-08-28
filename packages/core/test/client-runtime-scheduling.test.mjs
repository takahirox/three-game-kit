import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_PRESENTATION_PHASES,
  CLIENT_SIMULATION_PHASES,
  MAX_WALL_CLOCK_TICKS_PER_PUMP,
  SIMULATION_DT_SECONDS,
  WALL_CLOCK_ACCUMULATOR_CAP_SECONDS,
  createClientSchedule,
  createDeterministicPresentationFrameSource,
  createTelemetryStore,
  createWorld,
} from "@three-game-kit/core";

function simulationSystem({
  id = "simulation",
  phase = "snapshot-ingest",
  priority = 0,
  featureId = "simulation-feature",
  featureDeclarationIndex = 0,
  within = 0,
  run = () => undefined,
} = {}) {
  return {
    domain: "client-simulation",
    phase,
    priority,
    featureId,
    featureDeclarationIndex,
    systemId: id,
    withinFeatureDeclarationIndex: within,
    run,
  };
}

function presentationSystem({
  id = "presentation",
  phase = "remote-interpolation",
  priority = 0,
  featureId = "presentation-feature",
  featureDeclarationIndex = 1,
  within = 0,
  run = () => undefined,
} = {}) {
  return {
    domain: "client-presentation",
    phase,
    priority,
    featureId,
    featureDeclarationIndex,
    systemId: id,
    withinFeatureDeclarationIndex: within,
    run,
  };
}

function schedule({
  driver = "exact",
  simulationSystems = [],
  presentationSystems = [],
  frameSource = createDeterministicPresentationFrameSource(),
  world = createWorld(),
  telemetryStore,
  observationClock,
} = {}) {
  const result = createClientSchedule({
    driver,
    world,
    simulationSystems,
    presentationSystems,
    frameSource,
    telemetryStore,
    observationClock,
  });
  assert.equal(result.ok, true);
  return { runtime: result.value, frameSource };
}

test("120 exact Client ticks and 75 presentation frames stay independent and use every exact phase", () => {
  const simulationTrace = [];
  const presentationTrace = [];
  const telemetryStore = createTelemetryStore({ runtime: "client" });
  const world = createWorld();
  world.createEntity();
  let observationSecond = 0;
  let collisions = 0;
  const simulationSystems = CLIENT_SIMULATION_PHASES.map((phase, within) =>
    simulationSystem({
      id: `simulation-${phase}`,
      phase,
      within,
      run: ({ tick, dt }) => {
        simulationTrace.push({ phase, tick, dt });
        if (phase === "predictive-collision") collisions += 1;
      },
    }),
  );
  const presentationSystems = CLIENT_PRESENTATION_PHASES.map((phase, within) =>
    presentationSystem({
      id: `presentation-${phase}`,
      phase,
      within,
      run: ({ frame, timestampMs }) =>
        presentationTrace.push({ phase, frame, timestampMs }),
    }),
  );
  const { runtime, frameSource } = schedule({
    simulationSystems,
    presentationSystems,
    world,
    telemetryStore,
    observationClock: () => observationSecond++,
  });

  const creationTelemetry = telemetryStore.snapshotTelemetry();
  assert.deepEqual(creationTelemetry.scheduleReport, runtime.scheduleReport);
  assert.equal(Object.isFrozen(creationTelemetry.scheduleReport), true);

  assert.deepEqual(runtime.stepExact(120), { ok: true, value: 120 });
  assert.equal(runtime.presentationFrameCount, 0);
  assert.equal(presentationTrace.length, 0);
  assert.equal(collisions, 120);
  for (let tick = 1; tick <= 120; tick += 1) {
    const slice = simulationTrace.slice((tick - 1) * 8, tick * 8);
    assert.deepEqual(
      slice.map((entry) => entry.phase),
      CLIENT_SIMULATION_PHASES,
    );
    assert.ok(
      slice.every(
        (entry) => entry.tick === tick && entry.dt === SIMULATION_DT_SECONDS,
      ),
    );
  }

  assert.deepEqual(runtime.startPresentation(), { ok: true, value: true });
  for (let frame = 1; frame <= 75; frame += 1)
    assert.equal(frameSource.deliver(frame * 8.25), true);
  assert.equal(runtime.tick, 120);
  assert.equal(runtime.presentationFrameCount, 75);
  assert.equal(simulationTrace.length, 120 * 8);
  assert.equal(presentationTrace.length, 75 * 4);
  for (let frame = 1; frame <= 75; frame += 1) {
    const slice = presentationTrace.slice((frame - 1) * 4, frame * 4);
    assert.deepEqual(
      slice.map((entry) => entry.phase),
      CLIENT_PRESENTATION_PHASES,
    );
    assert.ok(
      slice.every(
        (entry) => entry.frame === frame && entry.timestampMs === frame * 8.25,
      ),
    );
  }
  const telemetry = telemetryStore.snapshotTelemetry();
  assert.equal(telemetry.simulationTick, 120);
  assert.equal(telemetry.entityCount, 1);
  assert.equal(telemetry.droppedWallTimeSeconds, 0);
  assert.equal(telemetry.presentationFrameCount, 75);
  assert.equal(telemetry.clientFrameDurationSeconds, 1);
  assert.deepEqual(telemetry.scheduleReport, runtime.scheduleReport);
  assert.equal(observationSecond, 150);
  assert.equal(frameSource.outstandingRequestCount, 1);
  const beforeStop = telemetryStore.snapshotTelemetry();
  runtime.stop();
  assert.equal(frameSource.outstandingRequestCount, 0);
  assert.deepEqual(telemetryStore.snapshotTelemetry(), beforeStop);
});

test("both frozen reports use phase, signed priority, Feature order, and within-Feature order", () => {
  const simulationTrace = [];
  const presentationTrace = [];
  const simulationSystems = [
    simulationSystem({
      id: "later-phase-negative",
      phase: "reconcile",
      priority: Number.MIN_SAFE_INTEGER,
      featureId: "c",
      featureDeclarationIndex: 2,
      run: () => simulationTrace.push("later-phase-negative"),
    }),
    simulationSystem({
      id: "positive",
      priority: 4,
      featureId: "a",
      within: 2,
      run: () => simulationTrace.push("positive"),
    }),
    simulationSystem({
      id: "feature-b",
      featureId: "b",
      featureDeclarationIndex: 1,
      run: () => simulationTrace.push("feature-b"),
    }),
    simulationSystem({
      id: "a-second",
      featureId: "a",
      within: 1,
      run: () => simulationTrace.push("a-second"),
    }),
    simulationSystem({
      id: "a-first",
      featureId: "a",
      run: () => simulationTrace.push("a-first"),
    }),
    simulationSystem({
      id: "negative",
      priority: -3,
      featureId: "a",
      within: 3,
      run: () => simulationTrace.push("negative"),
    }),
  ];
  const presentationSystems = CLIENT_PRESENTATION_PHASES.map((phase, within) =>
    presentationSystem({
      id: `ordered-${phase}`,
      phase,
      priority: phase === "remote-interpolation" ? 99 : -99,
      featureDeclarationIndex: 3,
      within,
      run: () => presentationTrace.push(phase),
    }),
  );
  const { runtime, frameSource } = schedule({
    simulationSystems,
    presentationSystems,
  });
  assert.equal(runtime.stepExact(1).ok, true);
  assert.deepEqual(simulationTrace, [
    "negative",
    "a-first",
    "a-second",
    "feature-b",
    "positive",
    "later-phase-negative",
  ]);
  assert.deepEqual(
    runtime.simulationScheduleReport.map((entry) => entry.systemId),
    simulationTrace,
  );
  assert.deepEqual(
    runtime.simulationScheduleReport.map((entry) => entry.finalExecutionIndex),
    [0, 1, 2, 3, 4, 5],
  );

  assert.equal(runtime.startPresentation().ok, true);
  assert.equal(frameSource.deliver(4), true);
  assert.deepEqual(presentationTrace, CLIENT_PRESENTATION_PHASES);
  assert.deepEqual(
    runtime.presentationScheduleReport.map((entry) => entry.phase),
    CLIENT_PRESENTATION_PHASES,
  );
  assert.deepEqual(runtime.scheduleReport, [
    ...runtime.simulationScheduleReport,
    ...runtime.presentationScheduleReport,
  ]);
  assert.equal(Object.isFrozen(runtime.scheduleReport), true);
  assert.ok(runtime.scheduleReport.every(Object.isFrozen));
  const inspection = runtime.inspectScheduling();
  assert.equal(Object.isFrozen(inspection), true);
  assert.equal(inspection.scheduleReport, runtime.scheduleReport);
});

test("invalid Client declarations are rejected before either schedule executes", () => {
  let calls = 0;
  const source = createDeterministicPresentationFrameSource();
  const invalidPairs = [
    {
      simulationSystems: [
        simulationSystem({ id: "duplicate", run: () => (calls += 1) }),
      ],
      presentationSystems: [presentationSystem({ id: "duplicate" })],
    },
    {
      simulationSystems: [
        { ...simulationSystem(), domain: "client-presentation" },
      ],
      presentationSystems: [],
    },
    {
      simulationSystems: [{ ...simulationSystem(), phase: "render" }],
      presentationSystems: [],
    },
    {
      simulationSystems: [
        { ...simulationSystem(), priority: Number.MAX_SAFE_INTEGER + 1 },
      ],
      presentationSystems: [],
    },
    {
      simulationSystems: [{ ...simulationSystem(), before: "another" }],
      presentationSystems: [],
    },
  ];
  for (const pair of invalidPairs) {
    const result = createClientSchedule({
      driver: "exact",
      world: createWorld(),
      frameSource: source,
      ...pair,
    });
    assert.equal(result.ok, false);
    assert.equal(Object.isFrozen(result.error), true);
  }
  assert.equal(calls, 0);
  assert.equal(source.requestCount, 0);
});

test("wall-clock pumping matches Server bounds and synchronous failures abort later systems", () => {
  let ticks = 0;
  const wallTelemetryStore = createTelemetryStore({ runtime: "client" });
  const wall = schedule({
    driver: "wall-clock",
    simulationSystems: [simulationSystem({ run: () => (ticks += 1) })],
    telemetryStore: wallTelemetryStore,
  }).runtime;
  const pumped = wall.pumpWallClock(1);
  assert.equal(pumped.ok, true);
  assert.equal(
    pumped.value.backlogBeforeExecutionSeconds,
    WALL_CLOCK_ACCUMULATOR_CAP_SECONDS,
  );
  assert.equal(pumped.value.ticksExecuted, MAX_WALL_CLOCK_TICKS_PER_PUMP);
  assert.ok(
    pumped.value.accumulatorSeconds >= 0 &&
      pumped.value.accumulatorSeconds < SIMULATION_DT_SECONDS,
  );
  assert.ok(Math.abs(pumped.value.discardedSeconds - 11 / 12) < 1e-12);
  assert.equal(ticks, 5);
  assert.equal(
    wallTelemetryStore.snapshotTelemetry().droppedWallTimeSeconds,
    pumped.value.cumulativeDiscardedSeconds,
  );
  assert.equal(wall.stepExact(1).error.code, "driver-mode");

  const simulationTrace = [];
  const thenable = schedule({
    simulationSystems: [
      simulationSystem({
        id: "before",
        run: () => simulationTrace.push("before"),
      }),
      simulationSystem({
        id: "thenable",
        within: 1,
        run: () => ({ then() {} }),
      }),
      simulationSystem({
        id: "later",
        within: 2,
        run: () => simulationTrace.push("later"),
      }),
    ],
  }).runtime;
  const tickResult = thenable.stepExact(1);
  assert.equal(tickResult.ok, false);
  assert.equal(tickResult.error.code, "system-returned-thenable");
  assert.equal(tickResult.error.category, "invariant");
  assert.deepEqual(simulationTrace, ["before"]);

  const presentationTrace = [];
  const presentation = schedule({
    presentationSystems: [
      presentationSystem({
        id: "throwing",
        run: () => {
          throw new Error("frame boom");
        },
      }),
      presentationSystem({
        id: "presentation-later",
        within: 1,
        run: () => presentationTrace.push("later"),
      }),
    ],
  });
  assert.equal(presentation.runtime.startPresentation().ok, true);
  assert.equal(presentation.frameSource.deliver(1), true);
  assert.equal(
    presentation.runtime.lastPresentationFrame.error.code,
    "system-threw",
  );
  assert.deepEqual(presentationTrace, []);
});

test("invalid timestamps run zero systems and preserve simulation state", () => {
  let frameSystemCalls = 0;
  let observationReads = 0;
  const telemetryStore = createTelemetryStore({ runtime: "client" });
  const fixture = schedule({
    simulationSystems: [simulationSystem()],
    presentationSystems: CLIENT_PRESENTATION_PHASES.map((phase, within) =>
      presentationSystem({
        id: `timestamp-${phase}`,
        phase,
        within,
        run: () => (frameSystemCalls += 1),
      }),
    ),
    telemetryStore,
    observationClock: () => observationReads++,
  });
  assert.equal(fixture.runtime.stepExact(2).ok, true);
  assert.equal(fixture.runtime.startPresentation().ok, true);
  assert.equal(fixture.frameSource.deliver(10), true);
  assert.equal(frameSystemCalls, 4);
  assert.equal(fixture.runtime.presentationFrameCount, 1);

  const beforeInvalidTelemetry = telemetryStore.snapshotTelemetry();
  assert.equal(observationReads, 2);
  for (const timestamp of [9, Number.NaN, Number.POSITIVE_INFINITY]) {
    const before = frameSystemCalls;
    const beforeErrors =
      telemetryStore.snapshotTelemetry().structuredRuntimeErrorCount;
    assert.equal(fixture.frameSource.deliver(timestamp), true);
    assert.equal(frameSystemCalls, before);
    assert.equal(fixture.runtime.presentationFrameCount, 1);
    assert.equal(fixture.runtime.lastPresentationFrame.ok, false);
    assert.equal(
      fixture.runtime.lastPresentationFrame.error.code,
      "frame-source-failure",
    );
    assert.equal(observationReads, 2);
    const afterInvalid = telemetryStore.snapshotTelemetry();
    assert.equal(
      afterInvalid.simulationTick,
      beforeInvalidTelemetry.simulationTick,
    );
    assert.equal(afterInvalid.entityCount, beforeInvalidTelemetry.entityCount);
    assert.equal(
      afterInvalid.presentationFrameCount,
      beforeInvalidTelemetry.presentationFrameCount,
    );
    assert.equal(
      afterInvalid.clientFrameDurationSeconds,
      beforeInvalidTelemetry.clientFrameDurationSeconds,
    );
    assert.equal(afterInvalid.structuredRuntimeErrorCount, beforeErrors + 1);
    assert.equal(
      afterInvalid.structuredRuntimeErrors.at(-1).code,
      "frame-source-failure",
    );
  }
  assert.equal(fixture.runtime.tick, 2);
  assert.equal(fixture.runtime.lastPresentationTimestampMs, 10);
  assert.equal(fixture.runtime.errors.length, 3);
  assert.equal(fixture.frameSource.deliver(10), true);
  assert.equal(frameSystemCalls, 8);
  assert.equal(fixture.runtime.presentationFrameCount, 2);
  assert.equal(observationReads, 4);
  assert.equal(fixture.runtime.tick, 2);
});

test("request cancellation is idempotent and callback clearing plus live fences prevent replacement", () => {
  const direct = createDeterministicPresentationFrameSource();
  let directCalls = 0;
  const request = direct.request(() => (directCalls += 1));
  assert.equal(direct.outstandingRequestCount, 1);
  direct.cancel(request);
  direct.cancel(request);
  assert.equal(direct.cancellationCount, 1);
  assert.equal(direct.outstandingRequestCount, 0);
  assert.equal(direct.deliver(1), false);
  assert.equal(directCalls, 0);

  const source = createDeterministicPresentationFrameSource();
  let runtime;
  let callbackCalls = 0;
  const created = createClientSchedule({
    driver: "exact",
    world: createWorld(),
    simulationSystems: [],
    presentationSystems: [
      presentationSystem({
        run: () => {
          callbackCalls += 1;
          assert.equal(source.outstandingRequestCount, 0);
          assert.equal(
            runtime.inspectScheduling().hasOutstandingPresentationRequest,
            false,
          );
          runtime.stop();
        },
      }),
    ],
    frameSource: source,
  });
  assert.equal(created.ok, true);
  runtime = created.value;
  assert.deepEqual(runtime.startPresentation(), { ok: true, value: true });
  assert.deepEqual(runtime.startPresentation(), { ok: true, value: false });
  assert.equal(source.requestCount, 1);
  assert.equal(source.deliver(5), true);
  assert.equal(callbackCalls, 1);
  assert.equal(source.outstandingRequestCount, 0);
  assert.equal(source.requestCount, 1);
  assert.equal(runtime.tick, 0);
  runtime.stop();

  let lateCallback;
  let lateRuns = 0;
  let cancelCalls = 0;
  let requestCalls = 0;
  let lateClockCalls = 0;
  const fencedTelemetryStore = createTelemetryStore({ runtime: "client" });
  const leakySource = {
    request(callback) {
      requestCalls += 1;
      lateCallback = callback;
      return {};
    },
    cancel() {
      cancelCalls += 1;
    },
  };
  const fenced = schedule({
    presentationSystems: [presentationSystem({ run: () => (lateRuns += 1) })],
    frameSource: leakySource,
    telemetryStore: fencedTelemetryStore,
    observationClock: () => {
      lateClockCalls += 1;
      return 0;
    },
  }).runtime;
  assert.equal(fenced.startPresentation().ok, true);
  const telemetryBeforeStop = fencedTelemetryStore.snapshotTelemetry();
  fenced.stop();
  fenced.stop();
  assert.equal(cancelCalls, 1);
  lateCallback(7);
  assert.equal(lateRuns, 0);
  assert.equal(lateClockCalls, 0);
  assert.equal(fenced.presentationFrameCount, 0);
  assert.equal(requestCalls, 1);
  assert.deepEqual(
    fencedTelemetryStore.snapshotTelemetry(),
    telemetryBeforeStop,
  );
});
