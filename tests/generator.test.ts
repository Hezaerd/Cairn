import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Exit, Result } from "effect";
import {
  AMBIGUOUS,
  characterSets,
  generatePassword,
  Uniform,
} from "@cairn/client/PasswordGenerator";
import {
  decodePageRequest,
  decodePickerRequest,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  type PasswordOptions,
} from "@cairn/contracts";

// The same checks as the Rust generator's tests in crates/vault/src/generator.rs.

const defaults: PasswordOptions = {
  length: 20,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: false,
};

const generate = (options: PasswordOptions) => Effect.runSync(generatePassword(options));

test("generator: has the requested length", () => {
  for (const length of [MIN_PASSWORD_LENGTH, 20, 64, MAX_PASSWORD_LENGTH])
    assert.equal(generate({ ...defaults, length }).length, length);
});

test("generator: refuses lengths out of range and empty selections", () => {
  for (const options of [
    { ...defaults, length: 0 },
    { ...defaults, length: MIN_PASSWORD_LENGTH - 1 },
    { ...defaults, length: MAX_PASSWORD_LENGTH + 1 },
    { ...defaults, lowercase: false, uppercase: false, digits: false, symbols: false },
  ])
    assert.ok(Exit.isFailure(Effect.runSyncExit(generatePassword(options))));
});

test("generator: includes every enabled set and nothing else", () => {
  for (let bits = 1; bits < 16; bits++) {
    const options: PasswordOptions = {
      length: MIN_PASSWORD_LENGTH,
      lowercase: (bits & 1) !== 0,
      uppercase: (bits & 2) !== 0,
      digits: (bits & 4) !== 0,
      symbols: (bits & 8) !== 0,
      avoidAmbiguous: bits % 3 === 0,
    };

    const sets = characterSets(options);
    const alphabet = sets.join("");

    for (let round = 0; round < 200; round++) {
      const password = [...generate(options)];

      assert.ok(
        password.every((char) => alphabet.includes(char)),
        JSON.stringify(options),
      );

      for (const set of sets)
        assert.ok(
          password.some((char) => set.includes(char)),
          JSON.stringify(options),
        );
    }
  }
});

test("generator: matches the desktop's character sets", () => {
  assert.equal(
    characterSets(defaults).join(""),
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_{|}~",
  );
});

test("generator: avoids ambiguous characters", () => {
  const options = { ...defaults, length: MAX_PASSWORD_LENGTH, avoidAmbiguous: true };

  for (let round = 0; round < 100; round++)
    assert.ok(![...generate(options)].some((char) => AMBIGUOUS.includes(char)));
});

test("generator: spreads characters evenly", () => {
  // 26 lowercase letters over about 260,000 characters: each expects 10,000
  // hits with a standard deviation near 100, so 10% either way only fails on
  // a real bias.
  const options = {
    ...defaults,
    length: MAX_PASSWORD_LENGTH,
    uppercase: false,
    digits: false,
    symbols: false,
  };

  const counts = Array.from({ length: 26 }, () => 0);

  for (let round = 0; round < 2_032; round++)
    for (const char of generate(options)) counts[char.charCodeAt(0) - 97]!++;

  const expected = counts.reduce((sum, count) => sum + count, 0) / counts.length;

  for (const count of counts) assert.ok(Math.abs(count - expected) < expected / 10);
});

test("generator: index sampling is unbiased for awkward bounds", () => {
  // 256 % 94 leaves 68 values that a plain modulo would hand to the first 68 indexes.
  const random = new Uniform();
  const bound = 94;
  const counts = Array.from({ length: bound }, () => 0);

  for (let round = 0; round < 188_000; round++) counts[random.below(bound)]!++;

  const average = (part: ReadonlyArray<number>) =>
    part.reduce((sum, count) => sum + count, 0) / part.length;

  assert.ok(Math.abs(average(counts.slice(0, 68)) - average(counts.slice(68))) < 100);
});

test("picker boundary accepts generator requests with valid options only", () => {
  assert.ok(
    Result.isSuccess(decodePickerRequest({ type: "Generate", options: defaults, fresh: true })),
  );
  assert.ok(Result.isSuccess(decodePickerRequest({ type: "UseGenerated" })));

  for (const message of [
    { type: "Generate", options: defaults },
    { type: "Generate", options: { ...defaults, length: 7 }, fresh: true },
    { type: "Generate", options: { ...defaults, length: 129 }, fresh: true },
    { type: "Generate", options: { ...defaults, extra: true }, fresh: true },
    { type: "UseGenerated", password: "chosen-by-the-frame" },
  ])
    assert.ok(Result.isFailure(decodePickerRequest(message)));
});

test("page boundary accepts a sign-up picker with a valid length only", () => {
  assert.ok(Result.isSuccess(decodePageRequest({ type: "OpenPicker" })));
  assert.ok(
    Result.isSuccess(decodePageRequest({ type: "OpenPicker", newPassword: { maxLength: 64 } })),
  );

  for (const newPassword of [{ maxLength: 4 }, { maxLength: 512 }, {}, { maxLength: 20, x: 1 }])
    assert.ok(Result.isFailure(decodePageRequest({ type: "OpenPicker", newPassword })));
});
