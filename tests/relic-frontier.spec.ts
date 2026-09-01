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
    game.setInput({ moveX: 1, moveY: 0 });
    game.press("dash");
    game.advance(0.25);
  });
  const traversal = await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot());
  expect(traversal.phase).toBe("explore");
  expect(traversal.player.position.x).toBeGreaterThan(0.5);
  expect(["run", "dash"]).toContain(traversal.player.animation);
  expect(traversal.player.dashCooldownTicks).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__RELIC_FRONTIER__!.inspectAudio()?.unlocked)).toBe(true);
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.inspectAudio()?.registeredClipIds)).toEqual(["impact", "pickup", "victory"]);

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
  expect(guardian.events.some(({ kind }) => kind === "ability-fired")).toBe(true);
  expect(guardian.events.some(({ kind }) => kind === "ability-rejected")).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("relic-frontier-guardian.png") });

  for (let hit = 0; hit < 10; hit += 1) {
    await page.evaluate(() => { window.__RELIC_FRONTIER__!.press("attack"); window.__RELIC_FRONTIER__!.advance(0.12); });
  }
  await expect.poll(() => page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot().enemies.find(({ kind }) => kind === "boss")?.alive)).toBe(false);

  await page.evaluate(() => {
    const game = window.__RELIC_FRONTIER__!;
    game.setInput({ moveY: -1 });
    game.advance(1.25);
    game.setInput({ moveY: 0 });
    game.press("interact");
    game.advance(0.05);
  });
  const relic = await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot());
  expect(relic.relicOwned).toBe(true);
  expect(relic.phase).toBe("escape");

  await page.evaluate(() => {
    const game = window.__RELIC_FRONTIER__!;
    game.loadScenario("escape");
    game.advance(0.05);
    game.press("interact");
    game.advance(0.05);
    game.setDebugCamera(true);
  });
  const result = await page.evaluate(() => ({ snapshot: window.__RELIC_FRONTIER__!.snapshot(), events: window.__RELIC_FRONTIER__!.events(), errors: window.__RELIC_FRONTIER__!.errors(), renderer: window.__RELIC_FRONTIER__!.inspectRenderer() }));
  expect(result.snapshot.phase).toBe("results");
  expect(result.events.map(({ kind }) => kind)).toEqual(expect.arrayContaining(["scenario-loaded", "enemy-defeated", "relic-acquired", "phase-changed"]));
  expect(result.renderer!.drawCalls).toBeGreaterThan(0);
  expect(result.errors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("relic-frontier-results.png") });

  await page.evaluate(() => window.__RELIC_FRONTIER__!.restart());
  await expect.poll(() => page.evaluate(() => window.__RELIC_FRONTIER__?.ready)).toBe(true);
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot().phase)).toBe("title");
  await page.evaluate(() => window.__RELIC_FRONTIER__!.dispose());
  await expect.poll(() => page.evaluate(() => window.__RELIC_FRONTIER__!.inspectLeaks().game?.activeFeatures)).toBe(0);
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.inspectLeaks())).toMatchObject({ hostListeners: 0, rafActive: false, hostDisposed: true });
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.inspectAudio()?.disposed)).toBe(true);
});
