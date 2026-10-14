import { Context, Effect, Layer, Option } from "effect";
import {
  PROTOCOL_VERSION,
  signedMessage,
  type LoginCheck,
  type LoginSummary,
  type Request,
  type Response,
  type StatusResponse,
} from "@cairn/contracts";
import { CairnClientError } from "@cairn/contracts/errors";
import { BrowserKey, pairingCode, passwordProof, type KeyPair } from "./BrowserKey";
import { NativeTransport } from "./NativeTransport";

export interface Credential {
  readonly username: string;
  readonly password: string;
}

export class CairnClient extends Context.Service<
  CairnClient,
  {
    readonly getStatus: Effect.Effect<StatusResponse, CairnClientError>;
    /** Whether this browser has a key. Having one doesn't mean Cairn approved it. */
    readonly hasKey: Effect.Effect<boolean, CairnClientError>;
    /**
     * Asks Cairn to pair this browser and returns the code to approve there.
     * The code holds a nonce from Cairn, so each request has its own.
     */
    readonly pair: (name: string) => Effect.Effect<string, CairnClientError>;
    readonly listLogins: (
      origin: string,
    ) => Effect.Effect<ReadonlyArray<LoginSummary>, CairnClientError>;
    readonly getLogin: (
      origin: string,
      entryId: string,
    ) => Effect.Effect<Credential, CairnClientError>;
    /** Whether Cairn holds a login typed into a page. The password doesn't leave the browser. */
    readonly checkLogin: (
      origin: string,
      login: Credential,
    ) => Effect.Effect<LoginCheck, CairnClientError>;
    readonly saveLogin: (
      origin: string,
      name: string,
      login: Credential,
    ) => Effect.Effect<void, CairnClientError>;
    readonly updateLogin: (
      origin: string,
      entryId: string,
      password: string,
    ) => Effect.Effect<void, CairnClientError>;
  }
>()("cairn/CairnClient") {}

type Reply<T extends Response["type"]> = Extract<Response, { type: T }>;

export const CairnClientLive = Layer.effect(
  CairnClient,
  Effect.gen(function* () {
    const transport = yield* NativeTransport;
    const keys = yield* BrowserKey;

    const send = <T extends Response["type"]>(request: Request, type: T) =>
      transport.request(request).pipe(
        Effect.flatMap((response) => {
          if (response.type === "Error")
            return Effect.fail(new CairnClientError({ code: response.code }));

          const matches = (value: Response): value is Reply<T> => value.type === type;

          return matches(response)
            ? Effect.succeed(response)
            : Effect.fail(new CairnClientError({ code: "InvalidResponse" }));
        }),
      );

    const header = () => ({ version: PROTOCOL_VERSION, requestId: crypto.randomUUID() });

    const requireKey = keys.load.pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new CairnClientError({ code: "NotPaired" })),
          onSome: (key) => Effect.succeed(key),
        }),
      ),
    );

    // Each authenticated request signs a fresh single-use challenge.
    const auth = (key: KeyPair) =>
      send({ ...header(), type: "GetChallenge" }, "Challenge").pipe(
        Effect.map(({ challenge }) => ({ clientId: key.clientId, challenge })),
      );

    return CairnClient.of({
      getStatus: send({ ...header(), type: "GetStatus" }, "Status"),
      hasKey: keys.load.pipe(Effect.map(Option.isSome)),
      pair: (name) =>
        Effect.gen(function* () {
          const key = Option.getOrUndefined(yield* keys.load) ?? (yield* keys.create);

          const { nonce } = yield* send(
            { ...header(), type: "Pair", publicKey: key.publicKey, name },
            "PairingRequested",
          );

          return yield* pairingCode(key.publicKey, nonce);
        }),
      listLogins: (origin) =>
        Effect.gen(function* () {
          const key = yield* requireKey;

          const unsigned = {
            ...header(),
            type: "ListLogins" as const,
            origin,
            ...(yield* auth(key)),
          };

          const signature = yield* key.sign(signedMessage(unsigned));
          const reply = yield* send({ ...unsigned, signature }, "Logins");

          return reply.logins;
        }),
      getLogin: (origin, entryId) =>
        Effect.gen(function* () {
          const key = yield* requireKey;

          const unsigned = {
            ...header(),
            type: "GetLogin" as const,
            origin,
            entryId,
            ...(yield* auth(key)),
          };

          const signature = yield* key.sign(signedMessage(unsigned));
          const reply = yield* send({ ...unsigned, signature }, "Login");

          return { username: reply.username, password: reply.password };
        }),
      checkLogin: (origin, login) =>
        Effect.gen(function* () {
          const key = yield* requireKey;
          const challenge = yield* auth(key);

          const unsigned = {
            ...header(),
            type: "CheckLogin" as const,
            origin,
            username: login.username,
            proof: yield* passwordProof(challenge.challenge, login.password),
            ...challenge,
          };

          const signature = yield* key.sign(signedMessage(unsigned));

          return yield* send({ ...unsigned, signature }, "LoginCheck");
        }),
      saveLogin: (origin, name, login) =>
        Effect.gen(function* () {
          const key = yield* requireKey;

          const unsigned = {
            ...header(),
            type: "SaveLogin" as const,
            origin,
            name,
            username: login.username,
            password: login.password,
            ...(yield* auth(key)),
          };

          const signature = yield* key.sign(signedMessage(unsigned));
          yield* send({ ...unsigned, signature }, "Saved");
        }),
      updateLogin: (origin, entryId, password) =>
        Effect.gen(function* () {
          const key = yield* requireKey;

          const unsigned = {
            ...header(),
            type: "UpdateLogin" as const,
            origin,
            entryId,
            password,
            ...(yield* auth(key)),
          };

          const signature = yield* key.sign(signedMessage(unsigned));
          yield* send({ ...unsigned, signature }, "Saved");
        }),
    });
  }),
);
