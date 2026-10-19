import { defineConfig } from "vitest/config";

// Separate from vite.config.ts: the React Router plugin is not needed to test
// server modules, and it expects a dev server.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    pool: "forks",
  },
});
