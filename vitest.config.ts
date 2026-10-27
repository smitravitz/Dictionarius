import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.test.ts"], // e2e/ belongs to Playwright
    server: {
      deps: {
        // node:sqlite is a recent builtin Vite's transformer doesn't recognize.
        external: [/^node:sqlite$/],
      },
    },
  },
});
