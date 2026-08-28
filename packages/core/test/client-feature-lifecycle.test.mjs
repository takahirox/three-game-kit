import assert from "node:assert/strict";
import test from "node:test";
import {
  createClientFeatureRuntime,
  createDeterministicPresentationFrameSource,
  defineFeatureConfiguration,
} from "@three-game-kit/core";
const configuration = defineFeatureConfiguration({
  defaultValue: () => Object.freeze({ enabled: true }),
  parse: (input) =>
    typeof input === "object" &&
    input !== null &&
    Object.keys(input).join("|") === "enabled" &&
    typeof input.enabled === "boolean"
      ? { ok: true, value: { enabled: input.enabled } }
      : {
          ok: false,
          issues: [{ path: ["enabled"], code: "boolean-required" }],
        },
});
function feature(id, options = {}) {
  return {
    id,
    description: `${id} client feature`,
    runtimeContributions: options.runtimeContributions ?? [],
    requires: options.requires ?? [],
    conflicts: options.conflicts ?? [],
    configuration: options.configuration ?? configuration,
    setup: options.setup ?? (() => undefined),
    dispose: options.dispose ?? (() => undefined),
  };
}
function assertZero(runtime) {
  const live = runtime.snapshotTelemetry().liveResources;
  assert.ok(
    Object.values(live).every((value) => value === 0),
    JSON.stringify(live),
  );
}
test("aggregate Client preflight fails before setup and freezes inspection", async () => {
  let setupCalls = 0;
  const badConfiguration = defineFeatureConfiguration({
    defaultValue: () => ({ value: false }),
    parse: () => ({
      ok: false,
      issues: [{ path: ["value"], code: "rejected" }],
    }),
  });
  const runtime = createClientFeatureRuntime({
    frameSource: createDeterministicPresentationFrameSource(),
    configuration: { unknown: {} },
    features: [
      feature(" bad ", {
        setup() {
          setupCalls += 1;
        },
      }),
      feature("A", {
        requires: ["missing", "missing"],
        conflicts: ["B", "B"],
        runtimeContributions: [
          {
            kind: "system",
            id: "duplicate",
            domain: "client-simulation",
            phase: "render",
            priority: 0,
            run() {},
          },
        ],
        configuration: badConfiguration,
        setup() {
          setupCalls += 1;
        },
      }),
      feature("B", {
        requires: ["C"],
        runtimeContributions: [
          {
            kind: "system",
            id: "duplicate",
            domain: "client-presentation",
            phase: "render",
            priority: 0,
            run() {},
          },
        ],
        setup() {
          setupCalls += 1;
        },
      }),
      feature("C", {
        requires: ["B"],
        setup() {
          setupCalls += 1;
        },
      }),
      feature("B", {
        setup() {
          setupCalls += 1;
        },
      }),
    ],
  });
  const result = await runtime.boot();
  assert.equal(result.state, "stopped");
  assert.equal(result.reason, "validation-failed");
  assert.equal(setupCalls, 0);
  const codes = result.failures.map(({ code }) => code);
  for (const code of [
    "invalid-feature-id",
    "invalid-descriptor",
    "missing-requirement",
    "invalid-contribution",
    "dependency-cycle",
    "duplicate-feature-id",
    "unknown-configuration",
    "invalid-configuration",
  ])
    assert.ok(codes.includes(code), code);
  const inspection = runtime.inspectLifecycle();
  assert.equal(Object.isFrozen(inspection), true);
  assert.equal(Object.isFrozen(inspection.validationReport), true);
  assert.equal(Object.isFrozen(inspection.validationReport.failures), true);
  assertZero(runtime);
});
test("stable Kahn order drives setup and both Client schedules for 120 ticks and 75 frames", async () => {
  const setupOrder = [];
  let simulationRuns = 0;
  let presentationRuns = 0;
  const source = createDeterministicPresentationFrameSource();
  const systemFeature = (id, requires = []) =>
    feature(id, {
      requires,
      runtimeContributions: [
        {
          kind: "system",
          id: `${id}-simulation`,
          domain: "client-simulation",
          phase: "shared-predict",
          priority: id === "A" ? 4 : -1,
          run() {
            simulationRuns += 1;
          },
        },
        {
          kind: "system",
          id: `${id}-presentation`,
          domain: "client-presentation",
          phase: "render",
          priority: id === "A" ? 4 : -1,
          run() {
            presentationRuns += 1;
          },
        },
      ],
      setup({ ledger }) {
        setupOrder.push(id);
        ledger.activateSystem(`${id}-simulation`);
        ledger.activateSystem(`${id}-presentation`);
      },
    });
  const runtime = createClientFeatureRuntime({
    frameSource: source,
    features: [
      systemFeature("C"),
      systemFeature("D", ["B"]),
      systemFeature("B", ["A"]),
      systemFeature("A"),
    ],
  });
  const boot = await runtime.boot();
  assert.equal(boot.state, "running");
  assert.deepEqual(boot.resolvedFeatureIds, ["C", "A", "B", "D"]);
  assert.deepEqual(setupOrder, ["C", "A", "B", "D"]);
  assert.deepEqual(runtime.stepExact(120), { ok: true, value: 120 });
  assert.deepEqual(runtime.startPresentation(), { ok: true, value: true });
  for (let frame = 1; frame <= 75; frame += 1)
    assert.equal(source.deliver(frame * 8), true);
  assert.equal(simulationRuns, 480);
  assert.equal(presentationRuns, 300);
  assert.equal(runtime.snapshotTelemetry().simulationTick, 120);
  assert.equal(runtime.snapshotTelemetry().presentationFrameCount, 75);
  await runtime.shutdown();
  assertZero(runtime);
});
test("third setup failure releases its scope then disposes completed Features in reverse", async () => {
  const order = [];
  const owned = (id) => ({
    resourceId: id,
    kind: "listeners",
    value: id,
    release() {
      order.push(`release:${id}`);
    },
  });
  const runtime = createClientFeatureRuntime({
    frameSource: createDeterministicPresentationFrameSource(),
    features: [
      feature("A", {
        setup({ ledger }) {
          ledger.acquire(owned("a"));
        },
        dispose() {
          order.push("dispose:A");
        },
      }),
      feature("B", {
        requires: ["A"],
        setup({ ledger }) {
          ledger.acquire(owned("b"));
        },
        dispose() {
          order.push("dispose:B");
        },
      }),
      feature("C", {
        requires: ["B"],
        setup({ ledger }) {
          ledger.acquire(owned("c-one"));
          ledger.acquire(owned("c-two"));
          throw new Error("third failed");
        },
        dispose() {
          order.push("dispose:C");
        },
      }),
      feature("D", {
        setup() {
          order.push("setup:D");
        },
      }),
    ],
  });
  const result = await runtime.boot();
  assert.equal(result.reason, "setup-failed");
  assert.deepEqual(result.setupOrder, ["A", "B"]);
  assert.deepEqual(result.disposedOrder, ["B", "A"]);
  assert.deepEqual(order, [
    "release:c-two",
    "release:c-one",
    "dispose:B",
    "release:b",
    "dispose:A",
    "release:a",
  ]);
  assertZero(runtime);
});
test("awaited setup cancellation fences late work and returns one shutdown promise and result", async () => {
  const order = [];
  let finish;
  let observedAbort = false;
  const source = createDeterministicPresentationFrameSource();
  const runtime = createClientFeatureRuntime({
    frameSource: source,
    features: [
      feature("A", {
        setup({ ledger }) {
          ledger.acquire({
            resourceId: "a",
            kind: "listeners",
            value: {},
            release() {
              order.push("release:a");
            },
          });
        },
        dispose() {
          order.push("dispose:A");
        },
      }),
      feature("B", {
        requires: ["A"],
        async setup({ signal, ledger }) {
          await new Promise((resolve) => {
            finish = resolve;
            signal.onAbort(() => {
              observedAbort = true;
              resolve();
            });
          });
          assert.throws(() =>
            ledger.acquire({
              resourceId: "late",
              kind: "listeners",
              value: {},
              release() {},
            }),
          );
        },
        dispose() {
          order.push("dispose:B");
        },
      }),
      feature("C", {
        setup() {
          order.push("setup:C");
        },
      }),
    ],
  });
  const boot = runtime.boot();
  while (finish === undefined) await Promise.resolve();
  const first = runtime.shutdown();
  const second = runtime.shutdown();
  assert.equal(first, second);
  assert.equal(observedAbort, true);
  const result = await first;
  assert.equal(await second, result);
  assert.equal(await boot, result);
  assert.equal(result.reason, "setup-cancelled");
  assert.deepEqual(order, ["dispose:A", "release:a"]);
  assertZero(runtime);
});
test("normal shutdown cancels scheduling before reverse cleanup and keeps the frame source borrowed", async () => {
  const order = [];
  const source = createDeterministicPresentationFrameSource();
  source.dispose = () => {
    throw new Error("borrowed source must not be disposed");
  };
  const runtime = createClientFeatureRuntime({
    frameSource: source,
    features: [
      feature("owner", {
        runtimeContributions: [{ kind: "mailbox", id: "messages" }],
        setup({ ledger }) {
          ledger.publishMailbox("messages", {
            stop() {
              order.push(`mailbox-stop:${source.outstandingRequestCount}`);
            },
            clear() {
              order.push("mailbox-clear");
              return 0;
            },
          });
        },
        dispose() {
          order.push(`dispose:owner:${source.outstandingRequestCount}`);
        },
      }),
      feature("dependent", {
        requires: ["owner"],
        setup({ dependencies, ledger }) {
          assert.ok(dependencies.borrow("owner", "messages").value);
          ledger.acquire({
            resourceId: "listener",
            kind: "listeners",
            value: {},
            release() {
              order.push("release:listener");
            },
          });
        },
        dispose() {
          order.push(`dispose:dependent:${source.outstandingRequestCount}`);
        },
      }),
    ],
  });
  assert.equal((await runtime.boot()).state, "running");
  assert.equal(runtime.startPresentation().ok, true);
  assert.equal(source.outstandingRequestCount, 1);
  const first = runtime.shutdown();
  const second = runtime.shutdown();
  assert.equal(first, second);
  const stopped = await first;
  assert.equal(await runtime.shutdown(), stopped);
  assert.equal(source.outstandingRequestCount, 0);
  assert.deepEqual(stopped.disposedOrder, ["dependent", "owner"]);
  assert.ok(
    order.indexOf("dispose:dependent:0") < order.indexOf("release:listener"),
  );
  assert.ok(
    order.indexOf("release:listener") < order.indexOf("dispose:owner:0"),
  );
  assert.equal(source.dispose instanceof Function, true);
  assert.equal(runtime.stepExact(1).ok, false);
  assert.equal(runtime.pumpWallClock(1).ok, false);
  assert.equal(runtime.startPresentation().ok, false);
  assertZero(runtime);
});
