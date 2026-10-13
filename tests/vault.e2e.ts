import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { chromium } from "playwright";
import { Schema } from "effect";

// This test drives the real Tauri IPC and Rust vault, with synthetic credentials
// in an isolated debug-only data directory and an isolated WebView2 profile.
const root = process.cwd();

const executable = path.join(root, "target/debug/cairn-desktop.exe");

assert.ok(existsSync(executable), "Build Tauri with --debug --no-bundle first.");

execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    "if (Get-Process cairn-desktop -ErrorAction SilentlyContinue) { throw 'Close Cairn before running the isolated vault test.' }",
  ],
  { windowsHide: true, stdio: "pipe" },
);

mkdirSync(path.join(root, ".local"), { recursive: true });

const directory = mkdtempSync(path.join(root, ".local/vault-e2e-"));

const file = path.join(directory, "data/vault.cairn");

const master = "synthetic-master-password-only";

const secret = "synthetic-credential-79!";

async function startApp() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(
    server.address(),
  );

  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  const child = spawn(executable, [], {
    cwd: root,
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      CAIRN_TEST_DATA_DIR: path.join(directory, "data"),
      WEBVIEW2_USER_DATA_FOLDER: path.join(directory, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
  });

  try {
    let ready = false;

    for (let attempt = 0; attempt < 80; attempt++) {
      assert.equal(child.exitCode, null, "Cairn exited before WebView2 was ready");

      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`);

        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* WebView2 has not started listening yet. */
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    assert.ok(ready, "WebView2 debugging endpoint did not start");
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    assert.ok(context);
    const page = context.pages()[0] ?? (await context.waitForEvent("page"));
    page.setDefaultTimeout(20_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.getByRole("heading", { name: "Ton espace privé." }).waitFor();

    return { child, browser, page, errors };
  } catch (error) {
    child.kill();
    throw error;
  }
}

async function stopApp(app: Awaited<ReturnType<typeof startApp>>) {
  await app.browser.close();

  if (app.child.exitCode === null && app.child.signalCode === null) {
    const exited = once(app.child, "exit");
    app.child.kill();
    await exited;
  }
}

let app = await startApp();

try {
  let page = app.page;
  await page.getByRole("heading", { name: "Crée ton coffre." }).waitFor();
  await page.screenshot({ path: path.join(directory, "create.png") });
  await page.getByLabel("Mot de passe maître", { exact: true }).fill(master);
  await page.getByLabel("Confirmer le mot de passe").fill(master + "mismatch");
  await page.getByRole("button", { name: "Créer le coffre" }).click();
  await page.getByRole("alert").filter({ hasText: "ne correspondent pas" }).waitFor();
  assert.equal(existsSync(file), false);
  await page.getByLabel("Confirmer le mot de passe").fill(master);
  await page.getByRole("button", { name: "Créer le coffre" }).click();
  await page.getByRole("heading", { name: "Le coffre est prêt." }).waitFor();
  assert.ok(existsSync(file));
  await page.getByRole("button", { name: "Ajouter un identifiant" }).click();
  await page.getByLabel("Nom", { exact: true }).fill("Compte de test");
  await page.getByLabel("Site", { exact: true }).fill("https://example.com");
  await page.getByLabel("Identifiant", { exact: true }).fill("synthetic@example.com");
  await page.getByLabel("Mot de passe", { exact: true }).fill(secret);
  await page.getByLabel("Notes", { exact: true }).fill("Note privée de test");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByRole("heading", { name: "Compte de test" }).waitFor();
  assert.equal(await page.getByText(secret, { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Afficher le mot de passe" }).click();
  await page.getByText(secret, { exact: true }).waitFor();
  await page.getByText("Note privée de test", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Verrouiller", exact: true }).click();
  await page.getByRole("button", { name: "Déverrouiller", exact: true }).waitFor();
  assert.equal(await page.getByText(secret, { exact: true }).count(), 0);
  assert.equal(await page.getByRole("heading", { name: "Compte de test" }).count(), 0);
  await page.getByLabel("Mot de passe maître", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Déverrouiller", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Mot de passe incorrect" }).waitFor();
  assert.deepEqual(app.errors, []);
  await stopApp(app);
  app = await startApp();
  page = app.page;
  await page.getByRole("button", { name: "Déverrouiller", exact: true }).waitFor();
  await page.getByLabel("Mot de passe maître", { exact: true }).fill(master);
  await page.getByRole("button", { name: "Déverrouiller", exact: true }).click();
  await page.getByRole("heading", { name: "Compte de test" }).waitFor();
  await page.screenshot({ path: path.join(directory, "saved.png") });
  await page.clock.install();
  await page.getByRole("button", { name: "Afficher le mot de passe" }).click();
  await page.getByText(secret, { exact: true }).waitFor();
  await page.clock.fastForward(31_000);
  await page.getByText(secret, { exact: true }).waitFor({ state: "hidden" });
  const storage = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]));
  assert.ok(!storage.includes(secret) && !storage.includes(master));

  for (const filename of [file, path.join(directory, "data/backups/previous.cairn")]) {
    const disk = readFileSync(filename, "utf8");

    for (const value of [
      master,
      secret,
      "Compte de test",
      "synthetic@example.com",
      "Note privée de test",
    ])
      assert.ok(!disk.includes(value));
  }

  assert.deepEqual(app.errors, []);
  await stopApp(app);
  writeFileSync(file, "corrupted-test-vault");
  app = await startApp();
  page = app.page;
  await page.getByRole("button", { name: "Déverrouiller", exact: true }).waitFor();
  await page.getByLabel("Mot de passe maître", { exact: true }).fill(master);
  await page.getByRole("button", { name: "Déverrouiller", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "endommagé" }).waitFor();
  assert.equal(readFileSync(file, "utf8"), "corrupted-test-vault");
  assert.deepEqual(app.errors, []);
  console.log(
    `Native vault E2E passed: create, save, reveal, lock, wrong password, restart, auto-hide, encrypted storage and corruption. Artifacts: ${directory}`,
  );
} finally {
  await stopApp(app);
}
