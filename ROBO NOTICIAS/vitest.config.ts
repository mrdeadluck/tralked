import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Lets later tests import site code (e.g. "@/lib/...") without depending on it yet.
    alias: { "@": fileURLToPath(new URL("../app/src", import.meta.url)) },
  },
  test: { include: ["test/**/*.test.ts"] },
});
