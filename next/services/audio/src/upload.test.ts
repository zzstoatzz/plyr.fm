import { env } from "cloudflare:workers";
import { runInDurableObject, evictDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { ownerHash, MAX_UPLOAD_BYTES, verifyCapability } from "./upload-capability.ts";
import type { UploadClaim } from "./upload-capability.ts";
import { routeUpload } from "./upload-worker.ts";
import type { UploadEnv } from "./upload-worker.ts";
import { UploadSessions } from "./upload-session.ts";
import type { UploadSession } from "./upload-session.ts";

declare global { namespace Cloudflare { interface Env extends UploadEnv {} } }
const secret = "test-upload-capability-secret-000000000000";
const origin = "https://next.plyr.fm";
function claim(owner = `did:plc:${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`, sizeBytes = 10): UploadClaim {
  return { version: 1, owner, uploadId: crypto.randomUUID(), recordUri: `at://${owner}/fm.plyr.track/3mtest`, sizeBytes, contentType: "audio/mpeg", fileType: "mp3", visibility: "public", downloadPolicy: "open", expiresAt: Date.now() + 300000 };
}
async function token(value: UploadClaim) {
  const payload = btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `${payload}.${btoa(String.fromCharCode(...signature)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
}
async function setup(value = claim()) {
  const hash = await ownerHash(value.owner);
  const url = `https://audio.example/v1/uploads/${hash}/${value.uploadId}`;
  const media = `https://audio.example/media/${hash}/${value.uploadId}`;
  const bearer = await token(value);
  const stub = env.UPLOADS.get(env.UPLOADS.idFromName(hash));
  const send = async (method: string, suffix = "", body?: BodyInit) => {
    const response = await routeUpload(new Request(url + suffix, { method, body, headers: { authorization: `Bearer ${bearer}`, origin } }), env);
    if (!response) throw new Error("route not handled");
    return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers });
  };
  return { value, hash, url, media, stub, send };
}

async function session(state: DurableObjectState, id: string) {
  const value = await state.storage.get<UploadSession>(`session:${id}`);
  if (!value) throw new Error("missing session");
  return value;
}

test("capability verifies identity-bound size/policy and rejects tampering or expiry", async () => {
  const value = claim(undefined, MAX_UPLOAD_BYTES);
  expect(await verifyCapability(await token(value), secret)).toEqual(value);
  for (const patch of [{ sizeBytes: MAX_UPLOAD_BYTES + 1 }, { sizeBytes: 0 }, { visibility: "private" }, { downloadPolicy: "off" }, { expiresAt: Date.now() - 1 }]) {
    expect(await verifyCapability(await token({ ...value, ...patch }), secret)).toBeNull();
  }
  expect(await verifyCapability(`${await token(value)}x`, secret)).toBeNull();
});

for (const redirected of [false, true]) test(`activation uses real Worker fetch and rejects redirects=${redirected}`, async () => {
  const value = claim();
  value.recordUri = `at://${value.owner}/fm.plyr.track/network-${redirected ? "redirect" : "verified"}`;
  const f = await setup(value);
  expect((await f.send("POST")).status).toBe(200);
  expect((await f.send("PUT", "/parts/1", "0123456789")).status).toBe(200);
  expect((await f.send("POST", "/finish")).status).toBe(200);
  const activated = await f.send("POST", "/activate");
  expect(activated.status).toBe(redirected ? 503 : 200);
  if (redirected) {
    expect(await activated.json()).toEqual({ error: "record authority unavailable" });
    expect((await routeUpload(new Request(f.media), env))?.status).toBe(404);
  } else {
    expect(await activated.json()).toMatchObject({ state: "published", reservedBytes: 0 });
    expect((await routeUpload(new Request(f.media), env))?.status).toBe(200);
  }
});

test("published download attachment preserves bytes, HEAD, ranges and visibility", async () => {
  const value = claim();
  value.recordUri = `at://${value.owner}/fm.plyr.track/network-verified`;
  const f = await setup(value);
  await f.send("POST"); await f.send("PUT", "/parts/1", "0123456789"); await f.send("POST", "/finish");
  const download = `${f.media}?download=1&filename=untrusted.html`;
  for (const method of ["GET", "HEAD"]) expect((await routeUpload(new Request(download, { method }), env))?.status).toBe(404);
  expect((await f.send("POST", "/activate")).status).toBe(200);
  for (const method of ["GET", "HEAD"]) {
    const response = await routeUpload(new Request(download, { method }), env);
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-disposition")).toBe('attachment; filename="audio.mp3"');
    expect(response?.headers.get("content-type")).toBe("audio/mpeg");
    expect(response?.headers.get("content-length")).toBe("10");
    expect(response?.headers.get("cache-control")).toBe("public, max-age=300");
    expect(response?.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response?.text()).toBe(method === "GET" ? "0123456789" : "");
  }
  const range = await routeUpload(new Request(download, { headers: { range: "bytes=2-4" } }), env);
  expect(range?.status).toBe(206);
  expect(range?.headers.get("content-disposition")).toBe('attachment; filename="audio.mp3"');
  expect(range?.headers.get("content-range")).toBe("bytes 2-4/10");
  expect(range?.headers.get("content-length")).toBe("3");
  expect(await range?.text()).toBe("234");
  for (const suffix of ["", "?download=0", "?filename=audio.mp3"]) {
    const playback = await routeUpload(new Request(f.media + suffix), env);
    expect(playback?.status).toBe(200);
    expect(playback?.headers.get("content-disposition")).toBeNull();
    expect(playback?.headers.get("etag")).toBe(range?.headers.get("etag"));
    expect(await playback?.text()).toBe("0123456789");
  }
});

test("multipart persists digests across eviction and never exposes unpublished bytes", async () => {
  const f = await setup();
  expect((await f.send("POST")).status).toBe(200);
  expect((await f.send("PUT", "/parts/1", "0123456789")).status).toBe(200);
  await evictDurableObject(f.stub);
  const status = await (await f.send("GET")).json<{ receivedParts: { number: number; sha256: string }[] }>();
  expect(status.receivedParts).toHaveLength(1);
  expect(status.receivedParts[0].sha256).toHaveLength(64);
  expect((await f.send("PUT", "/parts/1", "9876543210")).status).toBe(409);
  expect((await f.send("PUT", "/parts/1", "0123456789")).status).toBe(200);
  expect((await f.send("POST", "/finish")).status).toBe(200);
  for (const method of ["GET", "HEAD"]) {
    expect((await routeUpload(new Request(f.media, { method, headers: { range: "bytes=0-1" } }), env))?.status).toBe(404);
  }
  await runInDurableObject(f.stub, async (_, state) => {
    const model = new UploadSessions(state.storage, env.AUDIO, async () => "published");
    await model.activate(await session(state, f.value.uploadId));
  });
  await evictDurableObject(f.stub);
  const read = await routeUpload(new Request(f.media, { headers: { range: "bytes=2-4" } }), env);
  expect(read?.status).toBe(206);
  expect(read?.headers.get("content-range")).toBe("bytes 2-4/10");
  expect(read?.headers.get("x-content-type-options")).toBe("nosniff");
  expect(await read?.text()).toBe("234");
  expect((await f.send("DELETE")).status).toBe(409);
});

test("lost completion response recovers by HEAD before expiry and activates without client callback", async () => {
  const f = await setup();
  await f.send("POST");
  await f.send("PUT", "/parts/1", "0123456789");
  await runInDurableObject(f.stub, async (_, state) => {
    const current = await session(state, f.value.uploadId);
    current.state = "completing";
    current.nextCheck = Date.now() - 1;
    current.createdAt = Date.now() - 90000000;
    await state.storage.put(`session:${f.value.uploadId}`, current);
    const etag = current.parts[1].etag;
    if (!current.multipartId || !etag) throw new Error("missing multipart receipt");
    await env.AUDIO.resumeMultipartUpload(current.key, current.multipartId).complete([{ partNumber: 1, etag }]);
  });
  await evictDurableObject(f.stub);
  await runInDurableObject(f.stub, async (_, state) => {
    const restarted = new UploadSessions(state.storage, env.AUDIO, async () => "published");
    await restarted.alarm();
    expect((await session(state, f.value.uploadId)).state).toBe("published");
    expect(await state.storage.get("active")).toEqual([]);
  });
  expect((await f.send("POST", "/finish")).status).toBe(200);
});

test("owner quota, changed reservations, oversize parts and missing parts are rejected", async () => {
  const first = await setup(claim(undefined, MAX_UPLOAD_BYTES));
  expect((await first.send("POST")).status).toBe(200);
  const second = await setup(claim(first.value.owner, MAX_UPLOAD_BYTES));
  expect((await second.send("POST")).status).toBe(200);
  expect((await (await setup(claim(first.value.owner))).send("POST")).status).toBe(429);
  expect((await first.send("POST", "/finish")).status).toBe(409);
  const f = await setup();
  await f.send("POST");
  expect((await f.send("PUT", "/parts/1", "01234567890")).status).toBe(400);
  expect((await f.send("PUT", "/parts/1", "short")).status).toBe(400);
  expect((await f.send("PUT", "/parts/2", "0123456789")).status).toBe(400);
  expect((await (await setup({ ...f.value, sizeBytes: 11 })).send("POST")).status).toBe(409);
  expect((await f.send("DELETE")).status).toBe(200);
});

test("authority outage stops bounded recovery without deleting completed bytes or freeing quota", async () => {
  const f = await setup();
  await f.send("POST"); await f.send("PUT", "/parts/1", "0123456789"); await f.send("POST", "/finish");
  await runInDurableObject(f.stub, async (_, state) => {
    const current = await session(state, f.value.uploadId);
    current.nextCheck = Date.now() - 1;
    current.checks = 19;
    await state.storage.put(`session:${f.value.uploadId}`, current);
    const restarted = new UploadSessions(state.storage, env.AUDIO, async () => { throw new Error("PDS offline"); });
    await restarted.alarm();
    const after = await session(state, f.value.uploadId);
    expect(after.state).toBe("complete"); expect(after.nextCheck).toBeNull();
    expect(restarted.view(after).recoveryRequired).toBe(true);
    expect(restarted.view(after).reservedBytes).toBe(f.value.sizeBytes);
    expect(await env.AUDIO.head(after.key)).not.toBeNull();
    expect(await state.storage.get("active")).toEqual([f.value.uploadId]);
    await expect(restarted.cancel(after)).rejects.toThrow("PDS offline");
    const absent = new UploadSessions(state.storage, env.AUDIO, async () => "absent");
    await expect(absent.cancel(after)).rejects.toThrow("publication recovery");
  });
});

test("digest intent without R2 receipt survives eviction without claiming received bytes", async () => {
  const f = await setup();
  await f.send("POST");
  const bytes = new TextEncoder().encode("0123456789");
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  await runInDurableObject(f.stub, async (_, state) => {
    const current = await session(state, f.value.uploadId);
    current.parts[1] = { sha256: digest };
    await state.storage.put(`session:${current.uploadId}`, current);
  });
  await evictDurableObject(f.stub);
  const status = await (await f.send("GET")).json<{ receivedParts: unknown[]; reservedDigests: { number: number; sha256: string }[] }>();
  expect(status.receivedParts).toEqual([]);
  expect(status.reservedDigests).toEqual([{ number: 1, sha256: digest }]);
  expect((await f.send("PUT", "/parts/1", "9876543210")).status).toBe(409);
  expect((await f.send("PUT", "/parts/1", "0123456789")).status).toBe(200);
  expect((await f.send("POST", "/finish")).status).toBe(200);
});

test("held multipart request does not block existing published playback for its owner", async () => {
  const published = await setup();
  await published.send("POST"); await published.send("PUT", "/parts/1", "0123456789"); await published.send("POST", "/finish");
  await runInDurableObject(published.stub, async (_, state) => {
    const model = new UploadSessions(state.storage, env.AUDIO, async () => "published");
    await model.activate(await session(state, published.value.uploadId));
  });
  const transferring = await setup(claim(published.value.owner));
  await transferring.send("POST");
  let finishBody: (() => void) | undefined;
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode("01234"));
    finishBody = () => { controller.enqueue(new TextEncoder().encode("56789")); controller.close(); };
  } });
  const pending = transferring.send("PUT", "/parts/1", body);
  try {
    let busy = false;
    for (let count = 0; count < 20 && !busy; count++) busy = (await transferring.send("GET")).status === 409;
    expect(busy).toBe(true);
    for (const method of ["GET", "HEAD"]) {
      const response = await routeUpload(new Request(published.media, { method, headers: { range: "bytes=0-1" } }), env);
      expect(response?.status).toBe(method === "HEAD" ? 200 : 206);
      await response?.arrayBuffer();
    }
  } finally { finishBody?.(); }
  expect((await pending).status).toBe(200);
});

test("cancellation resumes after R2 abort succeeds but its response is lost", async () => {
  const f = await setup(); await f.send("POST");
  await runInDurableObject(f.stub, async (_, state) => {
    const current = await session(state, f.value.uploadId);
    current.state = "cancelling";
    await state.storage.put(`session:${current.uploadId}`, current);
    if (!current.multipartId) throw new Error("missing upload ID");
    await env.AUDIO.resumeMultipartUpload(current.key, current.multipartId).abort();
  });
  await evictDurableObject(f.stub);
  expect((await f.send("DELETE")).status).toBe(200);
  expect((await f.send("DELETE")).status).toBe(200);
});

test("capabilities cannot cross owners and writes reject unapproved origins", async () => {
  const first = await setup(); await first.send("POST");
  const second = await setup();
  const unauthorized = await routeUpload(new Request(first.url, { method: "POST", headers: { authorization: `Bearer ${await token(second.value)}`, origin } }), env);
  expect(unauthorized?.status).toBe(403);
  const crossOrigin = await routeUpload(new Request(first.url, { method: "POST", headers: { authorization: `Bearer ${await token(first.value)}`, origin: "https://evil.example" } }), env);
  expect(crossOrigin?.status).toBe(403);
});

test("real R2 multipart accepts a full part and exact short final part", async () => {
  const size = 10485760;
  const f = await setup(claim(undefined, size + 3));
  await f.send("POST");
  expect((await f.send("PUT", "/parts/1", new Uint8Array(size))).status).toBe(200);
  expect((await f.send("POST", "/finish")).status).toBe(409);
  expect((await f.send("PUT", "/parts/2", "end")).status).toBe(200);
  expect((await f.send("POST", "/finish")).status).toBe(200);
  expect((await env.AUDIO.head(`uploads/${f.hash}/${f.value.uploadId}`))?.size).toBe(size + 3);
});

test("unknown-length streamed part is stopped at the declared bound", async () => {
  const f = await setup(); await f.send("POST");
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(11)); controller.close(); } });
  expect((await f.send("PUT", "/parts/1", body)).status).toBe(413);
  expect((await (await f.send("GET")).json<{ receivedParts: unknown[] }>()).receivedParts).toEqual([]);
});
