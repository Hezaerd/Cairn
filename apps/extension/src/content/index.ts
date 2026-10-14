import type { PageRequest, PageResult } from "@cairn/contracts";
import type { PageCommand } from "@cairn/contracts/picker";
import { fill, loginFields, usable } from "./forms";
import { Overlay } from "./overlay";

// Runs in the isolated world of a page's top frame, registered for every
// site once the user allows suggestions, or injected by the service worker to
// fill from the popup. It never sees a login's name, only whether the site has
// some, and receives a password only to fill it.

declare global {
  // Set once per page so a second injection does nothing.
  var cairnContent: true | undefined;
}

const SCAN_DELAY_MS = 300;

type Site = PageResult["type"] | "Unknown";

const send = (request: PageRequest): Promise<PageResult | undefined> =>
  chrome.runtime.sendMessage(request).catch(() => undefined);

function start() {
  let site: Site = "Unknown";
  let checking: Promise<Site> | null = null;
  let opening = false;
  // Fields whose picker was closed: focusing them again doesn't reopen it.
  const dismissed = new WeakSet<HTMLInputElement>();

  const overlay = new Overlay((event) => {
    if (!event.isTrusted) return;

    if (overlay.isOpen) closePicker(true);
    else void open(true);
  });

  /** Asks the service worker whether Cairn has logins for this site. */
  const check = () =>
    (checking ??= send({ type: "FormFound" }).then((result) => {
      site = result?.type ?? "None";
      checking = null;

      return site;
    }));

  const dismiss = (anchor: HTMLInputElement) => {
    const fields = loginFields(anchor);

    for (const field of [anchor, fields?.username, fields?.password])
      if (field) dismissed.add(field);
  };

  async function open(force: boolean) {
    const anchor = overlay.anchor;

    if (overlay.isOpen || opening || !anchor || (!force && dismissed.has(anchor))) return;

    opening = true;
    // The service worker only answers a picker this tab asked for.
    const reply = await send({ type: "OpenPicker" });
    opening = false;

    if (reply && reply.type !== "None" && overlay.anchor === anchor) overlay.open();
  }

  function closePicker(refocus: boolean) {
    const anchor = overlay.anchor;

    if (!overlay.isOpen) return;

    overlay.close();

    if (anchor) dismiss(anchor);
    void send({ type: "ClosePicker" });

    if (refocus) anchor?.focus();
  }

  async function scan() {
    const current = overlay.anchor;

    if (current?.isConnected && usable(current)) return;

    const fields = loginFields();

    if (!fields) {
      overlay.hide();

      return;
    }

    if (site === "Unknown") await check();

    if (site === "None") return observer.disconnect();

    const anchor = fields.username ?? fields.password;

    if (anchor) overlay.showIcon(anchor);
  }

  async function focusField(field: HTMLInputElement) {
    // A locked vault may have been unlocked since.
    if (site === "Unknown" || site === "Locked") await check();

    if (site === "None" || document.activeElement !== field) return;

    overlay.showIcon(field);

    if (site === "Matches") await open(false);
  }

  let scheduled = false;

  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;

    setTimeout(() => {
      scheduled = false;
      void scan();
    }, SCAN_DELAY_MS);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["type", "hidden", "disabled", "style", "class"],
  });

  // Only real input opens the picker; a page can't open it with script.
  addEventListener(
    "focusin",
    (event) => {
      const field = event.target;

      if (event.isTrusted && field instanceof HTMLInputElement && loginFields(field))
        void focusField(field);
    },
    true,
  );

  addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target;

      if (!event.isTrusted || overlay.contains(target)) return;

      if (target instanceof HTMLInputElement && loginFields(target)) {
        // A click asks for the picker, even on a field where it was closed.
        // Focusing another field moves the picker there.
        dismissed.delete(target);

        if (target === overlay.anchor && site === "Matches") void open(true);
      } else closePicker(false);
    },
    true,
  );

  addEventListener(
    "keydown",
    (event) => {
      if (!event.isTrusted || !overlay.isOpen || event.target !== overlay.anchor) return;

      if (event.key === "Escape") closePicker(false);
      else if (event.key === "ArrowDown") {
        event.preventDefault();
        overlay.focusPicker();
      }
    },
    true,
  );

  function fillPage(origin: string, username: string, password: string) {
    // The tab may have navigated since the service worker read its address.
    if (location.origin !== origin) return false;

    const anchor = overlay.anchor;
    const fields = (anchor?.isConnected ? loginFields(anchor) : null) ?? loginFields();

    return fields ? fill(fields, username, password) : false;
  }

  // Commands come only from this extension's service worker.
  chrome.runtime.onMessage.addListener((message: PageCommand, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("background.js"))
      return false;

    if (message.type === "Fill")
      sendResponse(fillPage(message.origin, message.username, message.password));
    else if (message.type === "ResizePicker") overlay.resize(message.height);
    else if (overlay.isOpen) {
      overlay.close();
      const anchor = overlay.anchor;

      if (anchor) {
        dismiss(anchor);

        if (message.refocus) anchor.focus();
      }
    }

    return false;
  });

  void scan();
}

if (!globalThis.cairnContent && window === window.top) {
  globalThis.cairnContent = true;
  start();
}
