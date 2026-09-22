import { fileURLToPath, URL } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import baseConfig from "./vite.config.js";

/**
 * Static build of the browser showcases for GitHub Pages (`pnpm run build:pages`).
 * The dev server and Playwright keep using `vite.config.ts` unchanged; this config only adds the
 * multi-page inputs, the output directory, and the `/<repository>/` base path Pages serves from.
 */
const page = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default mergeConfig(
  baseConfig,
  defineConfig({
    base: process.env["PAGES_BASE"] ?? "/three-game-kit/",
    build: {
      outDir: "dist-pages",
      emptyOutDir: true,
      target: "es2022",
      rollupOptions: {
        input: {
          index: page("./index.html"),
          craftlands: page("./showcases/craftlands/index.html"),
          deepfield: page("./showcases/deepfield/index.html"),
          gravetide: page("./showcases/gravetide/index.html"),
          afterglow: page("./showcases/afterglow/index.html"),
          "core-run": page("./showcases/core-run/index.html"),
          "relic-frontier": page("./showcases/relic-frontier/index.html"),
          "chroma-strike": page("./showcases/relic-frontier/chroma-strike/index.html"),
          particles: page("./examples/particles/index.html"),
        },
      },
    },
  }),
);
