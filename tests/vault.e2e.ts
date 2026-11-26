import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import qr from "qrcode";

const root = process.cwd();

const executable = path.join(root, "target/debug/cairn-desktop.exe");

assert.ok(existsSync(executable), "Run cargo build -p cairn-desktop first.");

const local = path.join(root, ".local");

mkdirSync(local, { recursive: true });

const directory = mkdtempSync(path.join(local, "vault-e2e-"));

const picture = path.join(directory, "authenticator.png");

await qr.toFile(
  picture,
  "otpauth://totp/RFC6238:Test%20account?issuer=RFC6238&secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8",
);

const result = spawnSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-STA",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(root, "tests/vault.ps1"),
    executable,
    directory,
    picture,
  ],
  { cwd: root, stdio: "inherit", windowsHide: true },
);

if (result.error) throw result.error;

assert.equal(result.status, 0, `Vault test failed. Test data is in ${directory}`);
