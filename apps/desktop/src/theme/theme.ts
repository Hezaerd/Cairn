import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Schema } from "effect";

export const Theme = Schema.Literals(["light", "dark", "system"]);

export type Theme = typeof Theme.Type;

export const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

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
