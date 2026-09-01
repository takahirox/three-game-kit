import { createDeterministicPresentationFrameSource } from "@three-game-kit/core";
import { createClientRuntime } from "@three-game-kit/client";
import {
  createDomHudAdapter,
  createGameFlowClientFeature,
  createHealthClientFeature,
  createHudFeature,
  createSpawnPrefabClientFeature,
  createTriggerAreaClientFeature,
} from "@three-game-kit/client/gameplay";
import {
  createGameFlowRuntime,
  createHealthRuntime,
  createHudStateStore,
  createSpawnPrefabRuntime,
  createTriggerAreaRuntime,
} from "@three-game-kit/shared/gameplay";

interface CommonGameplayReport {
  readonly ready: boolean;
  readonly triggerKinds: readonly string[];
  readonly health: number;
  readonly pooledEnemyCount: number;
  readonly flowState: string;
  readonly actions: readonly string[];
  readonly hudText: string;
  readonly cleanup: Readonly<{
    readonly clean: boolean;
    readonly allDisposed: boolean;
    readonly hudChildrenRetained: boolean;
    readonly disposedOrder: readonly string[];
  }>;
}

declare global {
  interface Window { __THREE_GAME_KIT_COMMON_GAMEPLAY__?: CommonGameplayReport; }
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing common gameplay element: ${selector}`);
  return element;
}

requireElement<HTMLButtonElement>("#run").addEventListener("click", () => { void run(); }, { once: true });

async function run(): Promise<void> {
  const trigger = createTriggerAreaRuntime([
    { id: "goal", shape: "sphere", center: { x: 0, y: 0, z: 0 }, radius: 2, layers: ["player"] },
  ]);
  const health = createHealthRuntime();
  health.register("hero", 10);
  health.requestDamage("hero", 2, { sourceId: "goal" });
  const prefab = createSpawnPrefabRuntime([{ id: "enemy", components: { health: 3 }, pooling: true }], {
    create: (instance) => ({ instanceId: instance.id }),
    reuse(handle, instance) { Reflect.set(handle as object, "instanceId", instance.id); },
    release() {},
  });
  const firstEnemy = prefab.spawn("enemy");
  prefab.despawn(firstEnemy.id);
  prefab.spawn("enemy");
  const flow = createGameFlowRuntime({
    states: [{ id: "menu", allowedTo: ["play"] }, { id: "play", allowedTo: ["menu"] }],
    initialState: "menu",
  });
  flow.transition("play", { reason: "demo-start", tick: 0 });

  const store = createHudStateStore({ screen: "play", health: 10, maximumHealth: 10 });
  const actions: string[] = [];
  const hudRoot = requireElement<HTMLElement>("#hud");
  const hudChildCount = hudRoot.childElementCount;
  const hudAdapter = createDomHudAdapter(hudRoot, { onAction: (action) => actions.push(action) });
  const triggerEvents: string[] = [];
  const frameSource = createDeterministicPresentationFrameSource();
  const runtime = createClientRuntime({
    frameSource,
    features: [
      createTriggerAreaClientFeature({
        runtime: trigger,
        readActors: () => [{ id: "hero", position: { x: 0, y: 0, z: 0 }, layers: ["player"] }],
        publish: (events) => triggerEvents.push(...events.map(({ kind }) => kind)),
      }),
      createHealthClientFeature({ runtime: health, publish() {} }),
      createSpawnPrefabClientFeature(prefab),
      createGameFlowClientFeature(flow),
      createHudFeature({ store, adapter: hudAdapter }),
    ],
  });
  const boot = await runtime.boot();
  if (boot.state !== "running") throw new Error("Common gameplay runtime failed to boot");
  const stepped = runtime.stepExact(2);
  if (!stepped.ok) throw new Error("Common gameplay runtime failed to step");
  const healthValue = health.get("hero")?.current ?? -1;
  store.update({ score: 100, health: healthValue, extras: { areaEvents: triggerEvents.length } });
  const started = runtime.startPresentation();
  if (!started.ok || !frameSource.deliver(16)) throw new Error("HUD presentation did not run");
  requireElement<HTMLButtonElement>("[data-hud-action=pause]").click();
  const hudText = hudRoot.textContent?.replace(/\s+/gu, " ").trim() ?? "";
  const pooledEnemyCount = prefab.inspect().pooledCounts.enemy ?? 0;
  const flowState = flow.state;
  const shutdown = await runtime.shutdown();

  const report: CommonGameplayReport = Object.freeze({
    ready: true,
    triggerKinds: Object.freeze([...triggerEvents]),
    health: healthValue,
    pooledEnemyCount,
    flowState,
    actions: Object.freeze([...actions]),
    hudText,
    cleanup: Object.freeze({
      clean: shutdown.clean,
      allDisposed: trigger.disposed && health.disposed && prefab.disposed && flow.disposed && store.disposed && hudAdapter.disposed,
      hudChildrenRetained: hudRoot.childElementCount === hudChildCount,
      disposedOrder: shutdown.disposedOrder,
    }),
  });
  window.__THREE_GAME_KIT_COMMON_GAMEPLAY__ = report;
  requireElement<HTMLElement>("#status").textContent = JSON.stringify(report, null, 2);
}
