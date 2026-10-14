import { Effect, Layer, Match, Result } from "effect";
import { CairnClient, CairnClientLive } from "@cairn/client/CairnClient";
import { chromiumTransport } from "@cairn/client/ChromiumTransport";
import { IndexedDbKey } from "@cairn/client/IndexedDbKey";
import {
  DEV_HOST_NAME,
  HOST_NAME,
  decodePageRequest,
  decodePickerRequest,
  decodePopupRequest,
  decodeSaveRequest,
  type PageRequest,
  type PageResult,
  type PickerRequest,
  type PickerResult,
  type PopupRequest,
  type PopupResult,
  type SaveRequest,
  type SaveResult,
} from "@cairn/contracts";
import { CairnClientError } from "@cairn/contracts/errors";
import { fillTab, tellPage } from "./fill";
import { forgetGenerated, generate, lastGenerated } from "./generated";
import { forget, forgetSaved, offer, offered, save, shouldOffer, submitted } from "./saving";
import {
  closePicker,
  forgetLogins,
  injectOpenTabs,
  openPicker,
  pickerFor,
  type OpenPicker,
  suggestions,
  suggestionsAllowed,
  syncContentScript,
} from "./suggestions";

/** How long the banner shows that a login was saved. */
const SAVED_NOTICE_MS = 1_500;

// The installer registers the release host; the dev scripts register the dev one.
const hostName = import.meta.env.MODE === "release" ? HOST_NAME : DEV_HOST_NAME;

// Each request owns a short-lived native connection. Only the pairing key
// persists, in IndexedDB; credentials never leave this worker except into the
// page being filled.
const live = CairnClientLive.pipe(
  Layer.provide(Layer.merge(chromiumTransport(chrome.runtime, hostName), IndexedDbKey)),
);

/** An `http` or `https` address, or null. */
const website = (address: string | undefined) => {
  const url = URL.parse(address ?? "");

  return url && (url.protocol === "https:" || url.protocol === "http:") ? url : null;
};

/**
 * The tab's address, readable when opening the popup granted `activeTab` or
 * suggestions are on. Null when it isn't a website or the grant is gone.
 */
const tabOrigin = (tabId: number) =>
  Effect.tryPromise(() => chrome.tabs.get(tabId)).pipe(
    Effect.map((tab) => website(tab.url)),
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

/**
 * The code of this browser's last pairing request. Kept in memory only: if
 * the worker stops, the popup offers to pair again.
 */
let pairingCode: string | null = null;

const state = (tabId: number) =>
  Effect.gen(function* () {
    const client = yield* CairnClient;
    const { appVersion } = yield* client.getStatus;

    if (!(yield* client.hasKey)) return { type: "Unpaired", appVersion } satisfies PopupResult;

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
              : pairingCode === null
                ? { type: "Unpaired", appVersion }
                : { type: "Pairing", appVersion, code: pairingCode },
          ),
      ),
    );
  });

const pair = Effect.gen(function* () {
  const client = yield* CairnClient;
  const { appVersion } = yield* client.getStatus;
  pairingCode = null;
  const code = yield* client.pair(browserName());
  pairingCode = code;

  return { type: "Pairing", appVersion, code } satisfies PopupResult;
});

const fill = (tabId: number, entryId: string) =>
  Effect.gen(function* () {
    const client = yield* CairnClient;
    const url = yield* tabOrigin(tabId);

    if (!url) return { type: "NoForm" } satisfies PopupResult;

    const login = yield* client.getLogin(url.origin, entryId);
    const filled = yield* fillTab(tabId, url.origin, login);

    return { type: filled ? "Filled" : "NoForm" } satisfies PopupResult;
  });

const handlePopup = (request: PopupRequest) =>
  Match.value(request).pipe(
    Match.when({ type: "GetState" }, ({ tabId }) => state(tabId)),
    Match.when({ type: "Pair" }, () => pair),
    Match.when({ type: "Fill" }, ({ tabId, entryId }) => fill(tabId, entryId)),
    Match.exhaustive,
  );

/** Whether Cairn has logins for a page, without saying which. */
const formFound = (tabId: number, url: URL) =>
  Effect.gen(function* () {
    if (!(yield* Effect.promise(() => suggestionsAllowed(url))))
      return { type: "Off" } satisfies PageResult;

    const logins = yield* suggestions(tabId, url.origin);

    return { type: logins.length > 0 ? "Matches" : "None" } satisfies PageResult;
  }).pipe(
    Effect.catch((error): Effect.Effect<PageResult> =>
      Effect.succeed({ type: error.code === "VaultLocked" ? "Locked" : "None" }),
    ),
  );

const handlePage = (request: PageRequest, tabId: number, url: URL) =>
  Match.value(request).pipe(
    Match.when({ type: "FormFound" }, () => formFound(tabId, url)),
    Match.when({ type: "OpenPicker" }, ({ newPassword }) =>
      Effect.promise(async (): Promise<PageResult> => {
        if (!(await suggestionsAllowed(url))) return { type: "None" };
        openPicker(
          tabId,
          newPassword ? { origin: url.origin, newPassword } : { origin: url.origin },
        );

        return { type: "Matches" };
      }),
    ),
    Match.when({ type: "ClosePicker" }, () =>
      Effect.sync((): PageResult => {
        closePicker(tabId);

        return { type: "None" };
      }),
    ),
    // Saving is part of suggestions: without them, the page's typing stays there.
    Match.when({ type: "Submitted" }, ({ username, password }) =>
      Effect.promise(async (): Promise<PageResult> => {
        if (await suggestionsAllowed(url)) submitted(tabId, url.origin, { username, password });

        return { type: "None" };
      }),
    ),
    Match.when({ type: "FormGone" }, () =>
      Effect.gen(function* () {
        if (!(yield* Effect.promise(() => suggestionsAllowed(url))))
          return { type: "None" } satisfies PageResult;

        const offering = yield* shouldOffer(tabId, url.origin);

        return { type: offering ? "Offer" : "None" } satisfies PageResult;
      }),
    ),
    Match.exhaustive,
  );

const pickerSuggestions = (tabId: number, origin: string) =>
  suggestions(tabId, origin).pipe(
    Effect.map((logins): PickerResult => ({ type: "Logins", host: new URL(origin).host, logins })),
    Effect.catchIf(
      (error) => error.code === "VaultLocked",
      (): Effect.Effect<PickerResult> => Effect.succeed({ type: "Locked" }),
    ),
  );

const pickerFill = (tabId: number, origin: string, entryId: string) =>
  Effect.gen(function* () {
    const client = yield* CairnClient;
    const login = yield* client.getLogin(origin, entryId);
    const filled = yield* fillTab(tabId, origin, login);

    if (!filled) return { type: "NoForm" } satisfies PickerResult;

    closePicker(tabId);
    yield* Effect.promise(() => tellPage(tabId, { type: "ClosePicker", refocus: false }));

    return { type: "Filled" } satisfies PickerResult;
  });

/**
 * Fills the tab's last generated password into the sign-up form. The content
 * script checks the page is still on `origin`.
 */
const useGenerated = (tabId: number, origin: string) =>
  Effect.promise(async (): Promise<PickerResult> => {
    const kept = lastGenerated(tabId, origin);

    if (!kept) return { type: "Unavailable", code: "NotFound" };

    const filled = await tellPage(tabId, {
      type: "FillNewPassword",
      origin,
      password: kept.password,
    });

    if (filled !== true) return { type: "NoForm" };

    closePicker(tabId);
    await tellPage(tabId, { type: "ClosePicker", refocus: false });

    return { type: "Filled" };
  });

const handleGenerator = (
  request: PickerRequest,
  tabId: number,
  origin: string,
  maxLength: number,
) =>
  Match.value(request).pipe(
    Match.when({ type: "GetSuggestions" }, () =>
      Effect.succeed<PickerResult>({ type: "Generator", host: new URL(origin).host, maxLength }),
    ),
    Match.when({ type: "Generate" }, ({ options, fresh }) =>
      generate(
        tabId,
        origin,
        { ...options, length: Math.min(options.length, maxLength) },
        fresh,
      ).pipe(Effect.map((generated): PickerResult => ({ type: "Generated", ...generated }))),
    ),
    Match.when({ type: "UseGenerated" }, () => useGenerated(tabId, origin)),
    // A picker on a sign-up form fills only a generated password.
    Match.when({ type: "Fill" }, () => Effect.succeed<PickerResult>({ type: "NoForm" })),
    Match.orElse(() => handlePicker(request, tabId, origin)),
  );

const handlePicker = (request: PickerRequest, tabId: number, origin: string) =>
  Match.value(request).pipe(
    Match.when({ type: "GetSuggestions" }, () => pickerSuggestions(tabId, origin)),
    Match.when({ type: "Fill" }, ({ entryId }) => pickerFill(tabId, origin, entryId)),
    // Only a picker opened on a sign-up form generates passwords.
    Match.when({ type: "Generate" }, () =>
      Effect.succeed<PickerResult>({ type: "Unavailable", code: "Unauthorized" }),
    ),
    Match.when({ type: "UseGenerated" }, () =>
      Effect.succeed<PickerResult>({ type: "Unavailable", code: "Unauthorized" }),
    ),
    Match.when({ type: "Close" }, () =>
      Effect.promise(async (): Promise<PickerResult> => {
        closePicker(tabId);
        await tellPage(tabId, { type: "ClosePicker", refocus: true });

        return { type: "Done" };
      }),
    ),
    Match.when({ type: "Resize" }, ({ height }) =>
      Effect.promise(async (): Promise<PickerResult> => {
        await tellPage(tabId, { type: "ResizePicker", height });

        return { type: "Done" };
      }),
    ),
    Match.exhaustive,
  );

const lockedOr = <A>(program: Effect.Effect<A, CairnClientError, CairnClient>) =>
  program.pipe(
    Effect.catchIf(
      (error) => error.code === "VaultLocked",
      (): Effect.Effect<SaveResult> => Effect.succeed({ type: "Locked" }),
    ),
  );

/** Closes the banner, after a moment to read that the login was saved. */
const saved = (tabId: number) =>
  Effect.sync((): SaveResult => {
    forgetLogins(tabId);
    forgetGenerated(tabId);

    setTimeout(() => {
      forgetSaved(tabId);
      void tellPage(tabId, { type: "CloseSave" });
    }, SAVED_NOTICE_MS);

    return { type: "Saved" };
  });

const handleSave = (request: SaveRequest, tabId: number) =>
  Match.value(request).pipe(
    Match.when({ type: "GetOffer" }, () => lockedOr(offer(tabId))),
    Match.when({ type: "Save" }, ({ name }) =>
      lockedOr(save(tabId, name.trim()).pipe(Effect.andThen(saved(tabId)))),
    ),
    Match.when({ type: "Update" }, () => lockedOr(save(tabId).pipe(Effect.andThen(saved(tabId))))),
    Match.when({ type: "Dismiss" }, () =>
      Effect.promise(async (): Promise<SaveResult> => {
        forget(tabId);
        await tellPage(tabId, { type: "CloseSave" });

        return { type: "Done" };
      }),
    ),
    Match.when({ type: "Resize" }, ({ height }) =>
      Effect.promise(async (): Promise<SaveResult> => {
        await tellPage(tabId, { type: "ResizeSave", height });

        return { type: "Done" };
      }),
    ),
    Match.exhaustive,
  );

/**
 * The picker that sent a message: the one the tab's own page opened, as long
 * as the tab is still on its site. A page can frame the picker itself, but
 * then it gets nothing until real input in that page opened it.
 */
const pickerSite = (sender: chrome.runtime.MessageSender) => {
  const tabId = sender.tab?.id;
  const picker: OpenPicker | undefined = tabId === undefined ? undefined : pickerFor(tabId);

  return tabId !== undefined && picker && website(sender.tab?.url)?.origin === picker.origin
    ? { tabId, picker }
    : null;
};

const reply = <A>(
  program: Effect.Effect<A, CairnClientError, CairnClient>,
  fallback: (code: CairnClientError["code"]) => A,
  sendResponse: (response: A) => void,
) => {
  const handled = program.pipe(
    Effect.provide(live),
    Effect.catch((error) => Effect.succeed(fallback(error.code))),
  );

  void Effect.runPromise(handled).then(sendResponse, () =>
    sendResponse(fallback("ConnectionLost")),
  );

  return true;
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;

  const page = sender.tab && sender.frameId === 0 ? website(sender.url) : null;
  const extensionPage = URL.parse(sender.url ?? "");

  // Web pages can't message this worker, but a content script runs in pages
  // and reports what the page's DOM shows. Its address comes from Chromium.
  if (page && sender.tab?.id !== undefined) {
    const request = decodePageRequest(message);

    if (Result.isFailure(request)) return false;

    return reply(
      handlePage(request.success, sender.tab.id, page),
      (): PageResult => ({ type: "None" }),
      sendResponse,
    );
  }

  if (extensionPage?.protocol !== "chrome-extension:") return false;

  if (extensionPage.pathname === "/picker.html") {
    const request = decodePickerRequest(message);
    const site = pickerSite(sender);

    if (Result.isFailure(request)) return false;

    if (!site) {
      sendResponse({ type: "Unavailable", code: "Unauthorized" } satisfies PickerResult);

      return false;
    }

    const { tabId, picker } = site;

    return reply(
      picker.newPassword
        ? handleGenerator(request.success, tabId, picker.origin, picker.newPassword.maxLength)
        : handlePicker(request.success, tabId, picker.origin),
      (code): PickerResult => ({ type: "Unavailable", code }),
      sendResponse,
    );
  }

  // The save banner gets an answer only on the page it was offered on. A page
  // can frame the banner itself, but then it gets nothing.
  if (extensionPage.pathname === "/save.html") {
    const request = decodeSaveRequest(message);
    const tabId = sender.tab?.id;

    if (Result.isFailure(request)) return false;

    if (tabId === undefined || !offered(tabId, website(sender.tab?.url)?.origin)) {
      // A banner whose offer expired can still close.
      if (tabId !== undefined && request.success.type === "Dismiss")
        void tellPage(tabId, { type: "CloseSave" });

      sendResponse({ type: "Unavailable", code: "Unauthorized" } satisfies SaveResult);

      return false;
    }

    return reply(
      handleSave(request.success, tabId),
      (code): SaveResult => ({ type: "Unavailable", code }),
      sendResponse,
    );
  }

  if (sender.url !== chrome.runtime.getURL("index.html")) return false;

  const request = decodePopupRequest(message);

  if (Result.isFailure(request)) return false;

  return reply(
    handlePopup(request.success),
    (code): PopupResult => ({ type: "Unavailable", code }),
    sendResponse,
  );
});

chrome.permissions.onAdded.addListener(({ origins = [] }) => {
  void syncContentScript().then(() => injectOpenTabs(origins));
});

chrome.permissions.onRemoved.addListener(() => {
  void syncContentScript();
});

void syncContentScript();
