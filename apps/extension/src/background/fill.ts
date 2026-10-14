import { Effect } from "effect";
import type { PageCommand } from "@cairn/contracts";
import type { Credential } from "@cairn/client/CairnClient";
import { CairnClientError } from "@cairn/contracts/errors";

/**
 * Hands a login to the content script in the tab's top frame, which fills it
 * only if the page is still on `origin`. Injects the script first: it's
 * registered only when suggestions are on, and does nothing the second time.
 */
export const fillTab = (tabId: number, origin: string, login: Credential) =>
  Effect.tryPromise({
    try: async () => {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: ["content.js"],
      });

      const command: PageCommand = {
        type: "Fill",
        origin,
        username: login.username,
        password: login.password,
      };

      return (await chrome.tabs.sendMessage(tabId, command, { frameId: 0 })) === true;
    },
    catch: () => new CairnClientError({ code: "NotFound" }),
  });

/** Sends a command to the content script, ignoring a page that went away. */
export const tellPage = (tabId: number, command: PageCommand) =>
  chrome.tabs.sendMessage(tabId, command, { frameId: 0 }).catch(() => undefined);
