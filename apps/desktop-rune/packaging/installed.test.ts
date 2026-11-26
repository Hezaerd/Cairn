import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import { Schema } from "effect";
import { chromium } from "playwright";

assert.equal(process.env.GITHUB_ACTIONS, "true");

assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");

assert.equal(process.platform, "win32");

const run = promisify(execFile);

const versions = Schema.decodeUnknownSync(
  Schema.Struct({ tauri: Schema.String, first: Schema.String, second: Schema.String }),
)(JSON.parse(readFileSync(".local/rune-test-versions.json", "utf8")));

const serverAddress = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

const local = process.env.LOCALAPPDATA;

assert.ok(local);

const directory = path.join(local, "Cairn");

const executable = path.join(directory, "cairn-desktop.exe");

const vault = path.join(local, "com.hezaerd.cairn", "vault.cairn");

const runKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

const uninstallKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Cairn";

const hostKey = "HKCU\\Software\\Chromium\\NativeMessagingHosts\\com.hezaerd.cairn";

const master = "synthetic installer fixture password";

const tauri = path.resolve(".local/tauri-nightly", `Cairn_${versions.tauri}_x64-setup.exe`);

const rune1 = path.resolve(
  `target/rune-installer/test/${versions.first}/target/release/bundle/nsis/Cairn_${versions.first}_x64-setup.exe`,
);

const rune2 = path.resolve(
  `target/rune-installer/release/${versions.second}/target/release/bundle/nsis/Cairn_${versions.second}_x64-setup.exe`,
);

const expectedStartup = `"${executable}" --autostart`;

const installerOptions = { timeout: 120_000 };

async function registry(key: string, ...args: string[]) {
  const { stdout } = await run("reg.exe", ["query", key, ...args]);

  return stdout
    .trim()
    .split(/\r?\n/)
    .at(-1)
    ?.split(/\s+REG_SZ\s+/)
    .at(-1);
}

async function waitFor(description: string, probe: () => Promise<boolean>) {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    if (await probe()) return;
    await setTimeout(250);
  }

  assert.fail(`Timed out waiting for ${description}`);
}

function hash(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function install(installer: string, version: string) {
  await run(installer, ["/S"], installerOptions);
  assert.equal(await registry(uninstallKey, "/v", "DisplayVersion"), version);
}

function installedBytes() {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .reduce((total, entry) => total + statSync(path.join(entry.parentPath, entry.name)).size, 0);
}

async function assertConnector() {
  for (const view of ["/reg:32", "/reg:64"]) {
    assert.equal(
      await registry(hostKey, "/ve", view),
      path.join(directory, "cairn-native-host.json"),
    );
  }

  assert.ok(existsSync(path.join(directory, "cairn-native-host.exe")));
  assert.ok(existsSync(path.join(directory, "extension", "manifest.json")));
}

async function stop(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  await exited;
}

async function createTauriVault() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = serverAddress(server.address());
  server.close();
  await once(server, "close");
  const url = `http://127.0.0.1:${address.port}`;

  const child = spawn(executable, [], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${address.port}`,
      WEBVIEW2_USER_DATA_FOLDER: path.resolve(".local/tauri-webview"),
    },
    stdio: "ignore",
  });

  try {
    await waitFor("the Tauri WebView", async () => {
      assert.equal(child.exitCode, null, "Tauri exited before WebView2 came up");

      return fetch(`${url}/json/version`).then(
        (response) => response.ok,
        () => false,
      );
    });
    const browser = await chromium.connectOverCDP(url);

    try {
      const context = browser.contexts()[0];
      assert.ok(context);
      const page = context.pages()[0] ?? (await context.waitForEvent("page"));
      page.setDefaultTimeout(30_000);
      await page.getByLabel("Master password", { exact: true }).fill(master);
      await page.getByLabel("Confirm password", { exact: true }).fill(master);
      await page.getByRole("button", { name: "Create vault", exact: true }).click();
      await page.getByRole("heading", { name: "No logins" }).waitFor();
      await page.getByRole("link", { name: "Settings" }).click();
      await page.getByRole("checkbox", { name: "Start with Windows" }).click();
      await waitFor("Tauri to register startup", async () => {
        return registry(runKey, "/v", "Cairn").then(
          (value) => value === expectedStartup,
          () => false,
        );
      });
    } finally {
      await browser.close();
    }
  } finally {
    await stop(child);
  }
}

async function unlockRune(env: NodeJS.ProcessEnv, relaunched = false) {
  const { stdout } = await run(
    "powershell.exe",
    [
      "-NoProfile",
      "-File",
      path.join(import.meta.dirname, "unlock.ps1"),
      "-Executable",
      executable,
      ...(relaunched ? ["-Relaunched"] : []),
    ],
    { env, timeout: 90_000 },
  );

  process.stdout.write(stdout);
}

assert.ok(!existsSync(directory) && !existsSync(vault), "Expected a fresh runner");

await install(tauri, versions.tauri);

await assertConnector();

const tauriBytes = installedBytes();

const tauriHash = hash(executable);

await createTauriVault();

const vaultHash = hash(vault);

const staleChunk = path.join(directory, "extension", "stale-fixture.js");

writeFileSync(staleChunk, "");

await install(rune1, versions.first);

assert.notEqual(hash(executable), tauriHash);

assert.equal(await registry(runKey, "/v", "Cairn"), expectedStartup);

assert.equal(hash(vault), vaultHash);

assert.ok(!existsSync(staleChunk), "Old extension chunks survived");

await assertConnector();

await unlockRune(process.env);

let corrupt = false;

let requests = 0;

const bytes = readFileSync(rune2);

const signature = readFileSync(`${rune2}.sig`, "utf8").trim();

const publicKey = readFileSync(".local/rune-test.key.pub", "utf8").trim();

const feed = createServer((request, response) => {
  if (request.url === "/latest.json") {
    requests++;
    const asset = { signature, url: `${origin}/Cairn-setup.exe` };
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        version: versions.second,
        platforms: { "windows-x86_64": asset, "windows-x86_64-nsis": asset },
      }),
    );
  } else if (request.url === "/Cairn-setup.exe") {
    response.end(corrupt ? Buffer.concat([bytes, Buffer.of(0)]) : bytes);
  } else {
    response.writeHead(404).end();
  }
}).listen(0, "127.0.0.1");

await once(feed, "listening");

const address = serverAddress(feed.address());

const origin = `http://127.0.0.1:${address.port}`;

const env = {
  ...process.env,
  CAIRN_TEST_UPDATE_FEED: `${origin}/latest.json`,
  CAIRN_TEST_UPDATE_PUBKEY: publicKey,
  CAIRN_TEST_TAURI_VERSION: versions.tauri,
};

try {
  const firstHash = hash(executable);
  corrupt = true;
  await assert.rejects(run(executable, ["--test-install-update"], { ...installerOptions, env }), {
    stderr: /InvalidSignature/,
  });
  assert.equal(hash(executable), firstHash);
  corrupt = false;

  const { stdout } = await run(executable, ["--test-install-update"], { ...installerOptions, env });
  process.stdout.write(stdout);
  await waitFor("Rune to install the signed update", async () => {
    return (await registry(uninstallKey, "/v", "DisplayVersion")) === versions.second;
  });
  assert.equal(await registry(runKey, "/v", "Cairn"), expectedStartup);
  await assertConnector();
  assert.equal(hash(vault), vaultHash);
  const secondHash = hash(executable);
  assert.equal(secondHash, hash(path.join(path.dirname(rune2), "../../cairn-desktop.exe")));
  const runeBytes = installedBytes();

  const summary = [
    "| Install | Installer bytes | Installed bytes |",
    "| --- | ---: | ---: |",
    `| Tauri ${versions.tauri} | ${statSync(tauri).size} | ${tauriBytes} |`,
    `| Rune ${versions.second} | ${statSync(rune2).size} | ${runeBytes} |`,
    "",
    "One run per installer. Installed bytes are the sum of file lengths under the Cairn install directory.",
  ].join("\n");

  process.stdout.write(`${summary}\n`);

  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);

  const before = requests;
  await unlockRune(env, true);
  assert.equal(requests, before, "Release Rune used the debug update feed");
  await install(tauri, versions.tauri);
  assert.equal(hash(executable), tauriHash);

  const compat = await run(
    "cargo",
    [
      "test",
      "--locked",
      "-p",
      "cairn-desktop",
      "--test",
      "rune-update-compat",
      "--",
      "--ignored",
      "--nocapture",
    ],
    { env, timeout: 300_000 },
  );

  process.stdout.write(compat.stderr);
  await waitFor("Tauri's updater to install Rune", async () => {
    return (await registry(uninstallKey, "/v", "DisplayVersion")) === versions.second;
  });
  assert.equal(hash(executable), secondHash);
  assert.equal(await registry(runKey, "/v", "Cairn"), expectedStartup);
  assert.equal(hash(vault), vaultHash);
  await assertConnector();
  console.log("Tauri's updater accepted and installed the signed Rune feed");
} finally {
  feed.close();
}
