import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Result } from "effect";
import { decodeRequest, decodeResponse, decodePopupRequest } from "@cairn/contracts";

const cases = JSON.parse(
  readFileSync(new URL("./fixtures/protocol/cases.json", import.meta.url), "utf8"),
);

test("popup boundary accepts only its three requests", () => {
  for (const message of [
    { type: "GetState", tabId: 7 },
    { type: "Pair" },
    { type: "Fill", tabId: 7, entryId: "0123456789abcdef0123456789abcdef" },
  ])
    assert.ok(Result.isSuccess(decodePopupRequest(message)));

  for (const message of [
    null,
    undefined,
    "GetState",
    [],
    {},
    { type: "GetStatus" },
    { type: "GetState" },
    { type: "GetState", tabId: 1.5 },
    { type: "Pair", publicKey: "no" },
    { type: "Fill", tabId: 7, entryId: "../vault" },
    { type: "Fill", tabId: 7, entryId: "0123456789abcdef0123456789abcdef", password: "x" },
  ]) {
    assert.ok(Result.isFailure(decodePopupRequest(message)));
  }
});

for (const fixture of cases) {
  test(`protocol: ${fixture.name}`, () => {
    const decode = fixture.kind === "request" ? decodeRequest : decodeResponse;

    if (fixture.valid) assert.deepEqual(decode(fixture.message), fixture.message);
    else assert.throws(() => decode(fixture.message));
  });
}
