import { usePreferences } from "../store/preferences";
import { applyTheme, applyWindowTheme, systemDark, type Theme } from "./theme";

/** Applies the preferred theme now and whenever it changes, from React or not. */
export function followTheme() {
  let stopSystem = () => {};

  function apply(theme: Theme) {
    stopSystem();
    stopSystem = () => {};

    applyTheme(theme);
    applyWindowTheme(theme);

    if (theme !== "system") return;

    const update = () => applyTheme(theme);

    systemDark.addEventListener("change", update);
    stopSystem = () => systemDark.removeEventListener("change", update);
  }

  apply(usePreferences.getState().theme);

  const unsubscribe = usePreferences.subscribe((state, previous) => {
    if (state.theme !== previous.theme) apply(state.theme);
  });

  return () => {
    unsubscribe();
    stopSystem();
  };
}
