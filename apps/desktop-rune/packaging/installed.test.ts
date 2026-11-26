import assert from "node:assert/strict";
import { execFile } from "node:child_process";
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

assert.equal(process.env.GITHUB_ACTIONS, "true");

assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");

assert.equal(process.platform, "win32");

const run = promisify(execFile);

const serverAddress = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

const baselinePath = ".local/tauri-install.json";

const baselineSchema = Schema.Struct({
  version: Schema.String,
  binaryHash: Schema.String,
  vaultHash: Schema.String,
  installer: Schema.String,
  installedBytes: Schema.Number,
});

const local = process.env.LOCALAPPDATA;

assert.ok(local);

const directory = path.join(local, "Cairn");

const executable = path.join(directory, "cairn-desktop.exe");

const vault = path.join(local, "com.hezaerd.cairn", "vault.cairn");

const runKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

const uninstallKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Cairn";

const hostKey = "HKCU\\Software\\Chromium\\NativeMessagingHosts\\com.hezaerd.cairn";

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

async function driveInstalled(env: NodeJS.ProcessEnv, ...flags: string[]) {
  const { stdout } = await run(
    "powershell.exe",
    [
      "-NoProfile",
      "-File",
      path.join(import.meta.dirname, "drive-installed.ps1"),
      "-Executable",
      executable,
      ...flags,
    ],
    { env, timeout: 90_000 },
  );

  process.stdout.write(stdout);
}

if (process.argv.includes("--prepare-tauri")) {
  assert.ok(!existsSync(directory) && !existsSync(vault), "Expected a fresh runner");

  const { version } = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.String }))(
    JSON.parse(readFileSync(".local/tauri-nightly/latest.json", "utf8")),
  );

  const installer = path.resolve(".local/tauri-nightly", `Cairn_${version}_x64-setup.exe`);
  await install(installer, version);
  await assertConnector();
  const size = installedBytes();
  await driveInstalled(process.env, "-CreateTauriVault");
  assert.equal(await registry(runKey, "/v", "Cairn"), expectedStartup);
  writeFileSync(
    baselinePath,
    JSON.stringify({
      version,
      binaryHash: hash(executable),
      vaultHash: hash(vault),
      installer,
      installedBytes: size,
    }),
  );
  process.exit(0);
}

const baseline = Schema.decodeUnknownSync(baselineSchema)(
  JSON.parse(readFileSync(baselinePath, "utf8")),
);

const { first, second } = Schema.decodeUnknownSync(
  Schema.Struct({ first: Schema.String, second: Schema.String }),
)(JSON.parse(readFileSync(".local/rune-test-versions.json", "utf8")));

const rune1 = path.resolve(
  `target/rune-installer/test/${first}/target/release/bundle/nsis/Cairn_${first}_x64-setup.exe`,
);

const rune2 = path.resolve(
  `target/rune-installer/release/${second}/target/release/bundle/nsis/Cairn_${second}_x64-setup.exe`,
);

const staleChunk = path.join(directory, "extension", "stale-fixture.js");

writeFileSync(staleChunk, "");

await install(rune1, first);

assert.notEqual(hash(executable), baseline.binaryHash);

assert.equal(await registry(runKey, "/v", "Cairn"), expectedStartup);

assert.equal(hash(vault), baseline.vaultHash);

assert.ok(!existsSync(staleChunk), "Old extension chunks survived");

await assertConnector();

await driveInstalled(process.env);

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
        version: second,
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
  CAIRN_TEST_TAURI_VERSION: baseline.version,
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
    return (await registry(uninstallKey, "/v", "DisplayVersion")) === second;
  });
  assert.equal(await registry(runKey, "/v", "Cairn"), expectedStartup);
  await assertConnector();
  assert.equal(hash(vault), baseline.vaultHash);
  const secondHash = hash(executable);
  assert.equal(secondHash, hash(path.join(path.dirname(rune2), "../../cairn-desktop.exe")));
  const runeBytes = installedBytes();

  const summary = [
    "| Install | Installer bytes | Installed bytes |",
    "| --- | ---: | ---: |",
    `| Tauri ${baseline.version} | ${statSync(baseline.installer).size} | ${baseline.installedBytes} |`,
    `| Rune ${second} | ${statSync(rune2).size} | ${runeBytes} |`,
    "",
    "One run per installer. Installed bytes are the sum of file lengths under the Cairn install directory.",
  ].join("\n");

  process.stdout.write(`${summary}\n`);

  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);

  const before = requests;
  await driveInstalled(env, "-Relaunched");
  assert.equal(requests, before, "Release Rune used the debug update feed");
  await install(baseline.installer, baseline.version);
  assert.equal(hash(executable), baseline.binaryHash);

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
    return (await registry(uninstallKey, "/v", "DisplayVersion")) === second;
  });
  assert.equal(hash(executable), secondHash);
  assert.equal(await registry(runKey, "/v", "Cairn"), expectedStartup);
  assert.equal(hash(vault), baseline.vaultHash);
  await assertConnector();
  console.log("Tauri's updater accepted and installed the signed Rune feed");
} finally {
  feed.close();
}
