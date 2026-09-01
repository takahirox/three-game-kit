import {
  defineFeatureConfiguration,
  type ClientFeatureDescriptor,
  type ClientFeatureSetupContext,
} from "@three-game-kit/core";
import type {
  GameFlowRuntime,
  HealthEvent,
  HealthRuntime,
  HudState,
  HudStateStore,
  SpawnPrefabRuntime,
  TriggerActor,
  TriggerAreaEvent,
  TriggerAreaRuntime,
} from "@three-game-kit/shared/gameplay";

type EmptyConfiguration = Readonly<Record<string, never>>;
const EMPTY_CONFIGURATION = defineFeatureConfiguration<EmptyConfiguration>({
  defaultValue: () => Object.freeze({}),
  parse(value: unknown) {
    return typeof value === "object" && value !== null && !Array.isArray(value) && Reflect.ownKeys(value).length === 0
      ? { ok: true as const, value: Object.freeze({}) as EmptyConfiguration }
      : { ok: false as const, issues: [{ path: [], code: "empty-object-required" }] };
  },
});

function exactObject(value: unknown, keys: readonly string[]): value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && keys.every((key) => ownKeys.includes(key));
}

export interface HudAdapterInspection {
  readonly disposed: boolean;
  readonly renderCount: number;
  readonly lastRevision: number | null;
  readonly listenerActive: boolean;
}

export interface HudAdapter {
  readonly disposed: boolean;
  render(state: HudState): void;
  inspect(): HudAdapterInspection;
  dispose(): void;
}

export interface HudFeatureOptions {
  readonly store: HudStateStore;
  readonly adapter: HudAdapter;
}

export function createDomHudAdapter(root: unknown, options: Readonly<{ readonly onAction?: (action: string) => void }> = {}): HudAdapter {
  if (typeof Element === "undefined" || !(root instanceof Element) || typeof options !== "object" || options === null || Array.isArray(options) || !Reflect.ownKeys(options).every((key) => key === "onAction") || (options.onAction !== undefined && typeof options.onAction !== "function")) {
    throw new TypeError("DOM HUD adapter options are invalid");
  }
  let renderCount = 0;
  let lastRevision: number | null = null;
  let disposed = false;
  const click = (event: Event): void => {
    if (disposed || options.onAction === undefined || !(event.target instanceof Element)) return;
    const actionElement = event.target.closest("[data-hud-action]");
    const action = actionElement?.getAttribute("data-hud-action");
    if (action !== null && action !== undefined && action.length > 0) options.onAction(action);
  };
  if (options.onAction !== undefined) root.addEventListener("click", click);

  function value(state: HudState, binding: string): string {
    if (binding === "screen") return state.screen;
    if (binding === "score") return String(state.score);
    if (binding === "timer") return String(state.timerSeconds);
    if (binding === "health") return String(state.health);
    if (binding === "maximumHealth") return String(state.maximumHealth);
    if (binding === "paused") return String(state.paused);
    if (binding.startsWith("extra:")) return String(state.extras[binding.slice(6)] ?? "");
    return "";
  }

  return Object.freeze({
    get disposed(): boolean { return disposed; },
    render(state: HudState): void {
      if (disposed) throw new Error("HUD adapter has been disposed");
      if (typeof state !== "object" || state === null || !Number.isSafeInteger(state.revision)) throw new TypeError("HUD render state is invalid");
      for (const element of root.querySelectorAll("[data-hud-bind]")) {
        const binding = element.getAttribute("data-hud-bind");
        if (binding !== null) element.textContent = value(state, binding);
      }
      for (const element of root.querySelectorAll("[data-hud-screen]")) {
        if (element instanceof HTMLElement) element.hidden = element.getAttribute("data-hud-screen") !== state.screen;
      }
      renderCount += 1;
      lastRevision = state.revision;
    },
    inspect(): HudAdapterInspection { return Object.freeze({ disposed, renderCount, lastRevision, listenerActive: options.onAction !== undefined && !disposed }); },
    dispose(): void { if (!disposed) { disposed = true; if (options.onAction !== undefined) root.removeEventListener("click", click); } },
  });
}

export function createHudFeature(options: HudFeatureOptions): ClientFeatureDescriptor<EmptyConfiguration> {
  if (!exactObject(options, ["store", "adapter"]) || typeof options.store !== "object" || options.store === null || typeof options.store.snapshot !== "function" || typeof options.store.dispose !== "function" || typeof options.adapter !== "object" || options.adapter === null || typeof options.adapter.render !== "function" || typeof options.adapter.dispose !== "function") throw new TypeError("HUD Feature options are invalid");
  let active = false;
  let disposed = false;
  const contribution = Object.freeze({ kind: "system" as const, id: "ui-hud-render", domain: "client-presentation" as const, phase: "render" as const, priority: -200, run(): void { if (active && !disposed) options.adapter.render(options.store.snapshot()); } });
  return Object.freeze({
    id: "ui-hud", description: "Renders framework-neutral read-only HUD state through a client adapter", runtimeContributions: Object.freeze([contribution]), requires: Object.freeze([]), conflicts: Object.freeze([]), configuration: EMPTY_CONFIGURATION,
    setup({ ledger }: ClientFeatureSetupContext<EmptyConfiguration>): void { if (disposed) throw new Error("HUD Feature has been disposed"); active = true; try { ledger.activateSystem(contribution.id); } catch (error) { active = false; throw error; } },
    dispose(): void { if (disposed) return; disposed = true; active = false; let firstError: unknown; try { options.adapter.dispose(); } catch (error) { firstError = error; } try { options.store.dispose(); } catch (error) { firstError ??= error; } if (firstError !== undefined) throw firstError; },
  });
}

export interface TriggerAreaClientFeatureOptions { readonly runtime: TriggerAreaRuntime; readActors(): readonly TriggerActor[]; publish(events: readonly TriggerAreaEvent[]): void; }
export function createTriggerAreaClientFeature(options: TriggerAreaClientFeatureOptions): ClientFeatureDescriptor<EmptyConfiguration> {
  if (!exactObject(options, ["runtime", "readActors", "publish"]) || typeof options.runtime !== "object" || options.runtime === null || typeof options.runtime.step !== "function" || typeof options.runtime.dispose !== "function" || typeof options.readActors !== "function" || typeof options.publish !== "function") throw new TypeError("Trigger Area client Feature options are invalid");
  let active = false; let disposed = false;
  const contribution = Object.freeze({ kind: "system" as const, id: "trigger-area-client-evaluate", domain: "client-simulation" as const, phase: "shared-predict" as const, priority: 100, run({ tick }: { readonly tick: number }): void { if (active && !disposed) options.publish(options.runtime.step(tick, options.readActors())); } });
  return Object.freeze({ id: "trigger-area.client", description: "Evaluates predictive client Trigger Areas", runtimeContributions: Object.freeze([contribution]), requires: Object.freeze([]), conflicts: Object.freeze([]), configuration: EMPTY_CONFIGURATION, setup({ ledger }: ClientFeatureSetupContext<EmptyConfiguration>): void { if (disposed) throw new Error("Trigger Area client Feature has been disposed"); active = true; try { ledger.activateSystem(contribution.id); } catch (error) { active = false; throw error; } }, dispose(): void { if (!disposed) { disposed = true; active = false; options.runtime.dispose(); } } });
}

export interface HealthClientFeatureOptions { readonly runtime: HealthRuntime; publish(events: readonly HealthEvent[]): void; }
export function createHealthClientFeature(options: HealthClientFeatureOptions): ClientFeatureDescriptor<EmptyConfiguration> {
  if (!exactObject(options, ["runtime", "publish"]) || typeof options.runtime !== "object" || options.runtime === null || typeof options.runtime.step !== "function" || typeof options.runtime.dispose !== "function" || typeof options.publish !== "function") throw new TypeError("Health client Feature options are invalid");
  let active = false; let disposed = false;
  const contribution = Object.freeze({ kind: "system" as const, id: "health-damage-client-apply", domain: "client-simulation" as const, phase: "shared-predict" as const, priority: 200, run({ tick }: { readonly tick: number }): void { if (active && !disposed) options.publish(options.runtime.step(tick)); } });
  return Object.freeze({ id: "health-damage.client", description: "Applies predictive client health requests", runtimeContributions: Object.freeze([contribution]), requires: Object.freeze([]), conflicts: Object.freeze([]), configuration: EMPTY_CONFIGURATION, setup({ ledger }: ClientFeatureSetupContext<EmptyConfiguration>): void { if (disposed) throw new Error("Health client Feature has been disposed"); active = true; try { ledger.activateSystem(contribution.id); } catch (error) { active = false; throw error; } }, dispose(): void { if (!disposed) { disposed = true; active = false; options.runtime.dispose(); } } });
}

function ownedPassiveFeature(id: string, description: string, runtime: SpawnPrefabRuntime | GameFlowRuntime): ClientFeatureDescriptor<EmptyConfiguration> {
  let disposed = false;
  return Object.freeze({ id, description, runtimeContributions: Object.freeze([]), requires: Object.freeze([]), conflicts: Object.freeze([]), configuration: EMPTY_CONFIGURATION, setup(): void { if (disposed) throw new Error(`${id} Feature has been disposed`); }, dispose(): void { if (!disposed) { disposed = true; runtime.dispose(); } } });
}

export function createSpawnPrefabClientFeature(runtime: SpawnPrefabRuntime): ClientFeatureDescriptor<EmptyConfiguration> {
  if (typeof runtime !== "object" || runtime === null || typeof runtime.spawn !== "function" || typeof runtime.dispose !== "function") throw new TypeError("Spawn Prefab client runtime is invalid");
  return ownedPassiveFeature("spawn-prefab.client", "Owns predictive client prefab instances", runtime);
}

export function createGameFlowClientFeature(runtime: GameFlowRuntime): ClientFeatureDescriptor<EmptyConfiguration> {
  if (typeof runtime !== "object" || runtime === null || typeof runtime.transition !== "function" || typeof runtime.dispose !== "function") throw new TypeError("Game Flow client runtime is invalid");
  return ownedPassiveFeature("game-flow.client", "Owns deterministic client game flow", runtime);
}
