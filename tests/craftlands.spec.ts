import { expect, test } from "@playwright/test";

type Handle = NonNullable<Window["__CRAFTLANDS__"]>;
declare global { function game(): Handle; }

test("Craftlands runs a deterministic public-Feature survival sandbox", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/showcases/craftlands/index.html?test=1&distance=3");
  await expect.poll(() => page.evaluate(() => window.__CRAFTLANDS__?.ready), { timeout: 60_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__CRAFTLANDS__?.screenshotReady)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__CRAFTLANDS__?.inspectSave()?.ready)).toBe(true);
  await page.evaluate(() => { Object.assign(window, { game: () => window.__CRAFTLANDS__! }); });

  // --- Boot: title screen, public Feature composition, runtime-painted atlas, streamed chunks ---
  const boot = await page.evaluate(() => ({ snapshot: game().snapshot(), runtime: game().inspectRuntime(), renderer: game().inspectRenderer(), world: game().inspectWorld(), save: game().inspectSave() }));
  expect(boot.snapshot).toMatchObject({ phase: "title", mode: "survival", seed: 8_675_309, hasSave: false, editCount: 0, selectedSlot: 0 });
  expect(boot.snapshot.player).toMatchObject({ health: 20, maximumHealth: 20, hunger: 20 });
  expect(await page.evaluate(() => Object.isFrozen(game().snapshot().player))).toBe(true);
  expect(boot.runtime).toMatchObject({ lifecycleState: "running", debugProviders: ["player", "world"] });
  expect(boot.runtime!.installedFeatureIds).toEqual(["movement-input", "craftlands.rules", "health-damage.client", "game-flow.client", "save-load.client", "ui-hud", "debug-devtools.client", "audio", "craftlands.camera", "particles", "three-rendering"]);
  expect(boot.runtime!.scheduleSystemIds).toEqual(expect.arrayContaining(["movement-input-sample", "craftlands.rules.step", "health-damage-client-apply", "craftlands.camera.view", "three-render-frame"]));
  expect(boot.world).toMatchObject({ seed: 8_675_309, editCount: 0, simulationDistance: 3 });
  expect(boot.world!.loadedChunks).toBe(49);
  expect(boot.renderer).toMatchObject({ backend: "three-webgl", disposed: false, chunks: 49, dirtyChunks: 0, textures: 1, estimatedTextureBytes: 262_144, width: 1280, height: 720, renderDistance: 3 });
  expect(boot.renderer!.triangles).toBeGreaterThan(100_000);
  expect(boot.save).toMatchObject({ ready: true, lastLoad: "not-found", lastSave: null, hasSave: false });
  await expect(page.locator('[data-hud-screen="title"]')).toBeVisible();
  await expect(page.locator('.title [data-hud-action="continue"]')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("craftlands-title.png") });

  // --- New world: spawn on grass with passive mobs nearby ---
  await page.click('[data-hud-action="start"]');
  await page.evaluate(() => game().advance(1));
  const started = await page.evaluate(() => game().snapshot());
  expect(started.phase).toBe("playing");
  expect(started.player.grounded).toBe(true);
  expect(started.biome).not.toBe("Ocean");
  expect(started.mobs.length).toBeGreaterThan(0);
  expect(started.mobs.every((mob) => ["pig", "cow", "sheep", "chicken"].includes(mob.kind))).toBe(true);
  await expect(page.locator('[data-hud-screen="title"]')).toBeHidden();
  await expect(page.locator("#hotbar .slot.selected")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("craftlands-spawn.png") });

  // --- Movement, sprint FOV, jumping through the public movement input ---
  await page.keyboard.down("KeyW");
  await page.evaluate(() => game().advance(0.6));
  await page.keyboard.up("KeyW");
  const walked = await page.evaluate(() => game().snapshot());
  expect(walked.player.position.z).toBeLessThan(started.player.position.z - 0.8);
  expect((await page.evaluate(() => game().events())).some((event) => event.kind === "step" && event.subject === "grass")).toBe(true);
  await page.evaluate(() => { game().press("jump"); game().advance(0.15); });
  expect((await page.evaluate(() => game().snapshot())).player.grounded).toBe(false);
  await page.evaluate(() => game().advance(1));
  expect((await page.evaluate(() => game().snapshot())).player.grounded).toBe(true);
  await page.evaluate(() => { game().setMove(0, -1); game().setHeld({ sprint: true }); game().advance(0.5); });
  expect((await page.evaluate(() => game().snapshot())).player.sprinting).toBe(true);
  expect((await page.evaluate(() => game().inspectRenderer()!.fov))).toBeGreaterThan(75);
  await page.evaluate(() => { game().setMove(0, 0); game().setHeld({ sprint: false, sneak: true }); game().advance(0.1); });
  expect((await page.evaluate(() => game().snapshot())).player).toMatchObject({ sneaking: true, eyeHeight: 1.27 });
  await page.evaluate(() => { game().setHeld({ sneak: false }); game().advance(0.1); });

  // --- Punch a tree: Minecraft mining formula (oak log by hand ≈ 3 s), item entity, pickup ---
  await page.evaluate(() => { game().loadScenario("tree"); game().advance(0.1); });
  expect((await page.evaluate(() => game().snapshot())).target).toMatchObject({ blockKey: "oak_log" });
  await expect(page.locator("#status")).toContainText("Oak Log");
  await page.evaluate(() => { game().setHeld({ attack: true }); game().advance(1.5); });
  const partial = await page.evaluate(() => ({ snapshot: game().snapshot(), renderer: game().inspectRenderer() }));
  expect(partial.snapshot.mining.progress).toBeGreaterThan(0.3);
  expect(partial.snapshot.mining.progress).toBeLessThan(0.8);
  expect(partial.renderer!.particles.emitted).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("craftlands-mining.png") });
  await page.evaluate(() => { game().advance(1.7); game().setHeld({ attack: false }); game().advance(0.3); });
  const mined = await page.evaluate(() => ({ snapshot: game().snapshot(), renderer: game().inspectRenderer() }));
  expect(mined.snapshot.stats.minedByKey).toMatchObject({ oak_log: 1 });
  expect(mined.snapshot.items.length).toBe(1);
  expect(mined.snapshot.items[0]).toMatchObject({ key: "oak_log", count: 1 });
  expect(mined.renderer!.itemEntities).toBe(1);
  expect(mined.snapshot.editCount).toBeGreaterThanOrEqual(1);
  for (let index = 0; index < 3; index += 1) {
    await page.evaluate(() => { const s = game().snapshot(); game().setLook(s.player.yaw, s.player.pitch + 0.35); game().advance(0.05); game().setHeld({ attack: true }); game().advance(3.2); game().setHeld({ attack: false }); game().advance(0.3); });
  }
  await page.evaluate(() => { game().setLook(game().snapshot().player.yaw, 0); game().setMove(0, -1); game().advance(1.5); game().setMove(0, 0); game().advance(0.5); });
  expect(await page.evaluate(() => game().inspectInventory())).toMatchObject({ oak_log: 4 });
  expect((await page.evaluate(() => game().events())).map(({ kind }) => kind)).toContain("item-collected");
  await expect(page.locator("#hotbar .slot").first().locator("span")).toHaveText("4");

  // --- 2 × 2 crafting: planks, sticks, crafting table; shift-click crafts the maximum ---
  await page.evaluate(() => { game().press("inventory"); game().advance(0.05); });
  expect((await page.evaluate(() => game().snapshot())).screen).toBe("inventory");
  await expect(page.locator("#panel")).toBeVisible();
  await page.evaluate(() => { const i = game().snapshot().inventory.findIndex((s) => s?.key === "oak_log"); game().clickSlot("inventory", i, "left"); game().clickSlot("craft", 0, "left"); game().advance(0.05); });
  expect((await page.evaluate(() => game().snapshot())).craftResult).toMatchObject({ key: "planks", count: 4 });
  await page.evaluate(() => { game().clickSlot("craft-result", 0, "left", true); game().advance(0.05); });
  expect(await page.evaluate(() => game().inspectInventory())).toMatchObject({ planks: 16 });
  await page.evaluate(() => { const i = game().snapshot().inventory.findIndex((s) => s?.key === "planks"); game().clickSlot("inventory", i, "left"); game().clickSlot("craft", 0, "right"); game().clickSlot("craft", 3, "right"); game().advance(0.05); });
  expect((await page.evaluate(() => game().snapshot())).craftResult).toMatchObject({ key: "stick", count: 4 });
  await page.evaluate(() => { game().clickSlot("craft-result", 0, "left", true); game().clickSlot("craft", 0, "right"); game().clickSlot("craft", 1, "right"); game().clickSlot("craft", 3, "right"); game().clickSlot("craft", 4, "right"); game().advance(0.05); });
  expect((await page.evaluate(() => game().snapshot())).craftResult).toMatchObject({ key: "crafting_table", count: 1 });
  await page.screenshot({ path: testInfo.outputPath("craftlands-crafting.png") });
  await page.evaluate(() => { game().clickSlot("craft-result", 0, "left", true); const s = game().snapshot(); if (s.cursor !== null) game().clickSlot("inventory", s.inventory.findIndex((x) => x === null), "left"); game().press("inventory"); game().advance(0.05); });
  const crafted = await page.evaluate(() => ({ inventory: game().inspectInventory(), snapshot: game().snapshot() }));
  expect(crafted.inventory).toMatchObject({ stick: 4, crafting_table: 1, planks: 10 });
  expect(crafted.snapshot.screen).toBe("none");
  expect(crafted.snapshot.stats.crafted).toBe(6);

  // --- Place the table, open the 3 × 3 grid, craft a wooden pickaxe, mine stone with it ---
  await page.evaluate(() => { game().loadScenario("spawn"); const slot = game().snapshot().inventory.findIndex((x) => x?.key === "crafting_table"); game().press(`select-${slot + 1}` as never); game().setLook(0, -0.9); game().advance(0.05); game().setHeld({ use: true }); game().advance(0.05); game().setHeld({ use: false }); game().advance(0.05); });
  expect((await page.evaluate(() => game().snapshot())).target).toMatchObject({ blockKey: "crafting_table" });
  await page.evaluate(() => { game().press("select-1"); game().setHeld({ use: true }); game().advance(0.05); game().setHeld({ use: false }); game().advance(0.05); });
  expect((await page.evaluate(() => game().snapshot())).screen).toBe("crafting");
  await page.evaluate(() => {
    const g = game();
    const place = (key: string, cells: number[]): void => { const from = g.snapshot().inventory.findIndex((x) => x?.key === key); g.clickSlot("inventory", from, "left"); for (const cell of cells) g.clickSlot("craft", cell, "right"); const s = g.snapshot(); if (s.cursor !== null) g.clickSlot("inventory", s.inventory.findIndex((x) => x === null), "left"); };
    place("planks", [0, 1, 2]);
    place("stick", [4, 7]);
    g.advance(0.05);
  });
  expect((await page.evaluate(() => game().snapshot())).craftResult).toMatchObject({ key: "wooden_pickaxe", count: 1 });
  await page.evaluate(() => { game().clickSlot("craft-result", 0, "left", true); game().press("escape"); game().advance(0.05); });
  expect(await page.evaluate(() => game().inspectInventory())).toMatchObject({ wooden_pickaxe: 1, stick: 2, planks: 7 });
  await page.evaluate(() => { game().loadScenario("stone"); const slot = game().snapshot().inventory.findIndex((x) => x?.key === "wooden_pickaxe"); game().press(`select-${slot + 1}` as never); game().advance(0.05); });
  expect((await page.evaluate(() => game().snapshot())).target).toMatchObject({ blockKey: "stone" });
  await page.evaluate(() => { game().setHeld({ attack: true }); game().advance(1.3); game().setHeld({ attack: false }); game().advance(0.3); });
  const stone = await page.evaluate(() => game().snapshot());
  expect(stone.stats.minedByKey).toMatchObject({ stone: 1 });
  expect(stone.items.some((item) => item.key === "cobblestone")).toBe(true);
  expect(stone.inventory.find((slot) => slot?.key === "wooden_pickaxe")?.damage).toBe(1);

  // --- Furnace: shift-click ore and coal in, smelt an ingot, take it out ---
  await page.evaluate(() => { game().loadScenario("furnace"); game().setHeld({ use: true }); game().advance(0.05); game().setHeld({ use: false }); game().advance(0.05); });
  expect((await page.evaluate(() => game().snapshot())).screen).toBe("furnace");
  await page.evaluate(() => { const s = game().snapshot(); game().clickSlot("inventory", s.inventory.findIndex((x) => x?.key === "iron_ore"), "left", true); game().clickSlot("inventory", s.inventory.findIndex((x) => x?.key === "coal"), "left", true); game().advance(0.2); });
  const furnace = await page.evaluate(() => game().snapshot().furnace);
  expect(furnace).toMatchObject({ input: { key: "iron_ore", count: 4 }, fuel: { key: "coal", count: 3 }, output: null });
  expect(furnace!.burnFraction).toBeGreaterThan(0.9);
  await page.screenshot({ path: testInfo.outputPath("craftlands-furnace.png") });
  await page.evaluate(() => game().advance(10.5));
  expect((await page.evaluate(() => game().snapshot())).furnace).toMatchObject({ input: { count: 3 }, output: { key: "iron_ingot", count: 1 } });
  expect(await page.evaluate(() => game().inspectWorld().blockEntities)).toBe(1);
  await page.evaluate(() => { game().clickSlot("furnace-output", 0, "left", true); game().press("escape"); game().advance(0.05); });
  expect(await page.evaluate(() => game().inspectInventory())).toMatchObject({ iron_ingot: 1 });
  expect((await page.evaluate(() => game().events())).map(({ kind }) => kind)).toContain("smelted");

  // --- Torch light: flood-fill block light brightens the placed spot ---
  await page.evaluate(() => { game().loadScenario("cave"); game().give("torch", 1); const slot = game().snapshot().inventory.findIndex((x) => x?.key === "torch"); game().press(`select-${slot + 1}` as never); game().setLook(0, -1.2); game().advance(0.05); });
  const dark = await page.evaluate(() => { const p = game().snapshot().player.position; return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), light: game().snapshot().target }; });
  expect(dark.light).toMatchObject({ blockKey: "stone" });
  await page.evaluate(() => { game().setHeld({ use: true }); game().advance(0.05); game().setHeld({ use: false }); game().advance(0.1); });
  const lit = await page.evaluate(() => ({ target: game().snapshot().target, events: game().events().map(({ kind, subject }) => `${kind}:${subject ?? ""}`) }));
  expect(lit.events).toContain("block-placed:torch");
  await page.screenshot({ path: testInfo.outputPath("craftlands-torch.png") });

  // --- Hostile mobs attack at night; swords damage them; XP flows ---
  await page.evaluate(() => { game().loadScenario("mobs"); game().setTimeOfDay(0.85); game().advance(0.1); });
  expect((await page.evaluate(() => game().inspectRenderer()!.stars.visible))).toBe(true);
  const hostiles = await page.evaluate(() => game().snapshot().mobs.filter((mob) => mob.kind === "zombie").length);
  expect(hostiles).toBeGreaterThanOrEqual(1);
  await page.evaluate(() => game().advance(4));
  const bitten = await page.evaluate(() => ({ health: game().snapshot().player.health, events: game().events().map(({ kind }) => kind) }));
  expect(bitten.health).toBeLessThan(20);
  expect(bitten.events).toContain("mob-attack");
  await page.evaluate(() => { game().give("diamond_sword", 1); const slot = game().snapshot().inventory.findIndex((x) => x?.key === "diamond_sword"); game().press(`select-${slot + 1}` as never); game().setMode("creative"); game().advance(0.05); });
  await page.evaluate(() => {
    for (let swing = 0; swing < 12; swing += 1) {
      const s = game().snapshot();
      const zombie = s.mobs.find((mob) => mob.kind === "zombie" && mob.deadTicks === 0);
      if (zombie === undefined) break;
      const eye = { x: s.player.position.x, y: s.player.position.y + s.player.eyeHeight, z: s.player.position.z };
      const dx = zombie.position.x - eye.x; const dy = zombie.position.y + 1 - eye.y; const dz = zombie.position.z - eye.z;
      game().setLook(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
      game().setHeld({ attack: true }); game().advance(0.05); game().setHeld({ attack: false }); game().advance(0.6);
    }
  });
  const fought = await page.evaluate(() => ({ snapshot: game().snapshot(), events: game().events().map(({ kind }) => kind) }));
  expect(fought.events).toContain("attack");
  expect(fought.events).toContain("mob-killed");
  expect(fought.snapshot.stats.kills).toBeGreaterThanOrEqual(1);
  expect(fought.snapshot.player.xp + fought.snapshot.player.level).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("craftlands-night.png") });

  // --- Creative flight, third person, debug overlay, chat commands ---
  await page.evaluate(() => { game().press("fly-toggle"); game().advance(0.05); game().press("jump"); game().advance(0.5); });
  expect((await page.evaluate(() => game().snapshot())).player.flying).toBe(true);
  await page.evaluate(() => { game().press("toggle-perspective"); game().press("toggle-debug"); game().advance(0.05); });
  expect(await page.evaluate(() => game().inspectRenderer()!.thirdPerson)).toBe(true);
  await expect(page.locator("#debug")).toBeVisible();
  await expect(page.locator("#debug")).toContainText("XYZ:");
  await page.screenshot({ path: testInfo.outputPath("craftlands-third-person.png") });
  await page.evaluate(() => { game().press("toggle-perspective"); game().press("toggle-debug"); game().command("/time set day"); game().command("/gamemode survival"); game().advance(0.1); });
  const commanded = await page.evaluate(() => game().snapshot());
  expect(commanded.mode).toBe("survival");
  expect(commanded.chatLog.some((line) => line.startsWith("Set the time"))).toBe(true);
  expect(commanded.timeOfDay).toBeCloseTo(0.28, 2);

  // --- Save, quit to title, continue restores inventory and edits ---
  await page.evaluate(() => { game().press("save"); game().advance(0.2); });
  await expect.poll(() => page.evaluate(() => game().inspectSave().lastSave)).toBe("saved");
  const before = await page.evaluate(() => ({ inventory: game().inspectInventory(), edits: game().inspectWorld().editCount }));
  expect(before.edits).toBeGreaterThan(5);
  await page.evaluate(() => { game().press("escape"); game().advance(0.05); game().press("quit"); game().advance(0.3); });
  expect((await page.evaluate(() => game().snapshot())).phase).toBe("title");
  await expect(page.locator('.title [data-hud-action="continue"]')).toBeVisible();
  await page.click('.title [data-hud-action="continue"]');
  await page.evaluate(() => game().advance(0.3));
  const restored = await page.evaluate(() => ({ phase: game().snapshot().phase, inventory: game().inspectInventory(), edits: game().inspectWorld().editCount }));
  expect(restored.phase).toBe("playing");
  expect(restored.inventory).toEqual(before.inventory);
  expect(restored.edits).toBe(before.edits);

  // --- Death scatters the inventory; respawn returns to spawn with full health ---
  await page.evaluate(() => { game().command("/kill"); game().advance(0.2); });
  expect((await page.evaluate(() => game().snapshot())).phase).toBe("dead");
  await expect(page.locator('[data-hud-screen="dead"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("craftlands-dead.png") });
  await page.click('[data-hud-action="respawn"]');
  await page.evaluate(() => game().advance(0.5));
  const respawned = await page.evaluate(() => game().snapshot());
  expect(respawned.phase).toBe("playing");
  expect(respawned.player.health).toBe(20);
  expect(respawned.player.position).toMatchObject({ x: respawned.spawn.x, z: respawned.spawn.z });

  // --- Disposal releases listeners, features, meshes ---
  expect(consoleErrors.filter((text) => !text.includes("GL Driver"))).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(JSON.stringify(await page.evaluate(() => game().errors()), null, 1)).toBe("[]");
  await page.evaluate(() => game().dispose());
  const leaks = await page.evaluate(() => ({ leaks: game().inspectLeaks(), renderer: game().inspectRenderer() }));
  expect(leaks.leaks).toMatchObject({ hostListeners: 0, rafActive: false, pointerLocked: false, hostDisposed: true, game: { activeListeners: 0, activeFeatures: 0, disposed: true } });
  expect(leaks.renderer).toMatchObject({ disposed: true, chunks: 0 });
});
