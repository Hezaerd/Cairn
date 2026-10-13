import { invoke } from "@tauri-apps/api/core";
import { Effect, Schema } from "effect";
import { enUS, type Messages } from "./en-US";
import { frFR } from "./fr-FR";

export const Locale = Schema.Literals(["en-US", "fr-FR"]);

export type Locale = typeof Locale.Type;

export const messages: Record<Locale, Messages> = { "en-US": enUS, "fr-FR": frFR };

/** Rust reads the Windows language so the window and the tray menu always agree. */
export const detectLocale = Effect.tryPromise(() => invoke("locale")).pipe(
  Effect.flatMap(Schema.decodeUnknownEffect(Locale)),
  Effect.orElseSucceed((): Locale => "en-US"),
);
