import {
  ClientMessageSchema,
  InteractActionSchema,
  MoveActionSchema,
  OpaqueIdSchema,
  PositionSchema,
  RejectedReasonSchema,
  ServerMessageSchema,
  SnapshotEntitySchema,
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
  type AvatarSnapshotEntity,
  type ClientAction,
  type ClientMessage,
  type CommandMessage,
  type DecodeFailure,
  type DecodeFailureReason,
  type DecodeResult,
  type DecodeStage,
  type EncodeFailure,
  type EncodeFailureReason,
  type EncodeResult,
  type EncodedMessage,
  type InteractAction,
  type InteractableSnapshotEntity,
  type JoinMessage,
  type JoinedMessage,
  type MoveAction,
  type OpaqueId,
  type Position,
  type ProtocolFrameInput,
  type ProtocolIssue,
  type RejectedMessage,
  type RejectedReason,
  type ServerMessage,
  type SnapshotEntity,
  type SnapshotMessage,
} from "@three-game-kit/protocol";

const opaqueId: OpaqueId = "player_1";
const position: Position = { x: 0, y: 1, z: 2 };
const move: MoveAction = { kind: "move", x: 0.6, z: 0.8 };
const interact: InteractAction = {
  kind: "interact",
  targetEntityId: "target_1",
};
const action: ClientAction = move;
const join: JoinMessage = { protocolVersion: 1, kind: "join" };
const command: CommandMessage = {
  protocolVersion: 1,
  kind: "command",
  sequence: 1,
  intendedTick: 0,
  action,
};
const clientMessage: ClientMessage = command;
const joined: JoinedMessage = {
  protocolVersion: 1,
  kind: "joined",
  connectionId: "connection_1",
  playerId: opaqueId,
  ownedEntityId: "avatar_1",
  serverTick: 0,
};
const avatar: AvatarSnapshotEntity = {
  entityKind: "avatar",
  entityId: "avatar_1",
  playerId: opaqueId,
  position,
};
const interactable: InteractableSnapshotEntity = {
  entityKind: "interactable",
  entityId: "target_1",
  position,
  active: true,
};
const snapshotEntity: SnapshotEntity = avatar;
const snapshot: SnapshotMessage = {
  protocolVersion: 1,
  kind: "snapshot",
  serverTick: 1,
  acknowledgedSequence: 1,
  entities: [avatar, interactable],
};
// @ts-expect-error Snapshot entity collections are read-only.
snapshot.entities.push(avatar);

const rejectedReason: RejectedReason = "queue-full";
const rejected: RejectedMessage = {
  protocolVersion: 1,
  kind: "rejected",
  sequence: 1,
  reason: rejectedReason,
};
const serverMessage: ServerMessage = snapshot;

const parsedOpaque: OpaqueId = OpaqueIdSchema.parse(opaqueId);
const parsedPosition: Position = PositionSchema.parse(position);
const parsedMove: MoveAction = MoveActionSchema.parse(move);
const parsedInteract: InteractAction = InteractActionSchema.parse(interact);
const parsedClient: ClientMessage = ClientMessageSchema.parse(clientMessage);
const parsedEntity: SnapshotEntity = SnapshotEntitySchema.parse(snapshotEntity);
const parsedReason: RejectedReason = RejectedReasonSchema.parse(rejectedReason);
const parsedServer: ServerMessage = ServerMessageSchema.parse(serverMessage);

const frame: ProtocolFrameInput = {
  kind: "text",
  bytes: new TextEncoder().encode('{"protocolVersion":1,"kind":"join"}'),
};
const binaryFrame: ProtocolFrameInput = { kind: "binary" };
const clientResult: DecodeResult<ClientMessage> = decodeClientMessage(frame);
const serverResult: DecodeResult<ServerMessage> =
  decodeServerMessage(binaryFrame);
const clientEncoded: EncodeResult = encodeClientMessage(command);
const serverEncoded: EncodeResult = encodeServerMessage(rejected);

const decodeStage: DecodeStage = "schema";
const decodeReason: DecodeFailureReason = "schema-invalid";
const issue: ProtocolIssue = {
  path: ["action", "x"],
  code: "invalid_type",
};
const decodeFailure: DecodeFailure = {
  stage: decodeStage,
  reason: decodeReason,
  issues: [issue],
};
const decodeFailureResult: DecodeResult<ClientMessage> = {
  ok: false,
  failure: decodeFailure,
};
const encodeReason: EncodeFailureReason = "message-too-large";
const encodeFailure: EncodeFailure = {
  reason: encodeReason,
  issues: [],
};
const encodedMessage: EncodedMessage = {
  text: '{"protocolVersion":1,"kind":"join"}',
  byteLength: 35,
};

function inspectClientResult(result: DecodeResult<ClientMessage>): string {
  if (!result.ok) return `${result.failure.stage}:${result.failure.reason}`;
  switch (result.value.kind) {
    case "join":
      return result.value.kind;
    case "command":
      return result.value.action.kind;
    default: {
      const exhaustive: never = result.value;
      return exhaustive;
    }
  }
}

const forgedJoin: JoinMessage = {
  protocolVersion: 1,
  kind: "join",
  // @ts-expect-error Client join identity cannot be forged.
  connectionId: "connection_1",
};

const invalidMove: MoveAction = {
  kind: "move",
  // @ts-expect-error Movement axes are numeric.
  x: "1",
  z: 0,
};

const invalidInteract: InteractAction = {
  kind: "interact",
  // @ts-expect-error Interaction targets are opaque string IDs.
  targetEntityId: 1,
};

// @ts-expect-error Rejection reasons are a closed literal vocabulary.
const invalidReason: RejectedReason = "other";

// @ts-expect-error Sanitized issue paths are read-only.
issue.path.push("value");
// @ts-expect-error Decode failures do not expose raw errors or payloads.
decodeFailure.rawError;
// @ts-expect-error A Server message cannot be encoded in the Client direction.
encodeClientMessage(joined);
// @ts-expect-error Text frames require their bytes.
decodeClientMessage({ kind: "text" });

void [
  join,
  clientResult,
  serverResult,
  clientEncoded,
  serverEncoded,
  decodeFailureResult,
  encodeFailure,
  encodedMessage,
  parsedOpaque,
  parsedPosition,
  parsedMove,
  parsedInteract,
  parsedClient,
  parsedEntity,
  parsedReason,
  parsedServer,
  forgedJoin,
  invalidMove,
  invalidInteract,
  invalidReason,
  inspectClientResult(clientResult),
];
