import { expect, test } from "@playwright/test";

test("Afterglow runs a deterministic public-Feature neon sprint", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/showcases/afterglow/index.html?test=1");
  await expect.poll(() => page.evaluate(() => window.__AFTERGLOW__?.ready)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__AFTERGLOW__?.screenshotReady)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__AFTERGLOW__?.inspectSave()?.ready)).toBe(true);

  const boot = await page.evaluate(() => ({
    snapshot: window.__AFTERGLOW__!.snapshot(),
    runtime: window.__AFTERGLOW__!.inspectRuntime(),
    renderer: window.__AFTERGLOW__!.inspectRenderer(),
    save: window.__AFTERGLOW__!.inspectSave(),
  }));
  expect(boot.snapshot).toMatchObject({ phase: "title", deaths: 0, checkpointsPassed: 0, checkpointCount: 4, bestTimeSeconds: null, ghost: null });
  expect(boot.snapshot.trackLength).toBeGreaterThan(1400);
  expect(boot.snapshot.car).toMatchObject({ s: 0, x: 0, h: 0, speed: 0, alive: true, grounded: true });
  expect(await page.evaluate(() => Object.isFrozen(window.__AFTERGLOW__!.snapshot().car))).toBe(true);
  expect(boot.runtime).toMatchObject({ lifecycleState: "running", inputContext: "menu", cameraVariant: "orbit", vehicle: { speed: 0, driver: "pilot" } });
  expect(boot.runtime!.installedFeatureIds).toEqual([
    "input-experience-extensions", "afterglow.controls", "vehicles.client", "afterglow.rules", "trigger-area.client",
    "game-flow.client", "save-load.client", "ui-hud", "camera-extensions", "vfx", "three-rendering", "post-processing",
  ]);
  expect(boot.runtime!.scheduleSystemIds).toEqual(expect.arrayContaining(["input-experience-sample", "vehicles-client-step", "afterglow.rules.step", "camera-extensions-view", "post-processing-render"]));
  expect(boot.renderer).toMatchObject({ backend: "three-webgl", disposed: false, estimatedTextureBytes: 0, width: 1280, height: 720 });
  expect(boot.renderer!.composer).toMatchObject({ passIds: ["scene", "bloom", "chroma", "vignette", "output"], enabledPassIds: ["scene", "bloom", "chroma", "vignette", "output"] });
  expect(boot.renderer!.composer.renderCount).toBeGreaterThan(0);
  expect(boot.renderer!.meshes).toBeGreaterThan(100);
  expect(boot.renderer!.triangles).toBeGreaterThan(5_000);
  expect(boot.renderer!.triangles).toBeLessThan(60_000);
  expect(boot.save).toMatchObject({ ready: true, lastLoad: "not-found", lastSave: null, bestTimeMs: null, ghostSamples: 0 });
  await expect(page.locator('[data-hud-screen="title"]')).toBeVisible();
  await expect(page.locator('[data-hud-screen="results"]')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("afterglow-title.png") });

  // Launch: countdown then running, driven only through public semantic input.
  await page.click('[data-hud-action="start"]');
  await page.evaluate(() => window.__AFTERGLOW__!.advance(0.5));
  expect(await page.evaluate(() => window.__AFTERGLOW__!.snapshot().phase)).toBe("countdown");
  expect(await page.evaluate(() => window.__AFTERGLOW__!.inspectRuntime()!.inputContext)).toBe("drive");
  await expect(page.locator('[data-hud-screen="countdown"]')).toBeVisible();
  await page.evaluate(() => { const game = window.__AFTERGLOW__!; game.advance(1.2); game.setInput({ throttle: true }); game.advance(4); });
  const drive = await page.evaluate(() => ({ snapshot: window.__AFTERGLOW__!.snapshot(), renderer: window.__AFTERGLOW__!.inspectRenderer(), runtime: window.__AFTERGLOW__!.inspectRuntime() }));
  expect(drive.snapshot.phase).toBe("running");
  expect(drive.snapshot.car.s).toBeGreaterThan(120);
  expect(drive.snapshot.car.speed).toBeGreaterThan(40);
  expect(drive.snapshot.car.alive).toBe(true);
  expect(drive.snapshot.cue).toMatchObject({ kind: "pillar", label: "PILLARS · WEAVE" });
  expect(drive.runtime!.vehicle.speed).toBeCloseTo(drive.snapshot.car.speed, 5);
  expect(drive.renderer!.trailPoints).toBeGreaterThan(30);
  const driveVfx = (await page.evaluate(() => window.__AFTERGLOW__!.inspectVfx()))!;
  expect(driveVfx.disposed).toBe(false);
  expect(driveVfx.counters.submittedCommandCount).toBeGreaterThan(60);
  expect(driveVfx.counters.commandOverflowCount).toBe(0);
  expect(driveVfx.activeTrailCount + driveVfx.activeBurstCount).toBeGreaterThan(4);
  expect(drive.renderer!.drawCalls).toBeGreaterThan(50);
  expect(drive.renderer!.drawCalls).toBeLessThan(400);
  expect((await page.evaluate(() => window.__AFTERGLOW__!.events())).map(({ kind }) => kind)).toEqual(expect.arrayContaining(["countdown-started", "run-started", "boost-pad", "cue-changed"]));
  await expect(page.locator('[data-hud-bind="extra:cue"]')).toHaveText("PILLARS · WEAVE");
  await expect(page.locator('[data-hud-bind="extra:checkpoints"]').first()).toHaveText("0/4");
  await page.screenshot({ path: testInfo.outputPath("afterglow-drive.png") });

  // Keyboard steering flows through the input-experience runtime.
  await page.keyboard.down("KeyD");
  await page.evaluate(() => window.__AFTERGLOW__!.advance(0.5));
  await page.keyboard.up("KeyD");
  const steered = await page.evaluate(() => window.__AFTERGLOW__!.snapshot());
  expect(steered.car.x).toBeGreaterThan(1);
  expect(steered.car.steering).toBeGreaterThan(0.5);
  await page.evaluate(() => { const game = window.__AFTERGLOW__!; game.setInput({ steer: -1 }); game.advance(0.35); game.setInput({ steer: 0 }); game.advance(0.3); });
  const recentred = await page.evaluate(() => window.__AFTERGLOW__!.snapshot());
  expect(recentred.car.x).toBeLessThan(steered.car.x);
  expect(recentred.car.alive).toBe(true);
  expect(recentred.deaths).toBe(0);

  // Boost raises speed, heat, and the camera zoom / FOV.
  await page.evaluate(() => { const game = window.__AFTERGLOW__!; game.loadScenario("start"); game.setInput({ throttle: true, steer: 0 }); game.advance(1); });
  const fovBefore = (await page.evaluate(() => window.__AFTERGLOW__!.inspectRenderer()))!.fov;
  await page.evaluate(() => { const game = window.__AFTERGLOW__!; game.setInput({ boost: true }); game.advance(1.2); });
  const boosted = await page.evaluate(() => ({ snapshot: window.__AFTERGLOW__!.snapshot(), renderer: window.__AFTERGLOW__!.inspectRenderer() }));
  expect(boosted.snapshot.car.boosting).toBe(true);
  expect(boosted.snapshot.car.heat).toBeGreaterThan(0.4);
  expect(boosted.snapshot.car.speed).toBeGreaterThan(45);
  expect(boosted.renderer!.fov).toBeGreaterThan(fovBefore);
  expect(boosted.renderer!.effects.chromaAmount).toBeGreaterThan(0.0012);
  expect(boosted.renderer!.effects.vignetteDarkness).toBe(1);
  expect(boosted.renderer!.effects.vignetteOffset).toBeGreaterThan(1);
  expect((await page.evaluate(() => window.__AFTERGLOW__!.events())).map(({ kind }) => kind)).toContain("boost-started");
  await page.screenshot({ path: testInfo.outputPath("afterglow-boost.png") });
  await page.evaluate(() => { const game = window.__AFTERGLOW__!; game.setInput({ boost: false }); game.advance(0.5); });
  expect((await page.evaluate(() => window.__AFTERGLOW__!.snapshot())).car.heat).toBeLessThan(boosted.snapshot.car.heat);

  // Overheat destroys the car and respawns it at the last checkpoint (the start).
  await page.evaluate(() => { const game = window.__AFTERGLOW__!; game.loadScenario("start"); game.setInput({ throttle: true, boost: true }); game.advance(3); });
  const overheated = await page.evaluate(() => ({ snapshot: window.__AFTERGLOW__!.snapshot(), events: window.__AFTERGLOW__!.events().map(({ kind, subject }) => `${kind}:${subject ?? ""}`) }));
  expect(overheated.events).toEqual(expect.arrayContaining(["crashed:overheat", "respawned:start"]));
  expect(overheated.snapshot.deaths).toBe(1);
  await page.evaluate(() => window.__AFTERGLOW__!.setInput({ boost: false }));

  // A low laser without a jump is fatal; the respawn returns to the start checkpoint.
  await page.evaluate(() => { const game = window.__AFTERGLOW__!; game.loadScenario("laser"); game.setInput({ throttle: true }); while (game.snapshot().car.alive && game.snapshot().car.s < 320) game.advance(1 / 60); });
  const crashed = await page.evaluate(() => window.__AFTERGLOW__!.snapshot());
  expect(crashed.car).toMatchObject({ alive: false, deathCause: "laser" });
  expect(crashed.deaths).toBe(2);
  const crashRenderer = (await page.evaluate(() => window.__AFTERGLOW__!.inspectRenderer()))!;
  expect(crashRenderer.effects.crashFlash).toBeGreaterThan(0.05);
  expect(crashRenderer.effects.bloomStrength).toBeGreaterThan(0.5);
  const crashVfx = (await page.evaluate(() => window.__AFTERGLOW__!.inspectVfx()))!;
  expect(crashVfx.activeBurstCount).toBeGreaterThan(2);
  expect(crashVfx.activeTrailCount).toBeGreaterThan(6);
  await expect(page.locator("#crash")).toBeVisible();
  await expect(page.locator("#toast")).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("afterglow-crash.png") });
  await page.evaluate(() => window.__AFTERGLOW__!.advance(1));
  const respawned = await page.evaluate(() => window.__AFTERGLOW__!.snapshot());
  expect(respawned.car.alive).toBe(true);
  expect(respawned.car.s).toBeLessThan(120);
  await expect(page.locator("#crash")).toBeHidden();

  // Jumping over the same laser clears it and reaches checkpoint 1.
  await page.evaluate(() => { const game = window.__AFTERGLOW__!; game.loadScenario("laser"); game.setInput({ throttle: true }); while (game.snapshot().car.s < 290) game.advance(1 / 60); game.press("jump"); game.advance(1.4); });
  const cleared = await page.evaluate(() => ({ snapshot: window.__AFTERGLOW__!.snapshot(), events: window.__AFTERGLOW__!.events().slice(-16).map(({ kind, subject }) => `${kind}:${subject ?? ""}`) }));
  expect(cleared.events).toEqual(expect.arrayContaining(["jumped:pilot", "gate-cleared:gate-1", "landed:pilot", "checkpoint:checkpoint-1"]));
  expect(cleared.snapshot).toMatchObject({ checkpointsPassed: 1, deaths: 2 });
  expect(cleared.snapshot.car.alive).toBe(true);
  await expect(page.locator('[data-hud-bind="extra:checkpoints"]').first()).toHaveText("1/4");

  // Driving into a gap without jumping falls; the respawn uses checkpoint 1.
  await page.evaluate(() => { const game = window.__AFTERGLOW__!; game.loadScenario("gap"); game.setInput({ throttle: true }); game.advance(3.2); });
  const fell = await page.evaluate(() => ({ snapshot: window.__AFTERGLOW__!.snapshot(), events: window.__AFTERGLOW__!.events().slice(-24).map(({ kind, subject }) => `${kind}:${subject ?? ""}`) }));
  expect(fell.events).toEqual(expect.arrayContaining(["left-road:gap-1", "crashed:fall", "respawned:checkpoint-1"]));
  expect(fell.snapshot.deaths).toBe(3);

  // Jumping the gap keeps the run alive.
  await page.evaluate(() => { const game = window.__AFTERGLOW__!; game.loadScenario("gap"); game.setInput({ throttle: true }); while (game.snapshot().car.s < 410) game.advance(1 / 60); game.press("jump"); game.advance(1.4); });
  const jumped = await page.evaluate(() => ({ snapshot: window.__AFTERGLOW__!.snapshot(), events: window.__AFTERGLOW__!.events().slice(-10).map(({ kind }) => kind) }));
  expect(jumped.snapshot.car.alive).toBe(true);
  expect(jumped.snapshot.car.s).toBeGreaterThan(436);
  expect(jumped.snapshot.deaths).toBe(3);
  expect(jumped.events).not.toContain("crashed");

  // Threading the pillar slalom close to the posts awards near misses without a crash.
  const slalomStart = await page.evaluate(() => window.__AFTERGLOW__!.events().length);
  await page.evaluate(() => { const game = window.__AFTERGLOW__!; game.loadScenario("slalom"); game.setInput({ throttle: true, steer: 0 }); game.advance(2.6); });
  const slalom = await page.evaluate((start) => ({ snapshot: window.__AFTERGLOW__!.snapshot(), events: window.__AFTERGLOW__!.events().slice(start).map(({ kind, subject }) => `${kind}:${subject ?? ""}`) }), slalomStart);
  expect(slalom.events).toEqual(expect.arrayContaining(["near-miss:pillar-3", "near-miss:pillar-4", "near-miss:pillar-5"]));
  expect(slalom.events.some((entry) => entry.startsWith("crashed:"))).toBe(false);
  expect(slalom.snapshot.deaths).toBe(3);

  // Finish: results, medal, record, and a persisted ghost through the Save/Load Feature.
  await page.evaluate(() => { const game = window.__AFTERGLOW__!; game.loadScenario("finish"); game.setInput({ throttle: true }); game.advance(2.5); });
  await expect.poll(() => page.evaluate(() => window.__AFTERGLOW__!.inspectSave()?.lastSave)).toBe("saved");
  const finished = await page.evaluate(() => ({ snapshot: window.__AFTERGLOW__!.snapshot(), save: window.__AFTERGLOW__!.inspectSave(), runtime: window.__AFTERGLOW__!.inspectRuntime() }));
  expect(finished.snapshot).toMatchObject({ phase: "results", newRecord: true, checkpointsPassed: 4 });
  expect(finished.snapshot.finishTimeSeconds).toBeGreaterThan(5);
  expect(finished.snapshot.bestTimeSeconds).toBe(finished.snapshot.finishTimeSeconds);
  expect(["gold", "silver", "bronze", "none"]).toContain(finished.snapshot.medal);
  expect(finished.save).toMatchObject({ lastSave: "saved", bestTimeMs: Math.round(finished.snapshot.finishTimeSeconds! * 1000) });
  expect(finished.save!.ghostSamples).toBeGreaterThan(50);
  expect(finished.runtime).toMatchObject({ inputContext: "menu", cameraVariant: "orbit-results" });
  await expect(page.locator('[data-hud-screen="results"]')).toBeVisible();
  await expect(page.locator("#record")).toBeVisible();
  await page.evaluate(() => window.__AFTERGLOW__!.advance(2));
  const fireworks = (await page.evaluate(() => window.__AFTERGLOW__!.inspectVfx()))!;
  expect(fireworks.activeBurstCount).toBeGreaterThan(3);
  expect(fireworks.counters.submittedCommandCount).toBeGreaterThan(400);
  await page.screenshot({ path: testInfo.outputPath("afterglow-results.png") });

  // Retry: the ghost replays the saved best run.
  await page.keyboard.press("Space");
  await page.evaluate(() => window.__AFTERGLOW__!.advance(0.1));
  expect(await page.evaluate(() => window.__AFTERGLOW__!.snapshot().phase)).toBe("countdown");
  await page.evaluate(() => { const game = window.__AFTERGLOW__!; game.advance(1.6); game.setInput({ throttle: true }); game.advance(1); });
  const rerun = await page.evaluate(() => window.__AFTERGLOW__!.snapshot());
  expect(rerun.phase).toBe("running");
  expect(rerun.deaths).toBe(0);
  expect(rerun.ghost).not.toBeNull();
  expect(rerun.ghost!.s).toBeGreaterThan(0);
  await expect(page.locator("#ghost-tag")).toBeVisible();

  expect(await page.evaluate(() => window.__AFTERGLOW__!.errors())).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  await page.evaluate(() => window.__AFTERGLOW__!.dispose());
  expect(await page.evaluate(() => window.__AFTERGLOW__!.inspectLeaks())).toMatchObject({ hostListeners: 0, rafActive: false, hostDisposed: true, game: { disposed: true, activeFeatures: 0 } });
  expect(await page.evaluate(() => window.__AFTERGLOW__!.inspectRenderer())).toMatchObject({ disposed: true, composer: { passIds: [] } });
  expect(await page.evaluate(() => window.__AFTERGLOW__!.inspectVfx())).toMatchObject({ disposed: true, liveResourceCounts: { objects: 0, geometries: 0, materials: 0 } });
});

test("Afterglow normal playback releases disconnected gamepads and shuts down on page exit", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__testPad = null;
    Object.defineProperty(navigator, "getGamepads", { value: () => [(window as any).__testPad] });
  });
  await page.goto("/showcases/afterglow/index.html");
  await expect.poll(() => page.evaluate(() => window.__AFTERGLOW__?.ready)).toBe(true);
  await page.evaluate(() => { const api = window.__AFTERGLOW__!; api.start(); api.advance(2); });
  const connect = () => page.evaluate(() => {
    (window as any).__testPad = { id: "test-controller", connected: true, axes: [0], buttons: Array.from({ length: 10 }, (_, i) => ({ pressed: i === 5 || i === 7, value: i === 5 || i === 7 ? 1 : 0 })) };
  });
  await connect();
  await expect.poll(() => page.evaluate(() => window.__AFTERGLOW__!.snapshot().car.boosting)).toBe(true);
  await page.evaluate(() => { (window as any).__testPad = null; });
  await expect.poll(() => page.evaluate(() => window.__AFTERGLOW__!.snapshot().car.boosting)).toBe(false);
  await connect();
  await expect.poll(() => page.evaluate(() => window.__AFTERGLOW__!.snapshot().car.boosting)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
  await expect.poll(() => page.evaluate(() => window.__AFTERGLOW__!.inspectLeaks())).toMatchObject({ hostListeners: 0, rafActive: false, hostDisposed: true, game: { disposed: true, activeFeatures: 0 } });
  expect(await page.evaluate(() => window.__AFTERGLOW__!.errors())).toEqual([]);
});
