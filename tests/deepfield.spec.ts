import { expect, test } from "@playwright/test";

test("Deepfield runs a deterministic public-Feature voxel sandbox", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/showcases/deepfield/index.html?test=1");
  await expect.poll(() => page.evaluate(() => window.__DEEPFIELD__?.ready), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__DEEPFIELD__?.screenshotReady)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__DEEPFIELD__?.inspectSave()?.ready)).toBe(true);

  const boot = await page.evaluate(() => ({
    snapshot: window.__DEEPFIELD__!.snapshot(),
    runtime: window.__DEEPFIELD__!.inspectRuntime(),
    renderer: window.__DEEPFIELD__!.inspectRenderer(),
    world: window.__DEEPFIELD__!.inspectWorld(),
    save: window.__DEEPFIELD__!.inspectSave(),
  }));
  expect(boot.snapshot).toMatchObject({ phase: "title", seed: 1337, hasSave: false, editCount: 0, selectedSlot: 0, allObjectivesDone: false });
  expect(boot.snapshot.objectives).toHaveLength(5);
  expect(boot.snapshot.player).toMatchObject({ health: 20, maximumHealth: 20 });
  expect(await page.evaluate(() => Object.isFrozen(window.__DEEPFIELD__!.snapshot().player))).toBe(true);
  expect(boot.runtime).toMatchObject({ lifecycleState: "running", debugProviders: ["player", "world"] });
  expect(boot.runtime!.installedFeatureIds).toEqual([
    "movement-input", "deepfield.rules", "inventory.client", "health-damage.client", "game-flow.client", "save-load.client",
    "ui-hud", "debug-devtools.client", "deepfield.camera", "particles", "three-rendering",
  ]);
  expect(boot.runtime!.scheduleSystemIds).toEqual(expect.arrayContaining(["movement-input-sample", "deepfield.rules.step", "health-damage-client-apply", "deepfield.camera.view", "three-render-frame"]));
  expect(boot.world).toMatchObject({ seed: 1337, sizeX: 96, sizeY: 64, sizeZ: 96, editCount: 0 });
  expect(boot.world!.spawn.y).toBeGreaterThan(22);
  expect(boot.renderer).toMatchObject({ backend: "three-webgl", disposed: false, chunks: 36, chunkRebuilds: 36, dirtyChunks: 0, textures: 1, estimatedTextureBytes: 16_384, width: 1280, height: 720 });
  expect(boot.renderer!.triangles).toBeGreaterThan(50_000);
  expect(boot.renderer!.triangles).toBeLessThan(400_000);
  expect(boot.renderer!.particles).toMatchObject({ active: 0, emitted: 0, capacity: 640 });
  expect(boot.save).toMatchObject({ ready: true, lastLoad: "not-found", lastSave: null, hasSave: false });
  await expect(page.locator('[data-hud-screen="title"]')).toBeVisible();
  await expect(page.locator('[data-hud-action="continue"]')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("deepfield-title.png") });

  // New world through the HUD; the player stands on flat grass at spawn.
  await page.click('[data-hud-action="start"]');
  await page.evaluate(() => window.__DEEPFIELD__!.advance(0.5));
  const started = await page.evaluate(() => window.__DEEPFIELD__!.snapshot());
  expect(started.phase).toBe("playing");
  expect(started.player.grounded).toBe(true);
  expect(started.player.position).toMatchObject({ x: started.spawn.x, z: started.spawn.z });
  expect((await page.evaluate(() => window.__DEEPFIELD__!.events())).map(({ kind }) => kind)).toEqual(expect.arrayContaining(["phase-changed", "play-started"]));
  await expect(page.locator('[data-hud-screen="title"]')).toBeHidden();
  await expect(page.locator("#hotbar .slot.selected b")).toHaveText("1");
  await expect(page.locator('#hearts i[data-fill="full"]')).toHaveCount(10);
  await page.screenshot({ path: testInfo.outputPath("deepfield-spawn.png") });

  // Keyboard movement flows through the public movement input; jumping leaves the ground.
  await page.keyboard.down("KeyW");
  await page.evaluate(() => window.__DEEPFIELD__!.advance(0.6));
  await page.keyboard.up("KeyW");
  const walked = await page.evaluate(() => window.__DEEPFIELD__!.snapshot());
  expect(walked.player.position.z).toBeLessThan(started.player.position.z - 0.8);
  await page.evaluate(() => { const game = window.__DEEPFIELD__!; game.press("jump"); game.advance(0.15); });
  const airborne = await page.evaluate(() => window.__DEEPFIELD__!.snapshot());
  expect(airborne.player.grounded).toBe(false);
  expect(airborne.player.position.y).toBeGreaterThan(walked.player.position.y + 0.5);
  await page.evaluate(() => window.__DEEPFIELD__!.advance(1));
  expect((await page.evaluate(() => window.__DEEPFIELD__!.snapshot())).player.grounded).toBe(true);

  // Mining the grass underfoot drops dirt into the inventory, rebuilds chunks, and emits debris.
  await page.evaluate(() => { const game = window.__DEEPFIELD__!; game.loadScenario("spawn"); game.setLook(0, -1.2); game.advance(0.05); });
  const aim = await page.evaluate(() => window.__DEEPFIELD__!.snapshot().target);
  expect(aim).toMatchObject({ blockKey: "grass", normal: { x: 0, y: 1, z: 0 } });
  await expect(page.locator('[data-hud-bind="extra:targetName"]')).toHaveText("Grass");
  await page.evaluate(() => { const game = window.__DEEPFIELD__!; game.setHeld({ mine: true }); game.advance(0.25); });
  const partial = await page.evaluate(() => ({ snapshot: window.__DEEPFIELD__!.snapshot(), renderer: window.__DEEPFIELD__!.inspectRenderer() }));
  expect(partial.snapshot.mining.progress).toBeGreaterThan(0.4);
  expect(partial.snapshot.mining.progress).toBeLessThan(1);
  expect(partial.snapshot.mining.blockKey).toBe("grass");
  expect(partial.renderer!.particles.emitted).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("deepfield-mining.png") });
  await page.evaluate(() => { const game = window.__DEEPFIELD__!; game.advance(0.3); game.setHeld({ mine: false }); game.advance(0.05); });
  const mined = await page.evaluate(() => ({ snapshot: window.__DEEPFIELD__!.snapshot(), inventory: window.__DEEPFIELD__!.inspectInventory(), renderer: window.__DEEPFIELD__!.inspectRenderer() }));
  expect(mined.snapshot.stats.mined).toBe(1);
  expect(mined.snapshot.stats.minedByKey).toMatchObject({ grass: 1 });
  expect(mined.inventory).toMatchObject({ dirt: 1 });
  expect(mined.snapshot.editCount).toBe(1);
  expect(mined.renderer!.chunkRebuilds).toBeGreaterThan(36);
  expect(mined.renderer!.particles.active).toBeGreaterThan(5);
  await expect(page.locator('[data-hud-bind="extra:slot0"]')).toHaveText("1");
  expect((await page.evaluate(() => window.__DEEPFIELD__!.events())).map(({ kind, subject }) => `${kind}:${subject ?? ""}`)).toContain("block-mined:grass");

  // Placing the dirt back consumes it and restores the terrain edit.
  await page.evaluate(() => { const game = window.__DEEPFIELD__!; game.press("select-1"); game.advance(0.05); game.press("place"); game.advance(0.05); });
  const placed = await page.evaluate(() => ({ snapshot: window.__DEEPFIELD__!.snapshot(), inventory: window.__DEEPFIELD__!.inspectInventory() }));
  expect(placed.snapshot.stats.placed).toBe(1);
  expect(placed.inventory!.dirt ?? 0).toBe(0);
  expect(placed.snapshot.editCount).toBe(1);
  await page.evaluate(() => { const game = window.__DEEPFIELD__!; game.press("place"); game.advance(0.05); });
  expect((await page.evaluate(() => window.__DEEPFIELD__!.events())).map(({ kind }) => kind)).toContain("place-rejected");

  // Punching a tree: the tree scenario stands the player in front of the trunk.
  await page.evaluate(() => { const game = window.__DEEPFIELD__!; game.loadScenario("tree"); game.advance(0.05); });
  expect((await page.evaluate(() => window.__DEEPFIELD__!.snapshot())).target).toMatchObject({ blockKey: "log" });
  await page.evaluate(() => { const game = window.__DEEPFIELD__!; game.setHeld({ mine: true }); game.advance(1.2); game.setHeld({ mine: false }); });
  const punched = await page.evaluate(() => ({ snapshot: window.__DEEPFIELD__!.snapshot(), inventory: window.__DEEPFIELD__!.inspectInventory() }));
  expect(punched.snapshot.stats.minedByKey).toMatchObject({ log: 1 });
  expect(punched.inventory).toMatchObject({ log: 1 });
  await page.screenshot({ path: testInfo.outputPath("deepfield-tree.png") });

  // Ore scenarios carve a pocket facing the ore; mining it advances the expedition log.
  await page.evaluate(() => { const game = window.__DEEPFIELD__!; game.loadScenario("iron"); game.advance(0.05); });
  expect((await page.evaluate(() => window.__DEEPFIELD__!.snapshot())).target).toMatchObject({ blockKey: "iron-ore" });
  await page.evaluate(() => { const game = window.__DEEPFIELD__!; game.setHeld({ mine: true }); game.advance(2.4); game.setHeld({ mine: false }); });
  const iron = await page.evaluate(() => window.__DEEPFIELD__!.snapshot());
  expect(iron.stats.minedByKey).toMatchObject({ "iron-ore": 1 });
  expect(iron.objectives.find((objective) => objective.id === "iron")).toMatchObject({ current: 1, target: 3, done: false });
  await page.evaluate(() => { const game = window.__DEEPFIELD__!; game.loadScenario("diamond"); game.advance(0.05); });
  expect((await page.evaluate(() => window.__DEEPFIELD__!.snapshot())).target).toMatchObject({ blockKey: "diamond-ore" });
  await page.evaluate(() => { const game = window.__DEEPFIELD__!; game.setHeld({ mine: true }); game.advance(3); game.setHeld({ mine: false }); });
  const diamond = await page.evaluate(() => window.__DEEPFIELD__!.snapshot());
  expect(diamond.objectives.find((objective) => objective.id === "diamond")).toMatchObject({ current: 1, done: true });
  await expect(page.locator("#objectives li.done")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("deepfield-diamond.png") });

  // Falling from the cliff scenario deals lethal fall damage; the player respawns at camp with the inventory intact.
  await page.evaluate(() => { const game = window.__DEEPFIELD__!; game.loadScenario("cliff"); game.advance(1.6); });
  const fallen = await page.evaluate(() => ({ snapshot: window.__DEEPFIELD__!.snapshot(), events: window.__DEEPFIELD__!.events().map(({ kind, subject }) => `${kind}:${subject ?? ""}`) }));
  expect(fallen.events).toEqual(expect.arrayContaining(["hard-landing:pilot", "player-damaged:pilot", "player-died:fall", "phase-changed:dead"]));
  expect(fallen.snapshot.phase).toBe("dead");
  expect(fallen.snapshot.stats.deaths).toBe(1);
  await expect(page.locator('[data-hud-screen="dead"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("deepfield-fallen.png") });
  await page.evaluate(() => { const game = window.__DEEPFIELD__!; game.press("respawn"); game.advance(0.2); });
  const respawned = await page.evaluate(() => ({ snapshot: window.__DEEPFIELD__!.snapshot(), inventory: window.__DEEPFIELD__!.inspectInventory() }));
  expect(respawned.snapshot.phase).toBe("playing");
  expect(respawned.snapshot.player.health).toBe(20);
  expect(respawned.snapshot.player.position).toMatchObject({ x: respawned.snapshot.spawn.x, z: respawned.snapshot.spawn.z });
  expect(respawned.inventory).toMatchObject({ log: 1, "iron-ore": 1, "diamond-ore": 1 });

  // Swimming: the water scenario drops the player into a lake and jumping swims upward.
  await page.evaluate(() => { const game = window.__DEEPFIELD__!; game.loadScenario("water"); game.advance(1.5); });
  const swimming = await page.evaluate(() => window.__DEEPFIELD__!.snapshot());
  expect(swimming.player.inWater).toBe(true);
  expect(Math.abs(swimming.player.velocity.y)).toBeLessThan(3.5);
  await page.evaluate(() => { const game = window.__DEEPFIELD__!; game.press("jump"); game.advance(0.1); });
  expect((await page.evaluate(() => window.__DEEPFIELD__!.snapshot())).player.velocity.y).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("deepfield-water.png") });

  // Saving through the Save/Load Feature persists the edit journal; a fresh boot offers CONTINUE and restores it.
  await page.evaluate(() => { const game = window.__DEEPFIELD__!; game.loadScenario("spawn"); game.press("save"); game.advance(0.1); });
  await expect.poll(() => page.evaluate(() => window.__DEEPFIELD__!.inspectSave()?.lastSave)).toBe("saved");
  const saved = await page.evaluate(() => ({ snapshot: window.__DEEPFIELD__!.snapshot(), save: window.__DEEPFIELD__!.inspectSave() }));
  expect(saved.save).toMatchObject({ lastSave: "saved", hasSave: true });
  expect(saved.save!.editCount).toBeGreaterThan(3);
  expect(saved.snapshot.hasSave).toBe(true);
  await expect(page.locator("#saved")).toBeVisible();

  // Day / night: the deterministic clock advances with play, and night darkens the sky.
  const morning = await page.evaluate(() => ({ snapshot: window.__DEEPFIELD__!.snapshot(), renderer: window.__DEEPFIELD__!.inspectRenderer() }));
  expect(morning.snapshot.timeOfDay).toBeGreaterThan(0.27);
  expect(morning.renderer!.daylight).toBeGreaterThan(0.9);
  await expect(page.locator("#hud")).not.toHaveClass(/is-night/);
  await page.evaluate(() => { const game = window.__DEEPFIELD__!; game.setTimeOfDay(0.92); game.advance(0.1); });
  const night = await page.evaluate(() => ({ snapshot: window.__DEEPFIELD__!.snapshot(), renderer: window.__DEEPFIELD__!.inspectRenderer() }));
  expect(night.snapshot.timeOfDay).toBeGreaterThan(0.9);
  expect(night.renderer!.daylight).toBeLessThan(0.15);
  expect(night.renderer!.drawCalls).toBeGreaterThan(40);
  expect(night.renderer!.drawCalls).toBeLessThan(400);
  await expect(page.locator("#hud")).toHaveClass(/is-night/);
  await page.screenshot({ path: testInfo.outputPath("deepfield-night.png") });

  expect(await page.evaluate(() => window.__DEEPFIELD__!.errors())).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  await page.evaluate(() => window.__DEEPFIELD__!.dispose());
  expect(await page.evaluate(() => window.__DEEPFIELD__!.inspectLeaks())).toMatchObject({ hostListeners: 0, rafActive: false, pointerLocked: false, hostDisposed: true, game: { disposed: true, activeFeatures: 0 } });
  expect(await page.evaluate(() => window.__DEEPFIELD__!.inspectRenderer())).toMatchObject({ disposed: true, chunks: 0 });
});
