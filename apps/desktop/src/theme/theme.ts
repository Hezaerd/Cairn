import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Option, Schema } from "effect";

export const Theme = Schema.Literals(["light", "dark", "system"]);

export type Theme = typeof Theme.Type;

const storageKey = "cairn-theme";

const decodeTheme = Schema.decodeUnknownOption(Theme);

export const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

export function storedTheme(): Theme {
  return Option.getOrElse(decodeTheme(localStorage.getItem(storageKey)), () => "system");
}

export function storeTheme(theme: Theme) {
  localStorage.setItem(storageKey, theme);
}

export function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && systemDark.matches);

  document.documentElement.classList.toggle("dark", dark);
}

// The native title bar follows this setting; `null` hands it back to the OS.
export function applyWindowTheme(theme: Theme) {
  if (!isTauri()) return;

  void getCurrentWindow()
    .setTheme(theme === "system" ? null : theme)
    .catch(() => undefined);
}
