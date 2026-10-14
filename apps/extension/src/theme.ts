const systemDark = matchMedia("(prefers-color-scheme: dark)");

/** Follows the Windows theme, as Cairn does until you pick one in its settings. */
export function followSystemTheme() {
  const apply = () => document.documentElement.classList.toggle("dark", systemDark.matches);

  apply();
  systemDark.addEventListener("change", apply);
}
