import { createDeterministicPresentationFrameSource } from "@three-game-kit/core";
import { createClientRuntime } from "@three-game-kit/client";
import { createAbilitySkillClientFeature, createBrowserStorageSaveAdapter, createGeneralPhysicsClientFeature, createInventoryClientFeature, createProjectileClientFeature, createSaveLoadClientFeature, createSimpleAiNavigationClientFeature } from "@three-game-kit/client/genre";
import { createAbilityRuntime, createGeneralPhysicsRuntime, createInventoryRuntime, createProjectileRuntime, createSaveLoadRuntime, createSimpleAiRuntime } from "@three-game-kit/shared/genre";

interface Report { readonly ready: boolean; readonly physicsSteps: number; readonly projectileKinds: readonly string[]; readonly abilityKinds: readonly string[]; readonly inventoryCount: number; readonly aiX: number; readonly loadedScore: number; readonly cleanup: Readonly<{ clean: boolean; allDisposed: boolean; disposedOrder: readonly string[] }>; }
declare global { interface Window { __THREE_GAME_KIT_GENRE_EXPANSION__?: Report; } }

document.querySelector<HTMLButtonElement>("#run")?.addEventListener("click", () => { void run(); }, { once: true });

async function run(): Promise<void> {
  const physics = createGeneralPhysicsRuntime({ gravity: { x: 0, y: 0, z: 0 } });
  physics.addBody({ id: "hero", kind: "dynamic", position: { x: 0, y: 0, z: 0 }, halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, velocity: { x: 1, y: 0, z: 0 } });
  const projectile = createProjectileRuntime([{ id: "bolt", speed: 2, lifetimeTicks: 4 }]);
  projectile.fire("bolt", "hero", { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0);
  const inventory = createInventoryRuntime([{ id: "potion", maximumStack: 3 }]); inventory.createContainer("bag", 1); inventory.add("bag", "potion", 2);
  const ability = createAbilityRuntime([{ id: "dash", cooldownTicks: 2 }]); ability.request("hero", "dash", 1);
  const ai = createSimpleAiRuntime(); ai.register("guard", { x: 0, y: 0, z: 0 }, 1); ai.setWaypoints("guard", [{ x: 1, y: 0, z: 0 }]);
  let saveState = { score: 7 };
  const saves = createSaveLoadRuntime({ currentVersion: 1, capture: () => saveState, restore: (data) => { saveState = data as { score: number }; }, adapter: createBrowserStorageSaveAdapter(localStorage, "genre-example:") });
  const projectileKinds: string[] = []; const abilityKinds: string[] = [];
  const runtime = createClientRuntime({ frameSource: createDeterministicPresentationFrameSource(), features: [
    createGeneralPhysicsClientFeature(physics),
    createProjectileClientFeature(projectile, (events) => projectileKinds.push(...events.map(({ kind }) => kind))),
    createAbilitySkillClientFeature(ability, (events) => abilityKinds.push(...events.map(({ kind }) => kind))),
    createSimpleAiNavigationClientFeature(ai),
    createInventoryClientFeature(inventory),
    createSaveLoadClientFeature(saves),
  ] });
  const boot = await runtime.boot(); if (boot.state !== "running") throw new Error("Genre runtime failed to boot");
  const step = runtime.stepExact(2); if (!step.ok) throw new Error("Genre runtime failed to step");
  await saves.save("demo"); saveState = { score: 0 }; await saves.load("demo");
  const inventoryCount = inventory.snapshot().bag?.[0]?.count ?? 0; const aiX = ai.inspect().agents[0]?.position.x ?? -1; const physicsSteps = physics.inspect().stepCount;
  const shutdown = await runtime.shutdown();
  const report: Report = Object.freeze({ ready: true, physicsSteps, projectileKinds: Object.freeze(projectileKinds), abilityKinds: Object.freeze(abilityKinds), inventoryCount, aiX, loadedScore: saveState.score, cleanup: Object.freeze({ clean: shutdown.clean, allDisposed: physics.disposed && projectile.disposed && inventory.disposed && ability.disposed && ai.disposed && saves.disposed, disposedOrder: shutdown.disposedOrder }) });
  window.__THREE_GAME_KIT_GENRE_EXPANSION__ = report;
  const status = document.querySelector("#status"); if (status !== null) status.textContent = JSON.stringify(report, null, 2);
}
