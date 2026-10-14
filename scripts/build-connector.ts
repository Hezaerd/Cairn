import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HOST_NAME } from "@cairn/contracts";
import { RELEASE_EXTENSION_ID } from "../apps/extension/release";

// Builds what the installer ships next to Cairn: the native host, its
// manifest, and the release extension. `tauri.release.conf.json` runs this
// before the app build and bundles the results.
const root = path.resolve(import.meta.dirname, "..");

const connector = path.join(root, "target/connector");

const run = (command: string) => execSync(command, { cwd: root, stdio: "inherit" });

run("cargo build -p cairn-native-host --release");

run("pnpm --filter @cairn/extension build:release");

// Chromium resolves a relative `path` against the manifest's folder, so the
// manifest is the same for every install location.
const manifest = {
  name: HOST_NAME,
  description: "Cairn local status bridge",
  path: "cairn-native-host.exe",
  type: "stdio",
  allowed_origins: [`chrome-extension://${RELEASE_EXTENSION_ID}/`],
};

mkdirSync(connector, { recursive: true });

writeFileSync(
  path.join(connector, "cairn-native-host.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
