import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Result } from "effect";
import { decodeRequest, decodeResponse, decodePopupRequest } from "@cairn/contracts";

const cases = JSON.parse(
  readFileSync(new URL("./fixtures/protocol/cases.json", import.meta.url), "utf8"),
);

test("popup boundary accepts only the status request", () => {
  assert.ok(Result.isSuccess(decodePopupRequest({ type: "GetStatus" })));

  for (const message of [
    null,
    undefined,
    "GetStatus",
    [],
    {},
    { type: "Other" },
    { type: "GetStatus", extra: true },
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
