import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, defineConfig, type Plugin } from "vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { RELEASE_KEY } from "./release";

const root = fileURLToPath(new URL(".", import.meta.url));

const contentDirectory = fileURLToPath(new URL("src/content", import.meta.url));

/**
 * Content scripts can't be ES modules, and the main build would split code
 * they share with other entries into chunks. Build `content.js` on its own,
 * as one classic script, after each main build.
 */
function contentScript(): Plugin {
  let outDir = "";

  return {
    name: "cairn-content-script",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
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
          outDir,
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

/** Pins the release extension's ID by adding the public key to the copied manifest. */
function releaseKey(): Plugin {
  let manifest = "";

  return {
    name: "cairn-release-key",
    apply: (_, { mode }) => mode === "release",
    configResolved(config) {
      manifest = path.resolve(config.root, config.build.outDir, "manifest.json");
    },
    writeBundle() {
      const json = JSON.parse(readFileSync(manifest, "utf8"));
      writeFileSync(manifest, `${JSON.stringify({ ...json, key: RELEASE_KEY }, null, 2)}\n`);
    },
  };
}

// `--mode release` builds the copy the installer ships, into the folder it
// bundles from. Every other build is a dev build.
export default defineConfig(({ mode }) => ({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    contentScript(),
    releaseKey(),
  ],
  base: "./",
  build: {
    ...(mode === "release" && {
      outDir: fileURLToPath(new URL("../../target/connector/extension", import.meta.url)),
      emptyOutDir: true,
    }),
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
}));
