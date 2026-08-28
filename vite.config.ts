import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    exclude: ["@dimforge/rapier3d"],
  },
  resolve: {
    alias: [
      {
        find: /^@three-game-kit\/core$/,
        replacement: fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
      },
      {
        find: /^@three-game-kit\/shared$/,
        replacement: fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
      },
      {
        find: /^@three-game-kit\/client$/,
        replacement: fileURLToPath(new URL("./packages/client/src/index.ts", import.meta.url)),
      },
      {
        find: /^@three-game-kit\/client\/(.+)$/,
        replacement: fileURLToPath(new URL("./packages/client/src/$1.ts", import.meta.url)),
      },
    ],
  },
});
