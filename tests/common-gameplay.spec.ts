import { expect, test } from "@playwright/test";

test("Priority A common gameplay Features compose and clean up in Chromium", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/examples/common-gameplay/index.html");
  await page.getByRole("button", { name: "Run common gameplay" }).click();
  await page.waitForFunction(() => Reflect.get(window, "__THREE_GAME_KIT_COMMON_GAMEPLAY__")?.ready === true);
  const report = await page.evaluate(() => Reflect.get(window, "__THREE_GAME_KIT_COMMON_GAMEPLAY__"));
  expect(errors).toEqual([]);
  expect(report).toMatchObject({
    ready: true,
    triggerKinds: ["enter", "stay"],
    health: 8,
    pooledEnemyCount: 0,
    flowState: "play",
    actions: ["pause"],
    cleanup: {
      clean: true,
      allDisposed: true,
      hudChildrenRetained: true,
      disposedOrder: ["ui-hud", "game-flow.client", "spawn-prefab.client", "health-damage.client", "trigger-area.client"],
    },
  });
  expect(report.hudText).toContain("Score: 100");
  expect(report.hudText).toContain("Health: 8/10");
  expect(report.hudText).toContain("Area events: 2");
});
