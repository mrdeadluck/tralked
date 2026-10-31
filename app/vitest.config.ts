import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Steam has a keyless public adapter that would hit the network: tests stay on fixtures.
    env: { STEAM_MODE: "fixture" },
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          // DB-backed test files share one Postgres (db.test.ts snapshots whole tables),
          // so files must not run concurrently.
          fileParallelism: false,
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
  },
});
