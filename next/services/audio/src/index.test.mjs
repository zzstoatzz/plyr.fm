import assert from "node:assert/strict";
import { test } from "vitest";
import worker from "./index.js";

const url = "https://next.example/audio/bafkreifbec5sqkptigb5akdpouwbpw3loe44blnlsquk3spgt6ezeefyuq";
const data = "0123456789";

for (const [header, range, span, body] of [
  ["bytes=0-1", { offset: 0, length: 2, suffix: undefined }, "0-1", "01"],
  ["bytes=7-", { offset: 7, length: null, suffix: null }, "7-9", "789"],
  ["bytes=-2", { suffix: 2 }, "8-9", "89"],
]) {
  test(`reports the bytes returned for ${header}`, async () => {
    const request = new Request(url, { headers: { Range: header } });
    const response = await worker.fetch(request, {
      AUDIO: {
        async get(_key, options) {
          assert.equal(options.range.get("range"), header);
          return {
            size: data.length,
            httpEtag: '"fixture"',
            range,
            body,
            writeHttpMetadata() {},
          };
        },
      },
    });

    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), `bytes ${span}/${data.length}`);
    assert.equal(response.headers.get("content-length"), String(body.length));
    assert.equal(await response.text(), body);
  });
}
