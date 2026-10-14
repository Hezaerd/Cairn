import { Option, Schema } from "effect";
import { PasswordOptions } from "../vault/VaultClient";

// Only the options are remembered. Generated passwords stay in memory until they're saved.
const storageKey = "cairn-password-generator";

export const defaultOptions: PasswordOptions = {
  length: 20,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: false,
};

const decodeOptions = Schema.decodeUnknownOption(Schema.fromJsonString(PasswordOptions));

export function storedOptions(): PasswordOptions {
  return Option.getOrElse(decodeOptions(localStorage.getItem(storageKey)), () => defaultOptions);
}

export function storeOptions(options: PasswordOptions) {
  localStorage.setItem(storageKey, JSON.stringify(options));
}
