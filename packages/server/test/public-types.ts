import {
  createRapierServerCollisionAdapter,
  type ServerCollisionAdapter,
  type ServerCollisionFailure,
  type ServerCollisionInspection,
  type ServerCollisionOutcome,
} from "@three-game-kit/server/collision";

import {
  createAuthoritativeServer,
  type AuthoritativeAvatarInspection,
  type AuthoritativeDecodeIngressRejectionReason,
  type AuthoritativeConnection,
  type AuthoritativeConnectionInspection,
  type AuthoritativeConnectionOptions,
  type AuthoritativeConnectionPhase,
  type AuthoritativeFailure,
  type AuthoritativeFailureCode,
  type AuthoritativeLiveResourceCounts,
  type AuthoritativeOutcome,
  type AuthoritativePhaseInspection,
  type AuthoritativeRejectionCounts,
  type AuthoritativeServer,
  type AuthoritativeServerInspection,
  type AuthoritativeServerOptions,
  type AuthoritativeServerPhase,
} from "@three-game-kit/server/authoritative";

import {
  createAuthoritativeWebSocketServer,
  type AuthoritativeWebSocketServer,
  type AuthoritativeWebSocketServerDecodeFailureCounts,
  type AuthoritativeWebSocketServerFailure,
  type AuthoritativeWebSocketServerInspection,
  type AuthoritativeWebSocketServerOptions,
  type AuthoritativeWebSocketServerOutcome,
  type AuthoritativeWebSocketServerState,
  type ServerOutboundMessage,
} from "@three-game-kit/server/networking";

const adapter: ServerCollisionAdapter =
  createRapierServerCollisionAdapter({
    capsuleRadius: 0.5,
    capsuleHalfHeight: 0.5,
    controllerOffset: 0.01,
    boxes: [
      {
        id: "floor",
        center: { x: 0, y: -0.5, z: 0 },
        halfExtents: { x: 10, y: 0.5, z: 10 },
      },
    ],
  });

const created: ServerCollisionOutcome = adapter.createAvatar(
  "avatar",
  { x: 0, y: 1, z: 0 },
);
const positioned: ServerCollisionOutcome = adapter.setAvatarPosition(
  "avatar",
  { x: 2, y: 1, z: -1 },
);
const moved: ReturnType<ServerCollisionAdapter["moveAvatar"]> =
  adapter.moveAvatar(
    "avatar",
    { x: 0, y: 1, z: 0 },
    { x: 1, y: 0, z: 0 },
  );
const removed: ServerCollisionOutcome = adapter.removeAvatar("avatar");
const inspection: ServerCollisionInspection = adapter.inspect();
const failure: ServerCollisionFailure = { code: "missing-avatar" };
const disposed: boolean = adapter.disposed;

if (moved.ok) {
  const collided: boolean = moved.value.collided;
  const collisionCount: number = moved.value.collisionCount;
  const positionX: number = moved.value.position.x;
  void [collided, collisionCount, positionX];
} else {
  const failureCode: ServerCollisionFailure["code"] =
    moved.failure.code;
  void failureCode;
}

// @ts-expect-error Server collision failure codes are a closed vocabulary.
const invalidFailure: ServerCollisionFailure = { code: "other" };
// @ts-expect-error Avatar IDs must be strings.
adapter.removeAvatar(1);
// @ts-expect-error Movement vector components must be numbers.
adapter.createAvatar("invalid", { x: "0", y: 1, z: 0 });
// @ts-expect-error Avatar IDs must be strings.
adapter.setAvatarPosition(1, { x: 0, y: 1, z: 0 });
// @ts-expect-error Position vector components must be numbers.
adapter.setAvatarPosition("avatar", { x: 0, y: "1", z: 0 });
// @ts-expect-error Inspection avatar snapshots are read-only.
inspection.avatars.push({
  avatarId: "forged",
  position: { x: 0, y: 1, z: 0 },
});
const firstAvatar = inspection.avatars[0];
if (firstAvatar !== undefined) {
  // @ts-expect-error Inspection positions are read-only.
  firstAvatar.position.x = 2;
}
// @ts-expect-error Outcomes are read-only.
created.ok = false;

adapter.dispose();
void [
  created,
  removed,
  positioned,
  inspection,
  failure,
  disposed,
  invalidFailure,
];

const authoritativeMessages: Parameters<
  AuthoritativeConnectionOptions["emit"]
>[0][] = [];
const authoritativeConnectionOptions: AuthoritativeConnectionOptions = {
  emit: (message) => authoritativeMessages.push(message),
};
const authoritativeServerOptions: AuthoritativeServerOptions = {
  spawnPosition: { x: 0, y: 1, z: 0 },
  movementSpeedMetersPerSecond: 6,
  collisionAdapter: createRapierServerCollisionAdapter({
    capsuleRadius: 0.5,
    capsuleHalfHeight: 0.5,
    controllerOffset: 0.01,
    boxes: [
      {
        id: "authoritative-floor",
        center: { x: 0, y: -0.5, z: 0 },
        halfExtents: { x: 10, y: 0.5, z: 10 },
      },
    ],
  }),
};
const authoritativeServer: AuthoritativeServer =
  createAuthoritativeServer(authoritativeServerOptions);
const authoritativeAccepted: AuthoritativeOutcome<AuthoritativeConnection> =
  authoritativeServer.acceptConnection(authoritativeConnectionOptions);
const authoritativeFailure: AuthoritativeFailure = { code: "invalid-state" };
const authoritativeFailureCode: AuthoritativeFailureCode =
  authoritativeFailure.code;
const authoritativeConnectionPhase: AuthoritativeConnectionPhase = "connected";
const authoritativeServerPhase: AuthoritativeServerPhase = "ingress";
const authoritativeInspection: AuthoritativeServerInspection =
  authoritativeServer.inspect();
const authoritativeLiveCounts: AuthoritativeLiveResourceCounts =
  authoritativeInspection.liveResourceCounts;
const authoritativeRejections: AuthoritativeRejectionCounts =
  authoritativeInspection.rejectedCommandCounts;
const authoritativePhaseInspection: AuthoritativePhaseInspection = {
  serverTick: 1,
  phase: authoritativeServerPhase,
};
const authoritativeAvatarInspection: AuthoritativeAvatarInspection | undefined =
  authoritativeInspection.avatars[0];
const schemaInvalidReason: AuthoritativeDecodeIngressRejectionReason =
  "schema-invalid";
const unknownKindReason: AuthoritativeDecodeIngressRejectionReason =
  "unknown-kind";
const schemaInvalidRecord =
  authoritativeServer.recordDecodeIngressRejection(schemaInvalidReason);
const unknownKindRecord =
  authoritativeServer.recordDecodeIngressRejection(unknownKindReason);
const decodeIngressCode: string = schemaInvalidRecord.code;
const decodeIngressReason = schemaInvalidRecord.reasonCode;
const decodeIngressSequence: number = unknownKindRecord.sequence;
const structuredRuntimeErrors = authoritativeInspection.structuredRuntimeErrors;
const sharedMovementCallCount: number =
  authoritativeInspection.sharedMovementCallCount;
const authoritativeCollisionCallCount: number =
  authoritativeInspection.authoritativeCollisionCallCount;
// @ts-expect-error Decode ingress rejection reasons are a closed vocabulary.
const invalidDecodeIngressReason: AuthoritativeDecodeIngressRejectionReason =
  "other";
// @ts-expect-error Structured runtime error records are read-only.
schemaInvalidRecord.code = "replacement";
// @ts-expect-error Structured runtime error inspection arrays are read-only.
structuredRuntimeErrors.push(schemaInvalidRecord);
// @ts-expect-error Shared movement call counts are read-only.
authoritativeInspection.sharedMovementCallCount = 0;
// @ts-expect-error Authoritative collision call counts are read-only.
authoritativeInspection.authoritativeCollisionCallCount = 0;
const scheduledForcedPosition: AuthoritativeOutcome =
  authoritativeServer.scheduleForcedPosition("avatar", 1, {
    x: 0,
    y: 1,
    z: 0,
  });
const forcedPositionFixtures = authoritativeInspection.forcedPositionFixtures;
const forcedPositionScheduledCount: number =
  forcedPositionFixtures.scheduledCount;
const forcedPositionConsumedCount: number = forcedPositionFixtures.consumedCount;
const lastConsumedForcedPosition = forcedPositionFixtures.lastConsumed;
if (lastConsumedForcedPosition !== null) {
  const lastConsumedEntityId: string = lastConsumedForcedPosition.entityId;
  const lastConsumedTick: number = lastConsumedForcedPosition.serverTick;
  const lastConsumedX: number = lastConsumedForcedPosition.position.x;
  // @ts-expect-error Consumed fixture positions are read-only.
  lastConsumedForcedPosition.position.x = 2;
  void [lastConsumedEntityId, lastConsumedTick, lastConsumedX];
}
// @ts-expect-error Forced position fixture inspection is read-only.
authoritativeInspection.forcedPositionFixtures = forcedPositionFixtures;
// @ts-expect-error Forced position fixture counts are read-only.
forcedPositionFixtures.scheduledCount = 0;
// @ts-expect-error Forced position entity IDs must be strings.
authoritativeServer.scheduleForcedPosition(1, 1, { x: 0, y: 1, z: 0 });
// @ts-expect-error Forced positions require numeric vector components.
authoritativeServer.scheduleForcedPosition("avatar", 1, { x: "0", y: 1, z: 0 });
void [scheduledForcedPosition, forcedPositionScheduledCount, forcedPositionConsumedCount];

if (authoritativeAccepted.ok) {
  const authoritativeConnection = authoritativeAccepted.value;
  const authoritativeReady: AuthoritativeOutcome =
    authoritativeConnection.markReady();
  authoritativeConnection.receive({
    protocolVersion: 1,
    kind: "join",
  });
  const authoritativeConnectionInspection: AuthoritativeConnectionInspection =
    authoritativeConnection.inspect();
  const authoritativePositionX: number | undefined =
    authoritativeConnectionInspection.position?.x;
  void [authoritativeReady, authoritativePositionX];

  // @ts-expect-error Connection phases are read-only.
  authoritativeConnection.phase = "closed";
  // @ts-expect-error Connection phase traces are read-only arrays.
  authoritativeConnectionInspection.phaseTrace.push("closed");
  if (authoritativeConnectionInspection.position !== null) {
    // @ts-expect-error Inspected authoritative positions are read-only.
    authoritativeConnectionInspection.position.x = 2;
  }
}

// @ts-expect-error Authoritative failure codes are a closed vocabulary.
const invalidAuthoritativeFailure: AuthoritativeFailure = { code: "other" };
// @ts-expect-error Authoritative Server options require a collision adapter.
const invalidAuthoritativeOptions: AuthoritativeServerOptions = {
  spawnPosition: { x: 0, y: 1, z: 0 },
  movementSpeedMetersPerSecond: 6,
};
// @ts-expect-error Authoritative inspections expose read-only connection arrays.
authoritativeInspection.connections.pop();
// @ts-expect-error Authoritative inspections expose read-only avatar arrays.
authoritativeInspection.avatars.pop();
// @ts-expect-error Live resource counts are read-only.
authoritativeLiveCounts.connections = 0;
// @ts-expect-error Phase inspections are read-only.
authoritativePhaseInspection.serverTick = 2;
if (authoritativeAvatarInspection !== undefined) {
  // @ts-expect-error Avatar inspection identities are read-only.
  authoritativeAvatarInspection.entityId = "forged";
}
// @ts-expect-error Server ticks are read-only.
authoritativeServer.serverTick = 2;

authoritativeServer.shutdown();
void [
  authoritativeMessages,
  authoritativeFailureCode,
  authoritativeConnectionPhase,
  authoritativeRejections,
  invalidAuthoritativeFailure,
  invalidAuthoritativeOptions,
  schemaInvalidReason,
  unknownKindReason,
  schemaInvalidRecord,
  unknownKindRecord,
  decodeIngressCode,
  decodeIngressReason,
  decodeIngressSequence,
  structuredRuntimeErrors,
  sharedMovementCallCount,
  authoritativeCollisionCallCount,
  invalidDecodeIngressReason,
];

const positiveOutboundMessage: ServerOutboundMessage = {
  direction: "s2c",
  connectionOrdinal: 1,
  messageOrdinal: 1,
  operation: "joined",
  encoded: "{\"protocolVersion\":1}",
};
const outboundOperations: readonly ServerOutboundMessage["operation"][] = [
  "joined",
  "snapshot",
  "rejected",
];
const networkingOutboundMessages: ServerOutboundMessage[] = [];
const networkingOptions: AuthoritativeWebSocketServerOptions = {
  authoritativeServer,
  host: "127.0.0.1",
  port: 0,
  path: "/three-game-kit",
  outboundGate: (message) => {
    const direction: "s2c" = message.direction;
    const connectionOrdinal: number = message.connectionOrdinal;
    const messageOrdinal: number = message.messageOrdinal;
    const operation: "joined" | "snapshot" | "rejected" =
      message.operation;
    const encodedText: string = message.encoded;
    networkingOutboundMessages.push(message);
    void [
      direction,
      connectionOrdinal,
      messageOrdinal,
      operation,
      encodedText,
    ];
  },
};
const networkingServer: AuthoritativeWebSocketServer =
  createAuthoritativeWebSocketServer(networkingOptions);
const networkingState: AuthoritativeWebSocketServerState =
  networkingServer.state;
const networkingInspection: AuthoritativeWebSocketServerInspection =
  networkingServer.inspect();
const networkingDecodeFailureCounts: AuthoritativeWebSocketServerDecodeFailureCounts =
  networkingInspection.decodeFailureCounts;
const networkingFailure: AuthoritativeWebSocketServerFailure = {
  code: "bind-failed",
  operation: "listen",
  state: "idle",
};
const networkingOutcome: AuthoritativeWebSocketServerOutcome = {
  ok: false,
  failure: networkingFailure,
};

// @ts-expect-error Outbound message metadata is read-only.
positiveOutboundMessage.connectionOrdinal = 2;
// @ts-expect-error Outbound message metadata is read-only.
positiveOutboundMessage.operation = "snapshot";
// @ts-expect-error Networking inspections are read-only.
networkingInspection.connectionCount = 0;
// @ts-expect-error Decode failure counts are read-only.
networkingDecodeFailureCounts["invalid-json"] = 0;
// @ts-expect-error Networking failures are read-only.
networkingFailure.state = "ready";
// @ts-expect-error Networking outcomes are read-only.
networkingOutcome.ok = true;
// @ts-expect-error The public server does not expose a ws implementation.
networkingServer.ws;
// @ts-expect-error The public server does not expose a socket implementation.
networkingServer.socket;

void [
  positiveOutboundMessage,
  outboundOperations,
  networkingOutboundMessages,
  networkingState,
  networkingOutcome,
];
