import { expect, test } from "@playwright/test";

test("Gravetide runs a deterministic public-Feature survivor night", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/showcases/gravetide/index.html?test=1");
  await expect.poll(() => page.evaluate(() => window.__GRAVETIDE__?.ready), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__GRAVETIDE__?.screenshotReady)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__GRAVETIDE__?.inspectSave()?.ready)).toBe(true);

  const boot = await page.evaluate(() => ({ snapshot: window.__GRAVETIDE__!.snapshot(), runtime: window.__GRAVETIDE__!.inspectRuntime(), renderer: window.__GRAVETIDE__!.inspectRenderer() }));
  expect(boot.snapshot).toMatchObject({ phase: "title", seed: 4242, kills: 0, waveIndex: 0, result: null });
  expect(boot.snapshot.hero).toMatchObject({ hp: 100, maximumHp: 100, level: 1, alive: true });
  expect(boot.snapshot.records).toMatchObject({ bestSeconds: 0, bestLevel: 0, bestKills: 0, runs: 0 });
  expect(await page.evaluate(() => Object.isFrozen(window.__GRAVETIDE__!.snapshot().hero))).toBe(true);
  expect(boot.runtime).toMatchObject({ lifecycleState: "running", debugProviders: ["hero", "run"], ai: { agents: 0, eliteBehavior: null } });
  expect(boot.runtime!.installedFeatureIds).toEqual([
    "movement-input", "gravetide.rules", "trigger-area.client", "health-damage.client", "projectile.client", "ability-skill.client",
    "simple-ai-navigation.client", "spawn-prefab.client", "game-flow.client", "save-load.client", "ui-hud", "debug-devtools.client",
    "third-person-camera", "particles", "three-rendering",
  ]);
  expect(boot.runtime!.scheduleSystemIds).toEqual(expect.arrayContaining(["movement-input-sample", "gravetide.rules.step", "health-damage-client-apply", "projectile-client-step", "ability-skill-client-step", "simple-ai-navigation-client-step", "third-person-camera-view", "three-render-frame"]));
  expect(boot.renderer).toMatchObject({ backend: "three-webgl", disposed: false, textures: 2, width: 1280, height: 720, instances: { enemies: 0, gems: 0 } });
  expect(boot.renderer!.particles.capacity).toBe(2304);
  await expect(page.locator('[data-hud-screen="title"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("gravetide-title.png") });

  // Begin the night: the whip is equipped and the first wave starts arriving.
  await page.click('[data-hud-action="start"]');
  await page.evaluate(() => window.__GRAVETIDE__!.advance(0.2));
  const started = await page.evaluate(() => window.__GRAVETIDE__!.snapshot());
  expect(started.phase).toBe("running");
  expect(started.weapons).toEqual([expect.objectContaining({ id: "whip", level: 1 })]);
  await page.keyboard.down("KeyD");
  await page.evaluate(() => window.__GRAVETIDE__!.advance(1));
  await page.keyboard.up("KeyD");
  const walked = await page.evaluate(() => window.__GRAVETIDE__!.snapshot());
  expect(walked.hero.x).toBeGreaterThan(4);
  expect(walked.hero.facing).toBeCloseTo(Math.PI / 2, 1);
  await page.evaluate(() => window.__GRAVETIDE__!.advance(5));
  const wave = await page.evaluate(() => window.__GRAVETIDE__!.snapshot());
  expect(wave.enemies.alive).toBeGreaterThan(3);
  expect(wave.enemies.byKind.bat).toBeGreaterThan(3);
  expect((await page.evaluate(() => window.__GRAVETIDE__!.events())).map(({ kind }) => kind)).toEqual(expect.arrayContaining(["run-started", "phase-changed", "weapon-added"]));
  await page.screenshot({ path: testInfo.outputPath("gravetide-wave.png") });

  // A swarm around the hero: the whip and contact damage both resolve through the Health Feature, gems drop and are pulled in.
  await page.evaluate(() => { const game = window.__GRAVETIDE__!; game.loadScenario("swarm"); game.advance(4); });
  const swarm = await page.evaluate(() => ({ snapshot: window.__GRAVETIDE__!.snapshot(), runtime: window.__GRAVETIDE__!.inspectRuntime(), renderer: window.__GRAVETIDE__!.inspectRenderer(), events: window.__GRAVETIDE__!.events().map(({ kind }) => kind) }));
  expect(swarm.snapshot.kills).toBeGreaterThan(10);
  expect(swarm.snapshot.hero.hp).toBeLessThan(100);
  expect(swarm.snapshot.hero.hp).toBeGreaterThan(0);
  expect(swarm.events).toEqual(expect.arrayContaining(["enemy-killed", "hero-damaged", "gem-collected", "whip-hit", "level-up"]));
  expect(swarm.runtime!.prefab.active).toBe(swarm.snapshot.enemies.alive);
  expect(Object.values(swarm.runtime!.prefab.pooled).reduce((total, count) => total + count, 0)).toBeGreaterThan(5);
  expect(swarm.runtime!.health.entities).toBeGreaterThan(20);
  expect(swarm.renderer!.particles.emitted).toBeGreaterThan(50);
  expect(swarm.renderer!.instances.enemies).toBe(swarm.snapshot.enemies.alive);
  expect(swarm.snapshot.phase).toBe("levelup");
  expect(swarm.snapshot.offers).toHaveLength(3);
  await expect(page.locator('[data-hud-screen="levelup"]')).toBeVisible();
  await expect(page.locator("#cards .card:not([hidden])")).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath("gravetide-levelup.png") });

  // Choosing a card through the HUD applies the upgrade and resumes the run.
  const firstOffer = swarm.snapshot.offers[0]!;
  await page.click('[data-hud-action="choose-1"]');
  await page.evaluate(() => window.__GRAVETIDE__!.advance(0.1));
  const chosen = await page.evaluate(() => window.__GRAVETIDE__!.snapshot());
  expect(chosen.phase).toBe("running");
  if (firstOffer.kind === "weapon") expect(chosen.weapons.map((weapon) => weapon.id)).toContain(firstOffer.id);
  else if (firstOffer.kind === "passive") expect(choson(chosen.passives, firstOffer.id)).toBe(true);
  expect((await page.evaluate(() => window.__GRAVETIDE__!.events())).map(({ kind, subject }) => `${kind}:${subject ?? ""}`)).toContain(`offer-chosen:${firstOffer.kind}:${firstOffer.id}`);

  // Repeated level-ups stack weapons and passives up to the slot limits; the loadout stays consistent.
  for (let round = 0; round < 8; round += 1) {
    await page.evaluate(() => { const game = window.__GRAVETIDE__!; game.loadScenario("levelup"); game.advance(0.05); game.press("choose-1"); game.advance(0.05); });
  }
  const stacked = await page.evaluate(() => window.__GRAVETIDE__!.snapshot());
  expect(stacked.phase).toBe("running");
  expect(stacked.hero.level).toBeGreaterThanOrEqual(10);
  expect(stacked.weapons.reduce((total, weapon) => total + weapon.level, 0) + stacked.passives.reduce((total, passive) => total + passive.level, 0)).toBeGreaterThanOrEqual(9);
  expect(stacked.weapons.length).toBeLessThanOrEqual(4);
  expect(stacked.passives.length).toBeLessThanOrEqual(4);
  await page.evaluate(() => { const game = window.__GRAVETIDE__!; game.loadScenario("swarm"); game.advance(3); });
  await page.screenshot({ path: testInfo.outputPath("gravetide-loadout.png") });

  // The Grave Bell is an Ability Feature cast: request, cast time, completion, knockback hits, then cooldown.
  await page.evaluate(() => { const game = window.__GRAVETIDE__!; game.loadScenario("swarm"); game.press("bell"); game.advance(0.5); });
  const bell = await page.evaluate(() => ({ snapshot: window.__GRAVETIDE__!.snapshot(), events: window.__GRAVETIDE__!.events().filter(({ kind }) => kind.startsWith("bell")) }));
  expect(bell.events.map(({ kind }) => kind)).toEqual(expect.arrayContaining(["bell-requested", "bell-rung"]));
  expect(bell.events.find(({ kind }) => kind === "bell-rung")!.value).toBeGreaterThan(5);
  expect(bell.snapshot.bell.readyInSeconds).toBeGreaterThan(10);
  expect(bell.snapshot.bell.uses).toBe(1);
  await page.evaluate(() => { const game = window.__GRAVETIDE__!; game.press("bell"); game.advance(0.1); });
  expect((await page.evaluate(() => window.__GRAVETIDE__!.snapshot())).bell.uses).toBe(1);

  // The elite hunts through the Simple AI Feature.
  await page.evaluate(() => { const game = window.__GRAVETIDE__!; game.loadScenario("elite"); game.advance(1.5); });
  const elite = await page.evaluate(() => ({ snapshot: window.__GRAVETIDE__!.snapshot(), runtime: window.__GRAVETIDE__!.inspectRuntime() }));
  expect(elite.snapshot.enemies.eliteAlive).toBe(true);
  expect(elite.runtime!.ai).toEqual({ agents: 1, eliteBehavior: "hunt" });
  await expect(page.locator("#elite")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("gravetide-elite.png") });

  // Shrines heal through a Trigger Area enter event, once per cooldown.
  await page.evaluate(() => { const game = window.__GRAVETIDE__!; game.loadScenario("shrine"); game.advance(0.3); });
  const shrine = await page.evaluate(() => ({ snapshot: window.__GRAVETIDE__!.snapshot(), events: window.__GRAVETIDE__!.events().filter(({ kind }) => kind === "shrine-used") }));
  expect(shrine.events).toHaveLength(1);
  expect(shrine.snapshot.shrines[0]!.readyInSeconds).toBeGreaterThan(80);

  // Dawn: the timer runs out, the run is recorded, and the records persist through Save/Load.
  await page.evaluate(() => { const game = window.__GRAVETIDE__!; game.loadScenario("dawn"); game.advance(2.5); });
  await expect.poll(() => page.evaluate(() => window.__GRAVETIDE__!.inspectSave()?.lastSave)).toBe("saved");
  const dawn = await page.evaluate(() => window.__GRAVETIDE__!.snapshot());
  expect(dawn).toMatchObject({ phase: "victory", result: "dawn" });
  expect(dawn.records).toMatchObject({ bestSeconds: 300, runs: 1 });
  expect(dawn.records.bestKills).toBe(dawn.kills);
  expect(dawn.records.bestLevel).toBe(dawn.hero.level);
  await expect(page.locator('[data-hud-screen="victory"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("gravetide-dawn.png") });

  // Restarting resets the run while keeping the records.
  await page.keyboard.press("Enter");
  await page.evaluate(() => window.__GRAVETIDE__!.advance(0.2));
  const rerun = await page.evaluate(() => window.__GRAVETIDE__!.snapshot());
  expect(rerun).toMatchObject({ phase: "running", kills: 0, result: null });
  expect(rerun.hero).toMatchObject({ hp: 100, level: 1 });
  expect(rerun.records.runs).toBe(1);

  expect(await page.evaluate(() => window.__GRAVETIDE__!.errors())).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  await page.evaluate(() => window.__GRAVETIDE__!.dispose());
  expect(await page.evaluate(() => window.__GRAVETIDE__!.inspectLeaks())).toMatchObject({ hostListeners: 0, rafActive: false, hostDisposed: true, game: { disposed: true, activeFeatures: 0 } });
  expect(await page.evaluate(() => window.__GRAVETIDE__!.inspectRenderer())).toMatchObject({ disposed: true });
});

function choson(passives: readonly { readonly id: string }[], id: string): boolean {
  return passives.some((passive) => passive.id === id);
}
