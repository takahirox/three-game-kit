import { expect, test } from "@playwright/test";

test("all twenty-six presets render, switch, and release their bounded GPU resources", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto("/examples/particles/index.html?test=1");
    await page.waitForFunction(() => "__particles" in window);
    await expect(page.locator(".card")).toHaveCount(26);
    const initial = await page.evaluate(() => (window as any).__particles.inspect());
    expect(initial.initializedCount).toBeLessThan(26);
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
        expect(result.calls, `${result.id} draw budget`).toBeLessThanOrEqual(result.id === "shards" ? 7 : 5);
        if (["turbulence", "orbital-current", "comet", "shards", "cascade", "surface"].includes(result.id)) {
            expect(result.triangles, result.id).toBeGreaterThanOrEqual(result.particles * 2);
        } else expect(result.triangles, result.id).toBe(result.particles * 2);
    }
    const populated = await page.evaluate(() => (window as any).__particles.inspect());
    expect(populated.initializedCount).toBe(26);
    // Eight shared sprites, opaque depth/color, shadow depth/color, and Three.js's renderer-owned DFG lookup texture.
    // Comet also owns a shadow depth/color pair.
    expect(populated.textures).toBeLessThanOrEqual(15);
    expect(populated.geometries).toBeLessThanOrEqual(80);
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
    await expect(page.locator(".card:visible")).toHaveCount(5);
    const disposed = await page.evaluate(() => { const api = (window as any).__particles; api.dispose(); api.dispose(); return api.inspect(); });
    expect(disposed.children).toBe(0); expect(disposed.geometries).toBe(0); expect(disposed.programs).toBe(0); expect(disposed.textures).toBe(1); // Three.js caches its DFG LUT beyond material disposal.
    expect(errors).toEqual([]);
});

test("mobile gallery scrolls to the remaining effects and supports focus navigation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/examples/particles/index.html?test=1");
    await page.waitForFunction(() => "__particles" in window);
    await page.locator('[data-id="surface"]').scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => (window as any).__particles.inspect().renderedIds)).toContain("surface");
    await page.locator('[data-id="surface"]').click();
    await expect(page.locator("#focus-title")).toHaveText("Prismatic forge");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({ path: "test-results/particles-mobile.png" });
    await page.getByRole("button", { name: "Next effect" }).click();
    await expect(page.locator("#focus-title")).toHaveText("Solar flare");
    await page.getByRole("button", { name: "All experiments" }).click();
    await expect(page.locator("#focus")).toBeHidden();
});

test("authored formations remain populated beyond their original particle lifetime", async ({ page }) => {
    await page.goto("/examples/particles/index.html?test=1");
    const result = await page.evaluate(async () => {
        const presetModule = "/examples/particles/presets.ts";
        const textureModule = "/examples/particles/textures.ts";
        const { createEffect } = await import(presetModule);
        const { createTextures } = await import(textureModule);
        const textures = createTextures();
        const effect = createEffect("singularity", textures);
        const counts = () => effect.emitters.map((e: any) => e.inspect().activeParticleCount);
        const before = counts();
        effect.burst();
        effect.advance(1_001_000, true);
        const after = counts();
        effect.advance(1_001_000, true);
        const again = counts();
        effect.dispose();
        for (const texture of Object.values(textures) as { dispose(): void }[]) texture.dispose();
        return { before, after, again };
    });
    expect(result.before).toEqual([500, 180, 120]);
    expect(result.after).toEqual(result.before);
    expect(result.again).toEqual(result.before);
});

test("new module effects share the atlas gallery, controls and resource lifecycle", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.setViewportSize({ width: 1500, height: 1300 });
    await page.goto("/examples/particles/index.html?test=1");
    await page.waitForFunction(() => "__particles" in window);
    await page.getByRole("button", { name: "New 6", exact: true }).click();
    await expect(page.locator(".card:visible")).toHaveCount(6);
    await expect(page.locator(".new-badge")).toHaveCount(6);
    await expect(page).toHaveURL(/particles\/index\.html/);
    const initial = await page.evaluate(() => (window as any).__particles.inspect());
    expect(initial.renderedIds).toEqual(["turbulence", "orbital-current", "comet", "shards", "cascade", "surface"]);
    expect(initial.effects.find((e: any) => e.id === "surface").drawSavings).toBe(1);
    await page.screenshot({ path: "test-results/particles-new-effects.png", fullPage: true });
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const frozen = await page.evaluate(() => { const api = (window as any).__particles; const before = api.inspect(); api.present(2000); return { before, after: api.inspect() }; });
    expect(frozen.after.paused).toBe(true);
    expect(frozen.after.particles).toBe(frozen.before.particles);
    expect(frozen.after.emitters.map((e: any) => e.elapsedMs)).toEqual(frozen.before.emitters.map((e: any) => e.elapsedMs));
    await page.getByRole("button", { name: /Burst/ }).click();
    expect(await page.evaluate(() => (window as any).__particles.inspect().particles)).toBeGreaterThan(frozen.after.particles);
    await page.getByRole("button", { name: /Restart/ }).click();
    const restarted = await page.evaluate(() => (window as any).__particles.inspect());
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.getByRole("slider", { name: "Animation speed" }).fill("2");
    await page.evaluate(() => { const api = (window as any).__particles; for (let t = 2016; t <= 7000; t += 80) api.present(t); });
    const later = await page.evaluate(() => (window as any).__particles.inspect());
    expect(later.speed).toBe(2);
    expect(restarted.initializedCount).toBe(6);
    // WebGL allocates geometry only on its first visible draw; exercise a full
    // event cycle before comparing the next cycle's resource counts.
    // A second weighted crystal geometry also participates in the shadow pass.
    expect(later.geometries).toBeLessThanOrEqual(16);
    await page.evaluate(() => { const api = (window as any).__particles; for (let t = 7016; t <= 12000; t += 80) api.present(t); });
    const repeated = await page.evaluate(() => (window as any).__particles.inspect());
    expect(repeated.geometries).toBe(later.geometries); expect(repeated.programs).toBe(later.programs);
    for (const emitter of later.emitters) expect(emitter.activeParticleCount).toBeLessThanOrEqual(emitter.capacity);
    await page.locator('[data-id="shards"]').click();
    await expect(page.locator("#focus-title")).toHaveText("Crystal impact");
    await expect(page.locator("#focus-index")).toHaveText("24 / 26");
    await page.keyboard.press("Escape");
    await expect(page.locator(".card:visible")).toHaveCount(6);
    await page.getByRole("button", { name: "All effects 26", exact: true }).click();
    await expect(page.locator(".card:visible")).toHaveCount(26);
    const disposed = await page.evaluate(() => { const api = (window as any).__particles; api.dispose(); api.dispose(); return api.inspect(); });
    expect(disposed.children).toBe(0); expect(disposed.geometries).toBe(0); expect(disposed.programs).toBe(0);
    expect(errors).toEqual([]);
});

test("soft intersections, atlas blending, lighting and custom attributes produce correct GPU pixels", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto("/examples/particles/index.html?test=1");
    const result = await page.evaluate(async () => { const module = "/tests/support/particles-rendering.ts"; return (await import(module)).checkParticleRendering(); });
    expect(result.standardSoftBlend[0]).toBeGreaterThan(10); expect(result.standardSoftBlend[2]).toBeGreaterThan(10);
    expect(result.standardSoftBlend[0]).toBeLessThan(80); expect(result.standardSoftBlend[2]).toBeLessThan(80);
    expect(result.screenSizePixel[0]).toBeGreaterThan(100); expect(result.pivotCenter[0]).toBeLessThan(5);
    expect(result.standardBlue[2]).toBeGreaterThan(result.standardBlue[0] + 30); expect(result.standardRed[0]).toBeGreaterThan(result.standardRed[2] + 30);
    expect(result.standardLit[0]).toBeGreaterThan(30); expect(result.standardDark[0]).toBeLessThan(5);
    expect(result.shadowEnergy).toBeLessThan(result.unshadowedEnergy - 100); expect(result.borrowedPbrDisposals).toBe(0);
    expect(result.faded[0]).toBeGreaterThan(40); expect(result.faded[0]).toBeLessThan(65);
    expect(result.perspectiveFaded[0]).toBeGreaterThan(40); expect(result.perspectiveFaded[0]).toBeLessThan(65);
    expect(result.solid[0]).toBeGreaterThan(245);
    expect(result.blended[0]).toBeGreaterThan(120); expect(result.blended[0]).toBeLessThan(135);
    expect(result.blended[2]).toBeGreaterThan(120); expect(result.blended[2]).toBeLessThan(135);
    expect(result.litFront[0]).toBeGreaterThan(240); expect(result.litBack[0]).toBeLessThan(5);
    expect(result.tiltedLight[0]).toBeGreaterThan(120); expect(result.tiltedLight[0]).toBeLessThan(135);
    expect(result.customPixel[0]).toBeGreaterThan(120); expect(result.customPixel[0]).toBeLessThan(135);
    expect(result.borrowedDisposals).toBe(0); expect(result.remaining.geometries).toBe(0); expect(result.remaining.textures).toBe(1); // Renderer-owned DFG LUT, not an emitter resource.
    expect(errors).toEqual([]);
});

test("global transparency, billboard alignments, particle lights and PBR trails render correctly", async ({ page }) => {
    const errors: string[] = []; page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto("/examples/particles/index.html?test=1");
    const result = await page.evaluate(async () => { const path = "/tests/support/particles-rendering.ts"; return (await import(path)).checkParticleExtensions(); });
    expect(result.sorted[0]).toBeGreaterThan(150); expect(result.sorted[0]).toBeLessThan(170); expect(result.sorted[2]).toBeGreaterThan(55); expect(result.sorted[2]).toBeLessThan(75);
    expect(result.restored[0]).toBeGreaterThan(120); expect(result.restored[0]).toBeLessThan(135); expect(result.restored[2]).toBeLessThan(5);
    for (const rgba of result.orientations) expect(rgba[0]).toBeGreaterThan(200);
    expect(result.trailLit[0]).toBeGreaterThan(30); expect(result.trailDark[0]).toBeLessThan(5);
    expect(result.lightOn[0]).toBeGreaterThan(30); expect(result.lightOff[0]).toBeLessThan(5);
    expect(result.remaining.geometries).toBe(0); expect(result.remaining.textures).toBe(1); expect(errors).toEqual([]);
    await page.evaluate(() => (window as any).__particles.select("shards"));
    await page.getByRole("checkbox", { name: "Refine overlapping crystals" }).check();
    expect(await page.evaluate(() => (window as any).__particles.inspect().calls)).toBeGreaterThan(7);
    await page.getByRole("checkbox", { name: "Refine overlapping crystals" }).uncheck();
    expect(await page.evaluate(() => (window as any).__particles.inspect().calls)).toBeLessThanOrEqual(7);
    await page.evaluate(() => (window as any).__particles.dispose());
});
