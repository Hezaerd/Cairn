import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

// Explicit integration test: uses an isolated Helium profile and temporarily
// registers the native host. Never edits a personal browser profile.
const root = process.cwd();
const local = path.join(root, ".local");
mkdirSync(local, { recursive: true });
if (existsSync(path.join(local, "native-host.json"))) {
  throw new Error("Unregister this checkout's native host before running the isolated integration test.");
}
const executablePath = process.env.CAIRN_HELIUM_PATH ?? path.join(process.env.LOCALAPPDATA!, "imput/Helium/Application/chrome.exe");
const desktopPath = path.join(root, "target/debug/cairn-desktop.exe");
assert.ok(existsSync(desktopPath), "Build the desktop app first with tauri build --debug --no-bundle.");
const extensionPath = path.join(root, "apps/extension/dist");
const profile = mkdtempSync(path.join(local, "helium-e2e-"));
const context = await chromium.launchPersistentContext(profile, {
  executablePath, headless: true, viewport: { width: 360, height: 320 },
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, "--no-first-run"],
});
let desktop: ChildProcess | undefined;
let registered = false;
const powershell = (script: string, args: string[] = []) => execFileSync("powershell.exe", [
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts", script), ...args,
], { cwd: root, windowsHide: true, stdio: "pipe" });

try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker", { timeout: 20_000 });
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/index.html`);
  await page.getByRole("status").filter({ hasText: "Connecteur à installer" }).waitFor();
  console.log("Missing host installation: OK");

  powershell("register-native-host.ps1", ["-ExtensionId", id]);
  registered = true;
  await page.getByRole("button", { name: "Réessayer" }).click();
  await page.getByText("Ouvre Cairn sur Windows, puis réessaie.").waitFor();
  console.log("Application absent through Helium Native Messaging: OK");

  desktop = spawn(desktopPath, [], { cwd: root, windowsHide: true, stdio: "ignore" });
  let connected = false;
  for (let attempt = 0; attempt < 15; attempt++) {
    if (desktop.exitCode !== null) throw new Error(`Desktop exited: ${desktop.exitCode}`);
    await page.getByRole("button", { name: "Réessayer" }).click();
    await page.getByRole("button").waitFor({ state: "visible" });
    await page.waitForFunction(() => !(document.querySelector("button") as HTMLButtonElement).disabled);
    if (await page.getByRole("status").textContent() === "Cairn connecté") { connected = true; break; }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.ok(connected, "Desktop did not become available");
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(local, "helium-connected.png") });
  console.log(`Connected through Helium to the actual Tauri app: OK (extension ${id})`);

  // A second popup request gets its own native connection.
  const second = await context.newPage();
  await second.goto(`chrome-extension://${id}/index.html`);
  await second.getByRole("status").filter({ hasText: "Cairn connecté" }).waitFor();
  console.log("Second extension page: OK");
  await second.close();

  const secondContext = await chromium.launchPersistentContext(mkdtempSync(path.join(local, "helium-profile-")), {
    executablePath, headless: true, ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, "--no-first-run"],
  });
  try {
    const secondWorker = secondContext.serviceWorkers()[0] ?? await secondContext.waitForEvent("serviceworker");
    assert.equal(new URL(secondWorker.url()).host, id);
    const secondProfilePage = await secondContext.newPage();
    await secondProfilePage.goto(`chrome-extension://${id}/index.html`);
    await secondProfilePage.getByRole("status").filter({ hasText: "Cairn connecté" }).waitFor();
    console.log("Two isolated Helium profiles: OK");
  } finally { await secondContext.close(); }

  const cdp = await context.newCDPSession(page);
  const targets = await cdp.send("Target.getTargets");
  const target = targets.targetInfos.find(info => info.type === "service_worker" && info.url === worker.url());
  assert.ok(target, "Extension service worker target is missing");
  await cdp.send("Target.closeTarget", { targetId: target.targetId });
  await page.getByRole("button", { name: "Actualiser" }).click();
  await page.getByRole("status").filter({ hasText: "Cairn connecté" }).waitFor();
  console.log("Request after service worker termination: OK");
  await cdp.detach();

  desktop.kill();
  await new Promise<void>(resolve => desktop!.exitCode !== null ? resolve() : desktop!.once("exit", () => resolve()));
  desktop = undefined;
  await page.getByRole("button", { name: "Actualiser" }).click();
  await page.getByText("Ouvre Cairn sur Windows, puis réessaie.").waitFor();
  console.log("Desktop closure: OK");
} finally {
  desktop?.kill();
  try { await context.close(); }
  finally { if (registered) powershell("unregister-native-host.ps1"); }
}
