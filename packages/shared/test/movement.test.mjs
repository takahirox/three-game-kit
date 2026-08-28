import assert from "node:assert/strict";
import test from "node:test";
import {
  IDLE_MOVEMENT_COMMAND,
  applyMovementCommand,
  computeDesiredMovementTranslation,
  createHeadlessMovementCommandSource,
  createMovementCommand,
  createMovementState,
  createStaticSceneDescriptor,
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

test("desired movement translation applies axes, speed, dt, and downward movement", () => {
  assert.deepEqual(
    computeDesiredMovementTranslation(createMovementCommand(1, 0), {
      speedMetersPerSecond: 2,
      dtSeconds: 0.5,
    }),
    { x: 1, y: -0.001, z: 0 },
  );

  assert.deepEqual(
    computeDesiredMovementTranslation(IDLE_MOVEMENT_COMMAND, {
      speedMetersPerSecond: 2,
      dtSeconds: 0.5,
      downwardMetersPerTick: 0.25,
    }),
    { x: 0, y: -0.25, z: 0 },
  );

  assert.deepEqual(
    computeDesiredMovementTranslation(createMovementCommand(0.6, 0.8), {
      speedMetersPerSecond: 2,
      dtSeconds: 0.5,
    }),
    { x: 0.6, y: -0.001, z: 0.8 },
  );

  const zeroDownward = computeDesiredMovementTranslation(
    IDLE_MOVEMENT_COMMAND,
    {
      speedMetersPerSecond: 1,
      dtSeconds: 1,
      downwardMetersPerTick: 0,
    },
  );
  assert.equal(Object.is(zeroDownward.y, -0), true);
});

test("desired movement translation is detached, frozen, and does not mutate input", () => {
  const command = { kind: "move", x: 0.6, z: 0.8 };
  const options = {
    speedMetersPerSecond: 2,
    dtSeconds: 0.5,
    downwardMetersPerTick: 0.2,
  };
  const result = computeDesiredMovementTranslation(command, options);

  assert.deepEqual(command, { kind: "move", x: 0.6, z: 0.8 });
  assert.deepEqual(options, {
    speedMetersPerSecond: 2,
    dtSeconds: 0.5,
    downwardMetersPerTick: 0.2,
  });
  assert.equal(Object.isFrozen(result), true);

  command.x = -1;
  options.speedMetersPerSecond = 10;
  options.downwardMetersPerTick = 1;
  assert.deepEqual(result, { x: 0.6, y: -0.2, z: 0.8 });
});

test("desired movement translation rejects invalid semantic commands", () => {
  const invalidCommands = [
    null,
    { kind: "jump", x: 0, z: 0 },
    { kind: "move", x: Number.NaN, z: 0 },
    { kind: "move", x: 0, z: Number.POSITIVE_INFINITY },
    { kind: "move", x: 2, z: 0 },
    { kind: "move", x: 1, z: 1 },
  ];

  for (const command of invalidCommands) {
    assert.throws(
      () =>
        computeDesiredMovementTranslation(command, {
          speedMetersPerSecond: 1,
          dtSeconds: 1,
        }),
      /kind move|finite|unit disc/,
    );
  }
});

test("desired movement translation rejects invalid movement options", () => {
  const command = createMovementCommand(1, 0);
  for (const field of ["speedMetersPerSecond", "dtSeconds"]) {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () =>
          computeDesiredMovementTranslation(command, {
            speedMetersPerSecond: 1,
            dtSeconds: 1,
            [field]: value,
          }),
        /finite|positive/,
      );
    }
  }

  for (const value of [-0.001, Number.NaN, Number.POSITIVE_INFINITY, 1.001]) {
    assert.throws(
      () =>
        computeDesiredMovementTranslation(command, {
          speedMetersPerSecond: 2,
          dtSeconds: 0.5,
          downwardMetersPerTick: value,
        }),
      /finite|nonnegative|must not exceed/,
    );
  }

  assert.throws(
    () =>
      computeDesiredMovementTranslation(command, {
        speedMetersPerSecond: Number.MAX_VALUE,
        dtSeconds: Number.MAX_VALUE,
      }),
    /Movement distance must be finite/,
  );
  assert.throws(
    () =>
      computeDesiredMovementTranslation(command, {
        speedMetersPerSecond: 0.5,
        dtSeconds: 0.001,
      }),
    /must not exceed/,
  );
  assert.throws(
    () => computeDesiredMovementTranslation(command, null),
    /must be an object/,
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

function validStaticScene() {
  return {
    capsuleRadius: 0.5,
    capsuleHalfHeight: 0.5,
    controllerOffset: 0.01,
    boxes: [
      {
        id: "floor",
        center: { x: 0, y: -0.5, z: 0 },
        halfExtents: { x: 10, y: 0.5, z: 10 },
      },
      {
        id: "wall",
        center: { x: 2.5, y: 1, z: 0 },
        halfExtents: { x: 0.5, y: 1, z: 2 },
      },
    ],
  };
}

test("static scene descriptors are detached ordered frozen values", () => {
  const input = validStaticScene();
  const scene = createStaticSceneDescriptor(input);

  input.capsuleRadius = 7;
  input.capsuleHalfHeight = 7;
  input.controllerOffset = 7;
  input.boxes[0].id = "changed";
  input.boxes[0].center.x = 7;
  input.boxes[0].halfExtents.y = 7;
  input.boxes.reverse();

  assert.deepEqual(scene, {
    capsuleRadius: 0.5,
    capsuleHalfHeight: 0.5,
    controllerOffset: 0.01,
    boxes: [
      {
        id: "floor",
        center: { x: 0, y: -0.5, z: 0 },
        halfExtents: { x: 10, y: 0.5, z: 10 },
      },
      {
        id: "wall",
        center: { x: 2.5, y: 1, z: 0 },
        halfExtents: { x: 0.5, y: 1, z: 2 },
      },
    ],
  });
  assert.equal(Object.isFrozen(scene), true);
  assert.equal(Object.isFrozen(scene.boxes), true);
  for (const box of scene.boxes) {
    assert.equal(Object.isFrozen(box), true);
    assert.equal(Object.isFrozen(box.center), true);
    assert.equal(Object.isFrozen(box.halfExtents), true);
  }
});

test("static scene descriptors reject invalid numeric values", () => {
  const invalidScenes = [
    ["NaN capsule radius", (scene) => { scene.capsuleRadius = Number.NaN; }],
    ["infinite capsule half-height", (scene) => { scene.capsuleHalfHeight = Number.POSITIVE_INFINITY; }],
    ["infinite controller offset", (scene) => { scene.controllerOffset = Number.NEGATIVE_INFINITY; }],
    ["zero capsule radius", (scene) => { scene.capsuleRadius = 0; }],
    ["negative capsule half-height", (scene) => { scene.capsuleHalfHeight = -1; }],
    ["zero controller offset", (scene) => { scene.controllerOffset = 0; }],
    ["NaN box center", (scene) => { scene.boxes[0].center.x = Number.NaN; }],
    ["infinite box center", (scene) => { scene.boxes[0].center.z = Number.POSITIVE_INFINITY; }],
    ["zero box half-extent", (scene) => { scene.boxes[0].halfExtents.x = 0; }],
    ["negative box half-extent", (scene) => { scene.boxes[0].halfExtents.y = -1; }],
    ["infinite box half-extent", (scene) => { scene.boxes[0].halfExtents.z = Number.POSITIVE_INFINITY; }],
  ];

  for (const [name, invalidate] of invalidScenes) {
    const scene = validStaticScene();
    invalidate(scene);
    assert.throws(
      () => createStaticSceneDescriptor(scene),
      /finite|positive/,
      name,
    );
  }
});

test("static scene descriptors reject empty and duplicate box ids", () => {
  const emptyId = validStaticScene();
  emptyId.boxes[0].id = "";
  assert.throws(
    () => createStaticSceneDescriptor(emptyId),
    /non-empty/,
  );

  const duplicateId = validStaticScene();
  duplicateId.boxes[1].id = duplicateId.boxes[0].id;
  assert.throws(
    () => createStaticSceneDescriptor(duplicateId),
    /unique/,
  );
});
