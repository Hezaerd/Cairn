import type { PasswordOptions } from "../vault/VaultClient";

// Only the options are remembered, in the preferences. Generated passwords stay in memory until they're saved.
export const defaultOptions: PasswordOptions = {
  length: 20,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: false,
};
