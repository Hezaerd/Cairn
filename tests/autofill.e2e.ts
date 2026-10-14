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
      <input type="password" id="confirm" autocomplete="new-password" maxlength="64">
    </form>`,
  ],
  // Submitting these loads a page without a form, as a successful login does.
  [
    "/account",
    `<!doctype html><title>Account</title><form method="post" action="/welcome">
      <input type="text" id="user" autocomplete="username">
      <input type="password" id="pass" autocomplete="current-password">
      <button id="go">Log in</button>
    </form>`,
  ],
  [
    "/register",
    `<!doctype html><title>Register</title><form method="post" action="/welcome">
      <input type="text" id="name" autocomplete="name">
      <input type="email" id="user" autocomplete="email">
      <input type="password" id="pass" autocomplete="new-password">
      <input type="password" id="confirm" autocomplete="new-password">
      <button id="go">Sign up</button>
    </form>`,
  ],
  // A failed login shows the form again.
  [
    "/retry",
    `<!doctype html><title>Retry</title><form method="post" action="/retry">
      <input type="text" id="user" autocomplete="username">
      <input type="password" id="pass" autocomplete="current-password">
      <button id="go">Log in</button>
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

interface Entry {
  readonly id: string;
  readonly name: string;
  readonly site: string;
  readonly username: string;
}

const bannerOf = (page: Page) => page.frames().find((frame) => frame.url().endsWith("/save.html"));

/** The save banner in `page`, once it opens. */
async function banner(page: Page): Promise<Frame> {
  for (let poll = 0; poll < 60; poll++) {
    const frame = bannerOf(page);

    if (frame) return frame;

    await page.waitForTimeout(100);
  }

  throw new Error("The save banner didn't open");
}

/** Waits long enough for the banner to have opened, then checks it didn't. */
async function assertNoBanner(page: Page, message: string) {
  await page.waitForTimeout(2_500);
  assert.equal(bannerOf(page), undefined, message);
}

/** Waits for the banner to close by itself. */
async function bannerClosed(page: Page) {
  for (let poll = 0; poll < 50 && bannerOf(page); poll++) await page.waitForTimeout(100);

  assert.equal(bannerOf(page), undefined, "The banner closes");
}

/** Types a login into `path` on the other site and submits it with the button. */
async function submitLogin(path: string, username: string, password: string) {
  const page = await open(`http://127.0.0.1:${otherPort}${path}`);
  await page.fill("#user", username);
  await page.fill("#pass", password);

  if (await page.locator("#confirm").count()) await page.fill("#confirm", password);

  await page.click("#go");
  await page.waitForLoadState();

  return page;
}

/**
 * Clicks the Cairn icon in a field. It sits in a closed shadow root, so the
 * click goes to where it's drawn: at the field's right edge.
 */
async function clickIcon(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();

  assert.ok(box, `${selector} is on the page`);
  await page.waitForTimeout(500);
  await page.mouse.click(box.x + box.width - 15, box.y + box.height / 2);
}

/** Opens the generator on a sign-up form's password field. */
async function openGenerator(page: Page) {
  await page.click("#pass");
  await assertNoPicker(page, "Focusing a sign-up field doesn't open the generator");
  await clickIcon(page, "#pass");

  const frame = await picker(page);
  await frame.getByText(/^Nouveau mot de passe pour /).waitFor();

  return frame;
}

/** The password the generator shows, once it shows one. */
async function preview(frame: Frame, previous?: string) {
  const output = frame.getByLabel("Mot de passe généré");

  for (let poll = 0; poll < 50; poll++) {
    const text = (await output.textContent()) ?? "";

    if (text && text !== previous) return text;

    await frame.waitForTimeout(100);
  }

  throw new Error("The generator showed no new password");
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
  const code = (await popup.locator("p.font-mono").textContent())?.trim() ?? "";
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
  await assertNoPicker(signup, "No login picker on a sign-up form");
  console.log("Sign-up form gets no login picker: OK");

  // Generating: the icon in a sign-up form's password field opens the generator.
  frame = await openGenerator(signup);
  let generated = await preview(frame);
  assert.equal(generated.length, 20);
  assert.equal(await frame.getByRole("slider").getAttribute("aria-valuemax"), "64");
  await signup.screenshot({ path: path.join(directory, "page-generator.png") });

  await frame.getByRole("button", { name: "Régénérer" }).click();
  const regenerated = await preview(frame, generated);
  await frame.getByLabel("Symboles (!#$…)").uncheck();
  generated = await preview(frame, regenerated);
  assert.match(generated, /^[A-Za-z0-9]{20}$/, "Turning symbols off removes them");

  await signup.waitForTimeout(600);
  await frame.getByRole("button", { name: "Utiliser" }).click();
  await signup.waitForFunction(() => document.querySelector<HTMLInputElement>("#confirm")?.value);
  assert.equal(await signup.inputValue("#pass"), generated);
  assert.equal(await signup.inputValue("#confirm"), generated);
  assert.equal(await signup.inputValue("#user"), "", "Generating fills no username");
  await assertNoPicker(signup, "The generator closes after filling");

  // Reopening keeps the password generated for the site.
  frame = await openGenerator(signup);
  assert.equal(await preview(frame), generated);
  await signup.keyboard.press("Escape");
  console.log("Generated a password into a sign-up form: OK");

  const other = await open(`http://127.0.0.1:${otherPort}/login`);
  await other.click("#user");
  await assertNoPicker(other, "No picker on a site without logins");
  assert.equal(await badge(popup, await tabId(popup, `http://127.0.0.1:${otherPort}/login`)), "");
  console.log("Site without logins shows nothing: OK");

  // Saving: a login typed on a site Cairn doesn't know is offered once the
  // form goes away.
  const otherOrigin = `http://127.0.0.1:${otherPort}`;
  const typed = "synthetic-typed-81!";
  const changed = "synthetic-changed-81!";

  const listEntries = (): Promise<ReadonlyArray<Entry>> =>
    // SAFETY: Tauri injects its IPC bridge into the app's own WebView.
    app.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke("list_entries"));

  let welcome = await submitLogin("/account", "new@example.com", typed);
  let offer = await banner(welcome);
  await offer.getByText("Enregistrer cet identifiant dans Cairn ?").waitFor();
  await offer.getByText("new@example.com").waitFor();
  const name = offer.getByLabel("Nom");
  assert.equal(await name.inputValue(), `127.0.0.1:${otherPort}`);
  assert.ok(
    !(await offer.locator("body").innerText()).includes(typed),
    "The banner hides the password",
  );
  await welcome.screenshot({ path: path.join(directory, "page-save.png") });

  // A banner the page made transparent ignores clicks.
  await styleOverlay(welcome, "0.2");
  await welcome.waitForTimeout(600);
  await offer.getByRole("button", { name: "Enregistrer" }).click();
  await welcome.waitForTimeout(800);
  assert.equal((await listEntries()).length, 2, "A transparent banner must not save");
  await styleOverlay(welcome, null);
  await welcome.waitForTimeout(600);

  await name.fill("Site enregistré");
  await offer.getByRole("button", { name: "Enregistrer" }).click();
  await offer.getByText("Enregistré dans Cairn.").waitFor();
  await bannerClosed(welcome);
  await app.getByRole("complementary").getByText("Site enregistré", { exact: true }).waitFor();
  const savedEntry = (await listEntries()).find((entry) => entry.name === "Site enregistré");
  assert.deepEqual(
    { site: savedEntry?.site, username: savedEntry?.username },
    { site: otherOrigin, username: "new@example.com" },
  );
  console.log("New login saved from the banner, and the app's list shows it: OK");

  welcome = await submitLogin("/account", "new@example.com", typed);
  await assertNoBanner(welcome, "A login Cairn holds isn't offered");
  console.log("Known login isn't offered: OK");

  welcome = await submitLogin("/account", " New@Example.com ", changed);
  offer = await banner(welcome);
  await offer.getByText("Mettre à jour ce mot de passe dans Cairn ?").waitFor();
  await offer.getByText("Site enregistré").waitFor();
  await welcome.waitForTimeout(600);
  await offer.getByRole("button", { name: "Mettre à jour" }).click();
  await offer.getByText("Enregistré dans Cairn.").waitFor();
  await bannerClosed(welcome);
  assert.equal((await listEntries()).length, 3, "Updating doesn't add a login");

  const account = await open(`${otherOrigin}/account`);
  const accountTab = await tabId(popup, `${otherOrigin}/account`);
  assert.deepEqual(
    await popupMessage(popup, { type: "Fill", tabId: accountTab, entryId: savedEntry!.id }),
    { type: "Filled" },
  );
  assert.equal(await account.inputValue("#pass"), changed);
  console.log("Changed password offered as an update, and saved: OK");

  // Submitting what Cairn filled offers nothing.
  await account.click("#go");
  await account.waitForLoadState();
  await assertNoBanner(account, "A login Cairn filled isn't offered");
  console.log("Filled login isn't offered: OK");

  welcome = await submitLogin("/retry", "retry@example.com", typed);
  await assertNoBanner(welcome, "A login whose form comes back isn't offered");
  console.log("Failed login isn't offered: OK");

  welcome = await submitLogin("/register", "signup@example.com", typed);
  offer = await banner(welcome);
  await offer.getByText("signup@example.com").waitFor();
  await offer.getByRole("button", { name: "Plus tard" }).click();
  await bannerClosed(welcome);
  assert.equal((await listEntries()).length, 3, "Not now saves nothing");
  console.log("Sign-up offered, Not now closes it: OK");

  // A generated password isn't a fill: signing up with it offers to save it.
  const register = await open(`${otherOrigin}/register`);
  frame = await openGenerator(register);
  const signedUp = await preview(frame);
  await register.waitForTimeout(600);
  await frame.getByRole("button", { name: "Utiliser" }).click();
  await register.waitForFunction(() => document.querySelector<HTMLInputElement>("#confirm")?.value);
  await register.fill("#user", "generated@example.com");
  await register.click("#go");
  await register.waitForLoadState();
  offer = await banner(register);
  await offer.getByText("generated@example.com").waitFor();
  assert.ok(
    !(await offer.locator("body").innerText()).includes(signedUp),
    "The banner hides the generated password",
  );
  await offer.getByLabel("Nom").fill("Inscription générée");
  await register.waitForTimeout(600);
  await offer.getByRole("button", { name: "Enregistrer" }).click();
  await offer.getByText("Enregistré dans Cairn.").waitFor();
  await bannerClosed(register);

  const generatedEntry = (await listEntries()).find(
    (entry) => entry.name === "Inscription générée",
  );

  assert.ok(generatedEntry, "The generated login is saved");

  const generatedAccount = await open(`${otherOrigin}/account`);
  assert.deepEqual(
    await popupMessage(popup, {
      type: "Fill",
      tabId: await tabId(popup, `${otherOrigin}/account`),
      entryId: generatedEntry.id,
    }),
    { type: "Filled" },
  );
  assert.equal(await generatedAccount.inputValue("#pass"), signedUp);
  console.log("Signed up with a generated password and saved it: OK");

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

  // A name you give shows instead of the browser's own, and Escape only leaves the field.
  await browsers.getByRole("button", { name: /^Renommer / }).click();
  await browsers.getByLabel("Nom du navigateur").fill("Profil de test");
  await app.keyboard.press("Escape");
  await browsers.getByRole("button", { name: /^Renommer / }).waitFor();
  await browsers.getByRole("button", { name: /^Renommer / }).click();
  await browsers.getByLabel("Nom du navigateur").fill("Profil de test");
  await browsers.getByLabel("Nom du navigateur").press("Enter");
  await browsers.getByText("Profil de test", { exact: true }).waitFor();
  await app.screenshot({ path: path.join(directory, "desktop-browsers-renamed.png") });
  console.log("Renaming a browser: OK");

  await browsers.getByRole("button", { name: "Retirer Profil de test" }).click();
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
