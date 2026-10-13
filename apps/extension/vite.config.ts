import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    rollupOptions: {
      input: { popup: "index.html", background: "src/background/index.ts" },
      output: { entryFileNames: "[name].js" },
    },
  },
});
