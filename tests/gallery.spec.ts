import { expect, test } from "@playwright/test";
import type {} from "../showcases/metaverse/src/main.js";

const showcases = [
  ["craftlands", "Craftlands", "showcases/craftlands/index.html"],
  ["metaverse", "Lantern Court", "showcases/metaverse/index.html"],
  ["relic-frontier", "Relic Frontier", "showcases/relic-frontier/index.html"],
  ["afterglow", "Afterglow", "showcases/afterglow/index.html"],
  ["gravetide", "Gravetide", "showcases/gravetide/index.html"],
  ["deepfield", "Deepfield", "showcases/deepfield/index.html"],
  ["chroma-strike", "Chroma Strike", "showcases/relic-frontier/chroma-strike/index.html"],
  ["particle-atlas", "Particle Atlas", "examples/particles/index.html"],
  ["core-run", "Core Run", "showcases/core-run/index.html"],
] as const;

test("all playable links and both cover sizes resolve within the deployment base", async ({ page, request, baseURL }) => {
  const errors: string[] = [];
  const remoteRequests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", req => { if (new URL(req.url()).origin !== new URL(baseURL!).origin) remoteRequests.push(req.url()); });
  await page.goto("./");
  await expect(page.locator(".game-card")).toHaveCount(showcases.length);
  for (const [id, title, path] of showcases) {
    const card = page.locator(`[data-cover="${id}"]`);
    await expect(card).toHaveAttribute("href", `./${path}`);
    await expect(card.getByRole("heading")).toHaveText(title);
    const target = await card.evaluate(link => (link as HTMLAnchorElement).href);
    expect(target).toBe(new URL(path, baseURL).href);
    const response = await request.get(target);
    expect(response.ok(), path).toBe(true);
    expect((await response.text()).match(/<title>(.*?)<\/title>/s)?.[1]?.toLowerCase()).toContain(title.toLowerCase());
    const img = card.locator("img");
    await card.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    const candidates = (await img.getAttribute("srcset"))!.split(",").map(candidate => candidate.trim().split(/\s+/));
    expect(candidates.map(candidate => candidate[1])).toEqual(["640w", "1280w"]);
    for (const [asset, descriptor] of candidates) {
      const width = Number(descriptor!.slice(0, -1));
      // Vite fingerprints assets in Pages builds; verify the URLs actually emitted in HTML.
      const url = new URL(asset!, page.url()).href;
      expect(url.startsWith(baseURL!)).toBe(true);
      const cover = await request.get(url);
      expect(cover.ok(), url).toBe(true);
      expect(cover.headers()["content-type"]).toContain("image/webp");
      expect(await page.evaluate(async url => {
        const image = new Image(); image.src = url; await image.decode();
        return [image.naturalWidth, image.naturalHeight];
      }, url)).toEqual([width, width * 9 / 16]);
    }
  }
  expect(errors).toEqual([]);
  expect(remoteRequests).toEqual([]);
  // The dev server injects its HMR client; the built gallery has no scripts.
  if (new URL(baseURL!).pathname !== "/") await expect(page.locator("script")).toHaveCount(0);
});

test("Lantern Court loads and plays with local assets under the deployment base", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("./showcases/metaverse/index.html?test=1");
  await expect.poll(() => page.evaluate(() => window.__METAVERSE__?.ready)).toBe(true);
  const state = await page.evaluate(() => {
    const court = window.__METAVERSE__;
    court.start();
    court.setMove(0, -1);
    court.advance(2.5);
    court.setMove(0, 0);
    court.press("interact");
    court.advance(.2);
    return { snapshot: court.snapshot(), assets: court.inspectAssets(), errors: court.errors() };
  });
  expect(state.snapshot?.interaction).toMatchObject({ active: true, toggles: 1 });
  expect(state.assets.cachedIds).toEqual(["visitor", "court"]);
  expect(state.errors).toEqual([]);
  await page.evaluate(() => window.__METAVERSE__.dispose());
  expect(errors).toEqual([]);
});

for (const [name, width, height] of [["desktop", 1440, 1000], ["tablet", 834, 1112], ["phone", 390, 844], ["small-phone", 320, 740]] as const) {
  test(`${name} keeps prominent covers and reserves their space before loading`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    // Hold the covers until layout has been measured, then prove image loading cannot move cards.
    let releaseImages!: () => void;
    const imagesReady = new Promise<void>(resolve => { releaseImages = resolve; });
    await page.route("**/*.webp", async route => { await imagesReady; await route.continue(); });
    await page.goto("./", { waitUntil: "domcontentloaded" });
    const before = await page.locator(".cover").evaluateAll(covers => covers.map(cover => {
      const rect = cover.getBoundingClientRect(); return { top: rect.top, width: rect.width, height: rect.height };
    }));
    for (const cover of before) expect(cover.width / cover.height).toBeCloseTo(16 / 9, 1);
    releaseImages();
    for (const img of await page.locator(".game-card img").all()) {
      await img.scrollIntoViewIfNeeded();
      await expect.poll(() => img.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    }
    await page.evaluate(() => scrollTo(0, 0));
    const after = await page.locator(".cover").evaluateAll(covers => covers.map(cover => {
      const rect = cover.getBoundingClientRect(); return { top: rect.top, width: rect.width, height: rect.height };
    }));
    expect(after).toEqual(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const first = await page.locator(".game-grid li").nth(0).boundingBox();
    const second = await page.locator(".game-grid li").nth(1).boundingBox();
    if (width <= 600) {
      expect(second!.y).toBeGreaterThan(first!.y + first!.height);
      expect(second!.x).toBe(first!.x);
      expect(await page.locator(".featured-card img").evaluate(image => (image as HTMLImageElement).currentSrc)).toMatch(/craftlands-640(?:-[^/]+)?\.webp$/);
    } else {
      expect(second!.y).toBe(first!.y);
      expect(second!.x).toBeGreaterThan(first!.x + first!.width);
    }
    for (const card of await page.locator(".game-card").all()) {
      const box = await card.boundingBox();
      expect(box!.width).toBeGreaterThan(44); expect(box!.height).toBeGreaterThan(44);
      await expect(card.locator(".play")).toBeVisible();
    }
    await page.screenshot({ path: testInfo.outputPath(`gallery-${name}.png`), fullPage: true });
  });
}

test("keyboard users can skip the header, focus every card, and activate a showcase", async ({ page, baseURL }) => {
  // Stop at the destination HTML to isolate gallery navigation from the game's startup.
  await page.route("**/showcases/**/*.ts", route => route.abort());
  await page.goto("./");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to showcases" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  for (const [id] of showcases) {
    await page.keyboard.press("Tab");
    const card = page.locator(`[data-cover="${id}"]`);
    await expect(card).toBeFocused();
    expect(await card.evaluate(link => getComputedStyle(link).outlineStyle)).toBe("solid");
    expect(await card.evaluate(link => getComputedStyle(link).outlineWidth)).toBe("3px");
  }
  await page.locator('[data-cover="craftlands"]').focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new URL(showcases[0][2], baseURL).href);
});

test("hover is subtle and reduced motion disables transforms and transitions", async ({ page }) => {
  await page.goto("./");
  const card = page.locator('[data-cover="craftlands"]');
  await card.hover();
  await expect.poll(() => card.locator("img").evaluate(image => getComputedStyle(image).transform)).not.toBe("none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => card.locator("img").evaluate(image => getComputedStyle(image).transform)).toBe("none");
  for (const element of [card.locator("img"), card.locator(".arrow")]) {
    expect(await element.evaluate(node => getComputedStyle(node).transitionDuration)).toBe("0s");
    expect(await element.evaluate(node => getComputedStyle(node).transform)).toBe("none");
  }
});

test("a touch user can open a card without hover", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.route("**/showcases/**/*.ts", route => route.abort());
    await page.goto(baseURL!);
    const card = page.locator('[data-cover="craftlands"]');
    await expect(card.locator(".play")).toBeVisible();
    await card.tap();
    await expect(page).toHaveURL(new URL(showcases[0][2], baseURL).href);
  } finally { await context.close(); }
});
