import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Schema } from "effect";

const Messages = Schema.Record(
  Schema.String,
  Schema.Struct({
    message: Schema.String,
    placeholders: Schema.optionalKey(
      Schema.Record(Schema.String, Schema.Struct({ content: Schema.String })),
    ),
  }),
);

const read = (locale: string) =>
  Schema.decodeUnknownSync(Messages)(
    JSON.parse(
      readFileSync(
        new URL(`../apps/extension/public/_locales/${locale}/messages.json`, import.meta.url),
        "utf8",
      ),
    ),
  );

test("extension locales define the same messages and placeholders", () => {
  const english = read("en");
  const french = read("fr");

  assert.deepEqual(Object.keys(french).sort(), Object.keys(english).sort());

  for (const [key, { placeholders }] of Object.entries(english))
    assert.deepEqual(
      Object.keys(french[key]?.placeholders ?? {}),
      Object.keys(placeholders ?? {}),
      key,
    );
});
