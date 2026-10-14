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

const changedSecret = "synthetic-credential-changed-80!";

// Optional live smoke test. Normal runs never contact an external website.
const faviconSite = process.env.CAIRN_TEST_FAVICON_SITE;

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
      CAIRN_TEST_LOCALE: "fr-FR",
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
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.getByRole("main", { name: "Cairn" }).waitFor();

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
  await page.getByRole("heading", { name: "Créer un coffre" }).waitFor();
  await page.screenshot({ path: path.join(directory, "create.png") });
  await page.getByLabel("Mot de passe maître", { exact: true }).fill(master);
  await page.getByLabel("Confirmer le mot de passe").fill(master + "mismatch");
  await page.getByRole("button", { name: "Créer le coffre" }).click();
  await page.locator("[data-sonner-toast]").filter({ hasText: "ne correspondent pas" }).waitFor();
  assert.equal(existsSync(file), false);
  await page.getByLabel("Confirmer le mot de passe").fill(master);
  await page.getByRole("button", { name: "Créer le coffre" }).click();
  await page.getByRole("heading", { name: "Aucun identifiant" }).waitFor();
  assert.ok(existsSync(file));
  await page.getByRole("button", { name: "Ajouter un identifiant" }).click();
  await page.getByRole("dialog").waitFor();
  assert.equal(
    await page
      .getByLabel("Nom", { exact: true })
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Ajouter un identifiant" }).click();
  await page.screenshot({ path: path.join(directory, "add.png") });
  await page.getByLabel("Nom", { exact: true }).fill("Compte de test");
  await page.getByLabel("Site", { exact: true }).fill(faviconSite ?? "https://127.0.0.1");
  await page.getByLabel("Identifiant", { exact: true }).fill("synthetic@example.com");
  await page.getByLabel("Mot de passe", { exact: true }).fill(secret);
  await page.getByLabel("Notes facultatif", { exact: true }).fill("Note privée de test");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByRole("heading", { name: "Compte de test" }).waitFor();

  if (faviconSite) {
    await page.waitForFunction(() => {
      const icons = [...document.querySelectorAll<HTMLImageElement>("[data-slot=site-icon] img")];

      return icons.length === 2 && icons.every((icon) => icon.complete && icon.naturalWidth > 0);
    });
    const cache = readFileSync(path.join(directory, "data/favicons.cairn"));
    assert.ok(!cache.includes(Buffer.from(new URL(faviconSite).origin)));
    assert.ok(!cache.includes(Buffer.from("data:image/png")));
  }

  const cachedIconFile = faviconSite
    ? readFileSync(path.join(directory, "data/favicons.cairn"))
    : null;

  assert.equal(await page.getByText(secret, { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Afficher le mot de passe" }).click();
  await page.getByText(secret, { exact: true }).waitFor();
  await page.getByText("Note privée de test", { exact: true }).waitFor();

  // Exercise the native title-bar close, not a frontend imitation of the lock.
  const windowHandle = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `$cairnProcess = Get-Process -Id ${app.child.pid}; $cairnProcess.MainWindowHandle; if (!$cairnProcess.CloseMainWindow()) { throw 'No Cairn window to close' }`,
    ],
    { windowsHide: true, stdio: "pipe" },
  )
    .toString()
    .trim();

  assert.match(windowHandle, /^[1-9][0-9]*$/);
  await page.getByRole("button", { name: "Déverrouiller", exact: true }).waitFor();
  assert.equal(app.child.exitCode, null, "Close-to-tray must keep Cairn running");
  assert.equal(await page.getByText(secret, { exact: true }).count(), 0);
  assert.equal(await page.getByText("Note privée de test", { exact: true }).count(), 0);
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Add-Type 'using System; using System.Runtime.InteropServices; public class CairnWindow { [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle); }'; if ([CairnWindow]::IsWindowVisible([IntPtr]${windowHandle})) { throw 'Cairn window is still visible' }`,
    ],
    { windowsHide: true, stdio: "pipe" },
  );

  const secondLaunch = spawn(executable, [], {
    cwd: root,
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      CAIRN_TEST_DATA_DIR: path.join(directory, "data"),
      CAIRN_TEST_LOCALE: "fr-FR",
      WEBVIEW2_USER_DATA_FOLDER: path.join(directory, "webview"),
    },
  });

  await once(secondLaunch, "exit");
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Add-Type 'using System; using System.Runtime.InteropServices; public class CairnWindow { [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle); }'; if (![CairnWindow]::IsWindowVisible([IntPtr]${windowHandle})) { throw 'Second launch did not restore Cairn' }`,
    ],
    { windowsHide: true, stdio: "pipe" },
  );
  await page.getByLabel("Mot de passe maître", { exact: true }).fill(master);
  await page.getByRole("button", { name: "Déverrouiller", exact: true }).click();
  await page.getByRole("heading", { name: "Compte de test" }).waitFor();
  await page.getByRole("button", { name: "Afficher le mot de passe" }).click();
  await page.getByText(secret, { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Rechercher les identifiants" }).fill("no-match");
  await page.getByRole("heading", { name: "Aucun identifiant trouvé" }).waitFor();
  assert.equal(await page.getByText(secret, { exact: true }).count(), 0);
  await page.getByRole("textbox", { name: "Rechercher les identifiants" }).fill("example.com");
  await page.getByRole("heading", { name: "Compte de test" }).waitFor();
  assert.equal(await page.getByText(secret, { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Afficher le mot de passe" }).click();
  await page.getByText(secret, { exact: true }).waitFor();
  await page.getByRole("button", { name: "Ajouter un identifiant" }).click();
  assert.equal(await page.getByText(secret, { exact: true }).count(), 0);
  await page.keyboard.press("Escape");

  // Debug builds never check for updates, but the channel choice is still saved by Rust.
  await page.getByRole("link", { name: "Paramètres" }).click();
  await page.getByText("Les versions de développement ne se mettent pas à jour.").waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Rechercher des mises à jour" }).isDisabled(),
    true,
  );
  const nightly = page.getByRole("button", { name: /^Nightly/ });
  assert.equal(await nightly.getAttribute("aria-pressed"), "false");
  await nightly.click();
  await page.getByRole("button", { name: /^Nightly/, pressed: true }).waitFor();
  assert.equal(readFileSync(path.join(directory, "data/update-channel"), "utf8"), "nightly");
  await page.getByRole("link", { name: "Retour aux identifiants" }).click();
  await page.getByRole("button", { name: "Verrouiller", exact: true }).click();
  await page.getByRole("button", { name: "Déverrouiller", exact: true }).waitFor();
  assert.equal(await page.locator("[data-slot=site-icon] img").count(), 0);
  assert.equal(await page.getByText(secret, { exact: true }).count(), 0);
  assert.equal(await page.getByRole("heading", { name: "Compte de test" }).count(), 0);
  await page.getByLabel("Mot de passe maître", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Déverrouiller", exact: true }).click();
  await page.locator("[data-sonner-toast]").filter({ hasText: "Mot de passe incorrect" }).waitFor();
  assert.deepEqual(app.errors, []);
  await stopApp(app);
  app = await startApp();
  page = app.page;
  await page.getByRole("button", { name: "Déverrouiller", exact: true }).waitFor();
  await page.getByLabel("Mot de passe maître", { exact: true }).fill(master);
  await page.getByRole("button", { name: "Déverrouiller", exact: true }).click();
  await page.getByRole("heading", { name: "Compte de test" }).waitFor();

  if (cachedIconFile) {
    await page.waitForFunction(() => {
      const icons = [...document.querySelectorAll<HTMLImageElement>("[data-slot=site-icon] img")];

      return icons.length === 2 && icons.every((icon) => icon.complete && icon.naturalWidth > 0);
    });
    // A fresh cache is reused after restarting, without another encrypted write.
    assert.deepEqual(readFileSync(path.join(directory, "data/favicons.cairn")), cachedIconFile);
  }

  await page.getByRole("link", { name: "Paramètres" }).click();
  await page.getByRole("button", { name: /^Nightly/, pressed: true }).waitFor();
  await page.screenshot({ path: path.join(directory, "settings.png") });
  await page.getByRole("link", { name: "Retour aux identifiants" }).click();
  await page.getByRole("heading", { name: "Compte de test" }).waitFor();
  await page.screenshot({ path: path.join(directory, "saved.png") });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.screenshot({ path: path.join(directory, "saved-dark.png") });
  await page.setViewportSize({ width: 600, height: 480 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole("button", { name: "Ajouter un identifiant" }).click();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(directory, "small-dialog.png") });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 920, height: 640 });

  // Editing without a reveal keeps the stored password and notes out of the form.
  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByText("Les notes restent inchangées", { exact: false }).waitFor();
  await page.screenshot({ path: path.join(directory, "edit.png") });
  assert.equal(await dialog.getByLabel("Notes facultatif").count(), 0);
  assert.equal(await dialog.getByLabel(/^Mot de passe/).inputValue(), "");
  await dialog.getByLabel("Nom", { exact: true }).fill("Compte modifié");
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByRole("heading", { name: "Compte modifié" }).waitFor();
  await page.getByRole("button", { name: "Afficher le mot de passe" }).click();
  await page.getByText(secret, { exact: true }).waitFor();
  await page.getByText("Note privée de test", { exact: true }).waitFor();

  // After a reveal, the editor can change the notes and the password.
  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  dialog = page.getByRole("dialog");
  assert.equal(await page.getByText(secret, { exact: true }).count(), 0);
  assert.equal(await dialog.getByLabel("Notes facultatif").inputValue(), "Note privée de test");
  await dialog.getByLabel(/^Mot de passe/).fill(changedSecret);
  await dialog.getByLabel("Notes facultatif").fill("Note modifiée de test");
  await page.screenshot({ path: path.join(directory, "edit-revealed.png") });
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Afficher le mot de passe" }).click();
  await page.getByText(changedSecret, { exact: true }).waitFor();
  await page.getByText("Note modifiée de test", { exact: true }).waitFor();

  // Deleting asks for confirmation and leaves the other entries alone.
  await page.getByRole("button", { name: "Ajouter un identifiant" }).click();
  await page.getByLabel("Nom", { exact: true }).fill("Compte jetable");
  await page.getByLabel("Mot de passe", { exact: true }).fill("synthetic-disposable-42!");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: /Compte jetable/ }).click();
  await page.getByRole("heading", { name: "Compte jetable" }).waitFor();
  await page.getByRole("button", { name: "Supprimer l'identifiant" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Annuler" }).click();
  await page.getByRole("heading", { name: "Compte jetable" }).waitFor();
  await page.getByRole("button", { name: "Supprimer l'identifiant" }).click();
  await page.screenshot({ path: path.join(directory, "delete.png") });
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer", exact: true }).click();
  await page.getByRole("heading", { name: "Compte modifié" }).waitFor();
  assert.equal(await page.getByRole("button", { name: /Compte jetable/ }).count(), 0);
  assert.equal(
    await page
      .getByRole("complementary", { name: "Liste des identifiants" })
      .getByRole("listitem")
      .count(),
    1,
  );

  await page.clock.install();
  await page.getByRole("button", { name: "Afficher le mot de passe" }).click();
  await page.getByText(changedSecret, { exact: true }).waitFor();
  await page.clock.fastForward(31_000);
  await page.getByText(changedSecret, { exact: true }).waitFor({ state: "hidden" });
  const storage = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]));

  for (const value of [secret, changedSecret, master]) assert.ok(!storage.includes(value));

  for (const filename of [file, path.join(directory, "data/backups/previous.cairn")]) {
    const disk = readFileSync(filename, "utf8");

    for (const value of [
      master,
      secret,
      changedSecret,
      "Compte de test",
      "Compte modifié",
      "synthetic@example.com",
      "Note privée de test",
      "Note modifiée de test",
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
  await page.locator("[data-sonner-toast]").filter({ hasText: "endommagé" }).waitFor();
  assert.equal(readFileSync(file, "utf8"), "corrupted-test-vault");
  assert.deepEqual(app.errors, []);
  console.log(
    `Native vault E2E passed: create, save, reveal, edit, delete, close-to-tray, second-launch restore, lock, wrong password, restart, auto-hide, encrypted storage and corruption. Artifacts: ${directory}`,
  );
} finally {
  await stopApp(app);
}
