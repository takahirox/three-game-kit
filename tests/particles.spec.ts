import { expect, test } from "@playwright/test";

test("all twenty presets render, switch, and release their bounded GPU resources", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto("/examples/particles/index.html?test=1");
    await page.waitForFunction(() => "__particles" in window);
    await expect(page.locator(".card")).toHaveCount(20);
    const initial = await page.evaluate(() => (window as any).__particles.inspect());
    expect(initial.initializedCount).toBeLessThan(20);
    expect(initial.renderedIds.length).toBeGreaterThan(1);
    await page.screenshot({ path: "test-results/particles-workshop.png" });

    const results = await page.evaluate(() => {
        const api = (window as any).__particles;
        let time = 0;
        return api.inspect().presetIds.map((id: string) => {
            api.select(id);
            for (let i = 0; i < 10; i++) { time += 32; api.present(time); }
            return { id, ...api.inspect(), bright: api.pixelEnergy() };
        });
    });
    for (const result of results) {
        expect(result.renderedIds, result.id).toEqual([result.id]);
        expect(result.bright, `${result.id} visible pixels`).toBeGreaterThan(20);
        expect(result.calls, result.id).toBeGreaterThan(0);
        expect(result.calls, `${result.id} draw budget`).toBeLessThanOrEqual(5);
        expect(result.triangles, result.id).toBe(result.particles * 2);
    }
    const populated = await page.evaluate(() => (window as any).__particles.inspect());
    expect(populated.initializedCount).toBe(20);
    expect(populated.textures).toBeLessThanOrEqual(8);
    expect(populated.geometries).toBeLessThanOrEqual(60);
    await page.evaluate(() => { const api = (window as any).__particles; for (const id of api.inspect().presetIds) api.select(id); });
    const reused = await page.evaluate(() => (window as any).__particles.inspect());
    expect(reused.geometries).toBe(populated.geometries);
    expect(reused.programs).toBe(populated.programs);
    expect(reused.textures).toBe(populated.textures);

    await page.evaluate(() => (window as any).__particles.select("singularity"));
    await expect(page.getByRole("region", { name: "Singularity", exact: true })).toBeVisible();
    await page.screenshot({ path: "test-results/particles-singularity.png" });
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const frozen = await page.evaluate(() => { const api = (window as any).__particles; const before = api.inspect().particles; api.present(10000); return { before, after: api.inspect().particles, paused: api.inspect().paused }; });
    expect(frozen.paused).toBe(true); expect(frozen.after).toBe(frozen.before);
    await page.getByRole("button", { name: "Burst", exact: false }).click();
    await expect(page.locator("#stats")).toContainText("1 LIVE EFFECT");
    expect(await page.evaluate(() => (window as any).__particles.inspect().particles)).toBeGreaterThan(frozen.before);
    await page.getByRole("button", { name: "Restart", exact: false }).click();
    const restarted = await page.evaluate(() => (window as any).__particles.inspect());
    expect(restarted.particles).toBe(800);
    expect(restarted.geometries).toBe(populated.geometries);
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#focus-title")).toHaveText("Storm core");
    await page.keyboard.press("Escape");
    await expect(page.locator("#focus")).toBeHidden();
    await page.getByRole("button", { name: "Magic", exact: true }).click();
    await expect(page.locator(".card:visible")).toHaveCount(4);
    const disposed = await page.evaluate(() => { const api = (window as any).__particles; api.dispose(); api.dispose(); return api.inspect(); });
    expect(disposed.children).toBe(0); expect(disposed.geometries).toBe(0); expect(disposed.programs).toBe(0); expect(disposed.textures).toBe(0);
    expect(errors).toEqual([]);
});

test("mobile gallery scrolls to the remaining effects and supports focus navigation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/examples/particles/index.html?test=1");
    await page.waitForFunction(() => "__particles" in window);
    await page.locator('[data-id="matrix"]').scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => (window as any).__particles.inspect().renderedIds)).toContain("matrix");
    await page.locator('[data-id="matrix"]').click();
    await expect(page.locator("#focus-title")).toHaveText("Digital rain");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({ path: "test-results/particles-mobile.png" });
    await page.getByRole("button", { name: "Next effect" }).click();
    await expect(page.locator("#focus-title")).toHaveText("Solar flare");
    await page.getByRole("button", { name: "All experiments" }).click();
    await expect(page.locator("#focus")).toBeHidden();
});
