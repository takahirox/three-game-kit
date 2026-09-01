import {
  defineFeatureConfiguration,
  type FeatureDescriptor,
  type FeatureSetupContext,
  type ServerRuntimeContribution,
} from "@three-game-kit/core";
import type {
  AbilityEvent,
  AbilityRuntime,
  AiAgentState,
  GeneralPhysicsRuntime,
  InventoryRuntime,
  PhysicsContactEvent,
  ProjectileEvent,
  ProjectileRuntime,
  SaveLoadRuntime,
  SimpleAiRuntime,
} from "@three-game-kit/shared/genre";

type EmptyConfiguration = Readonly<Record<string, never>>;
type Descriptor = FeatureDescriptor<EmptyConfiguration, ServerRuntimeContribution>;
type DisposableRuntime = Readonly<{ dispose(): void | Promise<void> }>;

const EMPTY_CONFIGURATION = defineFeatureConfiguration<EmptyConfiguration>({
  defaultValue: () => Object.freeze({}),
  parse(value: unknown) {
    return typeof value === "object" && value !== null && !Array.isArray(value) && Reflect.ownKeys(value).length === 0
      ? { ok: true as const, value: Object.freeze({}) as EmptyConfiguration }
      : { ok: false as const, issues: [{ path: [], code: "empty-object-required" }] };
  },
});

function scheduledFeature(featureId: string, description: string, contributionId: string, priority: number, runtime: DisposableRuntime, run: (tick: number, dt: number) => void): Descriptor {
  if (typeof runtime !== "object" || runtime === null || typeof runtime.dispose !== "function" || typeof run !== "function") throw new TypeError(`${featureId} server Feature options are invalid`);
  let active = false;
  let disposed = false;
  const contribution = Object.freeze({ kind: "system" as const, id: contributionId, domain: "server-simulation" as const, phase: "gameplay" as const, priority, run({ tick, dt }: { readonly tick: number; readonly dt: number }): void { if (active && !disposed) run(tick, dt); } });
  return Object.freeze({
    id: featureId,
    description,
    runtimeContributions: Object.freeze([contribution]),
    requires: Object.freeze([]),
    conflicts: Object.freeze([]),
    configuration: EMPTY_CONFIGURATION,
    setup({ ledger }: FeatureSetupContext<EmptyConfiguration>): void { if (disposed) throw new Error(`${featureId} Feature has been disposed`); active = true; try { ledger.activateSystem(contribution.id); } catch (error) { active = false; throw error; } },
    async dispose(): Promise<void> { if (!disposed) { disposed = true; active = false; await runtime.dispose(); } },
  });
}

function passiveFeature(featureId: string, description: string, runtime: DisposableRuntime): Descriptor {
  if (typeof runtime !== "object" || runtime === null || typeof runtime.dispose !== "function") throw new TypeError(`${featureId} server runtime is invalid`);
  let disposed = false;
  return Object.freeze({ id: featureId, description, runtimeContributions: Object.freeze([]), requires: Object.freeze([]), conflicts: Object.freeze([]), configuration: EMPTY_CONFIGURATION, setup(): void { if (disposed) throw new Error(`${featureId} Feature has been disposed`); }, async dispose(): Promise<void> { if (!disposed) { disposed = true; await runtime.dispose(); } } });
}

export function createGeneralPhysicsServerFeature(runtime: GeneralPhysicsRuntime, publish: (events: readonly PhysicsContactEvent[]) => void = () => {}): Descriptor {
  if (typeof runtime?.step !== "function" || typeof publish !== "function") throw new TypeError("General Physics server Feature options are invalid");
  return scheduledFeature("general-physics.server", "Runs authoritative server general physics", "general-physics-server-step", 300, runtime, (tick, dt) => publish(runtime.step(tick, dt)));
}

export function createProjectileServerFeature(runtime: ProjectileRuntime, publish: (events: readonly ProjectileEvent[]) => void = () => {}): Descriptor {
  if (typeof runtime?.step !== "function" || typeof publish !== "function") throw new TypeError("Projectile server Feature options are invalid");
  return scheduledFeature("projectile.server", "Runs authoritative server projectiles", "projectile-server-step", 400, runtime, (tick, dt) => publish(runtime.step(tick, dt)));
}

export function createAbilitySkillServerFeature(runtime: AbilityRuntime, publish: (events: readonly AbilityEvent[]) => void = () => {}): Descriptor {
  if (typeof runtime?.step !== "function" || typeof publish !== "function") throw new TypeError("Ability Skill server Feature options are invalid");
  return scheduledFeature("ability-skill.server", "Runs authoritative server abilities and skills", "ability-skill-server-step", 500, runtime, (tick) => publish(runtime.step(tick)));
}

export function createSimpleAiNavigationServerFeature(runtime: SimpleAiRuntime, publish: (agents: readonly AiAgentState[]) => void = () => {}): Descriptor {
  if (typeof runtime?.step !== "function" || typeof publish !== "function") throw new TypeError("Simple AI Navigation server Feature options are invalid");
  return scheduledFeature("simple-ai-navigation.server", "Runs authoritative server AI navigation", "simple-ai-navigation-server-step", 600, runtime, (tick, dt) => publish(runtime.step(tick, dt)));
}

export function createInventoryServerFeature(runtime: InventoryRuntime): Descriptor {
  if (typeof runtime?.snapshot !== "function") throw new TypeError("Inventory server runtime is invalid");
  return passiveFeature("inventory.server", "Owns authoritative server inventory state", runtime);
}

export function createSaveLoadServerFeature(runtime: SaveLoadRuntime): Descriptor {
  if (typeof runtime?.save !== "function" || typeof runtime?.load !== "function") throw new TypeError("Save Load server runtime is invalid");
  return passiveFeature("save-load.server", "Owns authoritative server save and load state", runtime);
}
