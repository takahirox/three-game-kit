import assert from "node:assert/strict";
import test from "node:test";
import { createDeterministicPresentationFrameSource, defineFeatureConfiguration } from "@three-game-kit/core";
import { createClientRuntime } from "@three-game-kit/client";
import { createCharacterController, createCharacterControllerFeature } from "@three-game-kit/client/character-controller";

function collisionFixture() {
  let disposed = 0;
  const moves = [];
  return {
    get disposed() { return disposed > 0; },
    move(start, desired) {
      moves.push({ start, desired });
      const candidateY = start.y + desired.y;
      const grounded = candidateY <= 0;
      const effectiveY = grounded ? -start.y : desired.y;
      const effective = { x: desired.x, y: effectiveY, z: desired.z };
      return { ok: true, value: {
        startPosition: start,
        desiredTranslation: desired,
        effectiveTranslation: effective,
        position: { x: start.x + effective.x, y: start.y + effective.y, z: start.z + effective.z },
        grounded,
        collided: grounded,
        collisionCount: grounded ? 1 : 0,
      } };
    },
    dispose() { disposed += 1; },
    inspect: () => ({ disposed, moves }),
  };
}

const config = { walkSpeed: 3, runSpeed: 6, gravity: 12, jumpSpeed: 5, maximumFallSpeed: 20 };
const idle = { x: 0, z: 0, run: false, jump: false };

test("character controller provides gravity, grounded jump, running, platforms, impulses, teleport, and cleanup", () => {
  const collision = collisionFixture();
  const controller = createCharacterController({ collision, initialPosition: { x: 0, y: 0, z: 0 }, configuration: config });
  const landed = controller.step(1 / 60, idle);
  assert.equal(landed.grounded, true);
  assert.equal(landed.position.y, 0);
  const jumped = controller.step(1 / 60, { ...idle, jump: true });
  assert.equal(jumped.grounded, false);
  assert.ok(jumped.velocity.y > 0);
  const running = controller.step(0.1, { x: 1, z: 1, run: true, jump: false, platformVelocity: { x: 1, y: 0, z: 0 } });
  assert.ok(running.velocity.x > 5 && running.velocity.x < 6);
  assert.ok(running.velocity.z > 4 && running.velocity.z < 5);
  controller.applyImpulse({ x: 2, y: 3, z: -1 });
  assert.ok(controller.inspect().velocity.y >= 3);
  const impulsed = controller.step(0.1, idle);
  assert.equal(impulsed.velocity.x, 2);
  assert.equal(impulsed.velocity.z, -1);
  controller.setVelocity({ x: -4, y: 2, z: 3 });
  const overridden = controller.step(0.1, idle);
  assert.equal(overridden.velocity.x, -4);
  assert.equal(overridden.velocity.z, 3);
  const teleported = controller.teleport({ x: 10, y: 4, z: -2 });
  assert.deepEqual(teleported.position, { x: 10, y: 4, z: -2 });
  assert.deepEqual(teleported.velocity, { x: 0, y: 0, z: 0 });
  controller.dispose();
  controller.dispose();
  assert.equal(collision.inspect().disposed, 1);
  assert.throws(() => controller.step(1 / 60, idle), /disposed/);
});

test("Character Controller Feature runs in predictive-collision and owns the controller", async () => {
  const collision = collisionFixture();
  const controller = createCharacterController({ collision, initialPosition: { x: 0, y: 0, z: 0 }, configuration: config });
  const published = [];
  const feature = createCharacterControllerFeature({ controller, readInput: () => idle, publish: (state) => published.push(state) });
  assert.deepEqual(feature.runtimeContributions.map(({ id, phase }) => ({ id, phase })), [{ id: "character-controller-predict", phase: "predictive-collision" }]);
  assert.deepEqual(feature.conflicts, ["collision"]);
  const runtime = createClientRuntime({ features: [feature], frameSource: createDeterministicPresentationFrameSource() });
  assert.equal((await runtime.boot()).state, "running");
  assert.deepEqual(runtime.stepExact(3), { ok: true, value: 3 });
  assert.equal(published.length, 3);
  await runtime.shutdown();
  assert.equal(controller.disposed, true);
  assert.equal(collision.inspect().disposed, 1);
});

test("Character Controller Feature rolls back and validates bounded inputs", async () => {
  const collision = collisionFixture();
  const controller = createCharacterController({ collision, initialPosition: { x: 0, y: 0, z: 0 }, configuration: config });
  const configuration = defineFeatureConfiguration({ defaultValue: () => ({}), parse: () => ({ ok: true, value: {} }) });
  const failing = { id: "later-failure", description: "failure", runtimeContributions: [], requires: [], conflicts: [], configuration, setup() { throw new Error("fail"); }, dispose() {} };
  const runtime = createClientRuntime({
    features: [createCharacterControllerFeature({ controller, readInput: () => idle, publish() {} }), failing],
    frameSource: createDeterministicPresentationFrameSource(),
  });
  assert.equal((await runtime.boot()).reason, "setup-failed");
  assert.equal(controller.disposed, true);

  const other = createCharacterController({ collision: collisionFixture(), initialPosition: { x: 0, y: 0, z: 0 }, configuration: config });
  assert.throws(() => other.step(1 / 60, { ...idle, x: 2 }), /input values/);
  assert.throws(() => other.applyImpulse({ x: 0, y: Infinity, z: 0 }), /finite/);
  assert.throws(() => other.setVelocity({ x: Number.NaN, y: 0, z: 0 }), /finite/);
  assert.throws(() => createCharacterController({ collision: collisionFixture(), initialPosition: { x: 0, y: 0, z: 0 }, configuration: { ...config, runSpeed: 1 } }), /runSpeed/);
  other.dispose();
});
