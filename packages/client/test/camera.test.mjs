import assert from "node:assert/strict";
import test from "node:test";
import { createDeterministicPresentationFrameSource } from "@three-game-kit/core";
import { createClientRuntime } from "@three-game-kit/client";
import {
  createCameraFeature,
  createThirdPersonCameraTransform,
} from "@three-game-kit/client/camera";

const CONFIGURATION = Object.freeze({
  distance: 4,
  height: 2,
  lookAtHeight: 1,
  yawRadians: 0,
});

function assertVectorNear(actual, expected) {
  for (const component of ["x", "y", "z"]) {
    assert.ok(
      Math.abs(actual[component] - expected[component]) <= 1e-12,
      `${component}: expected ${expected[component]}, received ${actual[component]}`,
    );
  }
}

function assertFiniteTransform(transform) {
  for (const vector of [transform.target, transform.position, transform.lookAt]) {
    assert.equal(Object.isFrozen(vector), true);
    assert.equal(Number.isFinite(vector.x), true);
    assert.equal(Number.isFinite(vector.y), true);
    assert.equal(Number.isFinite(vector.z), true);
  }
  assert.equal(Object.isFrozen(transform), true);
}

test("third-person transform orbits behind canonical yaw values", () => {
  const cases = [
    [0, { x: 0, y: 2, z: 4 }],
    [Math.PI / 2, { x: -4, y: 2, z: 0 }],
    [Math.PI, { x: 0, y: 2, z: -4 }],
    [-Math.PI / 2, { x: 4, y: 2, z: 0 }],
  ];

  for (const [yawRadians, expectedPosition] of cases) {
    const transform = createThirdPersonCameraTransform(
      { x: 0, y: 0, z: 0 },
      { ...CONFIGURATION, yawRadians },
    );
    assertVectorNear(transform.position, expectedPosition);
    assert.deepEqual(transform.lookAt, { x: 0, y: 1, z: 0 });
    assert.deepEqual(transform.target, { x: 0, y: 0, z: 0 });
    assertFiniteTransform(transform);
  }
});

test("third-person transform copies and deeply freezes its vectors", () => {
  const target = { x: 10, y: 3, z: -2 };
  const configuration = {
    distance: 6,
    height: 4,
    lookAtHeight: 1.5,
    yawRadians: 0,
  };
  const transform = createThirdPersonCameraTransform(target, configuration);

  target.x = 999;
  target.y = 999;
  configuration.distance = 999;
  assert.deepEqual(transform, {
    target: { x: 10, y: 3, z: -2 },
    position: { x: 10, y: 7, z: 4 },
    lookAt: { x: 10, y: 4.5, z: -2 },
  });
  assert.notEqual(transform.target, target);
  assert.notEqual(transform.position, target);
  assert.notEqual(transform.lookAt, target);
  assertFiniteTransform(transform);

  assert.throws(() => {
    transform.position.x = 1;
  }, TypeError);
  assert.throws(() => {
    transform.lookAt.y = 1;
  }, TypeError);
});

test("third-person transform rejects malformed and non-finite values", () => {
  for (const target of [
    null,
    [],
    { x: 0, y: 0 },
    { x: 0, y: 0, z: 0, extra: true },
    { x: Number.NaN, y: 0, z: 0 },
    { x: 0, y: Infinity, z: 0 },
    { x: 0, y: 0, z: -Infinity },
  ]) {
    assert.throws(
      () => createThirdPersonCameraTransform(target, CONFIGURATION),
      /exactly x, y, and z|finite numbers/,
    );
  }

  for (const configuration of [
    null,
    [],
    { distance: 4, height: 2, lookAtHeight: 1 },
    { ...CONFIGURATION, extra: true },
    { ...CONFIGURATION, distance: 0 },
    { ...CONFIGURATION, distance: -1 },
    { ...CONFIGURATION, distance: Infinity },
    { ...CONFIGURATION, height: Number.NaN },
    { ...CONFIGURATION, lookAtHeight: -Infinity },
    { ...CONFIGURATION, yawRadians: Number.NaN },
  ]) {
    assert.throws(
      () =>
        createThirdPersonCameraTransform(
          { x: 0, y: 0, z: 0 },
          configuration,
        ),
      /configuration|positive finite|must be finite/,
    );
  }

  assert.throws(
    () =>
      createThirdPersonCameraTransform(
        { x: Number.MAX_VALUE, y: 0, z: 0 },
        {
          distance: Number.MAX_VALUE,
          height: 0,
          lookAtHeight: 0,
          yawRadians: -Math.PI / 2,
        },
      ),
    /Camera position components must be finite numbers/,
  );
});

test("camera feature publishes once for each of 75 presentation-only frames", async () => {
  const frameSource = createDeterministicPresentationFrameSource();
  const sourceTarget = { x: 0, y: 2, z: 3 };
  const configuration = {
    distance: 5,
    height: 2.5,
    lookAtHeight: 1,
    yawRadians: Math.PI / 4,
  };
  let targetReads = 0;
  const published = [];
  const feature = createCameraFeature({
    readTarget() {
      targetReads += 1;
      return sourceTarget;
    },
    configuration,
    publish(transform) {
      published.push(transform);
    },
  });
  configuration.distance = Infinity;

  assert.equal(feature.runtimeContributions.length, 1);
  assert.deepEqual(
    feature.runtimeContributions.map(
      ({ kind, id, domain, phase }) => ({ kind, id, domain, phase }),
    ),
    [
      {
        kind: "system",
        id: "third-person-camera-view",
        domain: "client-presentation",
        phase: "camera-view",
      },
    ],
  );

  const runtime = createClientRuntime({ features: [feature], frameSource });
  assert.equal((await runtime.boot()).state, "running");
  assert.equal(runtime.tick, 0);
  assert.deepEqual(runtime.startPresentation(), { ok: true, value: true });

  for (let frame = 1; frame <= 75; frame += 1) {
    sourceTarget.x = frame / 10;
    sourceTarget.z = -frame;
    assert.equal(frameSource.deliver(frame * 8), true);
  }

  assert.equal(targetReads, 75);
  assert.equal(published.length, 75);
  assert.equal(runtime.tick, 0);
  assert.equal(runtime.snapshotTelemetry().simulationTick, 0);
  assert.equal(runtime.snapshotTelemetry().presentationFrameCount, 75);
  assert.ok(
    published.every(
      (transform, index) =>
        transform.target.x === (index + 1) / 10 &&
        transform.target.z === -(index + 1),
    ),
  );
  assert.ok(published.every((transform) => transform.target !== sourceTarget));
  assert.ok(published.every((transform) => {
    assertFiniteTransform(transform);
    return true;
  }));

  await runtime.shutdown();
  const callbacksAtShutdown = published.length;
  const readsAtShutdown = targetReads;
  feature.runtimeContributions[0].run({ frame: 76, timestampMs: 608 });
  assert.equal(frameSource.deliver(608), false);
  assert.equal(published.length, callbacksAtShutdown);
  assert.equal(targetReads, readsAtShutdown);
  assert.equal(runtime.tick, 0);
});

test("camera feature validates its injected callbacks", () => {
  assert.throws(
    () => createCameraFeature({ configuration: CONFIGURATION, publish() {} }),
    /options are invalid/,
  );
  assert.throws(
    () =>
      createCameraFeature({
        readTarget() {
          return { x: 0, y: 0, z: 0 };
        },
        configuration: CONFIGURATION,
        publish: null,
      }),
    /options are invalid/,
  );
});
