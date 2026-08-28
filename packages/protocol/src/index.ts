import { z } from "zod";

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 16_384;
export const MAX_ID_LENGTH = 64;
export const MAX_SEQUENCE = 4_294_967_295;
export const MAX_TICK = 9_007_199_254_740_991;
export const MAX_PAST_TICKS = 6;
export const MAX_FUTURE_TICKS = 2;
export const MAX_PENDING_COMMANDS = 128;
export const MAX_BUFFERED_SNAPSHOTS = 32;
export const MAX_SNAPSHOT_ENTITIES = 256;
export const MAX_POSITION_ABS = 1_000_000;
export const MAX_MOVEMENT_SPEED = 10;

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PUBLIC_ISSUES = 16;

export const OpaqueIdSchema = z.string().regex(OPAQUE_ID_PATTERN);

const PositionCoordinateSchema = z
  .number()
  .finite()
  .min(-MAX_POSITION_ABS)
  .max(MAX_POSITION_ABS);
const MovementAxisSchema = z.number().finite().min(-1).max(1);
const TickSchema = z.number().int().min(0).max(MAX_TICK);
const CommandSequenceSchema = z.number().int().min(1).max(MAX_SEQUENCE);
const ResponseSequenceSchema = z.number().int().min(1).max(MAX_SEQUENCE);

export const PositionSchema = z.strictObject({
  x: PositionCoordinateSchema,
  y: PositionCoordinateSchema,
  z: PositionCoordinateSchema,
});

export const MoveActionSchema = z
  .strictObject({
    kind: z.literal("move"),
    x: MovementAxisSchema,
    z: MovementAxisSchema,
  })
  .refine(({ x, z }) => x * x + z * z <= 1, {
    message: "Movement must be inside the unit disc",
  });

export const InteractActionSchema = z.strictObject({
  kind: z.literal("interact"),
  targetEntityId: OpaqueIdSchema,
});

export const ClientActionSchema = z.discriminatedUnion("kind", [
  MoveActionSchema,
  InteractActionSchema,
]);

export const JoinMessageSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  kind: z.literal("join"),
});

export const CommandMessageSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  kind: z.literal("command"),
  sequence: CommandSequenceSchema,
  intendedTick: TickSchema,
  action: ClientActionSchema,
});

export const ClientMessageSchema = z.discriminatedUnion("kind", [
  JoinMessageSchema,
  CommandMessageSchema,
]);

export const JoinedMessageSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  kind: z.literal("joined"),
  connectionId: OpaqueIdSchema,
  playerId: OpaqueIdSchema,
  ownedEntityId: OpaqueIdSchema,
  serverTick: TickSchema,
});

export const AvatarSnapshotEntitySchema = z.strictObject({
  entityKind: z.literal("avatar"),
  entityId: OpaqueIdSchema,
  playerId: OpaqueIdSchema,
  position: PositionSchema,
});

export const InteractableSnapshotEntitySchema = z.strictObject({
  entityKind: z.literal("interactable"),
  entityId: OpaqueIdSchema,
  position: PositionSchema,
  active: z.boolean(),
});

export const SnapshotEntitySchema = z.discriminatedUnion("entityKind", [
  AvatarSnapshotEntitySchema,
  InteractableSnapshotEntitySchema,
]);

export const SnapshotEntitiesSchema = z
  .array(SnapshotEntitySchema)
  .max(MAX_SNAPSHOT_ENTITIES)
  .superRefine((entities, context) => {
    const ids = new Set<string>();
    for (const [index, entity] of entities.entries()) {
      if (ids.has(entity.entityId)) {
        context.addIssue({
          code: "custom",
          path: [index, "entityId"],
          message: "Snapshot entity IDs must be unique",
        });
      } else {
        ids.add(entity.entityId);
      }
    }
  })
  .readonly();

export const SnapshotMessageSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  kind: z.literal("snapshot"),
  serverTick: TickSchema,
  acknowledgedSequence: ResponseSequenceSchema.nullable(),
  entities: SnapshotEntitiesSchema,
});

export const RejectedReasonSchema = z.enum([
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
]);

export const RejectedMessageSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  kind: z.literal("rejected"),
  sequence: ResponseSequenceSchema.nullable(),
  reason: RejectedReasonSchema,
});

export const ServerMessageSchema = z.discriminatedUnion("kind", [
  JoinedMessageSchema,
  SnapshotMessageSchema,
  RejectedMessageSchema,
]);

export type OpaqueId = z.infer<typeof OpaqueIdSchema>;
export type Position = z.infer<typeof PositionSchema>;
export type MoveAction = z.infer<typeof MoveActionSchema>;
export type InteractAction = z.infer<typeof InteractActionSchema>;
export type ClientAction = z.infer<typeof ClientActionSchema>;
export type JoinMessage = z.infer<typeof JoinMessageSchema>;
export type CommandMessage = z.infer<typeof CommandMessageSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type JoinedMessage = z.infer<typeof JoinedMessageSchema>;
export type AvatarSnapshotEntity = z.infer<typeof AvatarSnapshotEntitySchema>;
export type InteractableSnapshotEntity = z.infer<
  typeof InteractableSnapshotEntitySchema
>;
export type SnapshotEntity = z.infer<typeof SnapshotEntitySchema>;
export type SnapshotMessage = z.infer<typeof SnapshotMessageSchema>;
export type RejectedReason = z.infer<typeof RejectedReasonSchema>;
export type RejectedMessage = z.infer<typeof RejectedMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export type ProtocolFrameInput =
  | Readonly<{ kind: "text"; bytes: Uint8Array }>
  | Readonly<{ kind: "binary" }>;

export type DecodeStage = "frame" | "json" | "schema" | "direction";
export type DecodeFailureReason =
  | "binary-frame"
  | "message-too-large"
  | "invalid-utf8"
  | "invalid-json"
  | "not-json-object"
  | "unsupported-version"
  | "unknown-kind"
  | "wrong-direction"
  | "schema-invalid";

export interface ProtocolIssue {
  readonly path: readonly (string | number)[];
  readonly code: string;
}

export interface DecodeFailure {
  readonly stage: DecodeStage;
  readonly reason: DecodeFailureReason;
  readonly issues: readonly ProtocolIssue[];
}

export type DecodeResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; failure: DecodeFailure }>;

export type EncodeFailureReason =
  | "schema-invalid"
  | "json-encode-failed"
  | "message-too-large";

export interface EncodeFailure {
  readonly reason: EncodeFailureReason;
  readonly issues: readonly ProtocolIssue[];
}

export interface EncodedMessage {
  readonly text: string;
  readonly byteLength: number;
}

export type EncodeResult =
  | Readonly<{ ok: true; value: EncodedMessage }>
  | Readonly<{ ok: false; failure: EncodeFailure }>;

interface IssueSource {
  readonly issues: readonly {
    readonly path: readonly PropertyKey[];
    readonly code: string;
  }[];
}

const EMPTY_ISSUES: readonly ProtocolIssue[] = Object.freeze([]);
const ALL_MESSAGE_KINDS: readonly string[] = [
  "join",
  "command",
  "joined",
  "snapshot",
  "rejected",
];
const CLIENT_MESSAGE_KINDS: readonly string[] = ["join", "command"];
const SERVER_MESSAGE_KINDS: readonly string[] = [
  "joined",
  "snapshot",
  "rejected",
];

function sanitizeIssues(error: IssueSource): readonly ProtocolIssue[] {
  return Object.freeze(
    error.issues.slice(0, MAX_PUBLIC_ISSUES).map((issue) =>
      Object.freeze({
        path: Object.freeze(
          issue.path.map((part) =>
            typeof part === "number" ? part : String(part),
          ),
        ),
        code: issue.code,
      }),
    ),
  );
}

function failedDecode(
  stage: DecodeStage,
  reason: DecodeFailureReason,
  issues: readonly ProtocolIssue[] = EMPTY_ISSUES,
): Readonly<{ ok: false; failure: DecodeFailure }> {
  return Object.freeze({
    ok: false,
    failure: Object.freeze({ stage, reason, issues }),
  });
}

function failedEncode(
  reason: EncodeFailureReason,
  issues: readonly ProtocolIssue[] = EMPTY_ISSUES,
): Readonly<{ ok: false; failure: EncodeFailure }> {
  return Object.freeze({
    ok: false,
    failure: Object.freeze({ reason, issues }),
  });
}

function byteAt(bytes: Uint8Array, index: number): number {
  return bytes[index] ?? -1;
}

function decodeUtf8(bytes: Uint8Array): string | null {
  const characters: string[] = [];
  let index = 0;
  while (index < bytes.length) {
    const first = byteAt(bytes, index);
    if (first <= 0x7f) {
      characters.push(String.fromCodePoint(first));
      index += 1;
      continue;
    }

    const second = byteAt(bytes, index + 1);
    if (first >= 0xc2 && first <= 0xdf) {
      if (second < 0x80 || second > 0xbf) return null;
      characters.push(
        String.fromCodePoint(((first & 0x1f) << 6) | (second & 0x3f)),
      );
      index += 2;
      continue;
    }

    const third = byteAt(bytes, index + 2);
    if (first >= 0xe0 && first <= 0xef) {
      if (
        second < (first === 0xe0 ? 0xa0 : 0x80) ||
        second > (first === 0xed ? 0x9f : 0xbf) ||
        third < 0x80 ||
        third > 0xbf
      ) {
        return null;
      }
      characters.push(
        String.fromCodePoint(
          ((first & 0x0f) << 12) |
            ((second & 0x3f) << 6) |
            (third & 0x3f),
        ),
      );
      index += 3;
      continue;
    }

    const fourth = byteAt(bytes, index + 3);
    if (first >= 0xf0 && first <= 0xf4) {
      if (
        second < (first === 0xf0 ? 0x90 : 0x80) ||
        second > (first === 0xf4 ? 0x8f : 0xbf) ||
        third < 0x80 ||
        third > 0xbf ||
        fourth < 0x80 ||
        fourth > 0xbf
      ) {
        return null;
      }
      characters.push(
        String.fromCodePoint(
          ((first & 0x07) << 18) |
            ((second & 0x3f) << 12) |
            ((third & 0x3f) << 6) |
            (fourth & 0x3f),
        ),
      );
      index += 4;
      continue;
    }
    return null;
  }
  return characters.join("");
}

function utf8ByteLength(text: string): number {
  let byteLength = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x7f) {
      byteLength += 1;
    } else if (code <= 0x7ff) {
      byteLength += 2;
    } else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < text.length &&
      text.charCodeAt(index + 1) >= 0xdc00 &&
      text.charCodeAt(index + 1) <= 0xdfff
    ) {
      byteLength += 4;
      index += 1;
    } else {
      byteLength += 3;
    }
  }
  return byteLength;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function classifySchemaFailure(
  value: Record<string, unknown>,
  expectedKinds: readonly string[],
  issues: readonly ProtocolIssue[],
): Readonly<{ ok: false; failure: DecodeFailure }> {
  if (
    typeof value.protocolVersion === "number" &&
    value.protocolVersion !== PROTOCOL_VERSION
  ) {
    return failedDecode("schema", "unsupported-version", issues);
  }
  if (
    typeof value.kind === "string" &&
    !ALL_MESSAGE_KINDS.includes(value.kind)
  ) {
    return failedDecode("schema", "unknown-kind", issues);
  }
  if (
    typeof value.kind === "string" &&
    ALL_MESSAGE_KINDS.includes(value.kind) &&
    !expectedKinds.includes(value.kind)
  ) {
    return failedDecode("direction", "wrong-direction", issues);
  }
  return failedDecode("schema", "schema-invalid", issues);
}

function decodeMessage<T>(
  frame: ProtocolFrameInput,
  schema: z.ZodType<T>,
  expectedKinds: readonly string[],
): DecodeResult<T> {
  if (frame.kind === "binary") {
    return failedDecode("frame", "binary-frame");
  }
  if (frame.bytes.byteLength > MAX_MESSAGE_BYTES) {
    return failedDecode("frame", "message-too-large");
  }

  const text = decodeUtf8(frame.bytes);
  if (text === null) return failedDecode("frame", "invalid-utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return failedDecode("json", "invalid-json");
  }
  if (!isJsonObject(parsed)) {
    return failedDecode("json", "not-json-object");
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return classifySchemaFailure(
      parsed,
      expectedKinds,
      sanitizeIssues(result.error),
    );
  }
  return Object.freeze({ ok: true, value: result.data });
}

function encodeMessage<T>(message: T, schema: z.ZodType<T>): EncodeResult {
  let validated: T;
  try {
    const result = schema.safeParse(message);
    if (!result.success) {
      return failedEncode("schema-invalid", sanitizeIssues(result.error));
    }
    validated = result.data;
  } catch {
    return failedEncode("schema-invalid");
  }

  let text: string | undefined;
  try {
    text = JSON.stringify(validated);
  } catch {
    return failedEncode("json-encode-failed");
  }
  if (text === undefined) return failedEncode("json-encode-failed");

  const byteLength = utf8ByteLength(text);
  if (byteLength > MAX_MESSAGE_BYTES) {
    return failedEncode("message-too-large");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({ text, byteLength }),
  });
}

export function decodeClientMessage(
  frame: ProtocolFrameInput,
): DecodeResult<ClientMessage> {
  return decodeMessage(frame, ClientMessageSchema, CLIENT_MESSAGE_KINDS);
}

export function decodeServerMessage(
  frame: ProtocolFrameInput,
): DecodeResult<ServerMessage> {
  return decodeMessage(frame, ServerMessageSchema, SERVER_MESSAGE_KINDS);
}

export function encodeClientMessage(message: ClientMessage): EncodeResult {
  return encodeMessage(message, ClientMessageSchema);
}

export function encodeServerMessage(message: ServerMessage): EncodeResult {
  return encodeMessage(message, ServerMessageSchema);
}
