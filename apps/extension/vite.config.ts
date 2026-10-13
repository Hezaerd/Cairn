import { defineConfig } from "vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react()],
  base: "./",
  build: {
    rollupOptions: {
      input: { popup: "index.html", background: "src/background/index.ts" },
      output: { entryFileNames: "[name].js" },
    },
  },
});
