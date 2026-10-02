import { expect, test, type CDPSession, type Page } from "@playwright/test";
import type {} from "../showcases/metaverse/src/main.js";

type Contact = { id: number; x: number; y: number };
async function touch(cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel", contacts: Contact[]) {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: contacts });
  // Chromium coalesces pointer moves until a rendering opportunity.
  await cdp.send("Runtime.evaluate", { expression: "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))", awaitPromise: true });
}
async function center(page: Page, selector: string) {
  const b = await page.locator(selector).boundingBox();
  expect(b).not.toBeNull();
  return { x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 };
}
async function boot(page: Page) {
  await page.goto("/showcases/metaverse/index.html?test=1");
  await expect.poll(() => page.evaluate(() => window.__METAVERSE__?.ready)).toBe(true);
  await expect(page.locator("#move-stick")).toBeHidden();
  await page.getByRole("button", { name: "Enter the court" }).tap();
  await page.evaluate(() => window.__METAVERSE__.advance(0.2));
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1024, height: 768 },
]) {
  test.describe(`touch ${viewport.width}×${viewport.height}`, () => {
    test.use({ hasTouch: true, isMobile: true, viewport });
    test("enter, walk/run, simultaneous look, jump, interact and leave without a keyboard", async ({ page }, info) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      await boot(page);
      await expect(page.locator("#move-stick")).toBeVisible();
      for (const selector of ["#move-stick", "#touch-run", "#touch-jump", '[data-hud-action="interact"]', '.toolbar button']) {
        for (const box of await page.locator(selector).all()) {
          const b = (await box.boundingBox())!;
          expect(b.width).toBeGreaterThanOrEqual(48);
          expect(b.height).toBeGreaterThanOrEqual(48);
          expect(b.x).toBeGreaterThanOrEqual(0);
          expect(b.y).toBeGreaterThanOrEqual(0);
          expect(b.x + b.width).toBeLessThanOrEqual(viewport.width);
          expect(b.y + b.height).toBeLessThanOrEqual(viewport.height);
        }
      }
      const stick = await center(page, "#move-stick");
      const move = { id: 1, x: stick.x, y: stick.y - 42 };
      const look = { id: 2, x: viewport.width * 0.65, y: viewport.height * 0.45 };
      const cdp = await page.context().newCDPSession(page);
      await touch(cdp, "touchStart", [{ id: 1, ...stick }]);
      await touch(cdp, "touchMove", [move]);
      await page.evaluate(() => window.__METAVERSE__.advance(0.5));
      expect(await page.evaluate(() => window.__METAVERSE__.snapshot()?.avatar.position.z)).toBeCloseTo(3.8, 3);
      expect(await page.evaluate(() => window.__METAVERSE__.snapshot()?.avatar.locomotion)).toBe("walk");
      expect(await page.evaluate(() => window.__METAVERSE__.snapshot()?.camera.yaw)).toBe(0);

      // A second finger starts without a camera jump and leaves the joystick active.
      await touch(cdp, "touchStart", [move, look]);
      expect(await page.evaluate(() => window.__METAVERSE__.snapshot()?.camera.yaw)).toBe(0);
      await touch(cdp, "touchMove", [move, { ...look, x: look.x + 50 }]);
      await page.evaluate(() => window.__METAVERSE__.advance(0.5));
      const simultaneous = await page.evaluate(() => window.__METAVERSE__.snapshot()!);
      expect(simultaneous.camera.yaw).toBeCloseTo(-0.3, 4);
      expect(simultaneous.avatar.position.x).toBeCloseTo(Math.sin(-0.3) * 1.2, 3);
      expect(simultaneous.avatar.position.z).toBeLessThan(3);
      await touch(cdp, "touchEnd", [{ ...look, x: look.x + 50 }]);

      expect(await page.evaluate(() => window.__METAVERSE__.inspectLeaks().touch)).toMatchObject({
        lookPointer: null, capturedPointers: 1,
      });
      // Tap Run and Jump while the first finger still holds movement.
      for (const selector of ["#touch-run", "#touch-jump"]) {
        const button = { id: 3, ...await center(page, selector) };
        await touch(cdp, "touchStart", [move, button]);
        await touch(cdp, "touchEnd", [button]);
      }
      await expect(page.locator("#touch-run")).toHaveAttribute("aria-pressed", "true");
      await page.evaluate(() => window.__METAVERSE__.advance(0.2));
      const jumping = await page.evaluate(() => window.__METAVERSE__.snapshot()!);
      expect(jumping.avatar.grounded).toBe(false);
      expect(jumping.avatar.locomotion).toBe("run");
      expect(Math.hypot(jumping.avatar.velocity.x, jumping.avatar.velocity.z)).toBeCloseTo(4.8, 3);
      expect(jumping.camera.yaw).toBeCloseTo(-0.3, 4);
      await touch(cdp, "touchEnd", []);
      await page.evaluate(() => window.__METAVERSE__.advance(1.2));
      expect(await page.evaluate(() => window.__METAVERSE__.snapshot()?.avatar.grounded)).toBe(true);
      expect(await page.evaluate(() => window.__METAVERSE__.snapshot()?.avatar.locomotion)).toBe("idle");

      // Reach and toggle the actual lantern using physical touch only.
      await page.getByRole("button", { name: "Restart", exact: true }).tap();
      await expect(page.locator("#touch-run")).toHaveAttribute("aria-pressed", "false");
      await touch(cdp, "touchStart", [{ id: 1, ...stick }]);
      await touch(cdp, "touchMove", [move]);
      await page.evaluate(() => window.__METAVERSE__.advance(2.5));
      const interaction = { id: 3, ...await center(page, '[data-hud-action="interact"]') };
      await touch(cdp, "touchStart", [move, interaction]);
      await touch(cdp, "touchEnd", [interaction]);
      await page.evaluate(() => window.__METAVERSE__.advance(0.2));
      await touch(cdp, "touchEnd", []);
      expect(await page.evaluate(() => window.__METAVERSE__.snapshot()?.interaction)).toMatchObject({ active: true, toggles: 1 });
      await page.evaluate(() => window.__METAVERSE__.advance(1));
      expect(await page.evaluate(() => window.__METAVERSE__.snapshot()?.interaction.toggles)).toBe(1);
      expect(await page.evaluate(() => window.__METAVERSE__.snapshot()?.camera.yaw)).toBe(0);
      // Primary-finger taps must not double emit through the native HUD click.
      await page.getByRole("button", { name: "Extinguish the courtyard lantern" }).tap();
      await page.evaluate(() => window.__METAVERSE__.advance(0.2));
      expect(await page.evaluate(() => window.__METAVERSE__.snapshot()?.interaction)).toMatchObject({ active: false, toggles: 2 });
      await page.getByRole("button", { name: "Light the courtyard lantern" }).tap();
      await page.evaluate(() => window.__METAVERSE__.advance(0.2));
      expect(await page.evaluate(() => window.__METAVERSE__.snapshot()?.interaction)).toMatchObject({ active: true, toggles: 3 });
      await page.screenshot({ path: info.outputPath("touch-lantern.png") });

      // Leave while both input pointers are still captured.
      await touch(cdp, "touchStart", [{ id: 1, ...stick }, look]);
      await page.evaluate(() => window.__METAVERSE__.dispose());
      expect(await page.evaluate(() => window.__METAVERSE__.inspectLeaks())).toMatchObject({
        hostListeners: 0, rafActive: false, pointerCaptured: false,
        touch: { disposed: true, listeners: 0, movePointer: null, lookPointer: null,
          capturedPointers: 0, input: { disposed: true, connectedDeviceIds: [], queuedActions: 0 } },
        game: { lifecycle: "stopped", controllerDisposed: true },
      });
      await touch(cdp, "touchEnd", []);
      expect(await page.evaluate(() => window.__METAVERSE__.errors())).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}

test.describe("touch cancellation", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  test("dead zone, normalized diagonals, invalid look, cancel, focus loss and restart clear pointers", async ({ page }) => {
    await boot(page);
    const cdp = await page.context().newCDPSession(page);
    const stick = await center(page, "#move-stick");
    const look = { id: 2, x: 550, y: 160 };
    await touch(cdp, "touchStart", [{ id: 1, ...stick }]);
    await touch(cdp, "touchMove", [{ id: 1, x: stick.x + 2, y: stick.y }]);
    await page.evaluate(() => window.__METAVERSE__.advance(0.5));
    expect(await page.evaluate(() => window.__METAVERSE__.snapshot()?.avatar.position.x)).toBeCloseTo(0, 5);
    const diagonal = { id: 1, x: stick.x + 70, y: stick.y - 70 };
    await touch(cdp, "touchMove", [diagonal]);
    await page.evaluate(() => window.__METAVERSE__.advance(0.5));
    expect(await page.evaluate(() => {
      const p = window.__METAVERSE__.snapshot()!.avatar.position;
      return Math.hypot(p.x, p.z - 5);
    })).toBeCloseTo(1.2, 3);
    await touch(cdp, "touchStart", [diagonal, look]);
    await page.evaluate(() => {
      const pointerId = window.__METAVERSE__.inspectLeaks().touch.lookPointer!;
      const canvas = document.querySelector("#world")!;
      for (const clientX of [NaN, Infinity, -Infinity]) {
        const event = new PointerEvent("pointermove", { pointerId });
        Object.defineProperty(event, "clientX", { value: clientX });
        canvas.dispatchEvent(event);
      }
    });
    expect(await page.evaluate(() => window.__METAVERSE__.snapshot()?.camera.yaw)).toBe(0);
    await touch(cdp, "touchCancel", []);
    await page.evaluate(() => window.__METAVERSE__.advance(0.2));
    expect(await page.evaluate(() => window.__METAVERSE__.inspectLeaks().touch)).toMatchObject({ movePointer: null, lookPointer: null, capturedPointers: 0 });
    expect(await page.evaluate(() => window.__METAVERSE__.snapshot()?.avatar.locomotion)).toBe("idle");
    for (const clear of ["blur", "restart", "resize"] as const) {
      await touch(cdp, "touchStart", [{ id: 1, ...stick }, look]);
      await touch(cdp, "touchMove", [diagonal, look]);
      await page.evaluate((kind) => {
        if (kind === "restart") window.__METAVERSE__.restart();
        else window.dispatchEvent(new Event(kind));
        window.__METAVERSE__.advance(0.2);
      }, clear);
      expect(await page.evaluate(() => window.__METAVERSE__.inspectLeaks().touch)).toMatchObject({ movePointer: null, lookPointer: null, capturedPointers: 0, running: false });
      expect(await page.evaluate(() => window.__METAVERSE__.snapshot()?.avatar.locomotion)).toBe("idle");
      await touch(cdp, "touchEnd", []);
    }
    // Holding Jump fires once; releasing it must not enqueue a second jump.
    const jump = { id: 3, ...await center(page, "#touch-jump") };
    await touch(cdp, "touchStart", [jump]);
    await page.evaluate(() => window.__METAVERSE__.advance(0.2));
    expect(await page.evaluate(() => window.__METAVERSE__.snapshot()?.avatar.grounded)).toBe(false);
    await page.evaluate(() => window.__METAVERSE__.advance(1.2));
    expect(await page.evaluate(() => window.__METAVERSE__.snapshot()?.avatar.grounded)).toBe(true);
    await touch(cdp, "touchEnd", []);
    await page.evaluate(() => window.__METAVERSE__.advance(0.2));
    expect(await page.evaluate(() => window.__METAVERSE__.snapshot()?.avatar.grounded)).toBe(true);
    await page.evaluate(() => window.__METAVERSE__.dispose());
    expect(await page.evaluate(() => window.__METAVERSE__.errors())).toEqual([]);
  });
});
