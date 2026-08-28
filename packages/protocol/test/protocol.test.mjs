import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_BUFFERED_SNAPSHOTS,
  MAX_FUTURE_TICKS,
  MAX_ID_LENGTH,
  MAX_MESSAGE_BYTES,
  MAX_MOVEMENT_SPEED,
  MAX_PAST_TICKS,
  MAX_PENDING_COMMANDS,
  MAX_POSITION_ABS,
  MAX_SEQUENCE,
  MAX_SNAPSHOT_ENTITIES,
  MAX_TICK,
  OpaqueIdSchema,
  PROTOCOL_VERSION,
  RejectedReasonSchema,
  SnapshotMessageSchema,
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
} from "@three-game-kit/protocol";

const textEncoder = new TextEncoder();

const REJECTION_REASONS = [
  "schema-invalid",
  "unsupported-version",
  "unknown-kind",
  "wrong-direction",
  "phase-invalid",
  "sequence-invalid",
  "tick-out-of-window",
  "queue-full",
  "ownership-violation",
  "movement-limit",
  "unknown-target",
  "interaction-out-of-range",
  "stale-connection",
];

function textFrame(text) {
  return { kind: "text", bytes: textEncoder.encode(text) };
}

function valueFrame(value) {
  return textFrame(JSON.stringify(value));
}

function expectDecodeFailure(result, stage, reason) {
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("expected decode failure");
  assert.deepEqual(Object.keys(result.failure).sort(), [
    "issues",
    "reason",
    "stage",
  ]);
  assert.equal(result.failure.stage, stage);
  assert.equal(result.failure.reason, reason);
  assert.equal("value" in result, false);
  return result.failure;
}

function expectEncodeFailure(result, reason) {
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("expected encode failure");
  assert.deepEqual(Object.keys(result.failure).sort(), ["issues", "reason"]);
  assert.equal(result.failure.reason, reason);
  assert.equal("value" in result, false);
  return result.failure;
}

function joinMessage() {
  return { protocolVersion: PROTOCOL_VERSION, kind: "join" };
}

function moveCommand(overrides = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "command",
    sequence: 1,
    intendedTick: 0,
    action: { kind: "move", x: 0.6, z: 0.8 },
    ...overrides,
  };
}

function interactCommand(overrides = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "command",
    sequence: 2,
    intendedTick: 1,
    action: { kind: "interact", targetEntityId: "target_1" },
    ...overrides,
  };
}

function joinedMessage() {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "joined",
    connectionId: "connection_1",
    playerId: "player_1",
    ownedEntityId: "avatar_1",
    serverTick: 0,
  };
}

function avatarEntity(overrides = {}) {
  return {
    entityKind: "avatar",
    entityId: "avatar_1",
    playerId: "player_1",
    position: { x: 0, y: 1, z: 2 },
    ...overrides,
  };
}

function interactableEntity(overrides = {}) {
  return {
    entityKind: "interactable",
    entityId: "target_1",
    position: { x: -1, y: 0, z: 1 },
    active: true,
    ...overrides,
  };
}

function snapshotMessage(overrides = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "snapshot",
    serverTick: MAX_TICK,
    acknowledgedSequence: MAX_SEQUENCE,
    entities: [avatarEntity(), interactableEntity()],
    ...overrides,
  };
}

function rejectedMessage(reason = "schema-invalid") {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "rejected",
    sequence: null,
    reason,
  };
}

function variants() {
  return [
    {
      name: "join",
      direction: "client",
      value: joinMessage(),
      encode: encodeClientMessage,
      decode: decodeClientMessage,
    },
    {
      name: "move command",
      direction: "client",
      value: moveCommand(),
      encode: encodeClientMessage,
      decode: decodeClientMessage,
    },
    {
      name: "interact command",
      direction: "client",
      value: interactCommand(),
      encode: encodeClientMessage,
      decode: decodeClientMessage,
    },
    {
      name: "joined",
      direction: "server",
      value: joinedMessage(),
      encode: encodeServerMessage,
      decode: decodeServerMessage,
    },
    {
      name: "snapshot",
      direction: "server",
      value: snapshotMessage(),
      encode: encodeServerMessage,
      decode: decodeServerMessage,
    },
    {
      name: "rejected",
      direction: "server",
      value: rejectedMessage(),
      encode: encodeServerMessage,
      decode: decodeServerMessage,
    },
  ];
}

function compactEntity(index, overrides = {}) {
  return {
    entityKind: "interactable",
    entityId: index.toString(36),
    position: { x: 0, y: 0, z: 0 },
    active: true,
    ...overrides,
  };
}

test("exports the exact Protocol v1 constants", () => {
  assert.deepEqual(
    {
      PROTOCOL_VERSION,
      MAX_MESSAGE_BYTES,
      MAX_ID_LENGTH,
      MAX_SEQUENCE,
      MAX_TICK,
      MAX_PAST_TICKS,
      MAX_FUTURE_TICKS,
      MAX_PENDING_COMMANDS,
      MAX_BUFFERED_SNAPSHOTS,
      MAX_SNAPSHOT_ENTITIES,
      MAX_POSITION_ABS,
      MAX_MOVEMENT_SPEED,
    },
    {
      PROTOCOL_VERSION: 1,
      MAX_MESSAGE_BYTES: 16_384,
      MAX_ID_LENGTH: 64,
      MAX_SEQUENCE: 4_294_967_295,
      MAX_TICK: Number.MAX_SAFE_INTEGER,
      MAX_PAST_TICKS: 6,
      MAX_FUTURE_TICKS: 2,
      MAX_PENDING_COMMANDS: 128,
      MAX_BUFFERED_SNAPSHOTS: 32,
      MAX_SNAPSHOT_ENTITIES: 256,
      MAX_POSITION_ABS: 1_000_000,
      MAX_MOVEMENT_SPEED: 10,
    },
  );
});

test("round-trips all six message variants through their direction codecs", () => {
  for (const { name, value, encode, decode } of variants()) {
    const encoded = encode(value);
    assert.equal(encoded.ok, true, name);
    if (!encoded.ok) assert.fail(name);
    assert.equal(
      encoded.value.byteLength,
      textEncoder.encode(encoded.value.text).byteLength,
      name,
    );
    assert.ok(encoded.value.byteLength <= MAX_MESSAGE_BYTES, name);

    const decoded = decode(textFrame(encoded.value.text));
    assert.equal(decoded.ok, true, name);
    if (!decoded.ok) assert.fail(name);
    assert.deepEqual(decoded.value, value, name);
  }
});

test("rejects unknown fields at every top-level and nested object boundary", () => {
  for (const { name, value, decode } of variants()) {
    expectDecodeFailure(
      decode(valueFrame({ ...value, unexpected: true })),
      "schema",
      "schema-invalid",
    );
    assert.ok(name.length > 0);
  }

  const nestedCases = [
    [
      "move action",
      { ...moveCommand(), action: { ...moveCommand().action, unexpected: 1 } },
      decodeClientMessage,
    ],
    [
      "interact action",
      {
        ...interactCommand(),
        action: { ...interactCommand().action, unexpected: 1 },
      },
      decodeClientMessage,
    ],
    [
      "avatar entity",
      snapshotMessage({
        entities: [{ ...avatarEntity(), unexpected: 1 }, interactableEntity()],
      }),
      decodeServerMessage,
    ],
    [
      "avatar position",
      snapshotMessage({
        entities: [
          {
            ...avatarEntity(),
            position: { ...avatarEntity().position, unexpected: 1 },
          },
          interactableEntity(),
        ],
      }),
      decodeServerMessage,
    ],
    [
      "interactable entity",
      snapshotMessage({
        entities: [avatarEntity(), { ...interactableEntity(), unexpected: 1 }],
      }),
      decodeServerMessage,
    ],
    [
      "interactable position",
      snapshotMessage({
        entities: [
          avatarEntity(),
          {
            ...interactableEntity(),
            position: { ...interactableEntity().position, unexpected: 1 },
          },
        ],
      }),
      decodeServerMessage,
    ],
  ];

  for (const [name, value, decode] of nestedCases) {
    const failure = expectDecodeFailure(
      decode(valueFrame(value)),
      "schema",
      "schema-invalid",
    );
    assert.ok(failure.issues.length > 0, name);
  }
});

test("rejects every missing required top-level and nested field", () => {
  for (const { name, value, decode } of variants()) {
    for (const key of Object.keys(value)) {
      const copy = structuredClone(value);
      delete copy[key];
      expectDecodeFailure(
        decode(valueFrame(copy)),
        "schema",
        "schema-invalid",
      );
      assert.ok(`${name}.${key}`.length > 0);
    }
  }

  for (const command of [moveCommand(), interactCommand()]) {
    for (const key of Object.keys(command.action)) {
      const copy = structuredClone(command);
      delete copy.action[key];
      expectDecodeFailure(
        decodeClientMessage(valueFrame(copy)),
        "schema",
        "schema-invalid",
      );
    }
  }

  const snapshot = snapshotMessage();
  for (const index of [0, 1]) {
    for (const key of Object.keys(snapshot.entities[index])) {
      const copy = structuredClone(snapshot);
      delete copy.entities[index][key];
      expectDecodeFailure(
        decodeServerMessage(valueFrame(copy)),
        "schema",
        "schema-invalid",
      );
    }
    for (const key of Object.keys(snapshot.entities[index].position)) {
      const copy = structuredClone(snapshot);
      delete copy.entities[index].position[key];
      expectDecodeFailure(
        decodeServerMessage(valueFrame(copy)),
        "schema",
        "schema-invalid",
      );
    }
  }
});

test("rejects wrong primitives and substituted discriminators", () => {
  const cases = [
    [{ ...joinMessage(), protocolVersion: "1" }, decodeClientMessage],
    [{ ...joinMessage(), kind: 1 }, decodeClientMessage],
    [{ ...moveCommand(), sequence: "1" }, decodeClientMessage],
    [{ ...moveCommand(), intendedTick: "0" }, decodeClientMessage],
    [{ ...moveCommand(), action: null }, decodeClientMessage],
    [
      { ...moveCommand(), action: { kind: "move", x: "0", z: 0 } },
      decodeClientMessage,
    ],
    [
      { ...moveCommand(), action: { kind: "move", x: 0, z: false } },
      decodeClientMessage,
    ],
    [
      {
        ...interactCommand(),
        action: { kind: "interact", targetEntityId: 7 },
      },
      decodeClientMessage,
    ],
    [
      { ...moveCommand(), action: { kind: "interact", x: 0, z: 0 } },
      decodeClientMessage,
    ],
    [
      { ...moveCommand(), action: { kind: "jump", x: 0, z: 0 } },
      decodeClientMessage,
    ],
    [{ ...joinedMessage(), connectionId: 1 }, decodeServerMessage],
    [{ ...joinedMessage(), playerId: 1 }, decodeServerMessage],
    [{ ...joinedMessage(), ownedEntityId: 1 }, decodeServerMessage],
    [{ ...joinedMessage(), serverTick: "0" }, decodeServerMessage],
    [
      snapshotMessage({ acknowledgedSequence: false }),
      decodeServerMessage,
    ],
    [snapshotMessage({ entities: {} }), decodeServerMessage],
    [
      snapshotMessage({
        entities: [
          { ...avatarEntity(), entityKind: "interactable" },
          interactableEntity(),
        ],
      }),
      decodeServerMessage,
    ],
    [
      snapshotMessage({
        entities: [
          { ...avatarEntity(), entityKind: "npc" },
          interactableEntity(),
        ],
      }),
      decodeServerMessage,
    ],
    [
      snapshotMessage({
        entities: [
          { ...avatarEntity(), entityId: 1 },
          interactableEntity(),
        ],
      }),
      decodeServerMessage,
    ],
    [
      snapshotMessage({
        entities: [
          { ...avatarEntity(), playerId: false },
          interactableEntity(),
        ],
      }),
      decodeServerMessage,
    ],
    [
      snapshotMessage({
        entities: [{ ...avatarEntity(), position: [] }, interactableEntity()],
      }),
      decodeServerMessage,
    ],
    [
      snapshotMessage({
        entities: [
          {
            ...avatarEntity(),
            position: { ...avatarEntity().position, y: "1" },
          },
          interactableEntity(),
        ],
      }),
      decodeServerMessage,
    ],
    [
      snapshotMessage({
        entities: [avatarEntity(), { ...interactableEntity(), active: 1 }],
      }),
      decodeServerMessage,
    ],
    [{ ...rejectedMessage(), sequence: false }, decodeServerMessage],
    [{ ...rejectedMessage(), reason: 1 }, decodeServerMessage],
  ];

  for (const [value, decode] of cases) {
    expectDecodeFailure(
      decode(valueFrame(value)),
      "schema",
      "schema-invalid",
    );
  }
});

test("rejects forged client identity and opposite-direction messages", () => {
  for (const forged of [
    { ...joinMessage(), connectionId: "connection_1" },
    { ...joinMessage(), playerId: "player_1", ownedEntityId: "avatar_1" },
    { ...moveCommand(), connectionId: "connection_1" },
    { ...interactCommand(), playerId: "player_1", ownedEntityId: "avatar_1" },
  ]) {
    expectDecodeFailure(
      decodeClientMessage(valueFrame(forged)),
      "schema",
      "schema-invalid",
    );
  }

  for (const { direction, value } of variants()) {
    const opposite =
      direction === "client" ? decodeServerMessage : decodeClientMessage;
    expectDecodeFailure(
      opposite(valueFrame(value)),
      "direction",
      "wrong-direction",
    );
  }
});

test("classifies version, kind, direction, and schema failures exactly", () => {
  const cases = [
    [
      decodeClientMessage(valueFrame({ ...joinMessage(), protocolVersion: 2 })),
      "schema",
      "unsupported-version",
    ],
    [
      decodeClientMessage(
        valueFrame({ protocolVersion: PROTOCOL_VERSION, kind: "future" }),
      ),
      "schema",
      "unknown-kind",
    ],
    [
      decodeClientMessage(valueFrame(joinedMessage())),
      "direction",
      "wrong-direction",
    ],
    [
      decodeClientMessage(valueFrame({ ...joinMessage(), extra: true })),
      "schema",
      "schema-invalid",
    ],
  ];

  for (const [result, stage, reason] of cases) {
    const failure = expectDecodeFailure(result, stage, reason);
    assert.ok(failure.issues.length > 0);
  }

  expectDecodeFailure(
    decodeClientMessage(
      valueFrame({
        ...joinedMessage(),
        protocolVersion: 2,
        kind: "unknown-server-kind",
      }),
    ),
    "schema",
    "unsupported-version",
  );
});

test("rejects binary, malformed UTF-8, oversized frames, invalid JSON, and roots", () => {
  const binary = expectDecodeFailure(
    decodeClientMessage({ kind: "binary" }),
    "frame",
    "binary-frame",
  );
  assert.deepEqual(binary.issues, []);

  const exactBytes = new Uint8Array(MAX_MESSAGE_BYTES);
  exactBytes.fill(0x20);
  const joinBytes = textEncoder.encode(JSON.stringify(joinMessage()));
  exactBytes.set(joinBytes, exactBytes.length - joinBytes.length);
  const exact = decodeClientMessage({ kind: "text", bytes: exactBytes });
  assert.equal(exact.ok, true);

  expectDecodeFailure(
    decodeClientMessage({
      kind: "text",
      bytes: new Uint8Array(MAX_MESSAGE_BYTES + 1),
    }),
    "frame",
    "message-too-large",
  );

  for (const bytes of [
    [0x80],
    [0xc0, 0xaf],
    [0xe2, 0x82],
    [0xed, 0xa0, 0x80],
    [0xf4, 0x90, 0x80, 0x80],
  ]) {
    expectDecodeFailure(
      decodeClientMessage({ kind: "text", bytes: Uint8Array.from(bytes) }),
      "frame",
      "invalid-utf8",
    );
  }

  for (const text of ["", "{", "{} {}", "not-json"]) {
    expectDecodeFailure(
      decodeClientMessage(textFrame(text)),
      "json",
      "invalid-json",
    );
  }

  for (const root of [[], 0, "text", true, null]) {
    expectDecodeFailure(
      decodeClientMessage(valueFrame(root)),
      "json",
      "not-json-object",
    );
  }
});

test("enforces command sequence and tick integer, safe, and wire bounds", () => {
  for (const sequence of [1, MAX_SEQUENCE]) {
    const result = decodeClientMessage(
      valueFrame(moveCommand({ sequence })),
    );
    assert.equal(result.ok, true, `sequence ${sequence}`);
  }
  for (const sequence of [
    0,
    -1,
    1.5,
    MAX_SEQUENCE + 1,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    expectDecodeFailure(
      decodeClientMessage(valueFrame(moveCommand({ sequence }))),
      "schema",
      "schema-invalid",
    );
  }
  for (const sequence of [Number.NaN, Infinity, -Infinity]) {
    expectEncodeFailure(
      encodeClientMessage(moveCommand({ sequence })),
      "schema-invalid",
    );
  }

  for (const intendedTick of [0, MAX_TICK]) {
    const result = decodeClientMessage(
      valueFrame(moveCommand({ intendedTick })),
    );
    assert.equal(result.ok, true, `tick ${intendedTick}`);
  }
  for (const intendedTick of [-1, 0.5, MAX_TICK + 1]) {
    expectDecodeFailure(
      decodeClientMessage(valueFrame(moveCommand({ intendedTick }))),
      "schema",
      "schema-invalid",
    );
  }
  for (const intendedTick of [Number.NaN, Infinity, -Infinity]) {
    expectEncodeFailure(
      encodeClientMessage(moveCommand({ intendedTick })),
      "schema-invalid",
    );
  }

  const overflowTick = JSON.stringify(moveCommand()).replace(
    '"intendedTick":0',
    '"intendedTick":1e400',
  );
  expectDecodeFailure(
    decodeClientMessage(textFrame(overflowTick)),
    "schema",
    "schema-invalid",
  );

  for (const sequence of [0, -1, 1.5, MAX_SEQUENCE + 1]) {
    expectEncodeFailure(
      encodeServerMessage(snapshotMessage({ acknowledgedSequence: sequence })),
      "schema-invalid",
    );
    expectEncodeFailure(
      encodeServerMessage({ ...rejectedMessage(), sequence }),
      "schema-invalid",
    );
  }
  for (const sequence of [null, 1, MAX_SEQUENCE]) {
    assert.equal(
      encodeServerMessage(snapshotMessage({ acknowledgedSequence: sequence }))
        .ok,
      true,
    );
  }
});

test("enforces finite coordinate bounds and opaque ID syntax", () => {
  const coordinates = [
    -MAX_POSITION_ABS,
    -MAX_POSITION_ABS + 0.000001,
    0,
    MAX_POSITION_ABS - 0.000001,
    MAX_POSITION_ABS,
  ];
  for (const coordinate of coordinates) {
    const result = decodeServerMessage(
      valueFrame(
        snapshotMessage({
          entities: [
            avatarEntity({ position: { x: coordinate, y: 0, z: 0 } }),
          ],
        }),
      ),
    );
    assert.equal(result.ok, true, `coordinate ${coordinate}`);
  }

  for (const coordinate of [
    -MAX_POSITION_ABS - 0.000001,
    MAX_POSITION_ABS + 0.000001,
  ]) {
    expectDecodeFailure(
      decodeServerMessage(
        valueFrame(
          snapshotMessage({
            entities: [
              avatarEntity({ position: { x: coordinate, y: 0, z: 0 } }),
            ],
          }),
        ),
      ),
      "schema",
      "schema-invalid",
    );
  }
  for (const coordinate of [Number.NaN, Infinity, -Infinity]) {
    expectEncodeFailure(
      encodeServerMessage(
        snapshotMessage({
          entities: [
            avatarEntity({ position: { x: coordinate, y: 0, z: 0 } }),
          ],
        }),
      ),
      "schema-invalid",
    );
  }

  const overflowPosition = JSON.stringify(snapshotMessage()).replace(
    '"x":0',
    '"x":1e400',
  );
  expectDecodeFailure(
    decodeServerMessage(textFrame(overflowPosition)),
    "schema",
    "schema-invalid",
  );

  for (const id of ["a", "A_0-z", "x".repeat(MAX_ID_LENGTH)]) {
    assert.equal(OpaqueIdSchema.safeParse(id).success, true, id);
  }
  for (const id of [
    "",
    "x".repeat(MAX_ID_LENGTH + 1),
    "space id",
    "é",
    1,
  ]) {
    assert.equal(OpaqueIdSchema.safeParse(id).success, false, String(id));
  }
});

test("enforces movement axis edges, finiteness, and the unit disc", () => {
  for (const [x, z] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [0.6, 0.8],
    [-0.6, -0.8],
  ]) {
    const result = decodeClientMessage(
      valueFrame(moveCommand({ action: { kind: "move", x, z } })),
    );
    assert.equal(result.ok, true, `${x},${z}`);
  }

  for (const [x, z] of [
    [-1.000001, 0],
    [1.000001, 0],
    [0, -1.000001],
    [0, 1.000001],
    [0.6, 0.800000001],
  ]) {
    expectDecodeFailure(
      decodeClientMessage(
        valueFrame(moveCommand({ action: { kind: "move", x, z } })),
      ),
      "schema",
      "schema-invalid",
    );
  }

  for (const value of [Number.NaN, Infinity, -Infinity]) {
    expectEncodeFailure(
      encodeClientMessage(
        moveCommand({ action: { kind: "move", x: value, z: 0 } }),
      ),
      "schema-invalid",
    );
  }
});

test("rejects 257 snapshot entities, duplicate IDs, and oversized encoding", () => {
  const tooMany = snapshotMessage({
    entities: Array.from(
      { length: MAX_SNAPSHOT_ENTITIES + 1 },
      (_, index) => compactEntity(index),
    ),
  });
  assert.equal(SnapshotMessageSchema.safeParse(tooMany).success, false);
  expectEncodeFailure(encodeServerMessage(tooMany), "schema-invalid");

  const duplicate = snapshotMessage({
    entities: [compactEntity(0), compactEntity(1, { entityId: "0" })],
  });
  const duplicateResult = SnapshotMessageSchema.safeParse(duplicate);
  assert.equal(duplicateResult.success, false);
  if (duplicateResult.success) assert.fail("expected duplicate entity failure");
  assert.deepEqual(duplicateResult.error.issues[0].path, ["entities", 1, "entityId"]);
  expectEncodeFailure(encodeServerMessage(duplicate), "schema-invalid");

  const maximum = snapshotMessage({
    entities: Array.from(
      { length: MAX_SNAPSHOT_ENTITIES },
      (_, index) => compactEntity(index),
    ),
  });
  assert.equal(SnapshotMessageSchema.safeParse(maximum).success, true);
  expectEncodeFailure(encodeServerMessage(maximum), "message-too-large");
});

test("publishes at most 16 frozen sanitized issues", () => {
  const invalid = snapshotMessage({
    entities: Array.from({ length: 20 }, (_, index) =>
      compactEntity(index, { active: "yes" }),
    ),
  });
  const failure = expectDecodeFailure(
    decodeServerMessage(valueFrame(invalid)),
    "schema",
    "schema-invalid",
  );
  assert.equal(failure.issues.length, 16);
  assert.equal(Object.isFrozen(failure.issues), true);
  for (const issue of failure.issues) {
    assert.deepEqual(Object.keys(issue).sort(), ["code", "path"]);
    assert.equal(Object.isFrozen(issue), true);
    assert.equal(Object.isFrozen(issue.path), true);
    assert.equal(typeof issue.code, "string");
  }
  const publicFailure = JSON.stringify(failure);
  assert.equal(publicFailure.includes("yes"), false);
  assert.equal(publicFailure.includes("message"), false);
  assert.equal(publicFailure.includes("input"), false);
});

test("accepts exactly the complete rejection reason vocabulary", () => {
  assert.deepEqual(RejectedReasonSchema.options, REJECTION_REASONS);
  for (const reason of REJECTION_REASONS) {
    const encoded = encodeServerMessage(rejectedMessage(reason));
    assert.equal(encoded.ok, true, reason);
    if (!encoded.ok) assert.fail(reason);
    const decoded = decodeServerMessage(textFrame(encoded.value.text));
    assert.equal(decoded.ok, true, reason);
    if (!decoded.ok) assert.fail(reason);
    assert.deepEqual(decoded.value, rejectedMessage(reason));
  }
  assert.equal(RejectedReasonSchema.safeParse("other").success, false);
});

test("encoder rejects invalid and non-finite data and reports exact byte size", () => {
  expectEncodeFailure(
    encodeClientMessage({ ...joinMessage(), unexpected: true }),
    "schema-invalid",
  );
  expectEncodeFailure(
    encodeClientMessage(
      moveCommand({ action: { kind: "move", x: Number.NaN, z: 0 } }),
    ),
    "schema-invalid",
  );

  const encoded = encodeServerMessage(joinedMessage());
  assert.equal(encoded.ok, true);
  if (!encoded.ok) assert.fail("expected encode success");
  assert.equal(
    encoded.value.byteLength,
    textEncoder.encode(encoded.value.text).byteLength,
  );
  assert.deepEqual(JSON.parse(encoded.value.text), joinedMessage());
});
