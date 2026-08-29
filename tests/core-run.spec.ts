import { expect, test, type Page } from "@playwright/test";
import { ticksFromSeconds } from "../showcases/core-run/src/feature.js";
import { CORE_PLACEMENTS, CORE_VALUES } from "../showcases/core-run/src/features/cores.js";
import {
  BASE_POSITION,
  COMBO_WINDOW_SECONDS,
} from "../showcases/core-run/src/features/deposit.js";
import {
  HAZARD_MAX,
  HAZARD_MIN,
  HAZARD_SPEED_MULTIPLIER,
} from "../showcases/core-run/src/features/hazard.js";
import {
  JUMP_PAD_IMPULSE,
  JUMP_PAD_POSITION,
  JUMP_PAD_RADIUS,
} from "../showcases/core-run/src/features/jump-pad.js";
import {
  DASH_COOLDOWN_SECONDS,
  DASH_SECONDS,
  DASH_SPEED,
  GRAVITY,
  JUMP_SPEED,
  MAX_SPEED,
} from "../showcases/core-run/src/features/movement.js";
import {
  PLATFORM_CENTER,
  PLATFORM_HALF_WIDTH,
  createMovingPlatformFeature,
  platformPosition,
} from "../showcases/core-run/src/features/moving-platform.js";
import {
  COUNTDOWN_SECONDS,
  ROUND_SECONDS,
  TIME_UP_SECONDS,
} from "../showcases/core-run/src/features/round-timer.js";
import type { CoreRunLeakReport, CoreRunTestHandle } from "../showcases/core-run/src/main.js";
import {
  PLAYER_SPAWN,
  createCoreRunState,
  vec3,
  type CoreRunSnapshot,
  type OneShotAction,
  type SemanticInput,
  type TelemetryEvent,
  type Vec3,
} from "../showcases/core-run/src/state.js";

/* ------------------------------- constants ------------------------------- */

const CORE_RUN_URL = "/showcases/core-run/index.html?test=1";
const DT = 1 / 60;
/** Mirrors MAX_STEPS_PER_ADVANCE in showcases/core-run/src/game.ts. */
const MAX_STEPS_PER_ADVANCE = 600;
const COUNTDOWN_TICKS = ticksFromSeconds(COUNTDOWN_SECONDS, DT);
const ROUND_TICKS = ticksFromSeconds(ROUND_SECONDS, DT);
const TIME_UP_TICKS = ticksFromSeconds(TIME_UP_SECONDS, DT);
const COMBO_WINDOW_TICKS = ticksFromSeconds(COMBO_WINDOW_SECONDS, DT);
const DASH_TICKS = ticksFromSeconds(DASH_SECONDS, DT);
const DASH_COOLDOWN_TICKS = ticksFromSeconds(DASH_COOLDOWN_SECONDS, DT);
/** Stop this close to a target; deceleration overshoot (<0.5 m) keeps us in range. */
const STOP_RADIUS = 0.75;
/** Ticks needed to decelerate from MAX_SPEED (or DASH_SPEED) to rest. */
const SETTLE_TICKS = 12;
const DASH_SETTLE_TICKS = 30;
const NAVIGATION_TICK_BUDGET = 600;
const HAZARD_CENTER: Vec3 = vec3(
  (HAZARD_MIN.x + HAZARD_MAX.x) / 2,
  0,
  (HAZARD_MIN.z + HAZARD_MAX.z) / 2,
);

/* -------------------------------- helpers -------------------------------- */

interface PageDiagnostics {
  readonly pageErrors: string[];
  readonly consoleErrors: string[];
}

type EventOf<K extends TelemetryEvent["kind"]> = Extract<TelemetryEvent, { kind: K }>;

function eventsOfKind<K extends TelemetryEvent["kind"]>(
  events: readonly TelemetryEvent[],
  kind: K,
): EventOf<K>[] {
  return events.filter((event): event is EventOf<K> => event.kind === kind);
}

function horizontalSpeed(snapshot: CoreRunSnapshot): number {
  return Math.hypot(snapshot.player.velocity.x, snapshot.player.velocity.z);
}

async function bootCoreRun(page: Page): Promise<PageDiagnostics> {
  const diagnostics: PageDiagnostics = { pageErrors: [], consoleErrors: [] };
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
  });
  await page.goto(CORE_RUN_URL);
  await page.waitForFunction(() => {
    const handle = Reflect.get(window, "__CORE_RUN__") as CoreRunTestHandle | undefined;
    return handle !== undefined && handle.ready && handle.screenshotReady;
  });
  return diagnostics;
}

async function readSnapshot(page: Page): Promise<CoreRunSnapshot> {
  return page.evaluate(() =>
    (Reflect.get(window, "__CORE_RUN__") as CoreRunTestHandle).snapshot(),
  );
}

async function readEvents(page: Page): Promise<readonly TelemetryEvent[]> {
  return page.evaluate(() =>
    (Reflect.get(window, "__CORE_RUN__") as CoreRunTestHandle).events(),
  );
}

async function readLeaks(page: Page): Promise<CoreRunLeakReport> {
  return page.evaluate(() =>
    (Reflect.get(window, "__CORE_RUN__") as CoreRunTestHandle).inspectLeaks(),
  );
}

async function expectNoErrors(page: Page, diagnostics: PageDiagnostics): Promise<void> {
  const runtimeErrors = await page.evaluate(() =>
    (Reflect.get(window, "__CORE_RUN__") as CoreRunTestHandle).errors(),
  );
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.consoleErrors).toEqual([]);
  expect(runtimeErrors).toEqual([]);
}

async function setInput(page: Page, input: Partial<SemanticInput>): Promise<void> {
  await page.evaluate((value) => {
    (Reflect.get(window, "__CORE_RUN__") as CoreRunTestHandle).setInput(value);
  }, input);
}

async function press(page: Page, action: OneShotAction): Promise<void> {
  await page.evaluate((value) => {
    (Reflect.get(window, "__CORE_RUN__") as CoreRunTestHandle).press(value);
  }, action);
}

/** Advances exactly `ticks` fixed steps through the deterministic handle. */
async function stepTicks(page: Page, ticks: number): Promise<void> {
  const stepped = await page.evaluate(
    ({ ticks, dt, maxSteps }) => {
      const handle = Reflect.get(window, "__CORE_RUN__") as CoreRunTestHandle;
      let done = 0;
      let remaining = ticks;
      while (remaining > 0) {
        const chunk = Math.min(remaining, maxSteps);
        done += handle.advance(chunk * dt);
        remaining -= chunk;
      }
      return done;
    },
    { ticks, dt: DT, maxSteps: MAX_STEPS_PER_ADVANCE },
  );
  expect(stepped, `expected exactly ${ticks} simulation steps`).toBe(ticks);
}

/**
 * Steers the player toward `target` on the XZ plane one tick at a time using
 * semantic input (camera yaw 0) until within `radius`, then releases input.
 * Bounded by `maxTicks`; asserts the target was reached.
 */
async function moveUntilNear(
  page: Page,
  target: Vec3,
  radius: number,
  maxTicks: number,
): Promise<number> {
  const result = await page.evaluate(
    ({ target, radius, maxTicks, dt }) => {
      const handle = Reflect.get(window, "__CORE_RUN__") as CoreRunTestHandle;
      let used = 0;
      let reached = false;
      while (used < maxTicks) {
        const position = handle.snapshot().player.position;
        const dx = target.x - position.x;
        const dz = target.z - position.z;
        const gap = Math.hypot(dx, dz);
        if (gap <= radius) {
          reached = true;
          break;
        }
        handle.setInput({ moveX: dx / gap, moveY: -dz / gap, cameraYaw: 0 });
        handle.advance(dt);
        used += 1;
      }
      handle.setInput({ moveX: 0, moveY: 0 });
      return { used, reached };
    },
    { target: { x: target.x, z: target.z }, radius, maxTicks, dt: DT },
  );
  expect(result.reached, `reach (${target.x}, ${target.z}) within ${maxTicks} ticks`).toBe(true);
  return result.used;
}

async function startRound(page: Page): Promise<void> {
  await page.evaluate(() => {
    (Reflect.get(window, "__CORE_RUN__") as CoreRunTestHandle).start();
  });
  const countdown = await readSnapshot(page);
  expect(countdown.phase).toBe("countdown");
  expect(countdown.countdownValue).toBe(COUNTDOWN_SECONDS);
  await expect(page.locator("#overlay-countdown")).toHaveText(String(COUNTDOWN_SECONDS));
  await stepTicks(page, COUNTDOWN_TICKS);
  const running = await readSnapshot(page);
  expect(running.phase).toBe("running");
  expect(running.remainingSeconds).toBe(ROUND_SECONDS);
}

/** Walks to a core, picks it up, walks to the Base, deposits it. */
async function carryCoreToBase(page: Page, coreId: number): Promise<CoreRunSnapshot> {
  const placement = CORE_PLACEMENTS[coreId];
  if (placement === undefined) throw new Error(`unknown core ${coreId}`);

  await moveUntilNear(page, placement.position, STOP_RADIUS, NAVIGATION_TICK_BUDGET);
  await stepTicks(page, SETTLE_TICKS);
  await press(page, "interact");
  await stepTicks(page, 1);
  const carrying = await readSnapshot(page);
  expect(carrying.carry.coreId).toBe(coreId);
  expect(carrying.cores[coreId]?.collected).toBe(true);
  await expect(page.locator("#hud-carry")).toHaveText(
    `${placement.kind.toUpperCase()} core (+${CORE_VALUES[placement.kind]})`,
  );

  await moveUntilNear(page, BASE_POSITION, STOP_RADIUS, NAVIGATION_TICK_BUDGET);
  await stepTicks(page, SETTLE_TICKS);
  await press(page, "interact");
  await stepTicks(page, 1);
  const deposited = await readSnapshot(page);
  expect(deposited.carry.coreId).toBeNull();
  expect(deposited.carry.lastDepositTick).toBe(deposited.tick);
  await expect(page.locator("#hud-carry")).toHaveText("None");
  return deposited;
}

/* --------------------------------- tests --------------------------------- */

test.describe("Core Run showcase", () => {
  test("boots cleanly in test mode with 12 fixed cores", async ({ page }, testInfo) => {
    const diagnostics = await bootCoreRun(page);

    const host = await page.evaluate(() => {
      const handle = Reflect.get(window, "__CORE_RUN__") as CoreRunTestHandle;
      return {
        mode: handle.mode,
        ready: handle.ready,
        screenshotReady: handle.screenshotReady,
        status: handle.status,
      };
    });
    expect(host).toEqual({
      mode: "test",
      ready: true,
      screenshotReady: true,
      status: "Test mode: time advances only via window.__CORE_RUN__.advance()",
    });

    const snapshot = await readSnapshot(page);
    expect(snapshot.phase).toBe("title");
    expect(snapshot.tick).toBe(0);
    expect(snapshot.cores).toHaveLength(12);
    const counts = { blue: 0, gold: 0, red: 0 };
    for (const [index, core] of snapshot.cores.entries()) {
      counts[core.kind] += 1;
      expect(core.id).toBe(index);
      expect(core.collected).toBe(false);
      expect(core.value).toBe(CORE_VALUES[core.kind]);
    }
    expect(counts).toEqual({ blue: 6, gold: 4, red: 2 });
    expect(CORE_VALUES).toEqual({ blue: 1, gold: 3, red: 5 });
    expect(snapshot.cores.filter((core) => core.kind === "blue").every((core) => core.value === 1)).toBe(true);
    expect(snapshot.cores.filter((core) => core.kind === "gold").every((core) => core.value === 3)).toBe(true);
    expect(snapshot.cores.filter((core) => core.kind === "red").every((core) => core.value === 5)).toBe(true);
    expect(snapshot.player.position).toEqual(PLAYER_SPAWN);
    expect(snapshot.score).toEqual({ score: 0, deposits: 0 });
    expect(await readEvents(page)).toEqual([]);

    await expect(page.locator("#overlay-title")).toHaveText("CORE RUN");
    await expect(page.locator("#start-button")).toBeVisible();
    await expect(page.locator("#results")).toBeHidden();
    await expect(page.locator("#hud-timer")).toHaveText(ROUND_SECONDS.toFixed(1));
    await expect(page.locator("#hud-score")).toHaveText("0");

    await page.screenshot({ path: testInfo.outputPath("core-run-title.png") });
    await expectNoErrors(page, diagnostics);
  });

  test("runs a deterministic round slice through semantic input", async ({ page }, testInfo) => {
    const diagnostics = await bootCoreRun(page);

    await startRound(page);
    const countdownEvents = eventsOfKind(await readEvents(page), "countdown").map((event) => event.value);
    expect(countdownEvents).toEqual([3, 2, 1, "go"]);
    expect(eventsOfKind(await readEvents(page), "phaseChanged")).toEqual([
      { kind: "phaseChanged", tick: 0, from: "title", to: "countdown" },
      { kind: "phaseChanged", tick: COUNTDOWN_TICKS, from: "countdown", to: "running" },
    ]);
    await expect(page.locator("#overlay")).toBeHidden();
    await expect(page.locator("#hud-timer")).toHaveText(ROUND_SECONDS.toFixed(1));

    // Movement: forward (-Z) accelerates to MAX_SPEED, releasing input settles to rest.
    await setInput(page, { moveX: 0, moveY: 1, cameraYaw: 0 });
    await stepTicks(page, 15);
    const moving = await readSnapshot(page);
    expect(moving.player.velocity.z).toBeCloseTo(-MAX_SPEED, 6);
    expect(moving.player.velocity.x).toBeCloseTo(0, 9);
    expect(moving.player.position.z).toBeLessThan(PLAYER_SPAWN.z);
    expect(moving.player.facing).toEqual({ x: 0, y: 0, z: -1 });
    expect(moving.player.grounded).toBe(true);
    await setInput(page, { moveX: 0, moveY: 0 });
    await stepTicks(page, SETTLE_TICKS);
    const settled = await readSnapshot(page);
    expect(horizontalSpeed(settled)).toBe(0);

    // Jump: one jump event, leaves the ground, lands again under gravity.
    await press(page, "jump");
    await stepTicks(page, 1);
    const airborne = await readSnapshot(page);
    expect(eventsOfKind(await readEvents(page), "jump")).toEqual([{ kind: "jump", tick: airborne.tick }]);
    expect(airborne.player.grounded).toBe(false);
    expect(airborne.player.velocity.y).toBeCloseTo(JUMP_SPEED - GRAVITY * DT, 9);
    expect(airborne.player.position.y).toBeGreaterThan(0);
    await stepTicks(page, 45);
    const landed = await readSnapshot(page);
    expect(landed.player.grounded).toBe(true);
    expect(landed.player.position.y).toBe(0);

    // Dash: burst along facing, cooldown gates a second dash until it expires.
    await press(page, "dash");
    await stepTicks(page, 1);
    const dashing = await readSnapshot(page);
    expect(eventsOfKind(await readEvents(page), "dash")).toHaveLength(1);
    expect(dashing.player.dashTicks).toBe(DASH_TICKS - 1);
    expect(dashing.player.dashCooldownTicks).toBe(DASH_COOLDOWN_TICKS);
    expect(dashing.player.velocity.z).toBeCloseTo(-DASH_SPEED, 9);
    await expect(page.locator("#hud-dash")).toHaveAttribute("data-ready", "false");
    await press(page, "dash");
    await stepTicks(page, 1);
    const gated = await readSnapshot(page);
    expect(eventsOfKind(await readEvents(page), "dash")).toHaveLength(1);
    expect(gated.player.dashCooldownTicks).toBe(DASH_COOLDOWN_TICKS - 1);
    await stepTicks(page, DASH_COOLDOWN_TICKS - 2);
    expect((await readSnapshot(page)).player.dashCooldownTicks).toBe(1);
    await expect(page.locator("#hud-dash")).toHaveAttribute("data-ready", "false");
    await stepTicks(page, 1);
    expect((await readSnapshot(page)).player.dashCooldownTicks).toBe(0);
    await expect(page.locator("#hud-dash")).toHaveText("Ready");
    await expect(page.locator("#hud-dash")).toHaveAttribute("data-ready", "true");
    await press(page, "dash");
    await stepTicks(page, 1);
    expect(eventsOfKind(await readEvents(page), "dash")).toHaveLength(2);
    await stepTicks(page, DASH_SETTLE_TICKS);
    const rested = await readSnapshot(page);
    expect(rested.player.dashTicks).toBe(0);
    expect(horizontalSpeed(rested)).toBe(0);

    // Pick up blue core 0, carry it to the Base, deposit for value x combo 1.
    const deposited = await carryCoreToBase(page, 0);
    expect(eventsOfKind(await readEvents(page), "corePickedUp")).toEqual([
      { kind: "corePickedUp", tick: expect.any(Number), coreId: 0, coreKind: "blue" },
    ]);
    expect(eventsOfKind(await readEvents(page), "coreDeposited")).toEqual([
      {
        kind: "coreDeposited",
        tick: deposited.tick,
        coreId: 0,
        value: 1,
        combo: 1,
        points: 1,
        score: 1,
      },
    ]);
    expect(deposited.score).toEqual({ score: 1, deposits: 1 });
    expect(deposited.combo).toEqual({ count: 1, windowTicks: COMBO_WINDOW_TICKS });
    expect(deposited.cores.filter((core) => core.collected).map((core) => core.id)).toEqual([0]);
    expect(deposited.phase).toBe("running");
    await expect(page.locator("#hud-score")).toHaveText("1");
    await expect(page.locator("#hud-combo-label")).toHaveText("x1");

    await page.screenshot({ path: testInfo.outputPath("core-run-running.png") });
    await expectNoErrors(page, diagnostics);
  });

  test("applies the combo multiplier inside the window and resets after it expires", async ({ page }) => {
    const diagnostics = await bootCoreRun(page);
    await startRound(page);

    const first = await carryCoreToBase(page, 0);
    expect(first.combo).toEqual({ count: 1, windowTicks: COMBO_WINDOW_TICKS });
    expect(first.score).toEqual({ score: 1, deposits: 1 });

    const second = await carryCoreToBase(page, 1);
    expect(second.tick - first.tick).toBeLessThan(COMBO_WINDOW_TICKS);
    expect(second.combo).toEqual({ count: 2, windowTicks: COMBO_WINDOW_TICKS });
    expect(second.score).toEqual({ score: 3, deposits: 2 });
    const deposits = eventsOfKind(await readEvents(page), "coreDeposited");
    expect(deposits).toHaveLength(2);
    expect(deposits[1]).toEqual({
      kind: "coreDeposited",
      tick: second.tick,
      coreId: 1,
      value: 1,
      combo: 2,
      points: 2,
      score: 3,
    });
    await expect(page.locator("#hud-combo-label")).toHaveText("x2");
    await expect(page.locator("#hud-combo-bar")).toHaveJSProperty("value", 1);
    await expect(page.locator("#hud-score")).toHaveText("3");

    await stepTicks(page, COMBO_WINDOW_TICKS - 1);
    const closing = await readSnapshot(page);
    expect(closing.combo).toEqual({ count: 2, windowTicks: 1 });
    expect(eventsOfKind(await readEvents(page), "comboExpired")).toEqual([]);

    await stepTicks(page, 1);
    const expired = await readSnapshot(page);
    expect(expired.combo).toEqual({ count: 0, windowTicks: 0 });
    expect(eventsOfKind(await readEvents(page), "comboExpired")).toEqual([
      { kind: "comboExpired", tick: second.tick + COMBO_WINDOW_TICKS, combo: 2 },
    ]);
    await expect(page.locator("#hud-combo-label")).toHaveText("");
    await expect(page.locator("#hud-combo-bar")).toHaveJSProperty("value", 0);

    const third = await carryCoreToBase(page, 2);
    expect(third.combo).toEqual({ count: 1, windowTicks: COMBO_WINDOW_TICKS });
    expect(third.score).toEqual({ score: 4, deposits: 3 });
    expect(eventsOfKind(await readEvents(page), "coreDeposited").at(-1)).toMatchObject({
      coreId: 2,
      combo: 1,
      points: 1,
      score: 4,
    });

    await expectNoErrors(page, diagnostics);
  });

  test("reaches timeUp and results, then Retry resets the round", async ({ page }, testInfo) => {
    const diagnostics = await bootCoreRun(page);
    await startRound(page);
    const deposited = await carryCoreToBase(page, 0);
    expect(deposited.score).toEqual({ score: 1, deposits: 1 });

    const remainingTicks = Math.round(deposited.remainingSeconds / DT);
    await stepTicks(page, remainingTicks - 1);
    const lastTick = await readSnapshot(page);
    expect(lastTick.phase).toBe("running");
    expect(lastTick.remainingSeconds).toBeCloseTo(DT, 9);

    await stepTicks(page, 1);
    const timeUp = await readSnapshot(page);
    expect(timeUp.phase).toBe("timeUp");
    expect(timeUp.tick).toBe(COUNTDOWN_TICKS + ROUND_TICKS);
    expect(timeUp.remainingSeconds).toBe(0);
    await expect(page.locator("#overlay")).toBeVisible();
    await expect(page.locator("#overlay-countdown")).toHaveText("TIME UP");
    await expect(page.locator("#hud-timer")).toHaveText("0.0");
    await expect(page.locator("#results")).toBeHidden();

    await stepTicks(page, TIME_UP_TICKS - 1);
    expect((await readSnapshot(page)).phase).toBe("timeUp");
    await stepTicks(page, 1);
    const results = await readSnapshot(page);
    expect(results.phase).toBe("results");
    expect(results.score).toEqual({ score: 1, deposits: 1 });
    expect(eventsOfKind(await readEvents(page), "phaseChanged").map((event) => event.to)).toEqual([
      "countdown",
      "running",
      "timeUp",
      "results",
    ]);
    await expect(page.locator("#results")).toBeVisible();
    await expect(page.locator("#results-score")).toHaveText("1");
    await expect(page.locator("#results-deposits")).toHaveText("1");
    await expect(page.locator("#results-best-combo")).toHaveText("x1");
    await page.screenshot({ path: testInfo.outputPath("core-run-results.png") });

    await page.locator("#retry-button").click();
    const retried = await readSnapshot(page);
    expect(retried.phase).toBe("countdown");
    expect(retried.tick).toBe(0);
    expect(retried.countdownValue).toBe(COUNTDOWN_SECONDS);
    expect(retried.remainingSeconds).toBe(ROUND_SECONDS);
    expect(retried.score).toEqual({ score: 0, deposits: 0 });
    expect(retried.combo).toEqual({ count: 0, windowTicks: 0 });
    expect(retried.carry).toEqual({ coreId: null, lastDepositTick: -1 });
    expect(retried.cores).toHaveLength(12);
    expect(retried.cores.every((core) => !core.collected)).toBe(true);
    expect(retried.player.position).toEqual(PLAYER_SPAWN);
    expect(retried.player.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(retried.player.grounded).toBe(true);
    expect(retried.player.dashCooldownTicks).toBe(0);
    expect(retried.player.dashTicks).toBe(0);
    expect(eventsOfKind(await readEvents(page), "phaseChanged").at(-1)).toEqual({
      kind: "phaseChanged",
      tick: 0,
      from: "title",
      to: "countdown",
    });
    await expect(page.locator("#results")).toBeHidden();
    await expect(page.locator("#overlay-countdown")).toHaveText(String(COUNTDOWN_SECONDS));
    await expect(page.locator("#hud-score")).toHaveText("0");
    await expect(page.locator("#hud-timer")).toHaveText(ROUND_SECONDS.toFixed(1));

    await stepTicks(page, COUNTDOWN_TICKS);
    const secondRound = await readSnapshot(page);
    expect(secondRound.phase).toBe("running");
    expect(secondRound.remainingSeconds).toBe(ROUND_SECONDS);

    await expectNoErrors(page, diagnostics);
  });

  test("hazard slows, jump pad launches, and platform motion is deterministic", async ({ page }) => {
    const diagnostics = await bootCoreRun(page);
    expect((await readSnapshot(page)).platform.position).toEqual(platformPosition(0));
    await startRound(page);

    // Hazard: entering the slow zone emits hazardEntered and caps speed.
    await moveUntilNear(page, HAZARD_CENTER, 0.5, NAVIGATION_TICK_BUDGET);
    const slowed = await readSnapshot(page);
    expect(slowed.player.inHazard).toBe(true);
    expect(slowed.player.speedMultiplier).toBe(HAZARD_SPEED_MULTIPLIER);
    expect(horizontalSpeed(slowed)).toBeGreaterThan(0);
    expect(horizontalSpeed(slowed)).toBeLessThanOrEqual(MAX_SPEED * HAZARD_SPEED_MULTIPLIER + 1e-6);
    expect(eventsOfKind(await readEvents(page), "hazardEntered")).toHaveLength(1);
    expect(eventsOfKind(await readEvents(page), "hazardExited")).toHaveLength(0);
    await stepTicks(page, SETTLE_TICKS);

    // Jump pad: first grounded contact within the pad radius launches the player.
    await moveUntilNear(page, JUMP_PAD_POSITION, JUMP_PAD_RADIUS, NAVIGATION_TICK_BUDGET);
    const launched = await readSnapshot(page);
    expect(launched.player.inHazard).toBe(false);
    expect(launched.player.speedMultiplier).toBe(1);
    expect(eventsOfKind(await readEvents(page), "hazardExited")).toHaveLength(1);
    expect(eventsOfKind(await readEvents(page), "jumpPad")).toEqual([
      { kind: "jumpPad", tick: launched.tick },
    ]);
    expect(launched.player.grounded).toBe(false);
    expect(launched.player.velocity.y).toBe(JUMP_PAD_IMPULSE);
    await stepTicks(page, 28);
    expect((await readSnapshot(page)).player.position.y).toBeGreaterThan(3);

    // Platform: position is a pure function of simulation time.
    const sampled = await page.evaluate((dt) => {
      const handle = Reflect.get(window, "__CORE_RUN__") as CoreRunTestHandle;
      const samples: { tick: number; x: number; y: number; z: number }[] = [];
      for (let index = 0; index < 30; index += 1) {
        handle.advance(dt);
        const snapshot = handle.snapshot();
        samples.push({ tick: snapshot.tick, ...snapshot.platform.position });
      }
      return samples;
    }, DT);
    expect(sampled).toHaveLength(30);
    for (const sample of sampled) {
      const expected = platformPosition(sample.tick * DT);
      expect(sample.x).toBeCloseTo(expected.x, 9);
      expect(sample.y).toBe(expected.y);
      expect(sample.z).toBe(expected.z);
    }
    const firstRun = await readSnapshot(page);

    // Same tick count after a restart reproduces the platform exactly.
    await page.evaluate(() => {
      (Reflect.get(window, "__CORE_RUN__") as CoreRunTestHandle).restart();
    });
    await startRound(page);
    await stepTicks(page, firstRun.tick - COUNTDOWN_TICKS);
    const secondRun = await readSnapshot(page);
    expect(secondRun.tick).toBe(firstRun.tick);
    expect(secondRun.platform).toEqual(firstRun.platform);

    await expectNoErrors(page, diagnostics);
  });

  test("moving-platform Feature carries a player standing on it", () => {
    const feature = createMovingPlatformFeature();
    const state = createCoreRunState();
    const events: TelemetryEvent[] = [];
    feature.reset(state, DT);
    expect(feature.id).toBe("core-run.moving-platform");
    expect(state.platform.position).toEqual(platformPosition(0));
    expect(state.player.onPlatform).toBe(false);

    const step = (tick: number): void => {
      state.tick = tick;
      feature.step(state, {
        tick,
        dt: DT,
        time: tick * DT,
        pressed: new Set(),
        emit: (event) => events.push(event),
      });
    };

    state.player.position = PLATFORM_CENTER;
    state.player.velocity = vec3(0, 0, 0);
    state.player.grounded = false;
    step(1);
    expect(state.player.onPlatform).toBe(true);
    expect(state.player.grounded).toBe(true);
    const offset = state.player.position.x - state.platform.position.x;
    for (let tick = 2; tick <= 90; tick += 1) {
      step(tick);
      expect(state.platform.position).toEqual(platformPosition(tick * DT));
      expect(state.player.onPlatform).toBe(true);
      expect(state.player.grounded).toBe(true);
      expect(state.player.position.y).toBe(PLATFORM_CENTER.y);
      expect(state.player.position.x - state.platform.position.x).toBeCloseTo(offset, 9);
    }
    expect(state.player.position.x).toBeCloseTo(
      platformPosition(90 * DT).x - platformPosition(DT).x,
      9,
    );
    expect(state.player.position.x).toBeGreaterThan(3);

    // Off the platform the player stops being carried.
    const offX = state.platform.position.x + PLATFORM_HALF_WIDTH + 1;
    state.player.position = vec3(offX, PLATFORM_CENTER.y, PLATFORM_CENTER.z);
    step(91);
    const carriedOnce = offX + platformPosition(91 * DT).x - platformPosition(90 * DT).x;
    expect(state.player.onPlatform).toBe(false);
    expect(state.player.position.x).toBeCloseTo(carriedOnce, 9);
    step(92);
    expect(state.player.onPlatform).toBe(false);
    expect(state.player.position.x).toBeCloseTo(carriedOnce, 9);

    // Hovering above the snap tolerance never lands.
    state.player.position = vec3(state.platform.position.x, PLATFORM_CENTER.y + 1, PLATFORM_CENTER.z);
    state.player.velocity = vec3(0, -1, 0);
    step(93);
    expect(state.player.onPlatform).toBe(false);
    expect(state.player.position.y).toBe(PLATFORM_CENTER.y + 1);
    expect(events).toEqual([]);
  });

  test("dispose releases listeners and handles, restart yields a clean state", async ({ page }) => {
    const diagnostics = await bootCoreRun(page);

    const before = await readLeaks(page);
    expect(before.hostListeners).toBeGreaterThan(0);
    expect(before).toMatchObject({
      rafActive: false,
      rafHandle: null,
      pointerDragging: false,
      hostDisposed: false,
      game: { activeListeners: 1, activeSubscriptions: 7, activeTimers: 0 },
    });
    expect(before.renderer?.frames).toBeGreaterThan(0);

    // Dirty the state so the restart has something to clean.
    await startRound(page);
    await stepTicks(page, 60);
    await press(page, "dash");
    await stepTicks(page, 1);
    const dirty = await readLeaks(page);
    expect(dirty.renderer?.activeParticles).toBeGreaterThan(0);
    expect((await readSnapshot(page)).tick).toBe(COUNTDOWN_TICKS + 61);

    const disposed = await page.evaluate(() => {
      const handle = Reflect.get(window, "__CORE_RUN__") as CoreRunTestHandle;
      handle.dispose();
      handle.dispose();
      return {
        leaks: handle.inspectLeaks(),
        ready: handle.ready,
        screenshotReady: handle.screenshotReady,
        status: handle.status,
        stepsAfterDispose: handle.advance(1),
      };
    });
    expect(disposed.leaks).toEqual({
      hostListeners: 0,
      rafActive: false,
      rafHandle: null,
      pointerDragging: false,
      hostDisposed: true,
      game: { activeListeners: 0, activeSubscriptions: 0, activeTimers: 0 },
      renderer: {
        frames: expect.any(Number),
        drawCalls: expect.any(Number),
        activeParticles: 0,
        activePopups: 0,
        eventsConsumed: expect.any(Number),
      },
    });
    expect(disposed.ready).toBe(false);
    expect(disposed.screenshotReady).toBe(false);
    expect(disposed.status).toBe("Core Run host disposed");
    expect(disposed.stepsAfterDispose).toBe(0);
    await expect(page.locator("#status")).toHaveText("Core Run host disposed");

    const restarted = await page.evaluate(() => {
      const handle = Reflect.get(window, "__CORE_RUN__") as CoreRunTestHandle;
      handle.restart();
      return {
        ready: handle.ready,
        screenshotReady: handle.screenshotReady,
        status: handle.status,
        leaks: handle.inspectLeaks(),
        events: handle.events(),
      };
    });
    expect(restarted.ready).toBe(true);
    expect(restarted.screenshotReady).toBe(true);
    expect(restarted.status).toBe("Test mode: time advances only via window.__CORE_RUN__.advance()");
    expect(restarted.events).toEqual([]);
    expect(restarted.leaks).toMatchObject({
      hostListeners: before.hostListeners,
      rafActive: false,
      rafHandle: null,
      pointerDragging: false,
      hostDisposed: false,
      game: { activeListeners: 1, activeSubscriptions: 7, activeTimers: 0 },
      renderer: { frames: 1, activeParticles: 0, activePopups: 0, eventsConsumed: 0 },
    });
    const clean = await readSnapshot(page);
    expect(clean.phase).toBe("title");
    expect(clean.tick).toBe(0);
    expect(clean.score).toEqual({ score: 0, deposits: 0 });
    expect(clean.combo).toEqual({ count: 0, windowTicks: 0 });
    expect(clean.carry).toEqual({ coreId: null, lastDepositTick: -1 });
    expect(clean.cores).toHaveLength(12);
    expect(clean.cores.every((core) => !core.collected)).toBe(true);
    expect(clean.player.position).toEqual(PLAYER_SPAWN);
    expect(clean.player.dashCooldownTicks).toBe(0);
    await expect(page.locator("#overlay-title")).toBeVisible();

    // The restarted host is fully functional.
    await startRound(page);
    expect((await readSnapshot(page)).tick).toBe(COUNTDOWN_TICKS);

    await expectNoErrors(page, diagnostics);
  });
});
