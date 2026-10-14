import { Effect } from "effect";
import type { PasswordOptions } from "@cairn/contracts";
import { generatePassword } from "@cairn/client/PasswordGenerator";

/** How long a generated password stays available for its site. */
const KEEP_MS = 120_000;

interface Generated {
  readonly origin: string;
  readonly password: string;
  readonly options: PasswordOptions;
  readonly timer: ReturnType<typeof setTimeout>;
}

// The password generated last in each tab, in this worker's memory only, so
// it can still be filled after the picker closed or the sign-up failed. Not
// the tab, another site, or two minutes. The worker may stop at any time,
// which drops it.
const generated = new Map<number, Generated>();

export function forgetGenerated(tabId: number) {
  clearTimeout(generated.get(tabId)?.timer);
  generated.delete(tabId);
}

/** The tab's last password for `origin`, while it's kept. */
export const lastGenerated = (tabId: number, origin: string) => {
  const entry = generated.get(tabId);

  return entry?.origin === origin ? entry : undefined;
};

/**
 * A new password for the tab's site, unless `fresh` is false and one is
 * still kept for it.
 */
export const generate = (tabId: number, origin: string, options: PasswordOptions, fresh: boolean) =>
  Effect.gen(function* () {
    const kept = fresh ? undefined : lastGenerated(tabId, origin);

    if (kept) return { password: kept.password, options: kept.options };

    const password = yield* generatePassword(options);
    forgetGenerated(tabId);
    generated.set(tabId, {
      origin,
      password,
      options,
      timer: setTimeout(() => forgetGenerated(tabId), KEEP_MS),
    });

    return { password, options };
  });

chrome.tabs.onRemoved.addListener(forgetGenerated);
