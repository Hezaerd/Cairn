import { Effect } from "effect";
import { CairnClient } from "@cairn/client/CairnClient";
import type { LoginSummary } from "@cairn/contracts";
import { SITES } from "../sites";

const SCRIPT_ID = "cairn-content";

const CACHE_MS = 60_000;

/**
 * Registers the content script while the extension has any host permission,
 * and removes it once it has none. Chromium only injects it where a
 * permission covers the page.
 */
export async function syncContentScript() {
  const { origins = [] } = await chrome.permissions.getAll();
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });

  if (origins.length > 0 && registered.length === 0)
    await chrome.scripting.registerContentScripts([
      { id: SCRIPT_ID, matches: SITES, js: ["content.js"], runAt: "document_idle" },
    ]);
  else if (origins.length === 0 && registered.length > 0)
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
}

/** Pages opened before suggestions were turned on get the script now. */
export async function injectOpenTabs(origins: ReadonlyArray<string>) {
  const tabs = await chrome.tabs.query({ url: [...origins] });

  await Promise.allSettled(
    tabs.map((tab) =>
      tab.id === undefined
        ? undefined
        : chrome.scripting.executeScript({
            target: { tabId: tab.id, frameIds: [0] },
            files: ["content.js"],
          }),
    ),
  );
}

/**
 * Whether suggestions are on for a page. The popup can inject the content
 * script through `activeTab`, which doesn't count.
 */
export const suggestionsAllowed = (url: URL) =>
  chrome.permissions.contains({ origins: [`${url.protocol}//${url.hostname}/*`] });

// Login names and usernames for each tab's site, in this worker's memory
// only. Never passwords. The worker may stop at any time, which only costs
// another request to Cairn.
const cache = new Map<
  number,
  { origin: string; expires: number; logins: ReadonlyArray<LoginSummary> }
>();

// The site each tab opened a picker for, after real input in that page.
const pickers = new Map<number, string>();

export const openPicker = (tabId: number, origin: string) => pickers.set(tabId, origin);

export const closePicker = (tabId: number) => pickers.delete(tabId);

export const pickerOrigin = (tabId: number) => pickers.get(tabId);

const setBadge = (tabId: number, count: number) =>
  chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : "" }).catch(() => {});

/** The logins for a tab's site, from the cache or from Cairn. Updates the badge. */
export const suggestions = (tabId: number, origin: string) =>
  Effect.gen(function* () {
    const cached = cache.get(tabId);

    if (cached && cached.origin === origin && cached.expires > Date.now()) return cached.logins;

    const client = yield* CairnClient;

    const logins = yield* client.listLogins(origin).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          cache.delete(tabId);
          void setBadge(tabId, 0);
        }),
      ),
    );

    cache.set(tabId, { origin, expires: Date.now() + CACHE_MS, logins });
    void setBadge(tabId, logins.length);

    return logins;
  });

chrome.tabs.onUpdated.addListener((tabId, change) => {
  // A new document has no picker open.
  if (change.status === "loading") pickers.delete(tabId);

  if (!change.url) return;

  // Same-site navigation in a single-page app keeps the suggestions.
  const origin = URL.parse(change.url)?.origin;

  if (cache.get(tabId)?.origin !== origin) {
    cache.delete(tabId);
    void setBadge(tabId, 0);
  }

  if (pickers.get(tabId) !== origin) pickers.delete(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  cache.delete(tabId);
  pickers.delete(tabId);
});

void chrome.action.setBadgeBackgroundColor({ color: "#899481" });

void chrome.action.setBadgeTextColor({ color: "#202520" });
