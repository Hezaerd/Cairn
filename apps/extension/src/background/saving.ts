import { Effect } from "effect";
import { CairnClient, type Credential } from "@cairn/client/CairnClient";
import type { LoginCheck, SaveResult } from "@cairn/contracts";
import { CairnClientError } from "@cairn/contracts/errors";

/** How long a submitted login waits to be offered, and the offer to be answered. */
const PENDING_MS = 120_000;

interface Pending {
  /** Where the login was typed. It's saved for this origin. */
  readonly origin: string;
  readonly username: string;
  /** Dropped once the login is saved. */
  password: string | null;
  expires: number;
  timer?: ReturnType<typeof setTimeout>;
  /** What Cairn answered, once it was asked. */
  check?: LoginCheck;
  /** The origin of the page showing the save banner, once it opened. */
  offeredOn?: string;
}

// The last login submitted in each tab, in this worker's memory only. A
// login form often loads another page, or another site, so it outlives the
// page it was typed in, but not the tab or two minutes. The worker may stop
// at any time, which drops it.
const pending = new Map<number, Pending>();

export function forget(tabId: number) {
  clearTimeout(pending.get(tabId)?.timer);
  pending.delete(tabId);
}

/** Forgets the tab's offer once it was saved, and not a login submitted since. */
export function forgetSaved(tabId: number) {
  if (pending.get(tabId)?.password === null) forget(tabId);
}

const keep = (tabId: number, entry: Pending) => {
  clearTimeout(entry.timer);
  entry.expires = Date.now() + PENDING_MS;
  entry.timer = setTimeout(() => forget(tabId), PENDING_MS);
};

export function submitted(tabId: number, origin: string, login: Credential) {
  forget(tabId);
  const entry: Pending = { origin, ...login, expires: 0 };
  keep(tabId, entry);
  pending.set(tabId, entry);
}

const current = (tabId: number) => {
  const entry = pending.get(tabId);

  return entry && entry.expires > Date.now() ? entry : undefined;
};

/** The tab's submitted login, while it still waits to be saved. */
const unsaved = (tabId: number) => {
  const entry = current(tabId);

  return entry?.password ? { entry, password: entry.password } : undefined;
};

/** Asks Cairn whether it holds the login, without sending the password. */
const check = (entry: Pending, password: string) =>
  Effect.gen(function* () {
    const client = yield* CairnClient;
    entry.check = yield* client.checkLogin(entry.origin, { username: entry.username, password });

    return entry.check;
  });

/**
 * Whether to offer saving the tab's submitted login on the page at `origin`:
 * yes when Cairn doesn't hold it, or is locked and can't tell yet.
 */
export const shouldOffer = (tabId: number, origin: string) =>
  Effect.gen(function* () {
    const found = unsaved(tabId);

    if (!found) return false;

    const result = yield* check(found.entry, found.password).pipe(
      Effect.map((check) => check.result),
      Effect.catchIf(
        (error) => error.code === "VaultLocked",
        () => Effect.succeed("Locked" as const),
      ),
    );

    if (result === "Known") {
      forget(tabId);

      return false;
    }

    found.entry.offeredOn = origin;
    keep(tabId, found.entry);

    return true;
  });

/** Whether the tab's save banner was offered on its page at `origin`. */
export const offered = (tabId: number, origin: string | undefined) =>
  origin !== undefined && current(tabId)?.offeredOn === origin;

/** What the banner shows. Asks Cairn again if it was locked. */
export const offer = (tabId: number) =>
  Effect.gen(function* () {
    const found = unsaved(tabId);

    if (!found) return { type: "Unavailable", code: "NotFound" } satisfies SaveResult;

    const { entry } = found;
    const result = entry.check ?? (yield* check(entry, found.password));
    const host = new URL(entry.origin).host;

    switch (result.result) {
      case "Known":
        forget(tabId);

        return { type: "Known" } satisfies SaveResult;
      case "New":
        return { type: "New", host, username: entry.username } satisfies SaveResult;
      case "Changed":
        return {
          type: "Changed",
          host,
          username: entry.username,
          name: result.entry.name,
        } satisfies SaveResult;
    }
  });

/**
 * Saves the tab's submitted login: as a new login given `name`, or else as
 * the new password of the login it changed. Keeps the offer, without the
 * password, until the banner closes.
 */
export const save = (tabId: number, name?: string) =>
  Effect.gen(function* () {
    const found = unsaved(tabId);
    const result = found?.entry.check;

    if (!found || !result) return yield* new CairnClientError({ code: "NotFound" });

    const { entry, password } = found;
    const client = yield* CairnClient;

    if (name !== undefined && result.result === "New")
      yield* client.saveLogin(entry.origin, name, { username: entry.username, password });
    else if (name === undefined && result.result === "Changed")
      yield* client.updateLogin(entry.origin, result.entry.id, password);
    else return yield* new CairnClientError({ code: "InvalidRequest" });

    entry.password = null;
  });

chrome.tabs.onRemoved.addListener(forget);
