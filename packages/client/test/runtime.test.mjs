import assert from "node:assert/strict";
import test from "node:test";
import {
  SIMULATION_DT_SECONDS,
  createDeterministicPresentationFrameSource,
  createTelemetryStore,
  defineFeatureConfiguration,
} from "@three-game-kit/core";
import {
  ClientRuntime,
  Runtime,
  createBrowserPresentationFrameSource,
  createClientRuntime,
  createRuntime,
} from "@three-game-kit/client";

const configuration = defineFeatureConfiguration({
  defaultValue: () => Object.freeze({ enabled: true }),
  parse(input) {
    if (
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input) ||
      Object.keys(input).join("|") !== "enabled" ||
      typeof input.enabled !== "boolean"
    ) {
      return {
        ok: false,
        issues: [{ path: ["enabled"], code: "boolean-required" }],
      };
    }
    return { ok: true, value: { enabled: input.enabled } };
  },
});

function feature(id, overrides = {}) {
  return {
    id,
    description: `${id} Client test Feature`,
    runtimeContributions: [],
    requires: [],
    conflicts: [],
    configuration,
    setup() {},
    dispose() {},
    ...overrides,
  };
}

function assertNoLiveResources(runtime) {
  assert.ok(
    Object.values(runtime.snapshotTelemetry().liveResources).every(
      (count) => count === 0,
    ),
  );
}

test("Runtime delegates lifecycle, exact ticks, frames, and one Core World", async () => {
  const frameSource = createDeterministicPresentationFrameSource();
  const telemetryStore = createTelemetryStore({ runtime: "client" });
  const worlds = new Set();
  const service = Object.freeze({ name: "fixture-service" });
  let setupConfiguration;
  let borrowedService;
  let simulationRuns = 0;
  let presentationRuns = 0;
  const features = Object.freeze([
    feature("fixture", {
      runtimeContributions: [
        {
          kind: "system",
          id: "fixture-simulation",
          domain: "client-simulation",
          phase: "shared-predict",
          priority: 0,
          run({ world, tick, dt }) {
            worlds.add(world);
            simulationRuns += 1;
            assert.equal(tick, simulationRuns);
            assert.equal(dt, SIMULATION_DT_SECONDS);
          },
        },
        {
          kind: "system",
          id: "fixture-presentation",
          domain: "client-presentation",
          phase: "render",
          priority: 0,
          run({ timestampMs }) {
            presentationRuns += 1;
            assert.equal(timestampMs, presentationRuns * 8);
          },
        },
      ],
      setup({ configuration: received, dependencies, ledger }) {
        setupConfiguration = received;
        borrowedService = dependencies.borrowHost("service").value;
        ledger.activateSystem("fixture-simulation");
        ledger.activateSystem("fixture-presentation");
      },
    }),
  ]);
  const runtime = createClientRuntime({
    features,
    configuration: { fixture: { enabled: false } },
    frameSource,
    telemetryStore,
    observationClock: () => 12.5,
    hostServices: { service },
  });

  assert.equal(ClientRuntime, Runtime);
  assert.ok(runtime instanceof Runtime);
  assert.equal(runtime.driver, "exact");
  assert.equal(runtime.state, "created");
  assert.equal(runtime.telemetryStore, telemetryStore);
  const started = runtime.start();
  assert.equal(started, runtime.boot());
  const boot = await started;
  assert.equal(boot.state, "running");
  assert.equal(runtime.state, "running");
  assert.deepEqual(setupConfiguration, { enabled: false });
  assert.equal(borrowedService, service);
  assert.deepEqual(
    runtime.scheduleReport.map(({ systemId }) => systemId),
    ["fixture-simulation", "fixture-presentation"],
  );
  assert.equal(runtime.inspectLifecycle().scheduleReport, runtime.scheduleReport);

  assert.deepEqual(runtime.stepExact(120), { ok: true, value: 120 });
  assert.equal(runtime.tick, 120);
  assert.equal(simulationRuns, 120);
  assert.equal(worlds.size, 1);

  assert.deepEqual(runtime.startPresentation(), { ok: true, value: true });
  assert.deepEqual(runtime.startPresentation(), { ok: true, value: false });
  for (let frame = 1; frame <= 75; frame += 1) {
    assert.equal(frameSource.deliver(frame * 8), true);
  }
  assert.equal(presentationRuns, 75);
  assert.equal(runtime.tick, 120);
  assert.equal(runtime.snapshotTelemetry().presentationFrameCount, 75);

  await runtime.shutdown();
  assertNoLiveResources(runtime);
});

test("Runtime delegates the bounded wall-clock driver", async () => {
  let simulationRuns = 0;
  const runtime = createRuntime({
    driver: "wall-clock",
    frameSource: createDeterministicPresentationFrameSource(),
    features: [
      feature("wall-clock", {
        runtimeContributions: [
          {
            kind: "system",
            id: "wall-clock-system",
            domain: "client-simulation",
            phase: "telemetry",
            priority: 0,
            run() {
              simulationRuns += 1;
            },
          },
        ],
        setup({ ledger }) {
          ledger.activateSystem("wall-clock-system");
        },
      }),
    ],
  });

  assert.equal((await runtime.boot()).state, "running");
  const pumped = runtime.pumpWallClock(1);
  assert.equal(pumped.ok, true);
  assert.equal(pumped.value.ticksExecuted, 5);
  assert.equal(pumped.value.backlogBeforeExecutionSeconds, 0.25);
  assert.ok(pumped.value.accumulatorSeconds < SIMULATION_DT_SECONDS);
  assert.equal(simulationRuns, 5);
  assert.equal(runtime.tick, 5);
  await runtime.shutdown();
  assertNoLiveResources(runtime);
});

test("Runtime preserves rollback and identical idempotent shutdown", async () => {
  const order = [];
  const rollingBack = new Runtime({
    frameSource: createDeterministicPresentationFrameSource(),
    features: [
      feature("first", {
        setup({ ledger }) {
          ledger.acquire({
            resourceId: "first-listener",
            kind: "listeners",
            value: {},
            release() {
              order.push("release:first");
            },
          });
        },
        dispose() {
          order.push("dispose:first");
        },
      }),
      feature("second", {
        requires: ["first"],
        setup({ ledger }) {
          ledger.acquire({
            resourceId: "second-timer",
            kind: "timers",
            value: {},
            release() {
              order.push("release:second");
            },
          });
        },
        dispose() {
          order.push("dispose:second");
        },
      }),
      feature("third", {
        requires: ["second"],
        setup() {
          throw new Error("forced third setup failure");
        },
        dispose() {
          order.push("dispose:third");
        },
      }),
    ],
  });

  const failed = await rollingBack.start();
  assert.equal(failed.state, "stopped");
  assert.equal(failed.reason, "setup-failed");
  assert.deepEqual(failed.disposedOrder, ["second", "first"]);
  assert.deepEqual(order, [
    "dispose:second",
    "release:second",
    "dispose:first",
    "release:first",
  ]);
  assertNoLiveResources(rollingBack);

  let disposals = 0;
  const runtime = new Runtime({
    frameSource: createDeterministicPresentationFrameSource(),
    features: [
      feature("disposable", {
        dispose() {
          disposals += 1;
        },
      }),
    ],
  });
  assert.equal((await runtime.start()).state, "running");
  const firstShutdown = runtime.shutdown();
  const secondShutdown = runtime.shutdown();
  assert.equal(firstShutdown, secondShutdown);
  const stopped = await firstShutdown;
  assert.equal(await runtime.shutdown(), stopped);
  assert.equal(disposals, 1);
  assertNoLiveResources(runtime);
});

test("browser presentation adapter maps one request, timestamp, and cancel", () => {
  const browserRequests = [
    Object.freeze({ id: 7 }),
    Object.freeze({ id: 8 }),
  ];
  const requestedCallbacks = [];
  const cancelled = [];
  const source = createBrowserPresentationFrameSource(
    (callback) => {
      requestedCallbacks.push(callback);
      return browserRequests[requestedCallbacks.length - 1];
    },
    (request) => {
      cancelled.push(request);
    },
  );
  const timestamps = [];
  const callback = (timestampMs) => timestamps.push(timestampMs);

  const cancelledRequest = source.request(callback);
  assert.notEqual(cancelledRequest, browserRequests[0]);
  source.cancel(cancelledRequest);
  source.cancel(cancelledRequest);
  requestedCallbacks[0](12);
  assert.deepEqual(cancelled, [browserRequests[0]]);
  assert.deepEqual(timestamps, []);

  const deliveredRequest = source.request(callback);
  requestedCallbacks[1](42.25);
  requestedCallbacks[1](43);
  source.cancel(deliveredRequest);
  assert.deepEqual(timestamps, [42.25]);
  assert.deepEqual(cancelled, [browserRequests[0]]);
});
