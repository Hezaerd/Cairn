import { Effect, Layer, Match, Option, Result } from "effect";
import { CairnClient, CairnClientLive } from "@cairn/client/CairnClient";
import { chromiumTransport } from "@cairn/client/ChromiumTransport";
import { IndexedDbKey } from "@cairn/client/IndexedDbKey";
import { decodePopupRequest, type PopupRequest, type PopupResult } from "@cairn/contracts";
import { CairnClientError } from "@cairn/contracts/errors";
import { fillLogin } from "./fill";

// Each popup request owns a short-lived native connection. Only the pairing
// key persists, in IndexedDB; credentials never leave this worker except
// into the page being filled.
const live = CairnClientLive.pipe(
  Layer.provide(Layer.merge(chromiumTransport(chrome.runtime), IndexedDbKey)),
);

/**
 * The tab's address, readable because opening the popup grants `activeTab`.
 * Null when it isn't a website or the grant is gone.
 */
const tabOrigin = (tabId: number) =>
  Effect.tryPromise(() => chrome.tabs.get(tabId)).pipe(
    Effect.map((tab) => {
      const url = URL.parse(tab.url ?? "");

      return url && (url.protocol === "https:" || url.protocol === "http:") ? url : null;
    }),
    Effect.orElseSucceed(() => null),
  );

interface UserAgentData {
  readonly brands: ReadonlyArray<{ readonly brand: string }>;
}

/** Shown in Cairn's list of paired browsers. */
function browserName() {
  // SAFETY: Chromium exposes `userAgentData`, which TypeScript's DOM types don't declare yet.
  const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
  const brands = data?.brands ?? [];

  const brand = brands.find(
    ({ brand }) => !/not.?a.?brand|chromium/i.test(brand) && brand.length <= 40,
  );

  return `${brand?.brand ?? "Chromium"} (Windows)`;
}

const state = (tabId: number) =>
  Effect.gen(function* () {
    const client = yield* CairnClient;
    const { appVersion } = yield* client.getStatus;
    const code = yield* client.pairingCode;

    if (Option.isNone(code)) return { type: "Unpaired", appVersion } satisfies PopupResult;

    const url = yield* tabOrigin(tabId);

    if (!url) return { type: "NoSite", appVersion } satisfies PopupResult;

    return yield* client.listLogins(url.origin).pipe(
      Effect.map((logins): PopupResult => ({ type: "Logins", appVersion, host: url.host, logins })),
      Effect.catchIf(
        (error) => error.code === "NotPaired" || error.code === "VaultLocked",
        (error): Effect.Effect<PopupResult> =>
          Effect.succeed(
            error.code === "VaultLocked"
              ? { type: "Locked", appVersion }
              : { type: "Pairing", appVersion, code: code.value },
          ),
      ),
    );
  });

const pair = Effect.gen(function* () {
  const client = yield* CairnClient;
  const { appVersion } = yield* client.getStatus;
  const code = yield* client.pair(browserName());

  return { type: "Pairing", appVersion, code } satisfies PopupResult;
});

const fill = (tabId: number, entryId: string) =>
  Effect.gen(function* () {
    const client = yield* CairnClient;
    const url = yield* tabOrigin(tabId);

    if (!url) return { type: "NoForm" } satisfies PopupResult;

    const login = yield* client.getLogin(url.origin, entryId);

    // The script checks the origin again, in case the tab navigated meanwhile.
    const [injection] = yield* Effect.tryPromise({
      try: () =>
        chrome.scripting.executeScript({
          target: { tabId },
          func: fillLogin,
          args: [url.origin, login.username, login.password],
        }),
      catch: () => new CairnClientError({ code: "NotFound" }),
    });

    return injection?.result === true
      ? ({ type: "Filled" } satisfies PopupResult)
      : ({ type: "NoForm" } satisfies PopupResult);
  });

const handle = (request: PopupRequest) =>
  Match.value(request).pipe(
    Match.when({ type: "GetState" }, ({ tabId }) => state(tabId)),
    Match.when({ type: "Pair" }, () => pair),
    Match.when({ type: "Fill" }, ({ tabId, entryId }) => fill(tabId, entryId)),
    Match.exhaustive,
  );

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("index.html"))
    return false;

  const request = decodePopupRequest(message);

  if (Result.isFailure(request)) return false;

  const program = handle(request.success).pipe(
    Effect.provide(live),
    Effect.catch((error): Effect.Effect<PopupResult> =>
      Effect.succeed({ type: "Unavailable", code: error.code }),
    ),
  );

  void Effect.runPromise(program).then(sendResponse, () =>
    sendResponse({ type: "Unavailable", code: "ConnectionLost" }),
  );

  return true;
});
