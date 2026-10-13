import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { decodeRequest, decodeResponse } from "@cairn/contracts";

const cases = JSON.parse(readFileSync(new URL("./fixtures/protocol/cases.json", import.meta.url), "utf8"));
for (const fixture of cases) {
  test(`protocol: ${fixture.name}`, () => {
    const decode = fixture.kind === "request" ? decodeRequest : decodeResponse;
    if (fixture.valid) assert.deepEqual(decode(fixture.message), fixture.message);
    else assert.throws(() => decode(fixture.message));
  });
}
