import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { MAX_UPLOAD_BYTES, ownerHash, validClaim } from "./upload-capability.ts";
import type { UploadClaim } from "./upload-capability.ts";
import { OwnerUploads, routeUpload } from "./upload-worker.ts";
import { ProcessingJobs } from "./processing-jobs.ts";
import type { ProcessingJob } from "./processing-jobs.ts";
import { signProcessing, verifyProcessing } from "./processing-capability.ts";
import type { ProcessingClaim } from "./processing-capability.ts";
import type { UploadSession } from "./upload-session.ts";

const secret = "test-upload-capability-secret-000000000000";
const source = "original!!";
const output = "rendition";
const encoder = new TextEncoder();
async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
}
async function token(value: UploadClaim) {
  const payload = btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return `${payload}.${btoa(String.fromCharCode(...signature)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
}
async function setup(owner = `did:plc:${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`, sizeBytes = source.length, outputBudget = 20) {
  const value: UploadClaim = { version: 1, owner, uploadId: crypto.randomUUID(), recordUri: `at://${owner}/fm.plyr.track/network-verified`,
    sizeBytes, contentType: "audio/aiff", fileType: "aiff", visibility: "public", downloadPolicy: "open", expiresAt: Date.now() + 300000,
    processing: { recipe: "mp3-320k-44100-v1", outputBudget } };
  const hash = await ownerHash(owner);
  const url = `https://audio.example/v1/uploads/${hash}/${value.uploadId}`;
  const media = `https://audio.example/media/${hash}/${value.uploadId}`;
  const bearer = await token(value);
  const stub = env.UPLOADS.get(env.UPLOADS.idFromName(hash));
  const send = async (method: string, suffix = "", body?: BodyInit) => {
    const response = await routeUpload(new Request(url + suffix, { method, body, headers: { authorization: `Bearer ${bearer}`, origin: "https://next.plyr.fm" } }), env);
    if (!response) throw new Error("missing route");
    const bytes = await response.arrayBuffer();
    return new Response(response.status === 204 ? null : bytes, { status: response.status, headers: response.headers });
  };
  const state = () => runInDurableObject(stub, async (_, context) => {
    const job = await context.storage.get<ProcessingJob>(`processing:${value.uploadId}`);
    const session = await context.storage.get<UploadSession>(`session:${value.uploadId}`);
    if (!job || !session) throw new Error("missing processing state");
    return { job, session };
  });
  const callback = async (claim: ProcessingClaim, action: string, method: string, body?: BodyInit, extra?: Record<string, string>) => {
    const response = await routeUpload(new Request(`https://audio.example/v1/processing/${value.uploadId}/${claim.generation}/${action}`, {
      method, body, headers: { authorization: `Bearer ${await signProcessing(claim, secret)}`, ...extra },
    }), env);
    if (!response) throw new Error("missing callback route");
    const bytes = await response.arrayBuffer();
    return new Response(response.status === 204 ? null : bytes, { status: response.status, headers: response.headers });
  };
  const finishSource = async () => {
    expect((await send("POST")).status).toBe(200);
    expect((await send("PUT", "/parts/1", source)).status).toBe(200);
    const response = await send("POST", "/finish");
    expect(response.status, await response.text()).toBe(200);
    return (await state()).job.claim;
  };
  return { value, hash, media, stub, send, state, callback, finishSource };
}

test("processing admission retains full source size and reserves source plus output", async () => {
  const f = await setup(undefined, MAX_UPLOAD_BYTES, MAX_UPLOAD_BYTES);
  expect(validClaim(f.value)).toBe(true);
  expect(validClaim({ ...f.value, processing: { recipe: "mp3-320k-44100-v1", outputBudget: MAX_UPLOAD_BYTES + 1 } })).toBe(false);
  expect(validClaim({ ...f.value, fileType: "opus", contentType: "audio/opus" })).toBe(true);
  expect(validClaim({ ...f.value, fileType: "opus", contentType: "audio/opus", processing: undefined })).toBe(false);
  expect(validClaim({ ...f.value, processing: null })).toBe(false);
  expect(await (await f.send("POST")).json()).toMatchObject({ reservedBytes: MAX_UPLOAD_BYTES * 2 });
  expect((await (await setup(f.value.owner)).send("POST")).status).toBe(429);
  expect((await f.send("DELETE")).status).toBe(200);
});

test("unconfigured processing fails before reserving source bytes", async () => {
  const f = await setup();
  await runInDurableObject(f.stub, async (_, context) => {
    const disabled = new OwnerUploads(context, { ...env, PROCESSING_TRANSCODER_KEY: undefined });
    const request = new Request(`https://audio.example/v1/uploads/${f.hash}/${f.value.uploadId}`, { method: "POST", headers: { authorization: `Bearer ${await token(f.value)}` } });
    const response = await disabled.fetch(request);
    expect(response.status).toBe(503); await response.arrayBuffer();
    expect(await context.storage.get(`session:${f.value.uploadId}`)).toBeUndefined();
  });
});

test("real callback routes keep source and rendition private until canonical publication", async () => {
  const f = await setup();
  const claim = await f.finishSource();
  expect(await (await f.send("GET")).json()).toMatchObject({ state: "processing", reservedBytes: 30, processingGeneration: 1 });
  for (const path of [f.media, `${f.media}/original`, `${f.media}/manifest`]) expect((await routeUpload(new Request(path), env))?.status).toBe(404);
  expect((await f.send("POST", "/activate")).status).toBe(409);
  expect(await (await f.callback(claim, "source", "GET")).text()).toBe(source);
  expect((await f.callback(claim, "heartbeat", "POST")).status).toBe(204);
  const sha256 = await digest(output);
  expect((await f.callback(claim, "parts/1", "PUT", output, { "X-Part-SHA256": sha256 })).status).toBe(204);
  expect((await f.callback(claim, "complete", "POST", JSON.stringify({ sizeBytes: output.length, duration: 1, contentType: "audio/mpeg", parts: [{ number: 1, sha256 }] }))).status).toBe(204);
  await evictDurableObject(f.stub);
  expect(await (await f.send("POST", "/finish")).json()).toMatchObject({ state: "complete", rendition: { duration: 1, sizeBytes: output.length, contentType: "audio/mpeg" } });
  expect((await f.callback(claim, "heartbeat", "POST")).status).toBe(409);
  expect((await f.callback(claim, "failed", "POST", JSON.stringify({ reason: "output_budget_exceeded" }))).status).toBe(409);
  expect((await f.send("POST", "/activate")).status).toBe(200);
  expect(await (await routeUpload(new Request(f.media), env))?.text()).toBe(output);
  const original = await routeUpload(new Request(`${f.media}/original`, { headers: { range: "bytes=1-3" } }), env);
  expect(original?.status).toBe(206); expect(original?.headers.get("content-disposition")).toBe('attachment; filename="original.aiff"');
  expect(await original?.text()).toBe(source.slice(1, 4));
  expect(await (await routeUpload(new Request(`${f.media}/manifest`), env))?.json()).toMatchObject({ processed: true, original: { sizeBytes: source.length }, playback: { sizeBytes: output.length, contentType: "audio/mpeg" } });
});

test("expired generation fences callbacks and retries retain original and record identity", async () => {
  const f = await setup(); const claim = await f.finishSource();
  await runInDurableObject(f.stub, async (_, context) => {
    const job = await context.storage.get<ProcessingJob>(`processing:${f.value.uploadId}`);
    if (!job) throw new Error("missing job");
    job.leaseUntil = Date.now() - 1; await context.storage.put(`processing:${f.value.uploadId}`, job);
  });
  expect((await f.send("POST", "/finish")).status).toBe(200);
  const next = await f.state(); expect(next.job.claim.generation).toBe(2); expect(next.session.recordUri).toBe(f.value.recordUri);
  expect(await (await f.send("GET")).json()).toMatchObject({ processingGeneration: 2 });
  expect((await f.callback(claim, "heartbeat", "POST")).status).toBe(409);
  expect((await f.callback(claim, "parts/1", "PUT", output, { "X-Part-SHA256": await digest(output) })).status).toBe(409);
  expect(await (await f.callback(next.job.claim, "source", "GET")).text()).toBe(source);
  expect((await f.send("DELETE")).status).toBe(409);
});

test("callback capabilities are separate from public upload grants and bind generation", async () => {
  const f = await setup(); const claim = await f.finishSource();
  expect(await verifyProcessing(await token(f.value), secret)).toBeNull();
  expect(await verifyProcessing(await signProcessing({ ...claim, expiresAt: Date.now() - 1 }, secret), secret)).toBeNull();
  const other = await setup();
  expect((await other.callback(claim, "heartbeat", "POST")).status).toBe(403);
});

test("processing completion rejects invalid duration, budget and unacknowledged parts", async () => {
  const f = await setup(); const claim = await f.finishSource(); const sha256 = await digest(output);
  const completion = { sizeBytes: output.length, duration: 1, contentType: "audio/mpeg", parts: [{ number: 1, sha256 }] };
  expect((await f.callback(claim, "complete", "POST", JSON.stringify(completion))).status).toBe(409);
  expect((await f.callback(claim, "parts/1", "PUT", output, { "X-Part-SHA256": "0".repeat(64) })).status).toBe(400);
  expect((await f.callback(claim, "parts/1", "PUT", output, { "X-Part-SHA256": sha256 })).status).toBe(204);
  for (const duration of [-1, 0.5, null, 4294967296]) expect((await f.callback(claim, "complete", "POST", JSON.stringify({ ...completion, duration }))).status).toBe(400);
  expect((await f.callback(claim, "complete", "POST", JSON.stringify({ ...completion, sizeBytes: 21 }))).status).toBe(400);
  expect((await f.state()).job.phase).toBe("running");
  expect((await routeUpload(new Request(f.media), env))?.status).toBe(404);
});

test("lost R2 completion acknowledgement recovers persisted rendition without re-encoding", async () => {
  const f = await setup(); const claim = await f.finishSource();
  const sha256 = await digest(output);
  expect((await f.callback(claim, "parts/1", "PUT", output, { "X-Part-SHA256": sha256 })).status).toBe(204);
  await runInDurableObject(f.stub, async (_, context) => {
    const job = await context.storage.get<ProcessingJob>(`processing:${f.value.uploadId}`);
    if (!job?.multipartId || !job.parts[1].etag) throw new Error("missing multipart receipt");
    job.phase = "completing"; job.outputSize = output.length; job.duration = 1;
    await context.storage.put(`processing:${f.value.uploadId}`, job);
    await env.AUDIO.resumeMultipartUpload(job.key, job.multipartId).complete([{ partNumber: 1, etag: job.parts[1].etag }]);
  });
  await evictDurableObject(f.stub);
  expect(await (await f.send("POST", "/finish")).json()).toMatchObject({ state: "complete" });
  const recovered = await f.state();
  expect(recovered.job.claim.generation).toBe(1); expect(recovered.job.phase).toBe("ready");
  expect(recovered.session.recordUri).toBe(f.value.recordUri);
});

test("held old part cannot commit after lease fencing and does not block recovery", async () => {
  const f = await setup(); const claim = await f.finishSource();
  const sha256 = await digest(output);
  await runInDurableObject(f.stub, async (_, context) => {
    const session = await context.storage.get<UploadSession>(`session:${f.value.uploadId}`);
    if (!session) throw new Error("missing session");
    const jobs = new ProcessingJobs(context.storage, env.AUDIO, { secret, url: "https://executor.invalid", auth: "fixture" }, Date.now, async () => new Response(null, { status: 202 }));
    let started = () => {}; let release = () => {};
    const reading = new Promise<void>(resolve => { started = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const body = new ReadableStream<Uint8Array>({ async pull(controller) { started(); await held; controller.enqueue(encoder.encode(output)); controller.close(); } }, { highWaterMark: 0 });
    const pending = jobs.part(claim, session, 1, new Request("https://fixture.invalid/part", { method: "PUT", body,
      headers: { "content-length": String(output.length), "X-Part-SHA256": sha256 } }));
    try {
      await reading;
      const job = await jobs.load(session.uploadId);
      if (!job) throw new Error("missing job");
      job.leaseUntil = Date.now() - 1; await context.storage.put(`processing:${session.uploadId}`, job);
      await jobs.advance(session);
    } finally { release(); }
    await expect(pending).rejects.toThrow("lease is no longer active");
    expect((await jobs.load(session.uploadId))?.claim.generation).toBe(2);
    expect((await jobs.load(session.uploadId))?.parts).toEqual({});
    expect(await env.AUDIO.head(session.key)).not.toBeNull();
  });
});

test("unacknowledged rendition digest survives eviction and rejects different retry bytes", async () => {
  const f = await setup(); const claim = await f.finishSource(); const sha256 = await digest(output);
  await runInDurableObject(f.stub, async (_, context) => {
    const job = await context.storage.get<ProcessingJob>(`processing:${f.value.uploadId}`);
    if (!job?.multipartId) throw new Error("missing job");
    job.parts[1] = { size: output.length, sha256 }; await context.storage.put(`processing:${f.value.uploadId}`, job);
    await env.AUDIO.resumeMultipartUpload(job.key, job.multipartId).uploadPart(1, encoder.encode(output));
  });
  await evictDurableObject(f.stub);
  expect((await f.callback(claim, "parts/1", "PUT", "different", { "X-Part-SHA256": await digest("different") })).status).toBe(409);
  expect((await f.callback(claim, "parts/1", "PUT", output, { "X-Part-SHA256": sha256 })).status).toBe(204);
  expect((await f.state()).job.parts[1].etag).toBeTruthy();
});

test("lost abort reply keeps reservation until documented absence permits recovery", async () => {
  const f = await setup(); await f.finishSource();
  await runInDurableObject(f.stub, async (_, context) => {
    const session = await context.storage.get<UploadSession>(`session:${f.value.uploadId}`);
    const job = await context.storage.get<ProcessingJob>(`processing:${f.value.uploadId}`);
    if (!session || !job) throw new Error("missing processing state");
    job.leaseUntil = Date.now() - 1; await context.storage.put(`processing:${session.uploadId}`, job);
    let aborts = 0;
    const bucket = {
      get: env.AUDIO.get.bind(env.AUDIO), head: env.AUDIO.head.bind(env.AUDIO), delete: env.AUDIO.delete.bind(env.AUDIO),
      createMultipartUpload: env.AUDIO.createMultipartUpload.bind(env.AUDIO),
      resumeMultipartUpload(key: string, id: string) {
        const upload = env.AUDIO.resumeMultipartUpload(key, id);
        return { key: upload.key, uploadId: upload.uploadId, uploadPart: upload.uploadPart.bind(upload), complete: upload.complete.bind(upload),
          async abort() { await upload.abort(); aborts += 1; throw new Error(aborts === 1 ? "transport unavailable" : "abortMultipartUpload: The specified multipart upload does not exist. (10024)"); } };
      },
    };
    const jobs = new ProcessingJobs(context.storage, bucket, { secret, url: "https://executor.invalid", auth: "fixture" }, Date.now, async () => new Response(null, { status: 202 }));
    await expect(jobs.advance(session)).rejects.toThrow("cleanup requires recovery");
    expect((await jobs.load(session.uploadId))?.claim.generation).toBe(1);
    expect((await jobs.load(session.uploadId))?.phase).toBe("cleanup");
    expect(await env.AUDIO.head(session.key)).not.toBeNull();
    await jobs.advance(session);
    expect(aborts).toBe(2); expect((await jobs.load(session.uploadId))?.claim.generation).toBe(2);
  });
});

test("reported capacity failure survives eviction and never retries the same budget", async () => {
  const f = await setup(); const claim = await f.finishSource();
  const failure = JSON.stringify({ reason: "output_budget_exceeded" });
  expect((await f.callback(claim, "failed", "POST", failure)).status).toBe(204);
  expect((await f.callback(claim, "failed", "POST", failure)).status).toBe(204);
  expect(await (await f.send("GET")).json()).toMatchObject({ state: "processing", recoveryRequired: true, processingFailure: "output_budget_exceeded", reservedBytes: 30 });
  await evictDurableObject(f.stub);
  for (let check = 0; check < 3; check++) {
    expect(await (await f.send("POST", "/finish")).json()).toMatchObject({ state: "processing", recoveryRequired: true, processingFailure: "output_budget_exceeded" });
  }
  expect((await f.send("POST", "/retry-processing")).status).toBe(409);
  const state = await f.state();
  expect(state.job.claim.generation).toBe(1); expect(state.job.attempts).toBe(1); expect(state.job.phase).toBe("recovery");
  expect(state.session.processing?.outputBudget).toBe(20);
  expect(await env.AUDIO.head(state.session.key)).not.toBeNull();
  expect((await routeUpload(new Request(f.media), env))?.status).toBe(404);
});

test("executor failures have bounded retries and stale reports cannot stop a later attempt", async () => {
  const f = await setup(); const original = await f.finishSource();
  expect((await f.callback(original, "failed", "POST", JSON.stringify({ reason: "arbitrary error text" }))).status).toBe(400);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const claim = (await f.state()).job.claim;
    expect((await f.callback(claim, "failed", "POST", JSON.stringify({ reason: "executor_failed" }))).status).toBe(204);
    expect((await f.send("POST", "/finish")).status).toBe(200);
    if (attempt < 3) expect((await f.callback(claim, "failed", "POST", JSON.stringify({ reason: "output_budget_exceeded" }))).status).toBe(409);
  }
  expect(await (await f.send("GET")).json()).toMatchObject({ recoveryRequired: true, processingFailure: "executor_failed" });
  expect((await f.state()).job.claim.generation).toBe(3);
  expect((await f.send("POST", "/retry-processing")).status).toBe(200);
  expect((await f.state()).job.claim.generation).toBe(4);
  expect((await f.callback(original, "failed", "POST", JSON.stringify({ reason: "output_budget_exceeded" }))).status).toBe(409);
  expect((await f.state()).job.failure).toBeUndefined();
});

test("unreported expired leases become explicit recovery after bounded attempts", async () => {
  const f = await setup(); await f.finishSource();
  for (let attempt = 1; attempt <= 3; attempt++) {
    await runInDurableObject(f.stub, async (_, context) => {
      const job = await context.storage.get<ProcessingJob>(`processing:${f.value.uploadId}`);
      if (!job) throw new Error("missing job");
      job.leaseUntil = Date.now() - 1; await context.storage.put(`processing:${f.value.uploadId}`, job);
    });
    expect((await f.send("POST", "/finish")).status).toBe(200);
  }
  expect(await (await f.send("GET")).json()).toMatchObject({ recoveryRequired: true, processingFailure: "lease_expired" });
  expect((await f.state()).job.claim.generation).toBe(3);
});
