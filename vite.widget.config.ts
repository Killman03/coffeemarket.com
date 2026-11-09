import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: "widget-dist",
    lib: {
      entry: fileURLToPath(new URL("./src/widget/index.tsx", import.meta.url)),
      formats: ["es"],
      fileName: () => "coffee-market-calculator.js",
      cssFileName: "coffee-market-calculator",
    },
  },
});
