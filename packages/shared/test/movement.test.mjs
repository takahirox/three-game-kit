import assert from "node:assert/strict";
import test from "node:test";
import {
  IDLE_MOVEMENT_COMMAND,
  applyMovementCommand,
  createHeadlessMovementCommandSource,
  createMovementCommand,
  createMovementState,
} from "@three-game-kit/shared/movement";

test("semantic movement commands advance immutable state at fixed dt", () => {
  const command = createMovementCommand({ x: 0.6, z: 0.8 });
  const initial = createMovementState({ x: 10, y: 2, z: -4 });
  const next = applyMovementCommand(initial, command, {
    speedMetersPerSecond: 6,
    dtSeconds: 1 / 60,
  });

  assert.equal(Object.isFrozen(command), true);
  assert.equal(Object.isFrozen(initial), true);
  assert.equal(Object.isFrozen(initial.position), true);
  assert.equal(initial.position.x, 10);
  assert.ok(Math.abs(next.position.x - 10.06) < 1e-12);
  assert.equal(next.position.y, 2);
  assert.ok(Math.abs(next.position.z - -3.92) < 1e-12);
  assert.throws(() => createMovementCommand(1, 1), /unit disc/);
  assert.throws(
    () =>
      applyMovementCommand(initial, command, {
        speedMetersPerSecond: Number.NaN,
        dtSeconds: 1 / 60,
      }),
    /finite/,
  );
});

test("headless command source copies its fixture and is tick-addressable", () => {
  const mutable = { kind: "move", x: 1, z: 0 };
  const source = createHeadlessMovementCommandSource([
    mutable,
    createMovementCommand(0, -1),
  ]);
  mutable.x = 0;

  assert.equal(source.commandCount, 2);
  assert.deepEqual(source.commandForTick(1), {
    kind: "move",
    x: 1,
    z: 0,
  });
  assert.deepEqual(source.commandForTick(2), {
    kind: "move",
    x: 0,
    z: -1,
  });
  assert.equal(source.commandForTick(3), IDLE_MOVEMENT_COMMAND);
  assert.equal(source.commandForTick(3), source.commandForTick(3));
  assert.throws(() => source.commandForTick(0), /positive safe integers/);
});
