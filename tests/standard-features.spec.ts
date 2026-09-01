import { expect, test } from "@playwright/test";

test("Priority S standard Features compose and clean up in Chromium", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/examples/standard-features/index.html");
  await page.getByRole("button", { name: "Run standard Features" }).click();
  await page.waitForFunction(() => Reflect.get(window, "__THREE_GAME_KIT_STANDARD__")?.ready === true);
  const report = await page.evaluate(() => Reflect.get(window, "__THREE_GAME_KIT_STANDARD__"));
  expect(errors).toEqual([]);
  expect(report).toMatchObject({
    ready: true,
    loaded: true,
    audio: { available: true, unlocked: true, disposed: true },
    animation: { state: "idle", disposed: true },
    character: { ticks: 3, disposed: true },
    assets: { completed: 3, disposed: true },
    shutdown: {
      clean: true,
      disposedOrder: ["character-controller", "animation", "audio", "asset-manager"],
    },
  });
  expect(report.animation.elapsedSeconds).toBeCloseTo(3 / 60, 12);
});
