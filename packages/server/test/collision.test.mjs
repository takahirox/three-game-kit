import assert from "node:assert/strict";
import test from "node:test";
import { createRapierServerCollisionAdapter } from "@three-game-kit/server/collision";

const ORIGIN = Object.freeze({ x: 0, y: 1, z: 0 });

function trustedFloorAndWallScene() {
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

function assertFiniteVector(vector) {
  assert.deepEqual(Object.keys(vector), ["x", "y", "z"]);
  assert.equal(Number.isFinite(vector.x), true);
  assert.equal(Number.isFinite(vector.y), true);
  assert.equal(Number.isFinite(vector.z), true);
}

function assertFrozenInspection(inspection) {
  assert.equal(Object.isFrozen(inspection), true);
  assert.equal(Object.isFrozen(inspection.avatars), true);
  for (const avatar of inspection.avatars) {
    assert.equal(Object.isFrozen(avatar), true);
    assert.equal(Object.isFrozen(avatar.position), true);
    assertFiniteVector(avatar.position);
  }
}

test("server collision keeps avatar movement independent and blocks a capsule at a wall", (t) => {
  const adapter = createRapierServerCollisionAdapter(
    trustedFloorAndWallScene(),
  );
  t.after(() => adapter.dispose());

  const alphaInitial = { x: 0, y: 1, z: 0 };
  const bravoInitial = { x: -3, y: 1, z: 0 };
  assert.deepEqual(adapter.createAvatar("alpha", alphaInitial), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(adapter.createAvatar("bravo", bravoInitial), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(adapter.createAvatar("alpha", ORIGIN), {
    ok: false,
    failure: { code: "duplicate-avatar" },
  });
  assert.deepEqual(adapter.removeAvatar("missing"), {
    ok: false,
    failure: { code: "missing-avatar" },
  });
  assert.deepEqual(
    adapter.moveAvatar("missing", ORIGIN, { x: 1, y: 0, z: 0 }),
    {
      ok: false,
      failure: { code: "missing-avatar" },
    },
  );

  alphaInitial.x = 99;
  bravoInitial.z = 99;
  const bravoStart = { x: -3, y: 1, z: 0 };
  const bravoDesired = { x: 0, y: 0, z: 1 };
  const bravoMove = adapter.moveAvatar(
    "bravo",
    bravoStart,
    bravoDesired,
  );
  assert.equal(bravoMove.ok, true);
  assert.ok(bravoMove.value.position.z > 0.99);
  assert.ok(bravoMove.value.position.z <= 1);
  assert.equal(bravoMove.value.position.x, -3);
  const bravoPosition = { ...bravoMove.value.position };
  bravoStart.x = 99;
  bravoDesired.z = 99;

  const beforeWall = adapter.inspect();
  assert.deepEqual(
    beforeWall.avatars.map(({ avatarId }) => avatarId),
    ["alpha", "bravo"],
  );
  assert.deepEqual(beforeWall.avatars[0].position, ORIGIN);
  assert.deepEqual(beforeWall.avatars[1].position, bravoPosition);

  const alphaStart = { x: 0, y: 1, z: 0 };
  const alphaDesired = { x: 4, y: 0, z: 0 };
  const alphaMove = adapter.moveAvatar("alpha", alphaStart, alphaDesired);
  assert.equal(alphaMove.ok, true);
  assert.equal(alphaMove.value.collided, true);
  assert.ok(alphaMove.value.collisionCount >= 1);
  assert.ok(alphaMove.value.effectiveTranslation.x > 1);
  assert.ok(alphaMove.value.effectiveTranslation.x < 4);
  assert.ok(alphaMove.value.position.x < 2);
  assert.equal(
    alphaMove.value.position.x,
    alphaMove.value.startPosition.x +
      alphaMove.value.effectiveTranslation.x,
  );
  assert.deepEqual(alphaMove.value.desiredTranslation, {
    x: 4,
    y: 0,
    z: 0,
  });
  alphaStart.x = 99;
  alphaDesired.x = 99;

  const inspected = adapter.inspect();
  assert.equal(inspected.disposed, false);
  assert.equal(inspected.avatarCount, 2);
  assert.deepEqual(
    inspected.avatars.map(({ avatarId }) => avatarId),
    ["alpha", "bravo"],
  );
  assert.deepEqual(inspected.avatars[0].position, alphaMove.value.position);
  assert.deepEqual(inspected.avatars[1].position, bravoPosition);
  assert.notEqual(
    inspected.avatars[0].position,
    alphaMove.value.position,
  );
  assertFrozenInspection(inspected);

  const inspectedAgain = adapter.inspect();
  assert.notEqual(inspectedAgain, inspected);
  assert.notEqual(inspectedAgain.avatars, inspected.avatars);
  assert.notEqual(inspectedAgain.avatars[0], inspected.avatars[0]);
  assert.notEqual(
    inspectedAgain.avatars[0].position,
    inspected.avatars[0].position,
  );
  assert.throws(() => {
    inspected.avatars[0].position.x = 99;
  }, TypeError);

  assert.deepEqual(adapter.removeAvatar("alpha"), {
    ok: true,
    value: undefined,
  });
  const afterRemoval = adapter.inspect();
  assert.equal(afterRemoval.avatarCount, 1);
  assert.equal(afterRemoval.avatars[0].avatarId, "bravo");
  assert.deepEqual(afterRemoval.avatars[0].position, bravoPosition);
  assert.deepEqual(adapter.removeAvatar("alpha"), {
    ok: false,
    failure: { code: "missing-avatar" },
  });

  const bravoAfterRemoval = adapter.moveAvatar(
    "bravo",
    bravoPosition,
    { x: 0, y: 0, z: 0.5 },
  );
  assert.equal(bravoAfterRemoval.ok, true);
  assert.ok(bravoAfterRemoval.value.position.z > bravoPosition.z);
  assert.deepEqual(
    adapter.inspect().avatars.map(({ avatarId }) => avatarId),
    ["bravo"],
  );
});

test("server collision sets an avatar position without changing other avatars or resources", (t) => {
  const adapter = createRapierServerCollisionAdapter(
    trustedFloorAndWallScene(),
  );
  t.after(() => adapter.dispose());

  assert.deepEqual(adapter.createAvatar("alpha", ORIGIN), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(
    adapter.createAvatar("bravo", { x: -3, y: 1, z: 2 }),
    { ok: true, value: undefined },
  );
  const requestedPosition = { x: 4, y: 2, z: -1 };
  assert.deepEqual(
    adapter.setAvatarPosition("alpha", requestedPosition),
    { ok: true, value: undefined },
  );
  requestedPosition.x = 99;

  const inspection = adapter.inspect();
  assert.equal(inspection.avatarCount, 2);
  assert.deepEqual(
    inspection.avatars.map(({ avatarId }) => avatarId),
    ["alpha", "bravo"],
  );
  assert.deepEqual(inspection.avatars[0].position, {
    x: 4,
    y: 2,
    z: -1,
  });
  assert.deepEqual(inspection.avatars[1].position, {
    x: -3,
    y: 1,
    z: 2,
  });
  assert.notEqual(inspection.avatars[0].position, requestedPosition);
  assertFrozenInspection(inspection);
  assert.throws(() => {
    inspection.avatars[0].position.z = 99;
  }, TypeError);

  const beforeMissing = adapter.inspect();
  assert.deepEqual(
    adapter.setAvatarPosition("missing", { x: 8, y: 8, z: 8 }),
    { ok: false, failure: { code: "missing-avatar" } },
  );
  assert.deepEqual(adapter.inspect(), beforeMissing);

  assert.deepEqual(adapter.removeAvatar("alpha"), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(adapter.removeAvatar("bravo"), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(adapter.inspect(), {
    disposed: false,
    avatarCount: 0,
    avatars: [],
  });
});

test("server collision rejects malformed IDs and untrusted vectors", (t) => {
  const adapter = createRapierServerCollisionAdapter(
    trustedFloorAndWallScene(),
  );
  t.after(() => adapter.dispose());

  for (const malformedId of ["", null, 1]) {
    assert.throws(
      () => adapter.createAvatar(malformedId, ORIGIN),
      /non-empty string/,
    );
  }
  assert.throws(
    () => adapter.setAvatarPosition("", ORIGIN),
    /non-empty string/,
  );
  assert.throws(() => adapter.removeAvatar(""), /non-empty string/);
  assert.throws(
    () => adapter.moveAvatar("", ORIGIN, { x: 0, y: 0, z: 0 }),
    /non-empty string/,
  );

  assert.throws(
    () => adapter.createAvatar("nan", { x: Number.NaN, y: 1, z: 0 }),
    /finite numbers/,
  );
  assert.throws(
    () =>
      adapter.createAvatar("extra", { x: 0, y: 1, z: 0, extra: true }),
    /exactly x, y, and z/,
  );
  assert.deepEqual(adapter.createAvatar("alpha", ORIGIN), {
    ok: true,
    value: undefined,
  });
  const beforeInvalidPosition = adapter.inspect();
  for (const invalidPosition of [
    { x: Number.NaN, y: 1, z: 0 },
    { x: 0, y: Number.POSITIVE_INFINITY, z: 0 },
    { x: 0, y: 1, z: Number.NEGATIVE_INFINITY },
  ]) {
    assert.throws(
      () => adapter.setAvatarPosition("alpha", invalidPosition),
      /finite numbers/,
    );
  }
  for (const invalidPosition of [
    null,
    [],
    { x: 0, y: 1 },
    { x: 0, y: 1, z: 0, extra: true },
  ]) {
    assert.throws(
      () => adapter.setAvatarPosition("alpha", invalidPosition),
      /exactly x, y, and z/,
    );
  }
  assert.deepEqual(adapter.inspect(), beforeInvalidPosition);
  assert.throws(
    () =>
      adapter.moveAvatar(
        "alpha",
        { x: Number.POSITIVE_INFINITY, y: 1, z: 0 },
        { x: 0, y: 0, z: 0 },
      ),
    /finite numbers/,
  );
  assert.throws(
    () =>
      adapter.moveAvatar(
        "alpha",
        ORIGIN,
        { x: 0, y: 0, z: Number.NEGATIVE_INFINITY },
      ),
    /finite numbers/,
  );
  assert.throws(
    () =>
      adapter.moveAvatar(
        "alpha",
        { x: 0, y: 1, z: 0, extra: true },
        { x: 0, y: 0, z: 0 },
      ),
    /exactly x, y, and z/,
  );
  assert.throws(
    () =>
      adapter.moveAvatar(
        "alpha",
        ORIGIN,
        { x: 0, y: 0, z: 0, extra: true },
      ),
    /exactly x, y, and z/,
  );
});

test("server collision disposal is idempotent and operations stay disposed", () => {
  const adapter = createRapierServerCollisionAdapter(
    trustedFloorAndWallScene(),
  );
  adapter.createAvatar("alpha", ORIGIN);

  adapter.dispose();
  assert.equal(adapter.disposed, true);
  assert.doesNotThrow(() => adapter.dispose());

  const disposedOutcome = {
    ok: false,
    failure: { code: "disposed-resource" },
  };
  assert.deepEqual(adapter.createAvatar("later", ORIGIN), disposedOutcome);
  assert.deepEqual(adapter.removeAvatar("alpha"), disposedOutcome);
  assert.deepEqual(adapter.setAvatarPosition("alpha", ORIGIN), disposedOutcome);
  assert.deepEqual(
    adapter.moveAvatar("alpha", ORIGIN, { x: 1, y: 0, z: 0 }),
    disposedOutcome,
  );

  const inspection = adapter.inspect();
  assert.deepEqual(inspection, {
    disposed: true,
    avatarCount: 0,
    avatars: [],
  });
  assertFrozenInspection(inspection);
  adapter.dispose();
  assert.deepEqual(adapter.inspect(), inspection);
});
