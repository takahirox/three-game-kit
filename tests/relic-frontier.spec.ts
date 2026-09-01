import { expect, test } from "@playwright/test";

test("Relic Frontier completes a deterministic public-Feature expedition", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/showcases/relic-frontier/index.html?test=1");
  await expect.poll(() => page.evaluate(() => window.__RELIC_FRONTIER__?.ready)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__RELIC_FRONTIER__?.screenshotReady)).toBe(true);

  const boot = await page.evaluate(() => ({
    snapshot: window.__RELIC_FRONTIER__!.snapshot(),
    runtime: window.__RELIC_FRONTIER__!.inspectRuntime(),
    renderer: window.__RELIC_FRONTIER__!.inspectRenderer(),
  }));
  expect(boot.snapshot.phase).toBe("title");
  expect(boot.snapshot.guidance.player).toMatchObject({ playerId: "player", stage: "start", step: 0, onboardingVisible: false });
  expect(boot.renderer).toMatchObject({ backend: "three-webgl", disposed: false, estimatedTextureBytes: 0, activeSkinnedMeshes: 0 });
  expect(boot.renderer!.textures).toBeLessThanOrEqual(1);
  expect(boot.renderer!.meshes).toBeGreaterThan(20);
  expect(boot.renderer!.triangles).toBeGreaterThan(100);
  expect(boot.renderer!.triangles).toBeLessThanOrEqual(25_000);
  expect(boot.renderer!.drawCalls).toBeLessThanOrEqual(80);
  expect(boot.runtime!.installedFeatureIds).toEqual(expect.arrayContaining([
    "movement-input", "relic-frontier.rules", "trigger-area.client", "health-damage.client",
    "projectile.client", "ability-skill.client", "simple-ai-navigation.client", "inventory.client",
    "game-flow.client", "asset-manager", "audio", "ui-hud", "character-controller", "debug-devtools.client",
    "third-person-camera", "vfx", "three-rendering",
  ]));
  await expect(page.locator("#onboarding")).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("relic-frontier-title.png") });
  await expect.poll(() => page.evaluate(() => window.__RELIC_FRONTIER__!.inspectAssets()?.ready)).toBe(true);
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.inspectAssets())).toMatchObject({
    successful: true,
    failureCode: "load-failed",
    manager: { progress: { total: 2, started: 2, completed: 1, failed: 1, pending: 0 } },
  });

  await page.evaluate(() => {
    const game = window.__RELIC_FRONTIER__!;
    game.start();
    game.advance(0.1);
  });
  const briefing = await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot());
  expect(briefing.phase).toBe("explore");
  expect(briefing.guidance.player).toMatchObject({ stage: "cells", step: 1, objective: "Recover Energy Cells (0/3)", targetId: "cell-garden", prompt: "", onboardingVisible: true });
  expect(await page.evaluate(() => Object.isFrozen(window.__RELIC_FRONTIER__!.snapshot().guidance.player?.target))).toBe(true);
  expect(briefing.guidance.player!.distance).toBeGreaterThan(10);
  await expect(page.locator("#onboarding")).toBeVisible();
  await expect(page.locator('[data-hud-bind="extra:stage"]')).toHaveText("STEP 1/5 · ENERGY CELLS");
  await expect(page.locator('[data-hud-bind="extra:objective"]')).toHaveText("Recover Energy Cells (0/3)");
  await expect(page.locator('[data-hud-bind="extra:cue"]')).toHaveText(/^[↑↗→↘↓↙←↖] \d+ m$/);
  await page.screenshot({ path: testInfo.outputPath("relic-frontier-briefing.png") });
  await page.click('[data-hud-action="dismiss-onboarding"]');
  await expect(page.locator("#onboarding")).toBeHidden();
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot().guidance.player?.onboardingVisible)).toBe(false);
  expect((await page.evaluate(() => window.__RELIC_FRONTIER__!.events())).some(({ kind }) => kind === "onboarding-dismissed")).toBe(true);

  await page.evaluate(() => {
    const game = window.__RELIC_FRONTIER__!;
    game.setInput({ moveX: 1, moveY: 0 });
    game.press("dash");
    game.advance(0.25);
  });
  const traversal = await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot());
  expect(traversal.phase).toBe("explore");
  expect(traversal.player.position.x).toBeGreaterThan(0.5);
  expect(["run", "dash"]).toContain(traversal.player.animation);
  expect(traversal.player.dashCooldownTicks).toBeGreaterThan(0);
  await expect(page.locator('[data-hud-bind="extra:dash"]')).toHaveText(/^\d+\.\ds$/);
  await expect.poll(() => page.evaluate(() => window.__RELIC_FRONTIER__!.inspectAudio()?.unlocked)).toBe(true);
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.inspectAudio()?.registeredClipIds)).toEqual(["impact", "pickup", "victory"]);

  await page.evaluate(() => { const game = window.__RELIC_FRONTIER__!; game.setInput({ moveX: 0, moveY: 0 }); game.advance(0.4); });
  const beforeDiagonal = await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot().player.position);
  await page.keyboard.down("KeyW");
  await page.keyboard.down("KeyD");
  await page.evaluate(() => window.__RELIC_FRONTIER__!.advance(0.5));
  await page.keyboard.up("KeyD");
  await page.keyboard.up("KeyW");
  const afterDiagonal = await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot().player.position);
  const diagonalX = afterDiagonal.x - beforeDiagonal.x;
  const diagonalZ = afterDiagonal.z - beforeDiagonal.z;
  expect(diagonalX).toBeGreaterThan(0.5);
  expect(diagonalZ).toBeLessThan(-0.5);
  expect(Math.abs(diagonalX + diagonalZ)).toBeLessThan(0.1);
  expect(await page.evaluate(() => {
    const game = window.__RELIC_FRONTIER__!;
    try { game.setInput({ moveX: 1, moveY: 1 }); game.setInput({ moveX: -1, moveY: 1 }); game.setInput({ moveX: 0, moveY: 0 }); return "ok"; } catch (error) { return String(error); }
  })).toBe("ok");
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.errors())).toEqual([]);
  expect(pageErrors).toEqual([]);

  await page.evaluate(() => {
    const game = window.__RELIC_FRONTIER__!;
    game.loadScenario("fresh");
    game.setInput({ moveX: -0.76, moveY: -0.64, cameraYaw: 0 });
    game.advance(2.8);
    game.setInput({ moveX: 0, moveY: 0 });
    game.advance(0.05);
  });
  const nearCell = await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot());
  expect(nearCell.guidance.player).toMatchObject({ stage: "cells", targetId: "cell-garden", prompt: "E · TAKE ENERGY CELL" });
  expect(nearCell.guidance.player!.distance).toBeLessThan(2.2);
  await expect(page.locator('[data-hud-bind="extra:prompt"]')).toHaveText("E · TAKE ENERGY CELL");
  await page.evaluate(() => { const game = window.__RELIC_FRONTIER__!; game.press("interact"); game.advance(0.05); });
  const collected = await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot());
  expect(collected.energyCells).toBe(1);
  expect(collected.guidance.player).toMatchObject({ stage: "cells", step: 1, objective: "Recover Energy Cells (1/3)", targetId: "cell-tower", prompt: "" });
  await expect(page.locator('.inventory [data-hud-bind="extra:cells"]')).toHaveText("1/3");

  await page.evaluate(() => { const game = window.__RELIC_FRONTIER__!; game.loadScenario("mechanism"); game.advance(0.05); });
  const mechanism = await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot());
  expect(mechanism).toMatchObject({ phase: "explore", energyCells: 3, mechanismPowered: false });
  expect(mechanism.guidance.player).toMatchObject({ stage: "mechanism", step: 2, objective: "Power the chamber mechanism", targetId: "power-console", prompt: "E · POWER THE MECHANISM" });
  await expect(page.locator('[data-hud-bind="extra:stage"]')).toHaveText("STEP 2/5 · CHAMBER MECHANISM");
  await expect(page.locator('[data-hud-bind="extra:prompt"]')).toHaveText("E · POWER THE MECHANISM");
  await expect(page.locator("#guardian")).toBeHidden();
  await page.evaluate(() => { const game = window.__RELIC_FRONTIER__!; game.press("interact"); game.advance(0.05); });
  const powered = await page.evaluate(() => ({ snapshot: window.__RELIC_FRONTIER__!.snapshot(), events: window.__RELIC_FRONTIER__!.events() }));
  expect(powered.snapshot).toMatchObject({ phase: "guardian", mechanismPowered: true });
  expect(powered.snapshot.guidance.player).toMatchObject({ stage: "guardian", step: 3, targetId: "relic-guardian" });
  expect(powered.events.some(({ kind }) => kind === "mechanism-powered")).toBe(true);
  await expect(page.locator('[data-hud-bind="extra:stage"]')).toHaveText("STEP 3/5 · RELIC GUARDIAN");
  await expect(page.locator("#guardian")).toBeVisible();
  await expect(page.locator('[data-hud-bind="extra:guardian"]')).toHaveText("180/180");

  await page.evaluate(() => {
    const game = window.__RELIC_FRONTIER__!;
    game.setInput({ moveX: 0, moveY: 0, cameraYaw: 0 });
    game.loadScenario("guardian");
    game.press("ability");
    game.advance(0.45);
    game.press("ability");
    game.advance(0.05);
  });
  const guardian = await page.evaluate(() => ({ snapshot: window.__RELIC_FRONTIER__!.snapshot(), events: window.__RELIC_FRONTIER__!.events() }));
  expect(guardian.snapshot).toMatchObject({ phase: "guardian", energyCells: 3, mechanismPowered: true });
  expect(guardian.snapshot.player.pulseCooldownTicks).toBeGreaterThan(0);
  expect(guardian.events.some(({ kind }) => kind === "ability-fired")).toBe(true);
  expect(guardian.events.some(({ kind }) => kind === "ability-rejected")).toBe(true);
  await expect(page.locator('[data-hud-bind="extra:ability"]')).toHaveText(/^\d+\.\ds$/);
  await expect(page.locator('[data-hud-bind="extra:guardian"]')).toHaveText(/^\d+\/180$/);
  await page.screenshot({ path: testInfo.outputPath("relic-frontier-guardian.png") });

  for (let hit = 0; hit < 10; hit += 1) {
    await page.evaluate(() => { window.__RELIC_FRONTIER__!.press("attack"); window.__RELIC_FRONTIER__!.advance(0.12); });
  }
  await expect.poll(() => page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot().enemies.find(({ kind }) => kind === "boss")?.alive)).toBe(false);
  await page.evaluate(() => window.__RELIC_FRONTIER__!.advance(0.05));
  const defeated = await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot());
  expect(defeated.guidance.player).toMatchObject({ stage: "relic", step: 4, objective: "Claim the Relic in the chamber", targetId: "relic" });
  await expect(page.locator('[data-hud-bind="extra:stage"]')).toHaveText("STEP 4/5 · CLAIM THE RELIC");
  await expect(page.locator("#guardian")).toBeHidden();

  await page.evaluate(() => {
    const game = window.__RELIC_FRONTIER__!;
    game.setInput({ moveY: -1 });
    game.advance(1.25);
    game.setInput({ moveY: 0 });
    game.advance(0.05);
  });
  const chamber = await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot());
  expect(chamber.guidance.player).toMatchObject({ stage: "relic", targetId: "relic", prompt: "E · CLAIM THE RELIC" });
  await expect(page.locator('[data-hud-bind="extra:prompt"]')).toHaveText("E · CLAIM THE RELIC");
  await page.evaluate(() => { const game = window.__RELIC_FRONTIER__!; game.press("interact"); game.advance(0.05); });
  const relic = await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot());
  expect(relic.relicOwned).toBe(true);
  expect(relic.phase).toBe("escape");
  expect(relic.guidance.player).toMatchObject({ stage: "escape", step: 5, objective: "Return to Base Camp and escape", targetId: "escape-zone" });
  await expect(page.locator('[data-hud-bind="extra:stage"]')).toHaveText("STEP 5/5 · ESCAPE TO BASE CAMP");

  await page.evaluate(() => { const game = window.__RELIC_FRONTIER__!; game.loadScenario("escape"); game.advance(0.05); });
  const camp = await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot());
  expect(camp.guidance.player).toMatchObject({ stage: "escape", targetId: "escape-zone", prompt: "E · ESCAPE TO BASE CAMP" });
  await expect(page.locator('[data-hud-bind="extra:prompt"]')).toHaveText("E · ESCAPE TO BASE CAMP");
  await page.evaluate(() => {
    const game = window.__RELIC_FRONTIER__!;
    game.press("interact");
    game.advance(0.05);
    game.setDebugCamera(true);
  });
  const result = await page.evaluate(() => ({ snapshot: window.__RELIC_FRONTIER__!.snapshot(), events: window.__RELIC_FRONTIER__!.events(), errors: window.__RELIC_FRONTIER__!.errors(), renderer: window.__RELIC_FRONTIER__!.inspectRenderer() }));
  expect(result.snapshot.phase).toBe("results");
  expect(result.snapshot.guidance.player).toMatchObject({ stage: "complete", step: 5, objective: "Expedition complete", targetId: null, prompt: "" });
  expect(result.events.map(({ kind }) => kind)).toEqual(expect.arrayContaining([
    "scenario-loaded", "onboarding-dismissed", "item-picked", "mechanism-powered", "objective-changed",
    "enemy-defeated", "relic-acquired", "expedition-complete", "phase-changed",
  ]));
  expect(result.renderer!.drawCalls).toBeGreaterThan(0);
  expect(result.renderer!.drawCalls).toBeLessThanOrEqual(80);
  expect(result.errors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  await expect(page.locator('[data-hud-bind="extra:stage"]')).toHaveText("EXPEDITION COMPLETE");
  await expect(page.locator('[data-hud-screen="results"]')).toBeVisible();
  await expect(page.locator('[data-hud-screen="results"] [data-hud-bind="score"]')).toHaveText(String(result.snapshot.score));
  await page.screenshot({ path: testInfo.outputPath("relic-frontier-results.png") });

  await page.evaluate(() => window.__RELIC_FRONTIER__!.restart());
  await expect.poll(() => page.evaluate(() => window.__RELIC_FRONTIER__?.ready)).toBe(true);
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot().phase)).toBe("title");
  await expect(page.locator("#onboarding")).toBeHidden();
  await page.evaluate(() => window.__RELIC_FRONTIER__!.dispose());
  await expect.poll(() => page.evaluate(() => window.__RELIC_FRONTIER__!.inspectLeaks().game?.activeFeatures)).toBe(0);
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.inspectLeaks())).toMatchObject({ hostListeners: 0, rafActive: false, hostDisposed: true });
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.inspectAudio()?.disposed)).toBe(true);
});
