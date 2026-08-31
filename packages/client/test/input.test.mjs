import assert from "node:assert/strict";
import test from "node:test";
import { createDeterministicPresentationFrameSource } from "@three-game-kit/core";
import { createClientRuntime } from "@three-game-kit/client";
import {
  MovementInputDisposedError,
  SemanticActionInputDisposedError,
  createInputFeature,
  createKeyboardMovementAdapter,
  createMovementInput,
  createSemanticActionInput,
} from "@three-game-kit/client/input";

const IDLE = Object.freeze({ kind: "move", x: 0, z: 0 });

function assertDisposed(action) {
  assert.throws(
    action,
    (error) =>
      error instanceof MovementInputDisposedError &&
      error.code === "movement-input-disposed",
  );
}

function createListenerHarness({ failAdd, failRemove } = {}) {
  const active = {
    keydown: new Set(),
    keyup: new Set(),
  };
  const additions = [];
  const removals = [];
  const source = {
    addListener(type, listener) {
      additions.push(type);
      if (failAdd !== undefined && type === String(failAdd)) throw failAdd.error;
      active[type].add(listener);
    },
    removeListener(type, listener) {
      removals.push(type);
      active[type].delete(listener);
      if (failRemove !== undefined && type === String(failRemove)) {
        throw failRemove.error;
      }
    },
  };

  return {
    source,
    additions,
    removals,
    active,
    dispatch(type, code) {
      for (const listener of active[type]) listener({ code });
    },
  };
}

test("movement input validates, copies, freezes, resets, and disposes", () => {
  for (const invalid of [
    null,
    { kind: "jump", x: 0, z: 0 },
    { kind: "move", x: Number.NaN, z: 0 },
    { kind: "move", x: 1, z: 1 },
  ]) {
    assert.throws(
      () => createMovementInput(invalid),
      /kind move|finite|unit disc/,
    );
  }

  const initial = { kind: "move", x: 0.6, z: 0.8 };
  const input = createMovementInput(initial);
  initial.x = 0;

  const initialSample = input.sample();
  assert.deepEqual(initialSample, { kind: "move", x: 0.6, z: 0.8 });
  assert.equal(Object.isFrozen(initialSample), true);

  const next = { kind: "move", x: -1, z: 0 };
  input.setMovement(next);
  next.x = 0;
  const nextSample = input.sample();
  assert.deepEqual(nextSample, { kind: "move", x: -1, z: 0 });
  assert.equal(Object.isFrozen(nextSample), true);

  input.setMovement(0, -1);
  assert.deepEqual(input.sample(), { kind: "move", x: 0, z: -1 });
  assert.throws(() => input.setMovement(1, 1), /unit disc/);
  assert.throws(
    () => input.setMovement({ kind: "move", x: 0, z: Infinity }),
    /finite/,
  );

  input.reset();
  assert.deepEqual(input.sample(), IDLE);

  input.dispose();
  input.dispose();
  assertDisposed(() => input.sample());
  assertDisposed(() => input.reset());
  assertDisposed(() => input.setMovement(1, 0));
  assertDisposed(() => input.setMovement({ kind: "move", x: 1, z: 0 }));
});

test("semantic action input validates, bounds, drains, resets, and disposes", () => {
  for (const names of [[], [""], ["jump", "jump"], ["jump", 1]]) {
    assert.throws(() => createSemanticActionInput(names), /action names/);
  }
  assert.throws(
    () => createSemanticActionInput(["jump"], { capacity: 0 }),
    /positive integer/,
  );

  const input = createSemanticActionInput(["jump", "dash"], { capacity: 2 });
  assert.equal(input.press("jump"), true);
  assert.equal(input.press("dash"), true);
  assert.equal(input.press("jump"), false);
  assert.deepEqual(input.drain(), ["jump", "dash"]);
  assert.equal(Object.isFrozen(input.drain()), true);
  assert.throws(() => input.press("interact"), /not allowed/);

  input.press("jump");
  input.reset();
  input.reset();
  assert.deepEqual(input.drain(), []);

  input.press("dash");
  input.dispose();
  input.dispose();
  input.reset();
  for (const operation of [() => input.press("jump"), () => input.drain()]) {
    assert.throws(
      operation,
      (error) =>
        error instanceof SemanticActionInputDisposedError &&
        error.code === "semantic-action-input-disposed",
    );
  }
});

test("keyboard adapter maps movement keys and combines axes", () => {
  const harness = createListenerHarness();
  const adapter = createKeyboardMovementAdapter(harness.source);
  assert.deepEqual(harness.additions, ["keydown", "keyup"]);

  const mappings = [
    ["KeyW", { kind: "move", x: 0, z: -1 }],
    ["KeyA", { kind: "move", x: -1, z: 0 }],
    ["KeyS", { kind: "move", x: 0, z: 1 }],
    ["KeyD", { kind: "move", x: 1, z: 0 }],
    ["ArrowUp", { kind: "move", x: 0, z: -1 }],
    ["ArrowLeft", { kind: "move", x: -1, z: 0 }],
    ["ArrowDown", { kind: "move", x: 0, z: 1 }],
    ["ArrowRight", { kind: "move", x: 1, z: 0 }],
  ];
  for (const [code, expected] of mappings) {
    harness.dispatch("keydown", code);
    assert.deepEqual(adapter.sample(), expected);
    harness.dispatch("keyup", code);
    assert.deepEqual(adapter.sample(), IDLE);
  }

  harness.dispatch("keydown", "KeyW");
  harness.dispatch("keydown", "KeyD");
  assert.deepEqual(adapter.sample(), {
    kind: "move",
    x: Math.sqrt(0.5 - Number.EPSILON),
    z: -Math.sqrt(0.5 - Number.EPSILON),
  });
  harness.dispatch("keyup", "KeyW");
  harness.dispatch("keyup", "KeyD");

  harness.dispatch("keydown", "KeyW");
  harness.dispatch("keydown", "KeyS");
  assert.deepEqual(adapter.sample(), IDLE);
  harness.dispatch("keyup", "KeyW");
  assert.deepEqual(adapter.sample(), { kind: "move", x: 0, z: 1 });
  harness.dispatch("keyup", "KeyS");

  harness.dispatch("keydown", "KeyA");
  harness.dispatch("keydown", "KeyD");
  assert.deepEqual(adapter.sample(), IDLE);
  harness.dispatch("keyup", "KeyA");
  assert.deepEqual(adapter.sample(), { kind: "move", x: 1, z: 0 });
  harness.dispatch("keyup", "KeyD");

  harness.dispatch("keydown", "Space");
  harness.dispatch("keyup", "Escape");
  assert.deepEqual(adapter.sample(), IDLE);

  adapter.dispose();
  adapter.dispose();
  assert.deepEqual(harness.removals, ["keydown", "keyup"]);
  assert.equal(harness.active.keydown.size, 0);
  assert.equal(harness.active.keyup.size, 0);
  assertDisposed(() => adapter.sample());
});

test("keyboard adapter rolls back partial listener registration", () => {
  const registrationError = new Error("keyup registration failed");
  const harness = createListenerHarness({
    failAdd: Object.assign(new String("keyup"), {
      error: registrationError,
    }),
  });

  assert.throws(
    () => createKeyboardMovementAdapter(harness.source),
    (error) => error === registrationError,
  );
  assert.deepEqual(harness.additions, ["keydown", "keyup"]);
  assert.deepEqual(harness.removals, ["keydown"]);
  assert.equal(harness.active.keydown.size, 0);
  assert.equal(harness.active.keyup.size, 0);
});

test("keyboard adapter attempts both removals and cleanup remains idempotent", () => {
  const removalError = new Error("keydown removal failed");
  const harness = createListenerHarness({
    failRemove: Object.assign(new String("keydown"), {
      error: removalError,
    }),
  });
  const adapter = createKeyboardMovementAdapter(harness.source);

  assert.throws(() => adapter.dispose(), (error) => error === removalError);
  assert.deepEqual(harness.removals, ["keydown", "keyup"]);
  assert.equal(harness.active.keydown.size, 0);
  assert.equal(harness.active.keyup.size, 0);

  adapter.dispose();
  assert.deepEqual(harness.removals, ["keydown", "keyup"]);
  assertDisposed(() => adapter.sample());
});

test("input feature contributes one action sampler and publishes once per exact tick", async () => {
  let samples = 0;
  const published = [];
  const sourceCommand = { kind: "move", x: 0, z: -1 };
  const feature = createInputFeature({
    input: {
      sample() {
        samples += 1;
        return sourceCommand;
      },
    },
    publish(command) {
      published.push(command);
    },
  });

  assert.equal(feature.runtimeContributions.length, 1);
  assert.deepEqual(
    feature.runtimeContributions.map(
      ({ kind, id, domain, phase }) => ({ kind, id, domain, phase }),
    ),
    [
      {
        kind: "system",
        id: "movement-input-sample",
        domain: "client-simulation",
        phase: "action-sample",
      },
    ],
  );

  const runtime = createClientRuntime({
    features: [feature],
    frameSource: createDeterministicPresentationFrameSource(),
  });
  assert.equal((await runtime.boot()).state, "running");
  assert.deepEqual(runtime.stepExact(120), { ok: true, value: 120 });
  assert.equal(samples, 120);
  assert.equal(published.length, 120);
  assert.ok(
    published.every(
      (command) =>
        command !== sourceCommand &&
        Object.isFrozen(command) &&
        command.kind === "move" &&
        command.x === 0 &&
        command.z === -1,
    ),
  );

  await runtime.shutdown();
  feature.runtimeContributions[0].run();
  assert.equal(runtime.stepExact(1).ok, false);
  assert.equal(samples, 120);
  assert.equal(published.length, 120);
});

test("input feature optionally drains actions once per tick", async () => {
  const actions = createSemanticActionInput(["jump", "dash"]);
  const publishedActions = [];
  const feature = createInputFeature({
    input: createMovementInput(),
    publish() {},
    actions,
    publishAction(action) {
      publishedActions.push(action);
    },
  });
  const runtime = createClientRuntime({
    features: [feature],
    frameSource: createDeterministicPresentationFrameSource(),
  });
  assert.equal((await runtime.boot()).state, "running");
  actions.press("jump");
  actions.press("dash");
  assert.deepEqual(runtime.stepExact(1), { ok: true, value: 1 });
  assert.deepEqual(publishedActions, ["jump", "dash"]);
  assert.deepEqual(runtime.stepExact(1), { ok: true, value: 2 });
  assert.deepEqual(publishedActions, ["jump", "dash"]);

  await runtime.shutdown();
  actions.dispose();
});

test("input feature requires both semantic action options", () => {
  const input = createMovementInput();
  const actions = createSemanticActionInput(["jump"]);
  assert.throws(
    () => createInputFeature({ input, publish() {}, actions }),
    /action options/,
  );
  assert.throws(
    () => createInputFeature({ input, publish() {}, publishAction() {} }),
    /action options/,
  );
  input.dispose();
  actions.dispose();
});
