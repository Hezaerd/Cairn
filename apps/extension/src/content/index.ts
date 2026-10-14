import type { PageRequest, PageResult } from "@cairn/contracts";
import type { PageCommand } from "@cairn/contracts/picker";
import { fill, fillNewPassword, loginFields, signUpFields, submission, usable } from "./forms";
import { Overlay } from "./overlay";

// Runs in the isolated world of a page's top frame, registered for every
// site once the user allows suggestions, or injected by the service worker to
// fill from the popup. It never sees a login's name, only whether the site has
// some, and receives a password only to fill it. In a sign-up form it opens
// the picker's generator instead. It reports what the user submits in a login
// or sign-up form, so Cairn can offer to save it.

declare global {
  // Set once per page so a second injection does nothing.
  var cairnContent: true | undefined;
}

const SCAN_DELAY_MS = 300;

/** How often to look whether a submitted form went away, and for how long. */
const WATCH_INTERVAL_MS = 500;

const WATCH_MS = 120_000;

/** How long a new page has to show its login form before it counts as gone. */
const SETTLE_MS = 1_000;

/** Submit signals this close together report one submission. */
const SAME_SUBMIT_MS = 1_000;

const submitControls = 'button, input[type="submit"], input[type="image"], [role="button"]';

type Site = PageResult["type"] | "Unknown";

/** The password field last submitted, what was reported for it, and when. */
interface Submitted {
  readonly field: HTMLInputElement;
  readonly username: string;
  readonly password: string;
  readonly at: number;
}

const send = (request: PageRequest): Promise<PageResult | undefined> =>
  chrome.runtime.sendMessage(request).catch(() => undefined);

function start() {
  let site: Site = "Unknown";
  let checking: Promise<Site> | null = null;
  let opening = false;
  // Fields whose picker was closed: focusing them again doesn't reopen it.
  const dismissed = new WeakSet<HTMLInputElement>();
  // Password fields Cairn filled, until the user types in them. Submitting
  // one doesn't offer to save what Cairn already holds.
  const filled = new WeakSet<HTMLInputElement>();
  let submitted: Submitted | null = null;
  let watcher: ReturnType<typeof setInterval> | undefined;

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

    for (const field of [
      anchor,
      fields?.username,
      fields?.password,
      ...(signUpFields(anchor)?.passwords ?? []),
    ])
      if (field) dismissed.add(field);
  };

  /**
   * Whether focusing or clicking `field` opens the picker: a login field, when
   * Cairn has logins for the site. A sign-up form's generator opens only from
   * its icon, so it doesn't cover the form for someone typing a password.
   */
  const opensOnFocus = (field: HTMLInputElement) =>
    site === "Matches" && loginFields(field) !== null;

  async function open(force: boolean) {
    const anchor = overlay.anchor;

    if (overlay.isOpen || opening || !anchor || (!force && dismissed.has(anchor))) return;

    const signUp = signUpFields(anchor);
    opening = true;

    // The service worker only answers a picker this tab asked for.
    const reply = await send(
      signUp
        ? { type: "OpenPicker", newPassword: { maxLength: signUp.maxLength } }
        : { type: "OpenPicker" },
    );

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
    const signUp = signUpFields();

    if (!fields && !signUp) {
      overlay.hide();

      return;
    }

    if (site === "Unknown") await check();

    if (site === "Off") return observer.disconnect();

    const anchor =
      site !== "None" && fields ? (fields.username ?? fields.password) : signUp?.passwords[0];

    if (anchor) overlay.showIcon(anchor, signUp?.passwords.includes(anchor) ?? false);

    // Without logins for the site, only a sign-up form gets the icon, and a
    // focused sign-up field still gets it later.
    if (site === "None") observer.disconnect();
  }

  async function focusField(field: HTMLInputElement) {
    // A locked vault may have been unlocked since.
    if (site === "Unknown" || site === "Locked") await check();

    if (document.activeElement !== field) return;

    const signUp = signUpFields(field) !== null;

    if (site === "Off" || (site === "None" && !signUp)) return;

    overlay.showIcon(field, signUp);

    if (opensOnFocus(field)) await open(false);
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

      if (
        event.isTrusted &&
        field instanceof HTMLInputElement &&
        (loginFields(field) || signUpFields(field))
      )
        void focusField(field);
    },
    true,
  );

  addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target;

      if (!event.isTrusted || overlay.contains(target)) return;

      if (target instanceof HTMLInputElement && (loginFields(target) || signUpFields(target))) {
        // A click asks for the picker, even on a field where it was closed.
        // Focusing another field moves the picker there.
        dismissed.delete(target);

        if (target === overlay.anchor && opensOnFocus(target)) void open(true);
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

    if (!fields || !fill(fields, username, password)) return false;

    if (fields.password) filled.add(fields.password);

    return true;
  }

  /**
   * Puts a generated password in the sign-up form. It isn't marked as filled,
   * so submitting the form offers to save it.
   */
  function fillGenerated(origin: string, password: string) {
    if (location.origin !== origin) return false;

    const anchor = overlay.anchor;
    const fields = (anchor?.isConnected ? signUpFields(anchor) : null) ?? signUpFields();

    if (!fields) return false;

    fillNewPassword(fields, password);

    for (const field of fields.passwords) filled.delete(field);

    return true;
  }

  /**
   * Asks the service worker to offer saving what was submitted, once the page
   * no longer shows a login form. A form still there usually means the login
   * failed.
   */
  async function offerSave() {
    if (overlay.isOffering || loginFields()?.password) return;

    const reply = await send({ type: "FormGone" });

    if (reply?.type === "Offer") overlay.offerSave();
  }

  /** Watches the submitted form, for pages that log in without loading a new one. */
  function watchSubmitted() {
    clearInterval(watcher);
    const started = Date.now();

    watcher = setInterval(() => {
      const field = submitted?.field;

      if (field?.isConnected && usable(field) && Date.now() - started < WATCH_MS) return;

      clearInterval(watcher);

      if (field && Date.now() - started < WATCH_MS) void offerSave();
    }, WATCH_INTERVAL_MS);
  }

  /** Reports the credentials in the form `target` submits, unless Cairn filled them. */
  function capture(target: Element) {
    const found = submission(target);

    if (!found || filled.has(found.password)) return;

    const username = found.username?.value.trim() ?? "";
    const password = found.password.value;

    // A click on the submit button also fires the form's submit event, and
    // Enter may do both.
    if (
      submitted?.field === found.password &&
      submitted.username === username &&
      submitted.password === password &&
      Date.now() - submitted.at < SAME_SUBMIT_MS
    )
      return;

    submitted = { field: found.password, username, password, at: Date.now() };
    void send({ type: "Submitted", username, password });
    watchSubmitted();
  }

  addEventListener(
    "submit",
    (event) => {
      if (event.isTrusted && event.target instanceof HTMLFormElement) capture(event.target);
    },
    true,
  );

  addEventListener(
    "keydown",
    (event) => {
      if (event.isTrusted && event.key === "Enter" && event.target instanceof HTMLInputElement)
        capture(event.target);
    },
    true,
  );

  addEventListener(
    "click",
    (event) => {
      const control = event.target instanceof Element && event.target.closest(submitControls);

      if (event.isTrusted && control) capture(control);
    },
    true,
  );

  addEventListener(
    "input",
    (event) => {
      if (event.isTrusted && event.target instanceof HTMLInputElement) filled.delete(event.target);
    },
    true,
  );

  // Commands come only from this extension's service worker.
  chrome.runtime.onMessage.addListener((message: PageCommand, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("background.js"))
      return false;

    switch (message.type) {
      case "Fill":
        sendResponse(fillPage(message.origin, message.username, message.password));
        break;
      case "FillNewPassword":
        sendResponse(fillGenerated(message.origin, message.password));
        break;
      case "ResizePicker":
        overlay.resize(message.height);
        break;
      case "ResizeSave":
        overlay.resizeSave(message.height);
        break;
      case "CloseSave":
        overlay.closeSave();
        break;
      case "ClosePicker": {
        if (!overlay.isOpen) break;

        overlay.close();
        const anchor = overlay.anchor;

        if (anchor) {
          dismiss(anchor);

          if (message.refocus) anchor.focus();
        }
      }
    }

    return false;
  });

  void scan();

  // A login that loaded this page may have something to save.
  setTimeout(() => void offerSave(), SETTLE_MS);
}

if (!globalThis.cairnContent && window === window.top) {
  globalThis.cairnContent = true;
  start();
}
