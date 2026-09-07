import { expect, test } from "@playwright/test";

test("particle shaders render visible instanced quads, reuse GPU resources, and dispose", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto("/examples/particles/index.html?test=1");
    await page.waitForFunction(() => "__particles" in window);
    const result = await page.evaluate(() => {
        const api = (window as unknown as { __particles: {
            present(time: number): void; pixelEnergy(): number;
            inspect(): { calls: number; triangles: number; geometries: number; programs: number; emitters: { activeParticleCount: number }[] };
        } }).__particles;
        const empty = api.pixelEnergy();
        for (let time = 100; time <= 1000; time += 100) api.present(time);
        const first = api.inspect(), bright = api.pixelEnergy();
        for (let time = 1100; time <= 5000; time += 100) api.present(time);
        return { empty, bright, first, last: api.inspect() };
    });
    expect(result.empty).toBe(0);
    expect(result.bright).toBeGreaterThan(100);
    expect(result.first.calls).toBe(3);
    expect(result.last.calls).toBe(3);
    expect(result.last.triangles).toBe(result.last.emitters.reduce((n, e) => n + e.activeParticleCount * 2, 0));
    expect(result.last.geometries).toBe(3);
    expect(result.last.programs).toBe(result.first.programs);
    await page.getByRole("button", { name: "Pause emission" }).click();
    await page.evaluate(() => (window as any).__particles.present(10000));
    await expect(page.locator("output")).toContainText("0 particles / 0 draw calls");
    await page.getByRole("button", { name: "Emit burst" }).click();
    await expect(page.locator("output")).toContainText("360 particles / 3 draw calls");
    await page.getByRole("button", { name: "Restart" }).click();
    await page.evaluate(() => (window as any).__particles.present(11000));
    await page.screenshot({ path: "test-results/particles-workshop.png" });
    const disposed = await page.evaluate(() => { const api = (window as any).__particles; api.dispose(); api.dispose(); return api.inspect(); });
    expect(disposed.children).toBe(0);
    expect(disposed.geometries).toBe(0);
    expect(disposed.programs).toBe(0);
    expect(errors).toEqual([]);
});
