import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  main: { build: { outDir: "out/main" } },
  preload: { build: { outDir: "out/preload" } },
  renderer: {
    resolve: { alias: { "@": resolve("src/renderer/src") } },
    plugins: [react()],
    build: { outDir: "out/renderer" }
  }
});
