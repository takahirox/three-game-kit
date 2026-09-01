import { expect, test } from "@playwright/test";

test("Priority C advanced Features compose independently and clean up", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message)); await page.goto("/examples/advanced-features/index.html"); await page.getByRole("button", { name: "Run advanced features" }).click(); await page.waitForFunction(() => Reflect.get(window, "__THREE_GAME_KIT_ADVANCED__")?.ready === true); const report = await page.evaluate(() => Reflect.get(window, "__THREE_GAME_KIT_ADVANCED__"));
  expect(errors).toEqual([]); expect(report).toMatchObject({ ready: true, dialogueLineId: "quest.accepted", postRenderCount: 1, action: "jump", debugProviders: ["dialogue", "vehicles"], cleanup: { clean: true, allDisposed: true, disposedOrder: ["post-processing", "camera-extensions", "debug-devtools.client", "input-experience-extensions", "vehicles.client", "dialogue.client"] } }); expect(report.vehicleSpeed).toBeGreaterThan(0); expect(report.cameraZ).toBe(4); expect(report.movementX).toBe(1);
});
