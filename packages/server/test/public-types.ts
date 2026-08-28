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
  type AuthoritativeInteractionAdapter,
  type AuthoritativeInteractionInput,
  type AuthoritativeInteractionInspection,
  type AuthoritativeInteractionResult,
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
const authoritativeInteractionInput: AuthoritativeInteractionInput = {
  actorEntityId: "avatar",
  actorPosition: { x: 0, y: 1, z: 0 },
  targetEntityId: "target",
  serverTick: 1,
};
const authoritativeInteractionResult: AuthoritativeInteractionResult =
  "accepted";
const authoritativeInteractionAdapter: AuthoritativeInteractionAdapter = {
  validate: (input) => {
    const actorPositionX: number = input.actorPosition.x;
    void actorPositionX;
    return authoritativeInteractionResult;
  },
  apply: (input) => {
    const targetEntityId: string = input.targetEntityId;
    void targetEntityId;
  },
  snapshot: () => [
    {
      entityKind: "interactable",
      entityId: "target",
      position: { x: 1, y: 1, z: 0 },
      active: true,
    },
  ],
};
// @ts-expect-error Interaction results reject phase failure vocabulary.
const phaseInvalidInteractionResult: AuthoritativeInteractionResult =
  "phase-invalid";
// @ts-expect-error Interaction results are a closed vocabulary.
const otherInteractionResult: AuthoritativeInteractionResult = "other";
const invalidInteractionResultAdapter: AuthoritativeInteractionAdapter = {
  // @ts-expect-error Interaction validation cannot return an arbitrary string.
  validate: () => "arbitrary-result",
  apply: () => {},
  snapshot: () => [],
};
const invalidInteractionSnapshotAdapter: AuthoritativeInteractionAdapter = {
  validate: () => "accepted",
  apply: () => {},
  snapshot: () => [
    {
      // @ts-expect-error Snapshot entries must be interactable snapshot entities.
      entityKind: "avatar",
      entityId: "target",
      position: { x: 1, y: 1, z: 0 },
      active: true,
    },
  ],
};
// @ts-expect-error Interaction actor IDs are read-only.
authoritativeInteractionInput.actorEntityId = "other-avatar";
// @ts-expect-error Interaction actor positions are read-only.
authoritativeInteractionInput.actorPosition.x = 2;
// @ts-expect-error Interaction target IDs are read-only.
authoritativeInteractionInput.targetEntityId = "other-target";
// @ts-expect-error Interaction server ticks are read-only.
authoritativeInteractionInput.serverTick = 2;
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
  interactionAdapter: authoritativeInteractionAdapter,
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
const authoritativeInteractionInspection: AuthoritativeInteractionInspection =
  authoritativeInspection.interaction;
const interactionActive: boolean = authoritativeInteractionInspection.active;
const interactionValidationCallCount: number =
  authoritativeInteractionInspection.validationCallCount;
const interactionApplyCallCount: number =
  authoritativeInteractionInspection.applyCallCount;
const interactionSnapshotCallCount: number =
  authoritativeInteractionInspection.snapshotCallCount;
const interactionCurrentInteractableCount: number =
  authoritativeInteractionInspection.currentInteractableCount;
const interactionLiveResourceCount: number =
  authoritativeInteractionInspection.liveResourceCount;
// @ts-expect-error Interaction inspection active state is read-only.
authoritativeInteractionInspection.active = false;
// @ts-expect-error Interaction validation call counts are read-only.
authoritativeInteractionInspection.validationCallCount = 0;
// @ts-expect-error Interaction apply call counts are read-only.
authoritativeInteractionInspection.applyCallCount = 0;
// @ts-expect-error Interaction snapshot call counts are read-only.
authoritativeInteractionInspection.snapshotCallCount = 0;
// @ts-expect-error Interaction entity counts are read-only.
authoritativeInteractionInspection.currentInteractableCount = 0;
// @ts-expect-error Interaction live resource counts are read-only.
authoritativeInteractionInspection.liveResourceCount = 0;
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
  authoritativeInteractionInput,
  authoritativeInteractionResult,
  authoritativeInteractionAdapter,
  phaseInvalidInteractionResult,
  otherInteractionResult,
  invalidInteractionResultAdapter,
  invalidInteractionSnapshotAdapter,
  authoritativeInteractionInspection,
  interactionActive,
  interactionValidationCallCount,
  interactionApplyCallCount,
  interactionSnapshotCallCount,
  interactionCurrentInteractableCount,
  interactionLiveResourceCount,
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
