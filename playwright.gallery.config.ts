import { defineConfig, devices } from "@playwright/test";

const devPort = Number(process.env.GALLERY_DEV_PORT ?? 4186);
const pagesPort = Number(process.env.GALLERY_PAGES_PORT ?? 4185);
const devURL = `http://127.0.0.1:${devPort}/`;
const pagesURL = `http://127.0.0.1:${pagesPort}/three-game-kit/`;

// Exercise the same gallery against Vite development and the actual Pages multi-page build.
export default defineConfig({
  testDir: "./tests",
  testMatch: "gallery.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure" },
  projects: [
    { name: "gallery-dev", use: { baseURL: devURL } },
    { name: "gallery-pages", use: { baseURL: pagesURL } },
  ],
  webServer: [
    {
      command: `pnpm exec vite --host 127.0.0.1 --port ${devPort} --strictPort`,
      url: devURL, reuseExistingServer: false,
    },
    {
      command: `pnpm run build:pages && pnpm exec vite preview --config vite.pages.config.ts --host 127.0.0.1 --port ${pagesPort} --strictPort`,
      url: pagesURL, reuseExistingServer: false, timeout: 120_000,
      env: { PAGES_BASE: "/three-game-kit/" },
    },
  ],
});
