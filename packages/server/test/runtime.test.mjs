import assert from "node:assert/strict";
import test from "node:test";
import {
  SIMULATION_DT_SECONDS,
  defineFeatureConfiguration,
  defineResource,
} from "@three-game-kit/core";
import {
  applyMovementCommand,
  createHeadlessMovementCommandSource,
  createMovementCommand,
  createMovementState,
} from "@three-game-kit/shared/movement";
import { Runtime } from "@three-game-kit/server";

const emptyConfiguration = defineFeatureConfiguration({
  defaultValue: () => ({}),
  parse(input) {
    if (
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input) ||
      Object.keys(input).length !== 0
    ) {
      return { ok: false, issues: [{ path: [], code: "empty-object-required" }] };
    }
    return { ok: true, value: {} };
  },
});

const MovementStateResource = defineResource("fixture-movement-state");

function basicFeature(id, overrides = {}) {
  return {
    id,
    description: `${id} test Feature`,
    runtimeContributions: [],
    requires: [],
    conflicts: [],
    configuration: emptyConfiguration,
    setup() {},
    dispose() {},
    ...overrides,
  };
}

function movementFeature(commands, observations) {
  const source = createHeadlessMovementCommandSource(commands);
  const holder = { current: createMovementState() };
  return basicFeature("fixture-movement", {
    runtimeContributions: [
      {
        kind: "resource",
        id: "fixture-state",
        resourceType: MovementStateResource,
      },
      {
        kind: "system",
        id: "fixture-movement-system",
        domain: "server-simulation",
        phase: "shared-movement",
        priority: 0,
        run({ world, tick, dt }) {
          observations.worlds.add(world);
          observations.executions += 1;
          assert.equal(dt, SIMULATION_DT_SECONDS);
          const state = world.getResource(MovementStateResource);
          state.current = applyMovementCommand(
            state.current,
            source.commandForTick(tick),
            { speedMetersPerSecond: 6, dtSeconds: dt },
          );
          observations.state = state.current;
        },
      },
    ],
    setup({ ledger }) {
      ledger.publishResource("fixture-state", holder);
      ledger.activateSystem("fixture-movement-system");
    },
  });
}

test("Runtime executes once-per-tick systems exactly and same-build Worlds match", async () => {
  const commands = Array.from({ length: 600 }, (_, index) =>
    index % 4 < 2
      ? createMovementCommand(1, 0)
      : createMovementCommand(0, -1),
  );
  const first = { executions: 0, state: null, worlds: new Set() };
  const second = { executions: 0, state: null, worlds: new Set() };
  const firstRuntime = new Runtime({
    features: [movementFeature(commands, first)],
  });
  const secondRuntime = new Runtime({
    features: [movementFeature(commands, second)],
  });

  assert.equal((await firstRuntime.start()).state, "running");
  assert.equal((await secondRuntime.start()).state, "running");
  assert.deepEqual(firstRuntime.stepExact(60), { ok: true, value: 60 });
  assert.equal(firstRuntime.tick, 60);
  assert.equal(first.executions, 60);
  assert.equal(first.worlds.size, 1);

  assert.deepEqual(firstRuntime.stepExact(540), { ok: true, value: 600 });
  assert.deepEqual(secondRuntime.stepExact(600), { ok: true, value: 600 });
  assert.equal(first.executions, 600);
  assert.equal(second.executions, 600);
  assert.notEqual([...first.worlds][0], [...second.worlds][0]);
  // This proves only equal same-build fixture results, not cross-runtime determinism.
  assert.equal(JSON.stringify(first.state), JSON.stringify(second.state));

  await Promise.all([firstRuntime.shutdown(), secondRuntime.shutdown()]);
});

test("Runtime exposes bounded wall-clock pumping", async () => {
  let executions = 0;
  const runtime = new Runtime({
    driver: "wall-clock",
    features: [
      basicFeature("wall-system", {
        runtimeContributions: [
          {
            kind: "system",
            id: "wall-system-tick",
            domain: "server-simulation",
            phase: "telemetry",
            priority: 0,
            run() {
              executions += 1;
            },
          },
        ],
        setup({ ledger }) {
          ledger.activateSystem("wall-system-tick");
        },
      }),
    ],
  });
  assert.equal((await runtime.start()).state, "running");
  const result = runtime.pumpWallClock(1);
  assert.equal(result.ok, true);
  assert.equal(result.value.ticksExecuted, 5);
  assert.equal(result.value.backlogBeforeExecutionSeconds, 0.25);
  assert.ok(result.value.accumulatorSeconds < 1 / 60);
  assert.equal(executions, 5);
  await runtime.shutdown();
});

test("Runtime preserves rollback and caches idempotent shutdown", async () => {
  const order = [];
  const rollingBack = new Runtime({
    features: [
      basicFeature("first", {
        runtimeContributions: [
          {
            kind: "system",
            id: "first-system",
            domain: "server-simulation",
            phase: "gameplay",
            priority: 0,
            run() {},
          },
        ],
        setup({ ledger }) {
          ledger.activateSystem("first-system");
          ledger.acquire({
            resourceId: "first-owned",
            kind: "subscriptions",
            value: {},
            release: () => order.push("release:first"),
          });
        },
        dispose: () => order.push("dispose:first"),
      }),
      basicFeature("second", {
        requires: ["first"],
        runtimeContributions: [
          {
            kind: "system",
            id: "second-system",
            domain: "server-simulation",
            phase: "gameplay",
            priority: 0,
            run() {},
          },
        ],
        setup({ ledger }) {
          ledger.activateSystem("second-system");
          ledger.acquire({
            resourceId: "second-owned",
            kind: "timers",
            value: {},
            release: () => order.push("release:second"),
          });
        },
        dispose: () => order.push("dispose:second"),
      }),
      basicFeature("third", {
        requires: ["second"],
        setup() {
          throw new Error("forced third setup failure");
        },
        dispose: () => order.push("dispose:third"),
      }),
    ],
  });
  const failed = await rollingBack.start();
  assert.equal(failed.state, "stopped");
  assert.deepEqual(failed.disposedOrder, ["second", "first"]);
  assert.deepEqual(order, [
    "dispose:second",
    "release:second",
    "dispose:first",
    "release:first",
  ]);
  assert.ok(
    Object.values(rollingBack.snapshotTelemetry().liveResources).every(
      (count) => count === 0,
    ),
  );

  let disposals = 0;
  const runtime = new Runtime({
    features: [
      basicFeature("disposable", {
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
  assert.ok(
    Object.values(runtime.snapshotTelemetry().liveResources).every(
      (count) => count === 0,
    ),
  );
});
