import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Result } from "effect";
import { decodeRequest, decodeResponse, decodePopupRequest, replyTypes } from "@cairn/contracts";

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

    // A reply must also have a type its request accepts.
    const answers = () => {
      const decoded = decode(fixture.message);
      const request = fixture.request ? decodeRequest(fixture.request) : undefined;

      if (request && decoded.type !== "Error" && decoded.type !== replyTypes[request.type])
        throw new Error(`${decoded.type} doesn't answer ${request.type}`);

      return decoded;
    };

    if (fixture.valid) assert.deepEqual(answers(), fixture.message);
    else assert.throws(answers);
  });
}
