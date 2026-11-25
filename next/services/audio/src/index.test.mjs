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
            customMetadata: { sniffed: "unknown" },
            writeHttpMetadata(headers) { headers.set("content-type", "audio/x-flac"); },
          };
        },
      },
    });

    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-type"), "audio/flac");
    assert.equal(response.headers.get("content-range"), `bytes ${span}/${data.length}`);
    assert.equal(response.headers.get("content-length"), String(body.length));
    assert.equal(await response.text(), body);
  });
}

test("reports the standard FLAC content type on HEAD requests", async () => {
  const response = await worker.fetch(new Request(url, { method: "HEAD" }), {
    AUDIO: {
      async head() {
        return {
          size: data.length,
          httpEtag: '"fixture"',
          customMetadata: { sniffed: "unknown" },
          writeHttpMetadata(headers) { headers.set("content-type", "audio/x-flac"); },
        };
      },
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/flac");
  assert.equal(response.headers.get("content-length"), String(data.length));
  assert.equal(await response.text(), "");
});

const capabilitySecret = "test-upload-capability-secret-000000000000";
const digest = "a120bb2829f34183d0286f752c17db6b7139c0adab9428adc9e69f899210b8a4";

async function capability(overrides = {}) {
  const owner = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
  const claim = { version: 1, owner, uploadId: "12345678-1234-4123-8123-123456789abc", recordUri: `at://${owner}/fm.plyr.track/3mtest`, sizeBytes: data.length, contentType: "audio/mpeg", fileType: "mp3", visibility: "public", downloadPolicy: "open", expiresAt: Date.now() + 300000, ...overrides };
  const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const payload = encode(new TextEncoder().encode(JSON.stringify(claim)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(capabilitySecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${payload}.${encode(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))))}`;
}

function put(bearer, { length = data.length, type = "audio/mpeg" } = {}) {
  const headers = { "content-type": type, "content-length": String(length), "x-content-sha256": digest };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return new Request(url, { method: "PUT", body: data, headers });
}

function bucket() {
  const writes = [];
  return { writes, async head() { return null; }, async put(key, _body, options) { writes.push({ key, options }); } };
}

test("the uploading client stores audio with its upload capability", async () => {
  const AUDIO = bucket();
  const response = await worker.fetch(put(await capability()), { AUDIO, UPLOAD_CAPABILITY_SECRET: capabilitySecret });
  assert.equal(response.status, 201);
  assert.deepEqual(AUDIO.writes.map(write => [write.key, write.options.sha256]), [[`audio/${url.split("/audio/")[1]}`, digest]]);
});

test("a capability for a different size or type cannot store audio", async () => {
  for (const request of [put(await capability({ sizeBytes: 11 })), put(await capability(), { type: "audio/wav" })]) {
    const AUDIO = bucket();
    assert.equal((await worker.fetch(request, { AUDIO, UPLOAD_CAPABILITY_SECRET: capabilitySecret })).status, 403);
    assert.equal(AUDIO.writes.length, 0);
  }
});

test("writes without the mirror token or an unprocessed upload capability are refused", async () => {
  const processing = await capability({ processing: { recipe: "mp3-320k-44100-v1", outputBudget: 100 } });
  for (const bearer of [null, "not-a-capability", processing]) {
    const AUDIO = bucket();
    assert.equal((await worker.fetch(put(bearer), { AUDIO, UPLOAD_CAPABILITY_SECRET: capabilitySecret })).status, 401);
    assert.equal(AUDIO.writes.length, 0);
  }
});

test("the backend mirror still stores audio with its token", async () => {
  const AUDIO = bucket();
  const token = "mirror-upload-token-0000000000000000000000";
  assert.equal((await worker.fetch(put(token), { AUDIO, UPLOAD_TOKEN: token })).status, 201);
  assert.equal(AUDIO.writes.length, 1);
});

test("preflight allows the client's audio PUT", async () => {
  const response = await worker.fetch(new Request(url, { method: "OPTIONS" }), {});
  assert.match(response.headers.get("access-control-allow-methods"), /PUT/);
  assert.match(response.headers.get("access-control-allow-headers"), /authorization/);
});

// a WAV someone named .m4a: the picker called it audio/mp4, the bytes say RIFF/WAVE
const wav = new Uint8Array([..."RIFF"].map(c => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WAVEfmt "].map(c => c.charCodeAt(0))));

test("audio is stored as what its bytes are, not what the upload claimed", async () => {
  const AUDIO = bucket();
  const request = new Request(url, { method: "PUT", body: wav, headers: { "content-type": "audio/mp4", "content-length": String(wav.length), "x-content-sha256": digest, authorization: `Bearer ${await capability({ sizeBytes: wav.length, contentType: "audio/mp4", fileType: "m4a" })}` } });
  assert.equal((await worker.fetch(request, { AUDIO, UPLOAD_CAPABILITY_SECRET: capabilitySecret })).status, 201);
  assert.equal(AUDIO.writes[0].options.httpMetadata.contentType, "audio/wav");
  assert.deepEqual(AUDIO.writes[0].options.customMetadata, { sniffed: "audio/wav" });
});

test("bytes that name no container keep the claimed type", async () => {
  const AUDIO = bucket();
  assert.equal((await worker.fetch(put(await capability()), { AUDIO, UPLOAD_CAPABILITY_SECRET: capabilitySecret })).status, 201);
  assert.equal(AUDIO.writes[0].options.httpMetadata.contentType, "audio/mpeg");
  assert.deepEqual(AUDIO.writes[0].options.customMetadata, { sniffed: "unknown" });
});

test("audio stored before sniffing is served as what it is and rewritten once", async () => {
  const pending = [];
  const writes = [];
  const legacy = (body) => ({
    size: wav.length, etag: "fixture", httpEtag: '"fixture"', httpMetadata: { contentType: "audio/mp4" }, customMetadata: {},
    body, arrayBuffer: async () => wav.slice(0, 12).buffer,
    writeHttpMetadata(headers) { headers.set("content-type", "audio/mp4"); },
  });
  const AUDIO = {
    async get(_key, options) { return legacy(options?.range instanceof Headers || !options ? new Response(wav).body : undefined); },
    async head() { return legacy(); },
    async put(key, body, options) { writes.push({ key, bytes: new Uint8Array(await new Response(body).arrayBuffer()), options }); },
  };
  for (const method of ["GET", "HEAD"]) {
    const response = await worker.fetch(new Request(url, { method }), { AUDIO }, { waitUntil: work => pending.push(work) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "audio/wav");
  }
  await Promise.all(pending);
  assert.ok(writes.length >= 1);
  assert.deepEqual([...writes[0].bytes], [...wav]);
  assert.equal(writes[0].options.httpMetadata.contentType, "audio/wav");
  assert.deepEqual(writes[0].options.customMetadata, { sniffed: "audio/wav" });
  assert.deepEqual(writes[0].options.onlyIf, { etagMatches: "fixture" });
});
