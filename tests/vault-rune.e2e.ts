import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

const executable = path.join(root, "target/debug/cairn-desktop-rune.exe");

assert.ok(existsSync(executable), "Run cargo build -p cairn-desktop-rune first.");

const local = path.join(root, ".local");

mkdirSync(local, { recursive: true });

const directory = mkdtempSync(path.join(local, "vault-rune-e2e-"));

const result = spawnSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(root, "tests/vault-rune.ps1"),
    executable,
    directory,
  ],
  { cwd: root, stdio: "inherit", windowsHide: true },
);

if (result.error) throw result.error;

assert.equal(result.status, 0, `Rune vault test failed. Test data is in ${directory}`);
