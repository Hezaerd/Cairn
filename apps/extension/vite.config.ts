import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build, defineConfig, type Plugin } from "vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL(".", import.meta.url));

const contentDirectory = fileURLToPath(new URL("src/content", import.meta.url));

/**
 * Content scripts can't be ES modules, and the main build would split code
 * they share with other entries into chunks. Build `content.js` on its own,
 * as one classic script, after each main build.
 */
function contentScript(): Plugin {
  return {
    name: "cairn-content-script",
    buildStart() {
      for (const file of readdirSync(contentDirectory))
        this.addWatchFile(`${contentDirectory}/${file}`);
    },
    async writeBundle() {
      await build({
        root,
        configFile: false,
        logLevel: "warn",
        build: {
          emptyOutDir: false,
          copyPublicDir: false,
          lib: {
            entry: `${contentDirectory}/index.ts`,
            formats: ["iife"],
            name: "cairnContent",
            fileName: () => "content.js",
          },
        },
      });
    },
  };
}

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), contentScript()],
  base: "./",
  build: {
    rollupOptions: {
      input: {
        popup: "index.html",
        picker: "picker.html",
        save: "save.html",
        background: "src/background/index.ts",
      },
      output: { entryFileNames: "[name].js" },
    },
  },
});
