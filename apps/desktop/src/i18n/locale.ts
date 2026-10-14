import { invoke } from "@tauri-apps/api/core";
import { Data, Effect, Schema } from "effect";
import { enUS, type Messages } from "./en-US";
import { frFR } from "./fr-FR";

export const Locale = Schema.Literals(["en-US", "fr-FR"]);

export type Locale = typeof Locale.Type;

export const locales = Locale.literals;

/** Each language is named in itself, so it stays recognizable whatever the current one is. */
export const localeNames: Record<Locale, string> = {
  "en-US": "English (United States)",
  "fr-FR": "Français (France)",
};

export const messages: Record<Locale, Messages> = { "en-US": enUS, "fr-FR": frFR };

/** `chosen` is `null` while Cairn follows the Windows language; `locale` is the one in use. */
export const Language = Schema.Struct({ chosen: Schema.NullOr(Locale), locale: Locale });

export type Language = typeof Language.Type;

export class LanguageError extends Data.TaggedError("LanguageError") {}

const decodeLanguage = Schema.decodeUnknownEffect(Language);

/** Rust keeps the language so the window and the tray menu always agree. */
export const loadLanguage = Effect.tryPromise(() => invoke("locale")).pipe(
  Effect.flatMap(decodeLanguage),
  Effect.orElseSucceed((): Language => ({ chosen: null, locale: "en-US" })),
);

export const saveLanguage = (chosen: Locale | null) =>
  Effect.tryPromise(() => invoke("set_language", { chosen })).pipe(
    Effect.flatMap(decodeLanguage),
    Effect.mapError(() => new LanguageError()),
  );
