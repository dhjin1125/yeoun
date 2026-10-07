import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**", ".data/**"]
  },
  resolve: {
    alias: [
      {
        find: "server-only",
        replacement: fileURLToPath(new URL("./tests/mocks/server-only.ts", import.meta.url))
      },
      { find: "@", replacement: fileURLToPath(new URL(".", import.meta.url)) }
    ]
  }
});
