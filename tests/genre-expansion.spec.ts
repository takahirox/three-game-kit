import { expect, test } from "@playwright/test";

test("Priority B genre expansion Features compose and clean up in Chromium", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/examples/genre-expansion/index.html");
  await page.getByRole("button", { name: "Run genre expansion" }).click();
  await page.waitForFunction(() => Reflect.get(window, "__THREE_GAME_KIT_GENRE_EXPANSION__")?.ready === true);
  const report = await page.evaluate(() => Reflect.get(window, "__THREE_GAME_KIT_GENRE_EXPANSION__"));
  expect(errors).toEqual([]);
  expect(report).toMatchObject({ ready: true, physicsSteps: 2, projectileKinds: ["moved", "moved"], abilityKinds: ["started", "completed"], inventoryCount: 2, loadedScore: 7, cleanup: { clean: true, allDisposed: true, disposedOrder: ["save-load.client", "inventory.client", "simple-ai-navigation.client", "ability-skill.client", "projectile.client", "general-physics.client"] } });
  expect(report.aiX).toBeGreaterThan(0);
});
