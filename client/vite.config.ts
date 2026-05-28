import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  plugins: [
    react(),
    electron([
      {
        entry: "src/main/index.ts",
        vite: {
          build: {
            outDir: "dist-electron/main",
            rollupOptions: { output: { format: "es", entryFileNames: "index.mjs" } },
          },
        },
      },
      {
        entry: "src/preload/index.ts",
        onstart({ reload }) { reload(); },
        vite: {
          build: {
            outDir: "dist-electron/preload",
            rollupOptions: { output: { format: "es", entryFileNames: "index.mjs" } },
          },
        },
      },
    ]),
    renderer(),
  ],
  build: {
    outDir: "dist",
  },
});
