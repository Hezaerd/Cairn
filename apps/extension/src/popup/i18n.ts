import type messages from "../../public/_locales/en/messages.json";

export type Message = keyof typeof messages;

/** Chrome picks the language from the browser UI and falls back to `default_locale`. */
export const t = (key: Message, ...substitutions: string[]) =>
  chrome.i18n.getMessage(key, substitutions);
