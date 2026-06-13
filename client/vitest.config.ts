import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@shared": resolve(__dirname, "src/shared"),
    },
    // Prefer TypeScript sources over compiled .js artifacts in src/
    extensions: [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".cjs", ".json"],
  },
});
