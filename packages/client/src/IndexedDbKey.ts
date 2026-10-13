import { Effect, Layer, Option } from "effect";
import { CairnClientError } from "@cairn/contracts/errors";
import { BrowserKey, generateKeys, keyPair } from "./BrowserKey";

const DATABASE = "cairn";

const STORE = "keys";

const ENTRY = "browser";

const keyError = () => new CairnClientError({ code: "KeyUnavailable" });

function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transact<A>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<A>) {
  return Effect.acquireUseRelease(
    Effect.tryPromise({ try: open, catch: keyError }),
    (database) =>
      Effect.tryPromise({
        try: () =>
          new Promise<A>((resolve, reject) => {
            const transaction = database.transaction(STORE, mode);
            const request = run(transaction.objectStore(STORE));
            transaction.oncomplete = () => resolve(request.result);
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
          }),
        catch: keyError,
      }),
    (database) => Effect.sync(() => database.close()),
  );
}

const isKeyPair = (value: CryptoKeyPair | undefined): value is CryptoKeyPair =>
  value?.privateKey instanceof CryptoKey && value.publicKey instanceof CryptoKey;

/**
 * Keeps the pairing key in the extension's IndexedDB. IndexedDB stores the
 * CryptoKey objects themselves, and the private key was created
 * non-extractable, so no script can read its bytes back.
 */
export const IndexedDbKey = Layer.succeed(
  BrowserKey,
  BrowserKey.of({
    load: transact<CryptoKeyPair | undefined>("readonly", (store) => store.get(ENTRY)).pipe(
      Effect.flatMap((keys) =>
        isKeyPair(keys) ? Effect.map(keyPair(keys), Option.some) : Effect.succeed(Option.none()),
      ),
    ),
    create: Effect.gen(function* () {
      const keys = yield* generateKeys;
      yield* transact("readwrite", (store) => store.put(keys, ENTRY));

      return yield* keyPair(keys);
    }),
  }),
);
