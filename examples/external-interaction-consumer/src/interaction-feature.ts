import {
  defineFeatureConfiguration,
  type ClientFeatureDescriptor,
  type FeatureDescriptor,
  type ServerRuntimeContribution,
} from "@three-game-kit/core";
import type { ClientReplicationEngine } from "@three-game-kit/client/replication";
import type {
  AuthoritativeInteractionAdapter,
  AuthoritativeInteractionInput,
} from "@three-game-kit/server/authoritative";
import type { InteractableSnapshotEntity } from "@three-game-kit/protocol";
import type { MovementVector } from "@three-game-kit/shared";

export const SERVER_FEATURE_ID = "external.interaction.server";
export const CLIENT_FEATURE_ID = "external.interaction.client";
export const SERVER_REQUIREMENT_ID = "host.server-authority";
export const CLIENT_REQUIREMENT_ID = "host.client-session";
export const CONFLICT_ID = "external.interaction.alternative";
export const SERVER_HOST_SERVICE_ID = "host.authoritative-interaction";
export const CLIENT_HOST_SERVICE_ID = "host.client-replication";

export interface InteractionConfiguration {
  readonly targetEntityId: string;
  readonly position: MovementVector;
  readonly range: number;
  readonly initialActive: boolean;
  readonly forceSetupFailure: boolean;
}

const DEFAULT_CONFIGURATION: InteractionConfiguration = Object.freeze({
  targetEntityId: "switch_1",
  position: Object.freeze({ x: 2, y: 0, z: 0 }),
  range: 3,
  initialActive: false,
  forceSetupFailure: false,
});

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function finiteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export const interactionConfiguration = defineFeatureConfiguration<InteractionConfiguration>({
  defaultValue: () => DEFAULT_CONFIGURATION,
  parse(input) {
    const issues: Array<{ path: readonly (string | number)[]; code: string }> = [];
    if (!record(input)) {
      return { ok: false, issues: [{ path: [], code: "expected-object" }] };
    }
    if (!exactKeys(input, [
      "forceSetupFailure",
      "initialActive",
      "position",
      "range",
      "targetEntityId",
    ])) issues.push({ path: [], code: "unexpected-keys" });
    if (!validId(input.targetEntityId)) issues.push({ path: ["targetEntityId"], code: "invalid-id" });
    if (!record(input.position) || !exactKeys(input.position, ["x", "y", "z"])) {
      issues.push({ path: ["position"], code: "invalid-position" });
    } else {
      for (const axis of ["x", "y", "z"] as const) {
        if (!finiteCoordinate(input.position[axis])) issues.push({ path: ["position", axis], code: "not-finite" });
      }
    }
    if (typeof input.range !== "number" || !Number.isFinite(input.range) || input.range < 0 || input.range > 1_000_000) {
      issues.push({ path: ["range"], code: "invalid-range" });
    }
    if (typeof input.initialActive !== "boolean") issues.push({ path: ["initialActive"], code: "expected-boolean" });
    if (typeof input.forceSetupFailure !== "boolean") issues.push({ path: ["forceSetupFailure"], code: "expected-boolean" });
    if (issues.length > 0) return { ok: false, issues };
    const position = input.position as Record<string, unknown>;
    return {
      ok: true,
      value: {
        targetEntityId: input.targetEntityId as string,
        position: { x: position.x as number, y: position.y as number, z: position.z as number },
        range: input.range as number,
        initialActive: input.initialActive as boolean,
        forceSetupFailure: input.forceSetupFailure as boolean,
      },
    };
  },
});

export interface InteractionAdapterInspection {
  readonly targetEntityId: string;
  readonly active: boolean;
  readonly validationCount: number;
  readonly applyCount: number;
}

export interface InspectableInteractionAdapter extends AuthoritativeInteractionAdapter {
  inspect(): InteractionAdapterInspection;
}

function squaredDistance(left: MovementVector, right: MovementVector): number {
  const x = left.x - right.x;
  const y = left.y - right.y;
  const z = left.z - right.z;
  return x * x + y * y + z * z;
}

export function createDeterministicAuthoritativeInteractionAdapter(
  configuration: InteractionConfiguration,
): InspectableInteractionAdapter {
  let active = configuration.initialActive;
  let validationCount = 0;
  let applyCount = 0;
  const rangeSquared = configuration.range * configuration.range;

  return Object.freeze({
    validate(input: AuthoritativeInteractionInput) {
      validationCount += 1;
      if (input.targetEntityId !== configuration.targetEntityId) return "unknown-target";
      if (squaredDistance(input.actorPosition, configuration.position) > rangeSquared) {
        return "interaction-out-of-range";
      }
      return "accepted";
    },
    apply(input: AuthoritativeInteractionInput) {
      if (input.targetEntityId !== configuration.targetEntityId ||
          squaredDistance(input.actorPosition, configuration.position) > rangeSquared) {
        throw new Error("Only a previously validated Interaction may be applied");
      }
      applyCount += 1;
      active = !active;
    },
    snapshot(): readonly InteractableSnapshotEntity[] {
      return Object.freeze([Object.freeze({
        entityKind: "interactable" as const,
        entityId: configuration.targetEntityId,
        position: Object.freeze({ ...configuration.position }),
        active,
      })]);
    },
    inspect() {
      return Object.freeze({
        targetEntityId: configuration.targetEntityId,
        active,
        validationCount,
        applyCount,
      });
    },
  });
}

export interface AuthoritativeInteractionActivation {
  activate(adapter: AuthoritativeInteractionAdapter): void;
}

export function createExternalServerInteractionFeature(): FeatureDescriptor<
  InteractionConfiguration,
  ServerRuntimeContribution
> {
  return {
    id: SERVER_FEATURE_ID,
    description: "External server-authoritative Interaction toggle",
    runtimeContributions: [],
    requires: [SERVER_REQUIREMENT_ID],
    conflicts: [CONFLICT_ID],
    configuration: interactionConfiguration,
    setup({ configuration, dependencies, ledger }) {
      const activation = dependencies.borrowHost<AuthoritativeInteractionActivation>(SERVER_HOST_SERVICE_ID).value;
      const owned = ledger.acquire({
        resourceId: "external.interaction.server.state",
        kind: "retainedReferences",
        value: createDeterministicAuthoritativeInteractionAdapter(configuration),
        release() {},
      });
      if (configuration.forceSetupFailure) throw new Error("Forced external Interaction setup failure");
      activation.activate(owned.value);
    },
    dispose() {},
  };
}

export interface ClientInteractionControl {
  queue(): void;
  latest(): readonly Readonly<{ entityId: string; active: boolean }>[];
}

export function createExternalClientInteractionFeature(): ClientFeatureDescriptor<InteractionConfiguration> {
  let control: ClientInteractionControl | null = null;
  return {
    id: CLIENT_FEATURE_ID,
    description: "External client Interaction input and presentation observer",
    runtimeContributions: [{
      kind: "system",
      id: "external.interaction.presentation",
      domain: "client-presentation",
      phase: "render",
      priority: 0,
      run() {
        control?.latest();
      },
    }],
    requires: [CLIENT_REQUIREMENT_ID],
    conflicts: [CONFLICT_ID],
    configuration: interactionConfiguration,
    setup({ configuration, dependencies, ledger }) {
      const engine = dependencies.borrowHost<ClientReplicationEngine>(CLIENT_HOST_SERVICE_ID).value;
      let latest: readonly Readonly<{ entityId: string; active: boolean }>[] = Object.freeze([]);
      const ownedControl: ClientInteractionControl = Object.freeze({
        queue() {
          const result = engine.queueInteract(configuration.targetEntityId);
          if (!result.ok) throw new Error(`Interaction queue rejected: ${result.failure.code}`);
        },
        latest() {
          latest = Object.freeze(engine.inspect().interactables.map(({ entityId, active }) => Object.freeze({ entityId, active })));
          return latest;
        },
      });
      ledger.acquire({
        resourceId: "external.interaction.client.state",
        kind: "subscriptions",
        value: ownedControl,
        release() {
          latest = Object.freeze([]);
          if (control === ownedControl) control = null;
        },
      });
      if (configuration.forceSetupFailure) throw new Error("Forced external Interaction setup failure");
      control = ownedControl;
      ledger.activateSystem("external.interaction.presentation");
    },
    dispose() {
      control = null;
    },
  };
}
