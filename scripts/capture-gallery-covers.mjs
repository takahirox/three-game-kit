import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { galleryCovers } from "./lib/gallery-covers.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = new URL("../gallery/covers/", import.meta.url);
const origin = process.env.GALLERY_CAPTURE_ORIGIN ?? "http://127.0.0.1:4177";
const requested = process.argv.slice(2);
for (const id of requested) {
  if (!galleryCovers.some(cover => cover.id === id)) throw new Error(`Unknown cover: ${id}`);
}
const captures = requested.length ? galleryCovers.filter(cover => requested.includes(cover.id)) : galleryCovers;
let server;
let browser;
let serverReady = false;
let startupError;

try {
  // An existing local dev server can be supplied; otherwise own and clean up a private one.
  if (!process.env.GALLERY_CAPTURE_ORIGIN) {
    server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "4177", "--strictPort"], {
      cwd: root, stdio: ["ignore", "pipe", "inherit"],
    });
    server.on("error", error => { startupError = error; });
    server.stdout.on("data", data => { if (data.toString().includes("Local:")) serverReady = true; });
  }
  const deadline = Date.now() + 30_000;
  while (true) {
    if (startupError) throw startupError;
    if (server?.exitCode !== null && server?.exitCode !== undefined) throw new Error("Capture server exited before becoming ready");
    if (!server || serverReady) {
      try { if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok) break; } catch { /* readiness poll */ }
    }
    if (Date.now() >= deadline) throw new Error("Capture server did not become ready within 30 seconds");
    await delay(100);
  }
  await mkdir(output, { recursive: true });
  browser = await chromium.launch();
  for (const cover of captures) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${origin}/${cover.path}?${cover.query}`);
      await page.waitForFunction(handle => {
        const game = window[handle];
        return handle === "__particles" ? Boolean(game) : game?.ready && game?.screenshotReady;
      }, cover.handle, { timeout: 60_000 });
      if (cover.handle === "__RELIC_FRONTIER__") {
        await page.waitForFunction(() => window.__RELIC_FRONTIER__.inspectAssets()?.ready);
      }
      // Serialize the authored recipe into the browser; it has no imports or external closures.
      await page.evaluate(({ handle, prepare }) => {
        const recipe = new Function(`return ({${prepare}}).prepare`)();
        recipe(window[handle]);
      }, { handle: cover.handle, prepare: cover.prepare.toString() });
      const runtimeErrors = await page.evaluate(handle => window[handle].errors?.() ?? [], cover.handle);
      if (errors.length || runtimeErrors.length) throw new Error(`${cover.id}: ${JSON.stringify([...errors, ...runtimeErrors])}`);
      // WebGL buffers are normally discarded after compositing. Capture the visible canvas
      // through Playwright rather than reading it back after the frame has been presented.
      await page.addStyleTag({ content: "body * { visibility: hidden !important; } canvas { visibility: visible !important; }" });
      const png = await page.locator(cover.canvas).screenshot({ type: "png" });
      // Encode locally in Chromium: no image library or external capture service is needed.
      for (const width of [640, 1280]) {
        const data = await page.evaluate(async ({ sourceUrl, width }) => {
          const source = new Image();
          source.src = sourceUrl;
          await source.decode();
          const image = document.createElement("canvas");
          image.width = width; image.height = width * 9 / 16;
          const ctx = image.getContext("2d");
          ctx.fillStyle = "#0b0e17"; ctx.fillRect(0, 0, image.width, image.height);
          ctx.drawImage(source, 0, 0, image.width, image.height);
          const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
          const colors = new Set();
          for (let i = 0; i < pixels.length; i += 400) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
          if (colors.size < 32) throw new Error("Captured frame is blank or lacks representative scene detail");
          return image.toDataURL("image/webp", 0.82);
        }, { sourceUrl: `data:image/png;base64,${png.toString("base64")}`, width });
        if (!data.startsWith("data:image/webp;base64,")) throw new Error("Chromium did not encode WebP");
        const bytes = Buffer.from(data.split(",")[1], "base64");
        await writeFile(new URL(`${cover.id}-${width}.webp`, output), bytes);
        console.log(`${cover.id}-${width}.webp: ${(bytes.length / 1024).toFixed(1)} KiB`);
      }
      await page.evaluate(handle => window[handle].dispose(), cover.handle);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise(resolve => server.once("exit", resolve));
  }
}
