import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import path from "node:path";
import { chromium, type Frame, type Page } from "playwright";
import { Schema } from "effect";
import type { PopupRequest } from "@cairn/contracts";

// Pairs an isolated Helium profile with the real desktop app and fills a
// local login page. Synthetic vault and profiles under `.local` only.
const root = process.cwd();

const local = path.join(root, ".local");

const desktopPath = path.join(root, "target/debug/cairn-desktop.exe");

assert.ok(existsSync(desktopPath), "Build Tauri with --debug --no-bundle first.");

mkdirSync(local, { recursive: true });

if (existsSync(path.join(local, "native-host.json")))
  throw new Error("Unregister this checkout's native host before running this test.");

execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    "if (Get-Process cairn-desktop -ErrorAction SilentlyContinue) { throw 'Close Cairn before running the autofill test.' }",
  ],
  { windowsHide: true, stdio: "pipe" },
);

const directory = mkdtempSync(path.join(local, "autofill-e2e-"));

const master = "synthetic-master-password-only";

const secret = "synthetic-credential-81!";

const Address = Schema.Struct({ port: Schema.Number });

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = Schema.decodeUnknownSync(Address)(server.address());
  await new Promise<void>((resolve) => server.close(() => resolve()));

  return port;
}

const loginPage = `<!doctype html><title>Login</title><form>
  <input type="search" id="search" placeholder="Search">
  <input type="text" id="user" autocomplete="username">
  <input type="password" id="pass" autocomplete="current-password">
</form>`;

const pages = new Map([
  ["/login", loginPage],
  ["/signin", loginPage],
  [
    "/signup",
    `<!doctype html><title>Sign up</title><form>
      <input type="email" id="user" autocomplete="email">
      <input type="password" id="pass" autocomplete="new-password">
      <input type="password" id="confirm" autocomplete="new-password">
    </form>`,
  ],
]);

/** Login pages on 127.0.0.1. The extension sees one as `http://127.0.0.1:<port>`. */
async function serve() {
  const server = createHttpServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(
      pages.get(request.url ?? "") ?? `<!doctype html><title>Home</title><p>No form here.</p>`,
    );
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  return { server, port: Schema.decodeUnknownSync(Address)(server.address()).port };
}

const { server: site, port: sitePort } = await serve();

const origin = `http://127.0.0.1:${sitePort}`;

// Another site, with no logins in the vault.
const { server: otherSite, port: otherPort } = await serve();

// A browser can't click the toolbar button under automation, so `activeTab`
// is never granted. This copy also gets host access to the test site, which
// stands in for that grant. The shipped manifest is unchanged.
const extensionPath = path.join(directory, "extension");

cpSync(path.join(root, "apps/extension/dist"), extensionPath, { recursive: true });

const manifestPath = path.join(extensionPath, "manifest.json");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

assert.deepEqual(manifest.permissions, ["nativeMessaging", "activeTab", "scripting"]);

assert.deepEqual(manifest.optional_host_permissions, ["https://*/*", "http://*/*"]);

assert.equal(manifest.host_permissions, undefined);

// The same grant also stands in for turning suggestions on.
manifest.host_permissions = ["http://127.0.0.1/*"];

writeFileSync(manifestPath, JSON.stringify(manifest));

const debugPort = await freePort();

const desktop = spawn(desktopPath, [], {
  cwd: root,
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    CAIRN_TEST_DATA_DIR: path.join(directory, "data"),
    CAIRN_TEST_LOCALE: "fr-FR",
    WEBVIEW2_USER_DATA_FOLDER: path.join(directory, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
  },
});

let registered = false;

const powershell = (script: string, args: string[] = []) =>
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(root, "scripts", script),
      ...args,
    ],
    { cwd: root, windowsHide: true, stdio: "pipe" },
  );

const executablePath =
  process.env.CAIRN_HELIUM_PATH ??
  path.join(process.env.LOCALAPPDATA!, "imput/Helium/Application/chrome.exe");

const browser = await chromium.launchPersistentContext(path.join(directory, "helium"), {
  executablePath,
  headless: true,
  viewport: { width: 360, height: 420 },
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--no-first-run",
    "--lang=fr",
  ],
});

/** Sends a popup message from an extension page, as the popup does. */
const popupMessage = (page: Page, message: PopupRequest) =>
  page.evaluate((message) => chrome.runtime.sendMessage(message), message);

/** Opens a page in Helium, outside the extension. */
async function open(url: string) {
  const page = await browser.newPage();
  await page.waitForLoadState();

  // Helium sometimes aborts the first navigation to a local origin, and may
  // then load it again by itself. Wait for the page, not for one navigation.
  const loaded = () =>
    page.url() === url &&
    page.evaluate(() => document.readyState === "complete").catch(() => false);

  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto(url).catch(() => {});

    for (let poll = 0; poll < 10; poll++) {
      if (await loaded()) return page;
      await page.waitForTimeout(200);
    }
  }

  throw new Error(`${url} didn't load`);
}

const tabId = (page: Page, url: string) =>
  page.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.id ?? -1, url);

const badge = (page: Page, tabId: number) =>
  page.evaluate((tabId) => chrome.action.getBadgeText({ tabId }), tabId);

const pickerOf = (page: Page) =>
  page.frames().find((frame) => frame.url().endsWith("/picker.html"));

/** The picker frame in `page`, once it opens. */
async function picker(page: Page): Promise<Frame> {
  for (let poll = 0; poll < 50; poll++) {
    const frame = pickerOf(page);

    if (frame) return frame;

    await page.waitForTimeout(100);
  }

  throw new Error("The picker didn't open");
}

/** Waits long enough for a picker to have opened, then checks it didn't. */
async function assertNoPicker(page: Page, message: string) {
  await page.waitForTimeout(1_500);
  assert.equal(pickerOf(page), undefined, message);
}

/** Styles the overlay's host element, which a page can reach. */
const styleOverlay = (page: Page, opacity: string | null) =>
  page.evaluate((opacity) => {
    for (const element of document.documentElement.children) {
      if (!(element instanceof HTMLDivElement)) continue;

      if (opacity === null) element.style.removeProperty("opacity");
      else element.style.setProperty("opacity", opacity, "important");
    }
  }, opacity);

try {
  // Desktop: create a vault with one login for the test site and one elsewhere.
  let ready = false;

  for (let attempt = 0; attempt < 80 && !ready; attempt++) {
    assert.equal(desktop.exitCode, null, "Cairn exited before WebView2 was ready");
    ready = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then(
      (response) => response.ok,
      () => false,
    );

    if (!ready) await new Promise((resolve) => setTimeout(resolve, 250));
  }

  assert.ok(ready, "WebView2 debugging endpoint did not start");
  const webview = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const [context] = webview.contexts();
  assert.ok(context);
  const app = context.pages()[0] ?? (await context.waitForEvent("page"));

  app.setDefaultTimeout(20_000);
  await app.emulateMedia({ reducedMotion: "reduce" });
  const appErrors: string[] = [];
  app.on("pageerror", (error) => appErrors.push(error.message));
  await app.getByLabel("Mot de passe maître", { exact: true }).fill(master);
  await app.getByLabel("Confirmer le mot de passe").fill(master);
  await app.getByRole("button", { name: "Créer le coffre" }).click();

  for (const [name, url, username] of [
    ["Site de test", origin, "synthetic@example.com"],
    ["Autre site", "https://example.com", "other@example.com"],
  ] as const) {
    await app.getByRole("button", { name: "Ajouter un identifiant" }).click();
    await app.getByLabel("Nom", { exact: true }).fill(name);
    await app.getByLabel("Site", { exact: true }).fill(url);
    await app.getByLabel("Identifiant", { exact: true }).fill(username);
    await app.getByLabel("Mot de passe", { exact: true }).fill(secret);
    await app.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await app.getByRole("complementary").getByText(name, { exact: true }).waitFor();
  }

  console.log("Vault with synthetic logins: OK");

  const page = await open(`${origin}/login`);

  // Extension: connect, then ask to pair.
  const worker =
    browser.serviceWorkers()[0] ??
    (await browser.waitForEvent("serviceworker", { timeout: 20_000 }));

  const id = new URL(worker.url()).host;
  powershell("register-native-host.ps1", ["-ExtensionId", id]);
  registered = true;
  const popup = await browser.newPage();
  const popupErrors: string[] = [];
  popup.on("pageerror", (error) => popupErrors.push(error.message));
  await popup.goto(`chrome-extension://${id}/index.html`);
  await popup.getByRole("status").filter({ hasText: "Cairn connecté" }).waitFor();
  await popup.getByRole("button", { name: "Associer à Cairn" }).click();
  const code = (await popup.locator(".code").textContent())?.trim() ?? "";
  assert.match(code, /^\d{4} \d{4}$/);
  await popup.screenshot({ path: path.join(directory, "popup-pairing.png") });

  // Before approval, the key gets nothing.
  const loginTab = await tabId(popup, `${origin}/*`);
  assert.deepEqual(await popupMessage(popup, { type: "GetState", tabId: loginTab }), {
    type: "Pairing",
    appVersion: "0.1.0",
    code,
  });

  // Desktop: the request shows the same code.
  const dialog = app.getByRole("dialog", { name: "Associer un navigateur ?" });
  await dialog.waitFor();
  assert.equal((await dialog.locator("p.font-mono").textContent())?.trim(), code);
  await app.screenshot({ path: path.join(directory, "desktop-pairing.png") });
  await dialog.getByRole("button", { name: "Approuver" }).click();
  await app.locator("[data-sonner-toast]").filter({ hasText: "est associé" }).waitFor();
  console.log(`Pairing approved with code ${code}: OK`);

  // The popup itself isn't a website.
  await popup.getByRole("button", { name: "Actualiser" }).click();
  await popup.getByText("Ouvre un site web pour voir ses identifiants.").waitFor();

  const state = await popupMessage(popup, { type: "GetState", tabId: loginTab });
  assert.equal(state.type, "Logins");
  assert.equal(state.host, `127.0.0.1:${sitePort}`);
  assert.deepEqual(
    state.logins.map((login: { name: string; username: string }) => [login.name, login.username]),
    [["Site de test", "synthetic@example.com"]],
  );
  assert.ok(!JSON.stringify(state).includes(secret), "Listing must not carry passwords");
  console.log("Only the matching login is listed, without its password: OK");

  const entryId = state.logins[0].id;
  assert.deepEqual(await popupMessage(popup, { type: "Fill", tabId: loginTab, entryId }), {
    type: "Filled",
  });
  assert.equal(await page.inputValue("#user"), "synthetic@example.com");
  assert.equal(await page.inputValue("#pass"), secret);
  assert.equal(await page.inputValue("#search"), "");
  console.log("Filled the login form: OK");

  // A login is never released to another site, even when asked by ID.
  const entries: Array<{ id: string; name: string }> = await app.evaluate(() =>
    // SAFETY: Tauri injects its IPC bridge into the app's own WebView.
    (window as any).__TAURI_INTERNALS__.invoke("list_entries"),
  );

  const otherId = entries.find((entry) => entry.name === "Autre site")?.id;
  assert.ok(otherId);
  assert.deepEqual(await popupMessage(popup, { type: "Fill", tabId: loginTab, entryId: otherId }), {
    type: "Unavailable",
    code: "NotFound",
  });
  console.log("Login for another site is refused: OK");

  await open(`${origin}/`);
  const homeTab = await tabId(popup, `${origin}/`);
  assert.deepEqual(await popupMessage(popup, { type: "Fill", tabId: homeTab, entryId }), {
    type: "NoForm",
  });
  console.log("Page without a form: OK");

  // Suggestions: focusing a login field opens the picker under it.
  await popup.reload();
  await popup.getByText("Proposer les identifiants dans les champs de connexion").waitFor();
  const signin = await open(`${origin}/signin`);
  const signinTab = await tabId(popup, `${origin}/signin`);
  await signin.click("#user");
  let frame = await picker(signin);
  const suggestion = frame.getByRole("button", { name: /Site de test/ });
  await suggestion.waitFor();
  assert.equal(await frame.getByRole("button").count(), 1, "Only this site's login is suggested");
  assert.equal(await badge(popup, signinTab), "1");
  await signin.screenshot({ path: path.join(directory, "page-picker.png") });
  console.log("Picker opens on focus, badge counts the site's logins: OK");

  // A picker the page made transparent ignores clicks.
  await styleOverlay(signin, "0.2");
  await signin.waitForTimeout(600);
  await suggestion.click();
  await signin.waitForTimeout(800);
  assert.equal(await signin.inputValue("#pass"), "", "A transparent picker must not fill");
  await styleOverlay(signin, null);
  await signin.waitForTimeout(600);
  console.log("Transparent picker refuses clicks: OK");

  await suggestion.click();
  await signin.waitForFunction(() => document.querySelector<HTMLInputElement>("#pass")?.value);
  assert.equal(await signin.inputValue("#user"), "synthetic@example.com");
  assert.equal(await signin.inputValue("#pass"), secret);
  assert.equal(await signin.inputValue("#search"), "");
  await assertNoPicker(signin, "The picker closes after filling and stays closed");
  console.log("Filled from the picker: OK");

  // Clicking the field asks for the picker again; Escape closes it.
  await signin.click("#user");
  frame = await picker(signin);
  await frame.getByRole("button", { name: /Site de test/ }).waitFor();
  await signin.keyboard.press("Escape");
  await assertNoPicker(signin, "Escape closes the picker");
  console.log("Reopen on click, close with Escape: OK");

  const signup = await open(`${origin}/signup`);
  await signup.click("#user");
  await assertNoPicker(signup, "No picker on a sign-up form");
  console.log("Sign-up form is ignored: OK");

  const other = await open(`http://127.0.0.1:${otherPort}/login`);
  await other.click("#user");
  await assertNoPicker(other, "No picker on a site without logins");
  assert.equal(await badge(popup, await tabId(popup, `http://127.0.0.1:${otherPort}/login`)), "");
  console.log("Site without logins shows nothing: OK");

  // Locking the vault stops the extension.
  await app.getByRole("button", { name: "Verrouiller", exact: true }).click();
  assert.deepEqual(await popupMessage(popup, { type: "GetState", tabId: loginTab }), {
    type: "Locked",
    appVersion: "0.1.0",
  });
  await popup.reload();
  await popup.getByText("Déverrouille Cairn pour voir tes identifiants.").waitFor();
  await popup.screenshot({ path: path.join(directory, "popup-locked.png") });
  const lockedPage = await open(`${origin}/signin`);
  await lockedPage.click("#user");
  await assertNoPicker(lockedPage, "A locked vault doesn't open the picker on focus");
  console.log("Locked vault: OK");

  // Removing the browser in Cairn revokes it.
  await app.getByLabel("Mot de passe maître", { exact: true }).fill(master);
  await app.getByRole("button", { name: "Déverrouiller", exact: true }).click();
  await app.getByRole("button", { name: "Navigateurs associés" }).click();
  const browsers = app.getByRole("dialog", { name: "Navigateurs associés" });
  await browsers.waitFor();
  await app.screenshot({ path: path.join(directory, "desktop-browsers.png") });
  await browsers.getByRole("button", { name: /^Retirer / }).click();
  await browsers.getByText("Aucun navigateur associé.", { exact: false }).waitFor();
  await app.keyboard.press("Escape");
  assert.equal((await popupMessage(popup, { type: "GetState", tabId: loginTab })).type, "Pairing");
  console.log("Removed browser is refused: OK");

  assert.deepEqual(appErrors, []);
  assert.deepEqual(popupErrors, []);
  await webview.close();
} finally {
  desktop.kill();
  site.close();
  otherSite.close();

  try {
    await browser.close();
  } finally {
    if (registered) powershell("unregister-native-host.ps1");
  }
}
