import { expect, test } from "@playwright/test";

type Handle = NonNullable<Window["__RELIC_FRONTIER__"]>;
type Snapshot = ReturnType<Handle["snapshot"]>;

/** Advances one fixed tick at a time until the predicate holds or the tick budget is exhausted. */
async function advanceUntil(page: import("@playwright/test").Page, predicate: string, maxTicks: number): Promise<{ ticks: number; matched: boolean }> {
  return page.evaluate(({ predicate, maxTicks }) => {
    const game = window.__RELIC_FRONTIER__!;
    const test = new Function("snapshot", "events", `return (${predicate});`) as (snapshot: Snapshot, events: ReturnType<Handle["events"]>) => boolean;
    for (let tick = 0; tick < maxTicks; tick += 1) {
      if (test(game.snapshot(), game.events())) return { ticks: tick, matched: true };
      game.advance(1 / 60);
    }
    return { ticks: maxTicks, matched: test(game.snapshot(), game.events()) };
  }, { predicate, maxTicks });
}

test("Relic Frontier completes a deterministic animated melee expedition through public Features", async ({ page }, testInfo) => {
  // The deterministic Guardian fight advances several thousand exact ticks with a render per tick.
  test.setTimeout(180_000);
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
  expect(boot.snapshot.checkpoint).toMatchObject({ activeId: "checkpoint-camp", label: "BASE CAMP", respawnTick: null, respawnCount: 0 });
  expect(boot.renderer).toMatchObject({ backend: "three-webgl", disposed: false, estimatedTextureBytes: 0 });
  expect(boot.renderer!.textures).toBeLessThanOrEqual(1);
  expect(boot.renderer!.meshes).toBeGreaterThan(20);
  expect(boot.renderer!.triangles).toBeGreaterThan(100);
  expect(boot.renderer!.triangles).toBeLessThanOrEqual(25_000);
  expect(boot.renderer!.drawCalls).toBeLessThanOrEqual(80);
  expect(boot.runtime!.installedFeatureIds).toEqual(expect.arrayContaining([
    "movement-input", "relic-frontier.rules", "trigger-area.client", "health-damage.client",
    "projectile.client", "ability-skill.client", "simple-ai-navigation.client", "inventory.client",
    "game-flow.client", "asset-manager", "audio", "ui-hud", "character-controller", "animation", "debug-devtools.client",
    "third-person-camera", "vfx", "three-rendering",
  ]));
  await expect(page.locator("#onboarding")).toBeHidden();

  // The animated humanoid rig loads through the public Asset Manager and attaches to every character.
  await expect.poll(() => page.evaluate(() => window.__RELIC_FRONTIER__!.inspectAssets()?.ready)).toBe(true);
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.inspectAssets())).toMatchObject({
    successful: true,
    failureCode: "load-failed",
    manager: { cachedIds: ["relic-ranger"], progress: { total: 2, started: 2, completed: 1, failed: 1, pending: 0 } },
  });
  await page.evaluate(() => window.__RELIC_FRONTIER__!.advance(1 / 60));
  const rig = await page.evaluate(() => ({ renderer: window.__RELIC_FRONTIER__!.inspectRenderer()!, animation: window.__RELIC_FRONTIER__!.inspectAnimation()! }));
  expect(rig.renderer.rig).toMatchObject({ status: "loaded", bones: 17, triangles: 264 });
  expect(rig.renderer.rig.characters).toEqual(["player", "husk-1", "husk-2", "warden-1", "husk-3", "relic-guardian"]);
  expect(rig.renderer.rig.clipIds).toEqual(["idle", "walk", "run", "attack-light", "attack-light-2", "attack-heavy", "dodge-roll", "hit-react", "stagger", "death", "cast"]);
  expect(rig.renderer.activeSkinnedMeshes).toBeGreaterThanOrEqual(1);
  expect(rig.renderer.activeSkinnedMeshes).toBeLessThanOrEqual(8);
  expect(rig.renderer.triangles).toBeLessThanOrEqual(25_000);
  expect(rig.renderer.drawCalls).toBeLessThanOrEqual(80);
  expect(rig.animation.characters.map(({ characterId }) => characterId)).toEqual(["husk-1", "husk-2", "husk-3", "player", "relic-guardian", "warden-1"]);
  const playerAnimation = rig.animation.characters.find(({ characterId }) => characterId === "player")!.animation;
  expect(playerAnimation).toMatchObject({ activeState: "idle", activeClipId: "idle", activeOneShotClipId: null, activeClipDuration: 2 });
  expect(playerAnimation.registeredClipIds).toEqual(expect.arrayContaining(["idle", "walk", "run", "attack-light", "attack-heavy", "dodge-roll", "hit-react", "stagger", "death"]));
  expect(playerAnimation.registeredEventIds).toEqual(expect.arrayContaining(["run:footstep", "attack-light:swing", "attack-heavy:slam", "dodge-roll:roll"]));
  await page.screenshot({ path: testInfo.outputPath("relic-frontier-title.png") });

  await page.evaluate(() => { const game = window.__RELIC_FRONTIER__!; game.start(); game.advance(0.1); });
  const briefing = await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot());
  expect(briefing.phase).toBe("explore");
  expect(briefing.guidance.player).toMatchObject({ stage: "cells", step: 1, objective: "Recover Energy Cells (0/3)", targetId: "cell-garden", prompt: "", onboardingVisible: true });
  expect(await page.evaluate(() => Object.isFrozen(window.__RELIC_FRONTIER__!.snapshot().guidance.player?.target))).toBe(true);
  await expect(page.locator("#onboarding")).toBeVisible();
  await expect(page.locator('[data-hud-bind="extra:stage"]')).toHaveText("STEP 1/5 · ENERGY CELLS");
  await expect(page.locator('[data-hud-bind="extra:cue"]')).toHaveText(/^[↑↗→↘↓↙←↖] \d+ m$/);
  await page.screenshot({ path: testInfo.outputPath("relic-frontier-briefing.png") });
  await page.click('[data-hud-action="dismiss-onboarding"]');
  await expect(page.locator("#onboarding")).toBeHidden();
  expect((await page.evaluate(() => window.__RELIC_FRONTIER__!.events())).some(({ kind }) => kind === "onboarding-dismissed")).toBe(true);

  // Idle → locomotion transition drives the looping state clip.
  await page.evaluate(() => { const game = window.__RELIC_FRONTIER__!; game.setInput({ moveX: 1, moveY: 0 }); game.advance(0.25); });
  const traversal = await page.evaluate(() => ({ snapshot: window.__RELIC_FRONTIER__!.snapshot(), animation: window.__RELIC_FRONTIER__!.inspectAnimation()!.characters.find(({ characterId }) => characterId === "player")!.animation }));
  expect(traversal.snapshot.player.position.x).toBeGreaterThan(0.5);
  expect(traversal.snapshot.player.animation.state).toBe("run");
  expect(traversal.animation).toMatchObject({ activeState: "run", activeClipId: "run", activeOneShotClipId: null });
  await expect.poll(() => page.evaluate(() => window.__RELIC_FRONTIER__!.inspectAudio()?.unlocked)).toBe(true);
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.inspectAudio()?.registeredClipIds)).toEqual(["impact", "pickup", "victory", "swing", "hurt"]);
  await page.evaluate(() => { const game = window.__RELIC_FRONTIER__!; game.setInput({ moveX: 0, moveY: 0 }); game.advance(0.4); });
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.inspectAnimation()!.characters.find(({ characterId }) => characterId === "player")!.animation.activeState)).toBe("idle");

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
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.errors())).toEqual([]);

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
  await expect(page.locator('[data-hud-bind="extra:prompt"]')).toHaveText("E · TAKE ENERGY CELL");
  await page.evaluate(() => { const game = window.__RELIC_FRONTIER__!; game.press("interact"); game.advance(0.05); });
  const collected = await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot());
  expect(collected.energyCells).toBe(1);
  expect(collected.guidance.player).toMatchObject({ stage: "cells", objective: "Recover Energy Cells (1/3)", targetId: "cell-tower" });
  await expect(page.locator('.inventory [data-hud-bind="extra:cells"]')).toHaveText("1/3");

  // --- Melee encounter: lock-on, heavy stagger, tick-authoritative hit windows, combo, kill.
  await page.evaluate(() => { const game = window.__RELIC_FRONTIER__!; game.loadScenario("melee"); game.press("lock-on"); game.advance(1 / 60); });
  const locked = await page.evaluate(() => ({ snapshot: window.__RELIC_FRONTIER__!.snapshot(), combat: window.__RELIC_FRONTIER__!.inspectCombat()! }));
  expect(locked.snapshot.lockOn.targetId).toBe("husk-1");
  expect(locked.combat.lockOn).toMatchObject({ targetId: "husk-1", acquireCount: 1, range: 12, releaseRange: 16 });
  expect(locked.snapshot.enemies.find(({ id }) => id === "husk-1")).toMatchObject({ alive: true, behavior: "approach", health: 60 });
  await expect(page.locator("#target")).toBeVisible();
  await expect(page.locator('[data-hud-bind="extra:target"]')).toHaveText("RUIN HUSK 60/60");
  await page.evaluate(() => { window.__RELIC_FRONTIER__!.press("lock-on"); window.__RELIC_FRONTIER__!.advance(1 / 60); });
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot().lockOn.targetId)).toBe("husk-2");
  await page.evaluate(() => { window.__RELIC_FRONTIER__!.press("lock-on"); window.__RELIC_FRONTIER__!.advance(1 / 60); });
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot().lockOn.targetId)).toBe(null);
  await page.evaluate(() => { window.__RELIC_FRONTIER__!.press("lock-on"); window.__RELIC_FRONTIER__!.advance(1 / 60); });
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot().lockOn.targetId)).toBe("husk-1");
  expect((await page.evaluate(() => window.__RELIC_FRONTIER__!.events())).filter(({ kind }) => kind.startsWith("lock-on-")).map(({ kind }) => kind)).toEqual(["lock-on-acquired", "lock-on-cycled", "lock-on-released", "lock-on-acquired"]);

  const heavy = await page.evaluate(() => {
    const game = window.__RELIC_FRONTIER__!;
    game.press("attack-heavy");
    const trace: Array<{ phase: string | null; health: number; kind: string; clip: string | null; clipProgress: number }> = [];
    for (let tick = 0; tick < 50; tick += 1) {
      game.advance(1 / 60);
      const snapshot = game.snapshot();
      const animation = game.inspectAnimation()!.characters.find(({ characterId }) => characterId === "player")!.animation;
      trace.push({ phase: snapshot.player.combat.phase, health: snapshot.enemies.find(({ id }) => id === "husk-1")!.health, kind: snapshot.enemies.find(({ id }) => id === "husk-1")!.combat.kind, clip: animation.activeOneShotClipId, clipProgress: animation.activeClipDuration === 0 ? 0 : animation.activeClipSeconds / animation.activeClipDuration });
    }
    return { trace, attacks: game.inspectCombat()!.attacks, events: game.events().map(({ kind }) => kind) };
  });
  const heavyDefinition = heavy.attacks.heavy;
  const firstDamageTick = heavy.trace.findIndex((entry, index) => index > 0 && entry.health < heavy.trace[index - 1]!.health);
  expect(firstDamageTick).toBe(heavyDefinition.startup);
  expect(heavy.trace[firstDamageTick]!.phase).toBe("active");
  for (const [index, entry] of heavy.trace.entries()) {
    const previous = index === 0 ? 60 : heavy.trace[index - 1]!.health;
    if (entry.health < previous) expect(entry.phase).toBe("active");
  }
  expect(heavy.trace[firstDamageTick - 1]).toMatchObject({ phase: "startup", health: 60, clip: "attack-heavy" });
  expect(Math.abs(heavy.trace[firstDamageTick - 1]!.clipProgress - (heavyDefinition.startup - 1) / (heavyDefinition.startup + heavyDefinition.active + heavyDefinition.recovery))).toBeLessThan(0.06);
  expect(heavy.trace.at(-1)).toMatchObject({ health: 20, phase: null, clip: null });
  expect(heavy.trace.some(({ kind }) => kind === "stagger")).toBe(true);
  expect(heavy.events).toEqual(expect.arrayContaining(["attack-started", "attack-hit-window", "melee-hit", "enemy-staggered"]));
  await page.screenshot({ path: testInfo.outputPath("relic-frontier-melee.png") });

  const closed = await advanceUntil(page, `snapshot.player.combat.kind === "idle" && Math.hypot(snapshot.enemies[0].position.x - snapshot.player.position.x, snapshot.enemies[0].position.z - snapshot.player.position.z) <= 2.3`, 240);
  expect(closed.matched).toBe(true);
  await page.evaluate(() => { const game = window.__RELIC_FRONTIER__!; game.press("attack-light"); game.advance(15 / 60); game.press("attack-light"); game.advance(1 / 60); });
  const combo = await page.evaluate(() => ({ snapshot: window.__RELIC_FRONTIER__!.snapshot(), animation: window.__RELIC_FRONTIER__!.inspectAnimation()!.characters.find(({ characterId }) => characterId === "player")!.animation }));
  expect(combo.snapshot.player.combat).toMatchObject({ kind: "attack", attackId: "light-1", phase: "recovery", comboQueued: true });
  expect(combo.animation).toMatchObject({ activeOneShotClipId: "attack-light", activeClipId: "attack-light" });
  const kill = await advanceUntil(page, `snapshot.enemies[0].alive === false`, 120);
  expect(kill.matched).toBe(true);
  await page.evaluate(() => window.__RELIC_FRONTIER__!.advance(1 / 60));
  const afterKill = await page.evaluate(() => ({ snapshot: window.__RELIC_FRONTIER__!.snapshot(), events: window.__RELIC_FRONTIER__!.events().map(({ kind, subject }) => `${kind}:${subject ?? ""}`), animation: window.__RELIC_FRONTIER__!.inspectAnimation()! }));
  expect(afterKill.events).toEqual(expect.arrayContaining(["combo-queued:light-2", "combo:light-2", "attack-started:light-2", "enemy-defeated:husk-1", "lock-on-released:husk-1"]));
  expect(afterKill.snapshot.lockOn.targetId).toBe(null);
  expect(afterKill.snapshot.defeatedEnemies).toBe(1);
  expect(afterKill.snapshot.enemies[0]).toMatchObject({ id: "husk-1", alive: false, health: 0, animation: { state: "dead" } });
  expect(afterKill.animation.characters.find(({ characterId }) => characterId === "husk-1")!.animation).toMatchObject({ activeState: "dead", activeClipId: "death" });
  expect(afterKill.animation.characters.find(({ characterId }) => characterId === "player")!.animation.completedOneShotCount).toBeGreaterThanOrEqual(2);

  // --- Dodge: the guard husk wakes when the Relic Pulse projectile hits it, then its slash is rolled through.
  const settled = await advanceUntil(page, `snapshot.player.combat.kind === "idle"`, 60);
  expect(settled.matched).toBe(true);
  await page.evaluate(() => { const game = window.__RELIC_FRONTIER__!; game.press("lock-on"); game.advance(1 / 60); game.press("ability"); game.advance(1 / 60); });
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot().lockOn.targetId)).toBe("husk-2");
  const pulse = await advanceUntil(page, `events.some((event) => event.kind === "projectile-hit" && event.subject === "husk-2")`, 180);
  expect(pulse.matched).toBe(true);
  await page.evaluate(() => window.__RELIC_FRONTIER__!.advance(1 / 60));
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot().enemies.find(({ id }) => id === "husk-2"))).toMatchObject({ health: 28, behavior: "approach" });
  const windup = await advanceUntil(page, `(() => { const husk = snapshot.enemies.find((enemy) => enemy.id === "husk-2"); return husk.combat.kind === "attack" && husk.combat.phase === "startup" && husk.combat.ticks >= 24; })()`, 400);
  expect(windup.matched).toBe(true);
  const healthBeforeDodge = await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot().player.health);
  await page.evaluate(() => { const game = window.__RELIC_FRONTIER__!; game.press("dodge"); game.advance(3 / 60); });
  const rolling = await page.evaluate(() => ({ snapshot: window.__RELIC_FRONTIER__!.snapshot(), animation: window.__RELIC_FRONTIER__!.inspectAnimation()!.characters.find(({ characterId }) => characterId === "player")!.animation }));
  expect(rolling.snapshot.player.combat).toMatchObject({ kind: "dodge", invulnerable: true });
  expect(rolling.snapshot.player.dodgeCooldownTicks).toBeGreaterThan(0);
  expect(rolling.animation.activeOneShotClipId).toBe("dodge-roll");
  await expect(page.locator('[data-hud-bind="extra:dodge"]')).toHaveText(/^\d+\.\ds$/);
  const swingDone = await advanceUntil(page, `snapshot.enemies.find((enemy) => enemy.id === "husk-2").combat.kind !== "attack"`, 120);
  expect(swingDone.matched).toBe(true);
  const dodged = await page.evaluate(() => ({ snapshot: window.__RELIC_FRONTIER__!.snapshot(), events: window.__RELIC_FRONTIER__!.events().map(({ kind, subject }) => `${kind}:${subject ?? ""}`) }));
  expect(dodged.events).toEqual(expect.arrayContaining(["dodge:player", "enemy-alerted:husk-2", "enemy-attack:husk-2", "enemy-hit-window:husk-2", "attack-dodged:husk-2"]));
  expect(dodged.snapshot.player.health).toBe(healthBeforeDodge);
  const husk2 = await advanceUntil(page, `(() => { const game = window.__RELIC_FRONTIER__; const husk = snapshot.enemies.find((enemy) => enemy.id === "husk-2"); if (husk.alive && snapshot.player.combat.kind === "idle") game.press("attack-light"); return !husk.alive; })()`, 900);
  expect(husk2.matched).toBe(true);
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot())).toMatchObject({ defeatedEnemies: 2, deaths: 0 });

  // --- Ranged encounter: the Warden telegraphs a cast and fires through the public Projectile Feature.
  await page.evaluate(() => { const game = window.__RELIC_FRONTIER__!; game.loadScenario("ranged"); game.advance(1 / 60); });
  const cast = await advanceUntil(page, `events.some((event) => event.kind === "enemy-cast" && event.subject === "warden-1")`, 120);
  expect(cast.matched).toBe(true);
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot().enemies.find(({ id }) => id === "warden-1"))).toMatchObject({ behavior: "hold", combat: { kind: "attack", attackId: "warden-bolt", phase: "startup" }, animation: { oneShot: "cast" } });
  await page.screenshot({ path: testInfo.outputPath("relic-frontier-ranged.png") });
  const bolt = await advanceUntil(page, `events.some((event) => event.kind === "projectile-hit" && event.subject === "player")`, 240);
  expect(bolt.matched).toBe(true);
  await page.evaluate(() => window.__RELIC_FRONTIER__!.advance(1 / 60));
  const struck = await page.evaluate(() => ({ snapshot: window.__RELIC_FRONTIER__!.snapshot(), events: window.__RELIC_FRONTIER__!.events().map(({ kind, subject }) => `${kind}:${subject ?? ""}`) }));
  expect(struck.snapshot.player.health).toBe(100 - 14);
  expect(struck.snapshot.player.combat.kind).toBe("hit");
  expect(struck.snapshot.player.animation.oneShot).toBe("hit-react");
  expect(struck.events).toEqual(expect.arrayContaining(["enemy-cast:warden-1", "enemy-attack:warden-bolt:warden-1", "projectile-fired:warden-1", "projectile-hit:player", "player-hit:player"]));

  // --- Death and respawn: the active checkpoint decides where the player returns.
  await page.evaluate(() => { const game = window.__RELIC_FRONTIER__!; game.loadScenario("player-death"); game.advance(1 / 60); });
  const downed = await page.evaluate(() => ({ snapshot: window.__RELIC_FRONTIER__!.snapshot(), combat: window.__RELIC_FRONTIER__!.inspectCombat()!, animation: window.__RELIC_FRONTIER__!.inspectAnimation()!.characters.find(({ characterId }) => characterId === "player")!.animation }));
  expect(downed.snapshot).toMatchObject({ phase: "downed", deaths: 1, player: { health: 0, combat: { kind: "dead" }, animation: { state: "dead" } } });
  expect(downed.snapshot.checkpoint).toMatchObject({ activeId: "checkpoint-camp", respawnTick: downed.combat.checkpoint.respawnTick });
  expect(downed.combat.checkpoint).toMatchObject({ activeCheckpointId: "checkpoint-camp", respawnDelayTicks: 150, respawnCount: 0 });
  expect(downed.combat.checkpoint.respawnTick! - downed.snapshot.tick).toBeGreaterThanOrEqual(140);
  expect(downed.combat.checkpoint.respawnTick! - downed.snapshot.tick).toBeLessThanOrEqual(150);
  expect(downed.animation).toMatchObject({ activeState: "dead", activeClipId: "death" });
  await expect(page.locator('[data-hud-screen="downed"]')).toBeVisible();
  await expect(page.locator('[data-hud-bind="extra:stage"]')).toHaveText("SIGNAL LOST · REDEPLOYING");
  await expect(page.locator('[data-hud-screen="downed"] [data-hud-bind="extra:respawn"]')).toHaveText(/^\d+\.\ds$/);
  await page.screenshot({ path: testInfo.outputPath("relic-frontier-downed.png") });
  await page.evaluate(() => window.__RELIC_FRONTIER__!.advance(2.6));
  const respawned = await page.evaluate(() => ({ snapshot: window.__RELIC_FRONTIER__!.snapshot(), events: window.__RELIC_FRONTIER__!.events().map(({ kind, subject }) => `${kind}:${subject ?? ""}`) }));
  expect(respawned.snapshot).toMatchObject({ phase: "explore", player: { health: 100, combat: { kind: "idle" }, animation: { state: "idle" } }, checkpoint: { activeId: "checkpoint-camp", respawnTick: null, respawnCount: 1 } });
  expect(respawned.snapshot.player.position.z).toBeCloseTo(18, 1);
  // The death scenario revives the path husks as its known state; the escort killed by the ranged scenario stays dead,
  // and every living enemy is back at its spawn with full health.
  expect(respawned.snapshot.enemies.filter(({ alive }) => !alive).map(({ id }) => id)).toEqual(["husk-3"]);
  expect(respawned.snapshot.enemies.find(({ id }) => id === "husk-1")).toMatchObject({ alive: true, health: 60, behavior: "dormant", combat: { kind: "idle" }, position: { x: -2.6, z: 2.5 } });
  expect(respawned.events).toEqual(expect.arrayContaining(["player-died:player", "respawn-scheduled:checkpoint-camp", "player-respawned:checkpoint-camp", "phase-changed:downed", "phase-changed:explore"]));
  await expect(page.locator('[data-hud-screen="downed"]')).toBeHidden();

  await page.evaluate(() => { const game = window.__RELIC_FRONTIER__!; game.loadScenario("checkpoint"); game.advance(2 / 60); });
  const gate = await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot());
  expect(gate.checkpoint).toMatchObject({ activeId: "checkpoint-gate", label: "CHAMBER GATE" });
  expect(gate.energyCells).toBe(3);
  await expect(page.locator("#toast")).toHaveText("CHECKPOINT · CHAMBER GATE");
  await expect(page.locator('.inventory [data-hud-bind="extra:checkpoint"]')).toHaveText("CHAMBER GATE");
  await page.evaluate(() => { const game = window.__RELIC_FRONTIER__!; game.forcePlayerDeath(); game.advance(1 / 60); });
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot())).toMatchObject({ phase: "downed", deaths: 2 });
  await page.evaluate(() => window.__RELIC_FRONTIER__!.advance(2.6));
  const gateRespawn = await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot());
  expect(gateRespawn).toMatchObject({ phase: "explore", energyCells: 3, checkpoint: { activeId: "checkpoint-gate", respawnCount: 2 } });
  expect(gateRespawn.player.position.z).toBeCloseTo(-12.5, 1);

  await page.evaluate(() => { const game = window.__RELIC_FRONTIER__!; game.loadScenario("mechanism"); game.advance(0.05); });
  const mechanism = await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot());
  expect(mechanism).toMatchObject({ phase: "explore", energyCells: 3, mechanismPowered: false });
  expect(mechanism.guidance.player).toMatchObject({ stage: "mechanism", step: 2, objective: "Power the chamber mechanism", targetId: "power-console", prompt: "E · POWER THE MECHANISM" });
  await expect(page.locator('[data-hud-bind="extra:stage"]')).toHaveText("STEP 2/5 · CHAMBER MECHANISM");
  await expect(page.locator("#guardian")).toBeHidden();
  await page.evaluate(() => { const game = window.__RELIC_FRONTIER__!; game.press("interact"); game.advance(0.05); });
  const powered = await page.evaluate(() => ({ snapshot: window.__RELIC_FRONTIER__!.snapshot(), events: window.__RELIC_FRONTIER__!.events() }));
  expect(powered.snapshot).toMatchObject({ phase: "guardian", mechanismPowered: true });
  expect(powered.snapshot.guidance.player).toMatchObject({ stage: "guardian", step: 3, targetId: "relic-guardian" });
  expect(powered.events.some(({ kind }) => kind === "mechanism-powered")).toBe(true);
  await expect(page.locator('[data-hud-bind="extra:stage"]')).toHaveText("STEP 3/5 · RELIC GUARDIAN");
  await expect(page.locator("#guardian")).toBeVisible();
  await expect(page.locator('[data-hud-bind="extra:guardian"]')).toHaveText("240/240");

  // --- Guardian: the same attack primitives at boss scale, two readable melee attacks plus a volley.
  await page.evaluate(() => { const game = window.__RELIC_FRONTIER__!; game.setInput({ moveX: 0, moveY: 0, cameraYaw: 0 }); game.loadScenario("guardian"); game.press("lock-on"); game.advance(1 / 60); });
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot().lockOn.targetId)).toBe("relic-guardian");
  const sweep = await advanceUntil(page, `snapshot.enemies.find((enemy) => enemy.id === "relic-guardian").combat.attackId === "guardian-sweep"`, 240);
  expect(sweep.matched).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("relic-frontier-guardian.png") });
  const bossFight = await page.evaluate(() => {
    const game = window.__RELIC_FRONTIER__!;
    let dodges = 0;
    let heavies = 0;
    let lights = 0;
    for (let tick = 0; tick < 3_600; tick += 1) {
      const snapshot = game.snapshot();
      const boss = snapshot.enemies.find(({ id }) => id === "relic-guardian")!;
      if (!boss.alive) break;
      const player = snapshot.player;
      const distance = Math.hypot(boss.position.x - player.position.x, boss.position.z - player.position.z);
      const definition = boss.combat.attackId === null ? null : game.inspectCombat()!.attacks[boss.combat.attackId];
      const melee = definition !== null && definition.volume.kind !== "projectile";
      const winding = boss.combat.kind === "attack" && boss.combat.phase === "startup";
      const remaining = winding && definition !== null ? definition.startup - boss.combat.ticks : Number.POSITIVE_INFINITY;
      // Safe window: the rest of the Guardian's recovery plus its cooldown, or the rest of a stagger/hit reaction.
      const safeTicks = boss.combat.kind === "attack" && boss.combat.phase === "recovery"
        ? boss.combat.totalTicks - boss.combat.ticks + 30
        : boss.combat.kind === "stagger" || boss.combat.kind === "hit" ? boss.combat.totalTicks - boss.combat.ticks : 0;
      const canAct = player.combat.kind === "idle" || (player.combat.kind === "attack" && player.combat.phase === "recovery");
      let action: "wait" | "dodge" | "heavy" | "light" | "move" = "wait";
      if (winding && melee && remaining <= 8 && canAct && player.dodgeCooldownTicks === 0) action = "dodge";
      else if (player.combat.kind === "idle" && distance <= 4.2 && (safeTicks >= 48 || (winding && remaining > 52))) action = "heavy";
      else if (player.combat.kind === "idle" && distance <= 4.2 && (safeTicks >= 26 || (winding && remaining > 30))) action = "light";
      else if (player.combat.kind === "idle" && distance > 4.2) action = "move";
      game.setInput({ moveX: action === "move" ? Math.sign(boss.position.x - player.position.x) * 0.4 : 0, moveY: action === "move" ? Math.sign(boss.position.z - player.position.z) : 0 });
      if (action === "dodge") { game.press("dodge"); dodges += 1; }
      if (action === "heavy") { game.press("attack-heavy"); heavies += 1; }
      if (action === "light") { game.press("attack-light"); lights += 1; }
      game.advance(1 / 60);
    }
    game.setInput({ moveX: 0, moveY: 0 });
    game.advance(1 / 60);
    return { snapshot: game.snapshot(), events: game.events().map(({ kind, subject }) => `${kind}:${subject ?? ""}`), dodges, heavies, lights, renderer: game.inspectRenderer()!, errors: game.errors() };
  });
  expect(bossFight.snapshot.enemies.find(({ id }) => id === "relic-guardian")).toMatchObject({ alive: false, health: 0 });
  expect(bossFight.heavies + bossFight.lights).toBeGreaterThanOrEqual(6);
  expect(bossFight.dodges).toBeGreaterThanOrEqual(1);
  expect(bossFight.snapshot.deaths).toBe(2);
  expect(bossFight.errors).toEqual([]);
  expect(bossFight.events).toEqual(expect.arrayContaining(["enemy-attack:guardian-sweep:relic-guardian", "enemy-attack:guardian-slam:relic-guardian", "attack-dodged:relic-guardian", "enemy-staggered:relic-guardian", "enemy-defeated:relic-guardian"]));
  expect(bossFight.renderer.animationEvents).toBeGreaterThan(10);
  expect(bossFight.renderer.drawCalls).toBeLessThanOrEqual(80);
  const defeated = bossFight.snapshot;
  expect(defeated.guidance.player).toMatchObject({ stage: "relic", step: 4, objective: "Claim the Relic in the chamber", targetId: "relic" });
  await expect(page.locator('[data-hud-bind="extra:stage"]')).toHaveText("STEP 4/5 · CLAIM THE RELIC");
  await expect(page.locator("#guardian")).toBeHidden();

  const reachRelic = await advanceUntil(page, `(() => { const game = window.__RELIC_FRONTIER__; if (snapshot.guidance.player.prompt === "E · CLAIM THE RELIC") return true; game.setInput({ moveX: Math.sign(-snapshot.player.position.x) * 0.5, moveY: Math.sign(-26 - snapshot.player.position.z) }); return false; })()`, 600);
  expect(reachRelic.matched).toBe(true);
  await page.evaluate(() => { const game = window.__RELIC_FRONTIER__!; game.setInput({ moveX: 0, moveY: 0 }); game.press("interact"); game.advance(0.05); });
  const relic = await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot());
  expect(relic.relicOwned).toBe(true);
  expect(relic.phase).toBe("escape");
  expect(relic.guidance.player).toMatchObject({ stage: "escape", step: 5, objective: "Return to Base Camp and escape", targetId: "escape-zone" });
  await expect(page.locator('[data-hud-bind="extra:stage"]')).toHaveText("STEP 5/5 · ESCAPE TO BASE CAMP");

  await page.evaluate(() => { const game = window.__RELIC_FRONTIER__!; game.loadScenario("escape"); game.advance(0.05); });
  const camp = await page.evaluate(() => window.__RELIC_FRONTIER__!.snapshot());
  expect(camp.guidance.player).toMatchObject({ stage: "escape", targetId: "escape-zone", prompt: "E · ESCAPE TO BASE CAMP" });
  await page.evaluate(() => { const game = window.__RELIC_FRONTIER__!; game.press("interact"); game.advance(0.05); game.setDebugCamera(true); });
  const result = await page.evaluate(() => ({ snapshot: window.__RELIC_FRONTIER__!.snapshot(), events: window.__RELIC_FRONTIER__!.events(), errors: window.__RELIC_FRONTIER__!.errors(), renderer: window.__RELIC_FRONTIER__!.inspectRenderer() }));
  expect(result.snapshot.phase).toBe("results");
  expect(result.snapshot.guidance.player).toMatchObject({ stage: "complete", step: 5, objective: "Expedition complete", targetId: null, prompt: "" });
  expect(result.events.map(({ kind }) => kind)).toEqual(expect.arrayContaining([
    "scenario-loaded", "onboarding-dismissed", "item-picked", "mechanism-powered", "objective-changed",
    "enemy-defeated", "relic-acquired", "expedition-complete", "phase-changed", "checkpoint-activated", "player-respawned",
  ]));
  expect(result.renderer!.drawCalls).toBeGreaterThan(0);
  expect(result.renderer!.drawCalls).toBeLessThanOrEqual(80);
  expect(result.renderer!.triangles).toBeLessThanOrEqual(25_000);
  expect(result.renderer!.activeSkinnedMeshes).toBeLessThanOrEqual(8);
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
  await expect.poll(() => page.evaluate(() => window.__RELIC_FRONTIER__!.inspectRenderer()?.rig.status)).toBe("loaded");
  await page.evaluate(() => window.__RELIC_FRONTIER__!.dispose());
  await expect.poll(() => page.evaluate(() => window.__RELIC_FRONTIER__!.inspectLeaks().game?.activeFeatures)).toBe(0);
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.inspectLeaks())).toMatchObject({ hostListeners: 0, rafActive: false, hostDisposed: true, game: { activeCharacters: 0, disposed: true } });
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.inspectAnimation()?.disposed)).toBe(true);
  expect(await page.evaluate(() => window.__RELIC_FRONTIER__!.inspectAudio()?.disposed)).toBe(true);
});

test("Chroma Strike runs a deterministic voxel FPS match", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/showcases/relic-frontier/chroma-strike/index.html?test=1");
  await expect.poll(() => page.evaluate(() => window.__CHROMA_STRIKE__?.ready)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__CHROMA_STRIKE__?.screenshotReady)).toBe(true);

  const boot = await page.evaluate(() => ({
    snapshot: window.__CHROMA_STRIKE__!.snapshot(),
    renderer: window.__CHROMA_STRIKE__!.inspectRenderer(),
    vfx: window.__CHROMA_STRIKE__!.inspectVfx(),
  }));
  expect(boot.snapshot).toMatchObject({ phase: "title", ammo: 12, reserveAmmo: 48, kills: 0, targetKills: 5 });
  expect(boot.renderer).toMatchObject({ backend: "three-webgl", disposed: false, screenshotReady: true });
  expect(boot.renderer!.meshes).toBeGreaterThan(20);
  expect(boot.renderer!.triangles).toBeGreaterThan(100);
  expect(boot.renderer!.triangles).toBeLessThan(25_000);
  expect(boot.renderer!.drawCalls).toBeLessThan(80);
  expect(boot.vfx).toMatchObject({ disposed: false, queuedCommandCount: 0 });
  expect(await page.evaluate(() => Object.isFrozen(window.__CHROMA_STRIKE__!.snapshot().enemies))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__CHROMA_STRIKE__!.inspectRenderer()?.weaponAsset.status)).toBe("loaded");
  await expect.poll(() => page.evaluate(() => window.__CHROMA_STRIKE__!.inspectRenderer()?.enemyAsset.status)).toBe("loaded");
  const models = await page.evaluate(() => window.__CHROMA_STRIKE__!.inspectRenderer());
  expect(models!.weaponAsset).toMatchObject({ file: "chroma-pulse-rifle.gltf", status: "loaded", active: true, fallbackVisible: false, meshes: 9, instances: 1 });
  expect(models!.enemyAsset).toMatchObject({ file: "chroma-combat-bot.gltf", status: "loaded", active: true, fallbackVisible: false, meshes: 60, instances: 5 });
  expect(models!.meshes).toBeGreaterThan(80);
  await page.screenshot({ path: testInfo.outputPath("chroma-strike-title.png") });

  await page.evaluate(() => { const game = window.__CHROMA_STRIKE__!; game.start(); game.advance(3.1); });
  expect(await page.evaluate(() => window.__CHROMA_STRIKE__!.snapshot().phase)).toBe("running");
  await expect(page.locator("#title-screen")).toBeHidden();
  await expect(page.locator("#crosshair")).toBeVisible();

  await page.evaluate(() => {
    const game = window.__CHROMA_STRIKE__!;
    game.loadScenario("duel");
    for (let shot = 0; shot < 3; shot += 1) { game.press("fire"); game.advance(0.13); }
  });
  const duel = await page.evaluate(() => ({ snapshot: window.__CHROMA_STRIKE__!.snapshot(), events: window.__CHROMA_STRIKE__!.events() }));
  expect(duel.snapshot).toMatchObject({ phase: "running", ammo: 9, kills: 1, hits: 3, shots: 3, score: 145 });
  expect(duel.snapshot.enemies[0]).toMatchObject({ id: "bot-1", health: 0, alive: false });
  expect(duel.events.map(({ kind }) => kind)).toEqual(expect.arrayContaining(["shot", "hit", "enemy-defeated"]));
  await expect(page.locator("#kills-value")).toHaveText("1/5");

  await page.evaluate(() => {
    const game = window.__CHROMA_STRIKE__!;
    game.loadScenario("duel");
    game.press("fire"); game.advance(0.13);
    game.press("reload"); game.advance(1.2);
  });
  expect(await page.evaluate(() => window.__CHROMA_STRIKE__!.snapshot())).toMatchObject({ ammo: 12, reserveAmmo: 47, reloadSeconds: 0 });
  expect((await page.evaluate(() => window.__CHROMA_STRIKE__!.events())).map(({ kind }) => kind)).toEqual(expect.arrayContaining(["reload-started", "reload-complete"]));

  await page.evaluate(() => {
    const game = window.__CHROMA_STRIKE__!;
    game.loadScenario("last-enemy");
    for (let shot = 0; shot < 3; shot += 1) { game.press("fire"); game.advance(0.13); }
  });
  const victory = await page.evaluate(() => window.__CHROMA_STRIKE__!.snapshot());
  expect(victory).toMatchObject({ phase: "results", result: "arena-clear", kills: 5, ammo: 9 });
  await expect(page.locator("#result-screen")).toBeVisible();
  await expect(page.locator("#result-title")).toHaveText("ARENA CLEARED");
  await page.screenshot({ path: testInfo.outputPath("chroma-strike-results.png") });

  await page.evaluate(() => { const game = window.__CHROMA_STRIKE__!; game.loadScenario("defeat"); game.advance(0.05); });
  expect(await page.evaluate(() => window.__CHROMA_STRIKE__!.snapshot())).toMatchObject({ phase: "defeated", result: "defeated", player: { health: 0 } });
  await expect(page.locator("#result-title")).toHaveText("SIGNAL LOST");
  expect(await page.evaluate(() => window.__CHROMA_STRIKE__!.errors())).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);

  await page.evaluate(() => window.__CHROMA_STRIKE__!.restart());
  expect(await page.evaluate(() => window.__CHROMA_STRIKE__!.snapshot().phase)).toBe("title");
  await page.evaluate(() => window.__CHROMA_STRIKE__!.dispose());
  expect(await page.evaluate(() => window.__CHROMA_STRIKE__!.inspectLeaks())).toMatchObject({ hostListeners: 0, rafActive: false, hostDisposed: true, game: { disposed: true } });
  expect(await page.evaluate(() => window.__CHROMA_STRIKE__!.inspectRenderer())).toMatchObject({ disposed: true });
});
