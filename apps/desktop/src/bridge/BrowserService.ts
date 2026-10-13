import { Context, Effect, Layer, Schema } from "effect";
import type { VaultError } from "../vault/VaultClient";
import { request } from "../vault/VaultClientLive";

export const PairingRequest = Schema.Struct({ name: Schema.String, code: Schema.String });

export type PairingRequest = typeof PairingRequest.Type;

export const PairedBrowser = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  pairedAt: Schema.Number,
});

export type PairedBrowser = typeof PairedBrowser.Type;

/** Browsers paired with Cairn through the extension. */
export class BrowserService extends Context.Service<
  BrowserService,
  {
    readonly pending: Effect.Effect<PairingRequest | null, VaultError>;
    readonly answer: (code: string, accept: boolean) => Effect.Effect<void, VaultError>;
    readonly list: Effect.Effect<ReadonlyArray<PairedBrowser>, VaultError>;
    readonly remove: (id: string) => Effect.Effect<void, VaultError>;
  }
>()("cairn/BrowserService") {}

export const BrowserServiceLive = Layer.succeed(
  BrowserService,
  BrowserService.of({
    pending: request("pairing_request", Schema.NullOr(PairingRequest)),
    answer: (code, accept) =>
      request("answer_pairing", Schema.Null, { code, accept }).pipe(Effect.asVoid),
    list: request("list_browsers", Schema.Array(PairedBrowser)),
    remove: (id) => request("remove_browser", Schema.Null, { id }).pipe(Effect.asVoid),
  }),
);
