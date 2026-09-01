import {
  defineFeatureConfiguration,
  type ClientFeatureDescriptor,
  type ClientFeatureSetupContext,
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
  SaveAdapter,
  SaveDocument,
  SaveLoadRuntime,
  SimpleAiRuntime,
} from "@three-game-kit/shared/genre";

type EmptyConfiguration = Readonly<Record<string, never>>;
type DisposableRuntime = Readonly<{ dispose(): void | Promise<void> }>;

const EMPTY_CONFIGURATION = defineFeatureConfiguration<EmptyConfiguration>({
  defaultValue: () => Object.freeze({}),
  parse(value: unknown) {
    return typeof value === "object" && value !== null && !Array.isArray(value) && Reflect.ownKeys(value).length === 0
      ? { ok: true as const, value: Object.freeze({}) as EmptyConfiguration }
      : { ok: false as const, issues: [{ path: [], code: "empty-object-required" }] };
  },
});

function scheduledFeature(
  featureId: string,
  description: string,
  contributionId: string,
  priority: number,
  runtime: DisposableRuntime,
  run: (tick: number, dt: number) => void,
): ClientFeatureDescriptor<EmptyConfiguration> {
  if (typeof runtime !== "object" || runtime === null || typeof runtime.dispose !== "function" || typeof run !== "function") throw new TypeError(`${featureId} client Feature options are invalid`);
  let active = false;
  let disposed = false;
  const contribution = Object.freeze({
    kind: "system" as const,
    id: contributionId,
    domain: "client-simulation" as const,
    phase: "shared-predict" as const,
    priority,
    run({ tick, dt }: { readonly tick: number; readonly dt: number }): void {
      if (active && !disposed) run(tick, dt);
    },
  });
  return Object.freeze({
    id: featureId,
    description,
    runtimeContributions: Object.freeze([contribution]),
    requires: Object.freeze([]),
    conflicts: Object.freeze([]),
    configuration: EMPTY_CONFIGURATION,
    setup({ ledger }: ClientFeatureSetupContext<EmptyConfiguration>): void {
      if (disposed) throw new Error(`${featureId} Feature has been disposed`);
      active = true;
      try { ledger.activateSystem(contribution.id); } catch (error) { active = false; throw error; }
    },
    async dispose(): Promise<void> {
      if (!disposed) { disposed = true; active = false; await runtime.dispose(); }
    },
  });
}

function passiveFeature(featureId: string, description: string, runtime: DisposableRuntime): ClientFeatureDescriptor<EmptyConfiguration> {
  if (typeof runtime !== "object" || runtime === null || typeof runtime.dispose !== "function") throw new TypeError(`${featureId} client runtime is invalid`);
  let disposed = false;
  return Object.freeze({
    id: featureId,
    description,
    runtimeContributions: Object.freeze([]),
    requires: Object.freeze([]),
    conflicts: Object.freeze([]),
    configuration: EMPTY_CONFIGURATION,
    setup(): void { if (disposed) throw new Error(`${featureId} Feature has been disposed`); },
    async dispose(): Promise<void> { if (!disposed) { disposed = true; await runtime.dispose(); } },
  });
}

export function createGeneralPhysicsClientFeature(runtime: GeneralPhysicsRuntime, publish: (events: readonly PhysicsContactEvent[]) => void = () => {}): ClientFeatureDescriptor<EmptyConfiguration> {
  if (typeof runtime?.step !== "function" || typeof publish !== "function") throw new TypeError("General Physics client Feature options are invalid");
  return scheduledFeature("general-physics.client", "Runs predictive client general physics", "general-physics-client-step", 300, runtime, (tick, dt) => publish(runtime.step(tick, dt)));
}

export function createProjectileClientFeature(runtime: ProjectileRuntime, publish: (events: readonly ProjectileEvent[]) => void = () => {}): ClientFeatureDescriptor<EmptyConfiguration> {
  if (typeof runtime?.step !== "function" || typeof publish !== "function") throw new TypeError("Projectile client Feature options are invalid");
  return scheduledFeature("projectile.client", "Runs predictive client projectiles", "projectile-client-step", 400, runtime, (tick, dt) => publish(runtime.step(tick, dt)));
}

export function createAbilitySkillClientFeature(runtime: AbilityRuntime, publish: (events: readonly AbilityEvent[]) => void = () => {}): ClientFeatureDescriptor<EmptyConfiguration> {
  if (typeof runtime?.step !== "function" || typeof publish !== "function") throw new TypeError("Ability Skill client Feature options are invalid");
  return scheduledFeature("ability-skill.client", "Runs predictive client abilities and skills", "ability-skill-client-step", 500, runtime, (tick) => publish(runtime.step(tick)));
}

export function createSimpleAiNavigationClientFeature(runtime: SimpleAiRuntime, publish: (agents: readonly AiAgentState[]) => void = () => {}): ClientFeatureDescriptor<EmptyConfiguration> {
  if (typeof runtime?.step !== "function" || typeof publish !== "function") throw new TypeError("Simple AI Navigation client Feature options are invalid");
  return scheduledFeature("simple-ai-navigation.client", "Runs predictive client AI navigation", "simple-ai-navigation-client-step", 600, runtime, (tick, dt) => publish(runtime.step(tick, dt)));
}

export function createInventoryClientFeature(runtime: InventoryRuntime): ClientFeatureDescriptor<EmptyConfiguration> {
  if (typeof runtime?.snapshot !== "function") throw new TypeError("Inventory client runtime is invalid");
  return passiveFeature("inventory.client", "Owns predictive client inventory state", runtime);
}

export function createSaveLoadClientFeature(runtime: SaveLoadRuntime): ClientFeatureDescriptor<EmptyConfiguration> {
  if (typeof runtime?.save !== "function" || typeof runtime?.load !== "function") throw new TypeError("Save Load client runtime is invalid");
  return passiveFeature("save-load.client", "Owns client save and load state", runtime);
}

interface BrowserStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createBrowserStorageSaveAdapter(storage: unknown, prefix = "three-game-kit:"): SaveAdapter {
  if (typeof storage !== "object" || storage === null || typeof (storage as BrowserStorageLike).getItem !== "function" || typeof (storage as BrowserStorageLike).setItem !== "function" || typeof (storage as BrowserStorageLike).removeItem !== "function" || typeof prefix !== "string") throw new TypeError("Browser storage adapter options are invalid");
  const target = storage as BrowserStorageLike;
  let disposed = false;
  const key = (slot: string): string => `${prefix}${slot}`;
  return Object.freeze({
    write(slot: string, document: SaveDocument): void { if (disposed) throw new Error("Browser storage adapter has been disposed"); target.setItem(key(slot), JSON.stringify(document)); },
    read(slot: string): SaveDocument | undefined { if (disposed) throw new Error("Browser storage adapter has been disposed"); const value = target.getItem(key(slot)); return value === null ? undefined : JSON.parse(value) as SaveDocument; },
    remove(slot: string): void { if (disposed) throw new Error("Browser storage adapter has been disposed"); target.removeItem(key(slot)); },
    dispose(): void { disposed = true; },
  });
}
