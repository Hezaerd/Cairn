import { Effect } from "effect";
import type { PasswordOptions } from "@cairn/contracts";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@cairn/contracts";
import { CairnClientError } from "@cairn/contracts/errors";

// The extension's copy of the desktop generator in `crates/vault/src/generator.rs`.
// Keep the sets and the method the same in both.

const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";

const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const DIGITS = "0123456789";

const SYMBOLS = "!#$%&()*+,-./:;<=>?@[]^_{|}~";

/** Characters that are easy to confuse with another one when read or typed by hand. */
export const AMBIGUOUS = "Il1O0o|";

/** The enabled character sets, without ambiguous characters if asked to. */
export const characterSets = (options: PasswordOptions): ReadonlyArray<string> =>
  (
    [
      [options.lowercase, LOWERCASE],
      [options.uppercase, UPPERCASE],
      [options.digits, DIGITS],
      [options.symbols, SYMBOLS],
    ] as const
  ).flatMap(([enabled, set]) =>
    !enabled
      ? []
      : [
          options.avoidAmbiguous
            ? [...set].filter((char) => !AMBIGUOUS.includes(char)).join("")
            : set,
        ],
  );

/** Unbiased indexes from buffered WebCrypto randomness. */
export class Uniform {
  readonly #buffer = new Uint8Array(32);
  #used = 32;

  #byte() {
    if (this.#used === this.#buffer.length) {
      crypto.getRandomValues(this.#buffer);
      this.#used = 0;
    }

    return this.#buffer[this.#used++]!;
  }

  /**
   * A uniform index below `bound`, which is at most 256. Rejection sampling
   * drops the bytes past the largest multiple of `bound`, so no index is
   * likelier than another.
   */
  below(bound: number) {
    const limit = 256 - (256 % bound);

    for (;;) {
      const byte = this.#byte();

      if (byte < limit) return byte % bound;
    }
  }
}

/** Generates a password with at least one character from every enabled set. */
export const generatePassword = (options: PasswordOptions) =>
  Effect.gen(function* () {
    const sets = characterSets(options);

    if (
      sets.length === 0 ||
      options.length < MIN_PASSWORD_LENGTH ||
      options.length > MAX_PASSWORD_LENGTH
    )
      return yield* new CairnClientError({ code: "InvalidRequest" });

    const alphabet = sets.join("");
    const random = new Uniform();
    // One character from each set, then the rest from all of them, then a
    // shuffle so the required characters don't sit at the start.
    const password = sets.map((set) => set[random.below(set.length)]!);

    while (password.length < options.length)
      password.push(alphabet[random.below(alphabet.length)]!);

    for (let index = password.length - 1; index > 0; index--) {
      const other = random.below(index + 1);
      [password[index], password[other]] = [password[other]!, password[index]!];
    }

    return password.join("");
  });
