import assert from "node:assert/strict";
import test from "node:test";
import {
  createBoundedMailbox,
  createRuntimeLiveFence,
  createServerFeatureRuntime,
  defineFeatureConfiguration,
  defineResource,
} from "../dist/index.js";

const validConfiguration = defineFeatureConfiguration({
  defaultValue: () => ({ enabled: true, nested: { amount: 1 } }),
  parse(input) {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { ok: false, issues: [{ path: [], code: "object-required" }] };
    }
    const keys = Object.keys(input);
    if (keys.some((key) => key !== "enabled" && key !== "nested")) {
      return { ok: false, issues: [{ path: [], code: "unknown-field" }] };
    }
    const nested = input.nested ?? { amount: 1 };
    if (
      typeof nested !== "object" ||
      nested === null ||
      Array.isArray(nested) ||
      Object.keys(nested).some((key) => key !== "amount") ||
      !Number.isSafeInteger(nested.amount ?? 1)
    ) {
      return { ok: false, issues: [{ path: ["nested"], code: "invalid-nested" }] };
    }
    if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
      return { ok: false, issues: [{ path: ["enabled"], code: "boolean-required" }] };
    }
    return {
      ok: true,
      value: {
        enabled: input.enabled ?? true,
        nested: { amount: nested.amount ?? 1 },
      },
    };
  },
});

function feature(id, overrides = {}) {
  return {
    id,
    description: `${id} feature`,
    runtimeContributions: [],
    requires: [],
    conflicts: [],
    configuration: validConfiguration,
    setup() {},
    dispose() {},
    ...overrides,
  };
}

function assertZeroTelemetry(runtime) {
  const snapshot = runtime.snapshotTelemetry();
  for (const [kind, count] of Object.entries(snapshot.liveResources)) {
    assert.equal(count, 0, `${kind} must be zero`);
  }
  assert.deepEqual(snapshot.installedFeatureIds, []);
}

test("stable Kahn resolution uses declaration indices and scheduling remains independent", async () => {
  const setup = [];
  const execution = [];
  const make = (id, requires, phase, priority, count = 1) =>
    feature(id, {
      requires,
      runtimeContributions: Array.from({ length: count }, (_, index) => ({
        kind: "system",
        id: `${id}-${index}`,
        domain: "server-simulation",
        phase,
        priority,
        run: () => execution.push(`${id}-${index}`),
      })),
      setup({ ledger }) {
        setup.push(id);
        for (let index = 0; index < count; index += 1) {
          ledger.activateSystem(`${id}-${index}`);
        }
      },
    });
  const features = [
    make("D", ["B"], "gameplay", 0),
    make("B", ["A"], "gameplay", 0),
    make("A", [], "telemetry", 0),
    make("C", [], "ingress", 10, 2),
  ];
  const runtime = createServerFeatureRuntime({ features });
  assert.equal(runtime.stepExact(1).ok, false);
  const running = await runtime.boot();
  assert.equal(running.state, "running");
  assert.deepEqual(running.resolvedFeatureIds, ["A", "B", "D", "C"]);
  assert.deepEqual(setup, ["A", "B", "D", "C"]);
  assert.deepEqual(
    running.scheduleReport.map(({ systemId }) => systemId),
    ["C-0", "C-1", "D-0", "B-0", "A-0"],
  );
  assert.equal(runtime.stepExact(1).ok, true);
  assert.deepEqual(execution, ["C-0", "C-1", "D-0", "B-0", "A-0"]);
  await runtime.shutdown();

  const permuted = createServerFeatureRuntime({
    features: [feature("C"), feature("D", { requires: ["B"] }), feature("B", { requires: ["A"] }), feature("A")],
  });
  const result = await permuted.boot();
  assert.equal(result.state, "running");
  assert.deepEqual(result.resolvedFeatureIds, ["C", "A", "B", "D"]);
  await permuted.shutdown();
});

test("aggregate preflight rejects graph, descriptor, contribution, and configuration failures before setup", async () => {
  const badDefault = defineFeatureConfiguration({
    defaultValue: () => ({ bad: true }),
    parse: () => ({ ok: false, issues: [{ path: ["bad"], code: "always-invalid" }] }),
  });
  const cases = [
    {
      name: "duplicate ids",
      features: [feature("A"), feature("A")],
      codes: ["duplicate-feature-id"],
    },
    {
      name: "invalid id and duplicate lists",
      features: [feature(" bad "), feature("A", { requires: ["B", "B"], conflicts: ["C", "C"] }), feature("B"), feature("C")],
      codes: ["invalid-feature-id", "invalid-descriptor", "invalid-descriptor"],
    },
    {
      name: "missing requirement",
      features: [feature("A", { requires: ["missing"] })],
      codes: ["missing-requirement"],
    },
    {
      name: "two node cycle",
      features: [feature("A", { requires: ["B"] }), feature("B", { requires: ["A"] })],
      codes: ["dependency-cycle", "dependency-cycle"],
    },
    {
      name: "long cycle",
      features: [feature("A", { requires: ["C"] }), feature("B", { requires: ["A"] }), feature("C", { requires: ["B"] })],
      codes: ["dependency-cycle", "dependency-cycle", "dependency-cycle"],
    },
    {
      name: "directional conflict",
      features: [feature("A", { conflicts: ["B"] }), feature("B")],
      codes: ["feature-conflict"],
    },
    {
      name: "reverse directional conflict",
      features: [feature("A"), feature("B", { conflicts: ["A"] })],
      codes: ["feature-conflict"],
    },
    {
      name: "wrong phase",
      features: [feature("A", { runtimeContributions: [{ kind: "system", id: "bad", domain: "server-simulation", phase: "render", priority: 0, run() {} }] })],
      codes: ["invalid-contribution"],
    },
    {
      name: "duplicate systems",
      features: [
        feature("A", { runtimeContributions: [{ kind: "system", id: "same", domain: "server-simulation", phase: "ingress", priority: 0, run() {} }] }),
        feature("B", { runtimeContributions: [{ kind: "system", id: "same", domain: "server-simulation", phase: "gameplay", priority: 0, run() {} }] }),
      ],
      codes: ["duplicate-system-id"],
    },
    {
      name: "invalid default",
      features: [feature("A", { configuration: badDefault })],
      codes: ["invalid-configuration"],
    },
  ];
  for (const entry of cases) {
    let setupCalls = 0;
    const features = entry.features.map((candidate) => ({
      ...candidate,
      setup(context) {
        setupCalls += 1;
        return candidate.setup(context);
      },
    }));
    const runtime = createServerFeatureRuntime({ features });
    const result = await runtime.boot();
    assert.equal(result.state, "stopped", entry.name);
    assert.equal(result.reason, "validation-failed", entry.name);
    assert.equal(setupCalls, 0, entry.name);
    assert.deepEqual(result.failures.map(({ code }) => code), entry.codes, entry.name);
    assertZeroTelemetry(runtime);
  }
});

test("configuration is strict, defaulted by one provider, fresh, and deeply immutable", async () => {
  const observed = [];
  const configuredFeature = feature("configured", {
    setup({ configuration }) {
      observed.push(configuration);
    },
  });
  for (let index = 0; index < 2; index += 1) {
    const runtime = createServerFeatureRuntime({ features: [configuredFeature] });
    assert.equal((await runtime.boot()).state, "running");
    await runtime.shutdown();
  }
  assert.notEqual(observed[0], observed[1]);
  assert.notEqual(observed[0].nested, observed[1].nested);
  assert.equal(Object.isFrozen(observed[0]), true);
  assert.equal(Object.isFrozen(observed[0].nested), true);

  const partial = createServerFeatureRuntime({
    features: [configuredFeature],
    configuration: { configured: { enabled: false } },
  });
  assert.equal((await partial.boot()).state, "running");
  assert.deepEqual(observed.at(-1), { enabled: false, nested: { amount: 1 } });
  await partial.shutdown();

  for (const configuration of [
    { configured: { enabled: 1 } },
    { configured: { nested: { amount: 1, extra: true } } },
    { configured: { enabled: true, extra: true } },
  ]) {
    const runtime = createServerFeatureRuntime({ features: [configuredFeature], configuration });
    const result = await runtime.boot();
    assert.equal(result.state, "stopped");
    assert.equal(result.failures[0].code, "invalid-configuration");
  }
  const unknown = createServerFeatureRuntime({
    features: [configuredFeature],
    configuration: { unknown: {} },
  });
  const unknownResult = await unknown.boot();
  assert.equal(unknownResult.state, "stopped");
  assert.equal(unknownResult.failures[0].code, "unknown-configuration");
});

test("third Feature setup failure releases its staging then disposes completed Features in reverse", async () => {
  const order = [];
  const owned = (id) => ({
    resourceId: id,
    kind: "listeners",
    value: id,
    release() {
      order.push(`release:${id}`);
      if (id === "c-one") throw new Error("independent release failure");
    },
  });
  const features = [
    feature("A", {
      setup({ ledger }) { ledger.acquire(owned("a")); },
      dispose() { order.push("dispose:A"); },
    }),
    feature("B", {
      requires: ["A"],
      setup({ ledger }) { ledger.acquire(owned("b")); },
      dispose() { order.push("dispose:B"); },
    }),
    feature("C", {
      requires: ["B"],
      setup({ ledger }) {
        ledger.acquire(owned("c-one"));
        ledger.acquire(owned("c-two"));
        throw new Error("third setup failed");
      },
      dispose() { order.push("dispose:C"); },
    }),
    feature("D", { setup() { order.push("setup:D"); } }),
  ];
  const runtime = createServerFeatureRuntime({ features });
  const result = await runtime.boot();
  assert.equal(result.state, "stopped");
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
  assert.deepEqual(result.failures.map(({ code }) => code), [
    "setup-failed",
    "resource-release-failed",
  ]);
  assertZeroTelemetry(runtime);
});

test("dependent borrowing is permitted, unrelated borrowing fails, and borrower cleanup precedes owner", async () => {
  const Service = defineResource("borrow-service");
  const order = [];
  const owner = feature("owner", {
    runtimeContributions: [{ kind: "resource", id: "service", resourceType: Service }],
    setup({ ledger }) {
      ledger.publishResource("service", { alive: true }, () => order.push("release:owner"));
    },
    dispose() { order.push("dispose:owner"); },
  });
  const dependent = feature("dependent", {
    requires: ["owner"],
    setup({ dependencies, ledger }) {
      const borrowed = dependencies.borrow("owner", "service");
      assert.equal(borrowed.value.alive, true);
      assert.equal("release" in borrowed, false);
      ledger.acquire({
        resourceId: "borrowed-listener",
        kind: "listeners",
        value: {},
        release: () => order.push("release:listener"),
      });
    },
    dispose() { order.push("dispose:dependent"); },
  });
  const runtime = createServerFeatureRuntime({ features: [owner, dependent] });
  assert.equal((await runtime.boot()).state, "running");
  await runtime.shutdown();
  assert.deepEqual(order, [
    "dispose:dependent",
    "release:listener",
    "dispose:owner",
    "release:owner",
  ]);
  assertZeroTelemetry(runtime);

  const unrelated = createServerFeatureRuntime({
    features: [owner, feature("unrelated", {
      setup({ dependencies }) { dependencies.borrow("owner", "service"); },
    })],
  });
  const rejected = await unrelated.boot();
  assert.equal(rejected.state, "stopped");
  assert.equal(rejected.failures[0].code, "ownership-violation");
});

test("host transfer token is targeted, single-use, and released exactly once", async () => {
  let releases = 0;
  let token;
  const runtime = createServerFeatureRuntime({
    features: [feature("owner", {
      setup({ ledger }) {
        const handle = ledger.consumeHostTransfer(token);
        assert.equal(handle.value.value, 7);
        assert.throws(() => ledger.consumeHostTransfer(token), /reused/);
        assert.throws(() => ledger.consumeHostTransfer({ ...token }), /invalid/);
      },
    })],
  });
  token = runtime.createHostTransferToken("owner", {
    resourceId: "host-object",
    kind: "sockets",
    value: { value: 7 },
    release() { releases += 1; },
  });
  assert.equal((await runtime.boot()).state, "running");
  assert.throws(
    () => runtime.createHostTransferToken("owner", {
      resourceId: "late",
      kind: "sockets",
      value: {},
      release() {},
    }),
    /late/,
  );
  await runtime.shutdown();
  assert.equal(releases, 1);
  await runtime.shutdown();
  assert.equal(releases, 1);
  assertZeroTelemetry(runtime);
});

test("async setup cancellation fences acquisitions, waits for quiescence, and starts no later Feature", async () => {
  const order = [];
  let releaseSetup;
  const gate = new Promise((resolve) => { releaseSetup = resolve; });
  const runtime = createServerFeatureRuntime({
    features: [
      feature("async", {
        async setup({ signal, ledger }) {
          ledger.acquire({
            resourceId: "async-resource",
            kind: "timers",
            value: {},
            release: () => order.push("release:async"),
          });
          signal.onAbort(() => {
            order.push("abort");
            releaseSetup();
          });
          await gate;
          assert.throws(() => ledger.acquire({
            resourceId: "late",
            kind: "timers",
            value: {},
            release() {},
          }), /not active/);
          order.push("quiesced");
        },
        dispose() { order.push("dispose:async"); },
      }),
      feature("later", { setup() { order.push("setup:later"); } }),
    ],
  });
  const boot = runtime.boot();
  await Promise.resolve();
  const shutdownOne = runtime.shutdown();
  const shutdownTwo = runtime.shutdown();
  assert.equal(shutdownOne, shutdownTwo);
  const [bootResult, stopped] = await Promise.all([boot, shutdownOne]);
  assert.equal(bootResult, stopped);
  assert.equal(stopped.reason, "setup-cancelled");
  assert.deepEqual(order, ["abort", "quiesced", "release:async"]);
  assert.deepEqual(stopped.disposedOrder, []);
  assertZeroTelemetry(runtime);
});

test("normal shutdown continues independent dispose and release failures and caches one result", async () => {
  const order = [];
  const make = (id, disposeFails = false, releaseFails = false) => feature(id, {
    setup({ ledger }) {
      ledger.acquire({
        resourceId: `${id}-resource`,
        kind: "physicsHandles",
        value: {},
        release() {
          order.push(`release:${id}`);
          if (releaseFails) throw new Error(`${id} release`);
        },
      });
    },
    dispose() {
      order.push(`dispose:${id}`);
      if (disposeFails) throw new Error(`${id} dispose`);
    },
  });
  const runtime = createServerFeatureRuntime({
    features: [make("A"), make("B", false, true), make("C", true, false)],
  });
  assert.equal((await runtime.boot()).state, "running");
  const before = runtime.inspectLifecycle();
  const first = runtime.shutdown();
  const concurrent = runtime.shutdown();
  assert.equal(first, concurrent);
  const result = await first;
  assert.deepEqual(result.disposedOrder, ["C", "B", "A"]);
  assert.deepEqual(result.failures.map(({ code }) => code), [
    "dispose-failed",
    "resource-release-failed",
  ]);
  assert.deepEqual(order, [
    "dispose:C", "release:C", "dispose:B", "release:B", "dispose:A", "release:A",
  ]);
  const after = runtime.inspectLifecycle();
  const again = runtime.shutdown();
  assert.equal(again, first);
  assert.equal(await again, result);
  assert.equal(runtime.inspectLifecycle().transitions.length, after.transitions.length);
  assert.ok(after.events.length > before.events.length);
  assertZeroTelemetry(runtime);
});

test("shutdown before boot performs host cleanup once and returns exact clean stopped result", async () => {
  let setupCalls = 0;
  const runtime = createServerFeatureRuntime({
    features: [feature("never", { setup() { setupCalls += 1; } })],
  });
  const first = runtime.shutdown();
  const second = runtime.shutdown();
  assert.equal(first, second);
  const stopped = await first;
  assert.deepEqual(stopped, {
    state: "stopped",
    runtime: "server",
    reason: "shutdown",
    clean: true,
    setupOrder: [],
    disposedOrder: [],
    failures: [],
  });
  assert.equal(setupCalls, 0);
  assert.equal(await runtime.boot(), stopped);
  assertZeroTelemetry(runtime);
});

test("mailbox and schedule are fenced before disposal and all final gauges are zero", async () => {
  const fence = createRuntimeLiveFence();
  const mailbox = createBoundedMailbox({
    capacity: 2,
    fence,
    copySnapshot: (value) => ({ ...value }),
  });
  const generation = fence.capture();
  const order = [];
  const runtime = createServerFeatureRuntime({
    features: [feature("runtime", {
      runtimeContributions: [
        { kind: "mailbox", id: "commands" },
        { kind: "system", id: "tick", domain: "server-simulation", phase: "command-apply", priority: 0, run: () => order.push("tick") },
      ],
      setup({ ledger }) {
        ledger.publishMailbox("commands", mailbox);
        ledger.activateSystem("tick");
        assert.equal(mailbox.enqueue({ value: 1 }, generation).status, "accepted");
      },
      dispose() {
        order.push(`dispose:${mailbox.inspect().size}:${mailbox.inspect().live}`);
      },
    })],
  });
  assert.equal(order.length, 0);
  const running = await runtime.boot();
  assert.equal(running.state, "running");
  assert.equal(runtime.stepExact(2).ok, true);
  assert.deepEqual(order, ["tick", "tick"]);
  await runtime.shutdown();
  assert.deepEqual(order, ["tick", "tick", "dispose:0:false"]);
  assert.equal(runtime.stepExact(1).ok, false);
  assertZeroTelemetry(runtime);
});
