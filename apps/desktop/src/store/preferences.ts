import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { Option, Schema } from "effect";
import { Theme } from "../theme/theme";
import { defaultOptions } from "../generator/options";
import { PasswordOptions } from "../vault/VaultClient";
import { storedField } from "./stored";

/** Settings kept in the window's local storage. Language and update channel live in Rust. */
export interface Preferences {
  theme: Theme;
  passwordOptions: PasswordOptions;
}

// Before this store, each preference had its own key. Read them once, then drop them.
const legacyKeys = { theme: "cairn-theme", passwordOptions: "cairn-password-generator" };

const legacy: Preferences = {
  theme: Option.getOrElse(
    Schema.decodeUnknownOption(Theme)(localStorage.getItem(legacyKeys.theme)),
    () => "system",
  ),
  passwordOptions: Option.getOrElse(
    Schema.decodeUnknownOption(Schema.fromJsonString(PasswordOptions))(
      localStorage.getItem(legacyKeys.passwordOptions),
    ),
    () => defaultOptions,
  ),
};

const decodeStored = Schema.decodeUnknownOption(
  Schema.Struct({
    theme: storedField(Theme, legacy.theme),
    passwordOptions: storedField(PasswordOptions, legacy.passwordOptions),
  }),
);

export const usePreferences = create<Preferences>()(
  persist(() => legacy, {
    name: "cairn-preferences",
    version: 1,
    storage: createJSONStorage(() => localStorage),
    merge: (stored, current) => Option.getOrElse(decodeStored(stored), () => current),
  }),
);

if (Object.values(legacyKeys).some((key) => localStorage.getItem(key) !== null)) {
  // Local storage hydrates synchronously, so this writes the merged state under the new key.
  usePreferences.setState({});
  Object.values(legacyKeys).forEach((key) => localStorage.removeItem(key));
}

export const setTheme = (theme: Theme) => usePreferences.setState({ theme });

export const setPasswordOptions = (passwordOptions: PasswordOptions) =>
  usePreferences.setState({ passwordOptions });
