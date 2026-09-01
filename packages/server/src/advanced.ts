import { defineFeatureConfiguration, type FeatureDescriptor, type FeatureSetupContext, type ServerRuntimeContribution } from "@three-game-kit/core";
import type { DebugDevToolsRuntime, DebugSnapshot, DialogueRuntime, VehicleEvent, VehicleRuntime } from "@three-game-kit/shared/advanced";

type EmptyConfiguration = Readonly<Record<string, never>>;
type Descriptor = FeatureDescriptor<EmptyConfiguration, ServerRuntimeContribution>;
type Disposable = Readonly<{ dispose(): void | Promise<void> }>;
const EMPTY_CONFIGURATION = defineFeatureConfiguration<EmptyConfiguration>({ defaultValue: () => Object.freeze({}), parse: (value: unknown) => typeof value === "object" && value !== null && !Array.isArray(value) && Reflect.ownKeys(value).length === 0 ? { ok: true as const, value: Object.freeze({}) } : { ok: false as const, issues: [{ path: [], code: "empty-object-required" }] } });

function scheduled(id: string, description: string, systemId: string, phase: "gameplay" | "telemetry", priority: number, owned: Disposable, run: (tick: number, dt: number) => void): Descriptor {
  if (typeof owned !== "object" || owned === null || typeof owned.dispose !== "function") throw new TypeError(`${id} runtime is invalid`);
  let active = false; let disposed = false;
  const contribution = Object.freeze({ kind: "system" as const, id: systemId, domain: "server-simulation" as const, phase, priority, run({ tick, dt }: { readonly tick: number; readonly dt: number }): void { if (active && !disposed) run(tick, dt); } });
  return Object.freeze({ id, description, runtimeContributions: Object.freeze([contribution]), requires: Object.freeze([]), conflicts: Object.freeze([]), configuration: EMPTY_CONFIGURATION, setup({ ledger }: FeatureSetupContext<EmptyConfiguration>): void { if (disposed) throw new Error(`${id} Feature has been disposed`); active = true; try { ledger.activateSystem(systemId); } catch (error) { active = false; throw error; } }, async dispose(): Promise<void> { if (!disposed) { disposed = true; active = false; await owned.dispose(); } } });
}
function passive(id: string, description: string, owned: Disposable): Descriptor {
  if (typeof owned !== "object" || owned === null || typeof owned.dispose !== "function") throw new TypeError(`${id} runtime is invalid`); let disposed = false; return Object.freeze({ id, description, runtimeContributions: Object.freeze([]), requires: Object.freeze([]), conflicts: Object.freeze([]), configuration: EMPTY_CONFIGURATION, setup(): void { if (disposed) throw new Error(`${id} Feature has been disposed`); }, async dispose(): Promise<void> { if (!disposed) { disposed = true; await owned.dispose(); } } });
}
export function createDialogueServerFeature(runtime: DialogueRuntime): Descriptor {
  if (typeof runtime?.snapshot !== "function") throw new TypeError("Dialogue server runtime is invalid");
  return passive("dialogue.server", "Owns authoritative server dialogue progression", runtime);
}
export function createVehiclesServerFeature(runtime: VehicleRuntime, publish: (events: readonly VehicleEvent[]) => void = () => {}): Descriptor {
  if (typeof runtime?.step !== "function" || typeof publish !== "function") throw new TypeError("Vehicles server Feature options are invalid");
  return scheduled("vehicles.server", "Validates and advances authoritative server vehicle control", "vehicles-server-step", "gameplay", 700, runtime, (tick, dt) => publish(runtime.step(tick, dt)));
}
export function createDebugDevToolsServerFeature(runtime: DebugDevToolsRuntime, publish: (snapshot: DebugSnapshot) => void = () => {}): Descriptor {
  if (typeof runtime?.capture !== "function" || typeof publish !== "function") throw new TypeError("Debug DevTools server Feature options are invalid");
  return scheduled("debug-devtools.server", "Captures structured headless server diagnostics and controlled injection seams", "debug-devtools-server-capture", "telemetry", 1000, runtime, (tick) => publish(runtime.capture(tick)));
}
