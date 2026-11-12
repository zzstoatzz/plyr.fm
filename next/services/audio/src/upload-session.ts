import { MAX_UPLOAD_BYTES, PART_BYTES, sameUpload, ownerHash, reservedBytes } from "./upload-capability.ts";

import type { UploadClaim } from "./upload-capability.ts";
export type ProcessingFailure = "output_budget_exceeded" | "executor_failed" | "lease_expired";
export type UploadSession = Omit<UploadClaim, "expiresAt"> & {
  audioUrl: string; key: string; state: "starting" | "transferring" | "completing" | "processing" | "complete" | "published" | "cancelling" | "cancelled";
  parts: Record<number, { sha256: string; etag?: string }>; createdAt: number; nextCheck: number | null;
  starts: number; checks: number; multipartId?: string;
  rendition?: { duration: number; sizeBytes: number };
  processingFailure?: ProcessingFailure;
};
type Inspection = (session: UploadSession) => Promise<"published" | "absent" | "conflict">;
type Process = (session: UploadSession, retry: boolean) => Promise<{ ready: boolean; nextCheck: number | null; artifact?: { duration: number; sizeBytes: number }; failure?: ProcessingFailure }>;
const DAY = 86400000;
const ACTIVE_LIMIT = 2;
const MAX_ATTEMPTS = 20;

export class UploadFailure extends Error {
  constructor(public status: number, message: string) { super(message); this.status = status; }
}

export class UploadSessions {
  busy = false;
  private waiting: (() => void)[] = [];
  constructor(private storage: DurableObjectStorage, private bucket: R2Bucket, private inspect: Inspection, private now = Date.now, private process?: Process) {}

  async exclusive<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new UploadFailure(408, "upload request aborted");
    if (this.busy) await this.wait(signal);
    else this.busy = true;
    try {
      if (signal?.aborted) throw new UploadFailure(408, "upload request aborted");
      return await operation();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.busy = false;
    }
  }

  private wait(signal?: AbortSignal): Promise<void> {
    if (this.waiting.length >= 2) return Promise.reject(new UploadFailure(409, "upload operation in progress"));
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
      const ready = () => { cleanup(); resolve(); };
      const fail = (error: UploadFailure) => {
        const index = this.waiting.indexOf(ready);
        if (index !== -1) this.waiting.splice(index, 1);
        cleanup(); reject(error);
      };
      const abort = () => fail(new UploadFailure(408, "upload request aborted"));
      const timer = setTimeout(() => fail(new UploadFailure(409, "upload operation in progress")), 20000);
      this.waiting.push(ready);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  async load(id: string) { return await this.storage.get<UploadSession>(`session:${id}`); }

  async save(session: UploadSession) {
    const active = await this.storage.get<string[]>("active") ?? [];
    const next = active.filter(id => id !== session.uploadId);
    if (session.state !== "published" && session.state !== "cancelled") next.push(session.uploadId);
    if (session.nextCheck != null) {
      const alarm = await this.storage.getAlarm();
      if (alarm == null || session.nextCheck < alarm) await this.storage.setAlarm(session.nextCheck);
    }
    await this.storage.put({ [`session:${session.uploadId}`]: session, active: next });
  }

  view(session: UploadSession) {
    return {
      state: session.state,
      recoveryRequired: !["published", "cancelled"].includes(session.state) && session.nextCheck === null,
      reservedBytes: ["published", "cancelled"].includes(session.state) ? 0 : reservedBytes(session),
      processing: session.processing ?? undefined,
      processingFailure: session.processingFailure,
      rendition: session.rendition ? { ...session.rendition, contentType: "audio/mpeg", fileType: "mp3" } : undefined,
      partSizeBytes: PART_BYTES,
      partCount: Math.ceil(session.sizeBytes / PART_BYTES),
      receivedParts: Object.entries(session.parts).filter(([, part]) => part.etag).map(([number, part]) => ({ number: Number(number), sha256: part.sha256 })),
      reservedDigests: Object.entries(session.parts).map(([number, part]) => ({ number: Number(number), sha256: part.sha256 })),
      audioUrl: ["complete", "published"].includes(session.state) ? session.audioUrl : undefined,
    };
  }

  async start(claim: UploadClaim, audioUrl: string) {
    let session = await this.load(claim.uploadId);
    if (session) {
      if (!sameUpload(session, claim)) throw new UploadFailure(409, "upload reservation differs");
      if (session.state === "cancelled") throw new UploadFailure(410, "upload cancelled");
    } else {
      const active = await this.storage.get<string[]>("active") ?? [];
      const sessions = await Promise.all(active.map(id => this.load(id)));
      if (active.length >= ACTIVE_LIMIT || sessions.reduce((sum, item) => sum + (item ? reservedBytes(item) : MAX_UPLOAD_BYTES), reservedBytes(claim)) > ACTIVE_LIMIT * MAX_UPLOAD_BYTES)
        throw new UploadFailure(429, "active upload limit reached");
      const { expiresAt, ...reservation } = claim;
      session = { ...reservation, audioUrl, key: `uploads/${await ownerHash(claim.owner)}/${claim.uploadId}`, state: "starting", parts: {}, createdAt: this.now(), nextCheck: this.now() + DAY, starts: 0, checks: 0 };
      await this.save(session);
    }
    if (session.state === "starting") {
      if (session.starts >= 3) throw new UploadFailure(409, "upload start needs cancellation");
      session.starts += 1;
      await this.save(session);
      const upload = await this.bucket.createMultipartUpload(session.key, {
        httpMetadata: { contentType: session.contentType },
        customMetadata: { owner: session.owner, uploadId: session.uploadId },
      });
      session.multipartId = upload.uploadId;
      session.state = "transferring";
      await this.save(session);
    }
    return this.view(session);
  }

  async part(session: UploadSession, number: number, request: Request) {
    if (session.state !== "transferring") throw new UploadFailure(409, "upload not accepting parts");
    const count = Math.ceil(session.sizeBytes / PART_BYTES);
    if (!Number.isInteger(number) || number < 1 || number > count) throw new UploadFailure(400, "invalid part number");
    const expected = number === count ? session.sizeBytes - PART_BYTES * (count - 1) : PART_BYTES;
    const length = request.headers.get("content-length");
    if (length !== null && Number(length) !== expected) throw new UploadFailure(400, "incorrect part size");
    const bytes = await boundedBody(request, expected);
    const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
    const old = session.parts[number];
    if (old && old.sha256 !== sha256) throw new UploadFailure(409, "part differs from reserved bytes");
    if (old?.etag) return { number, sha256 };
    session.parts[number] = { sha256 };
    await this.save(session);
    const receipt = await this.bucket.resumeMultipartUpload(session.key, session.multipartId ?? "").uploadPart(number, bytes);
    session.parts[number] = { sha256, etag: receipt.etag };
    await this.save(session);
    return { number, sha256 };
  }

  async recoverComplete(session: UploadSession): Promise<UploadSession["state"]> {
    if (session.state !== "completing") return session.state;
    const object = await this.bucket.head(session.key);
    if (object) {
      if (object.size !== session.sizeBytes || object.customMetadata?.owner !== session.owner || object.customMetadata?.uploadId !== session.uploadId)
        throw new UploadFailure(409, "completed object differs from reservation");
      session.state = session.processing ? "processing" : "complete";
      session.nextCheck = this.now() + 1000;
      await this.save(session);
    }
    return session.state;
  }

  async finish(session: UploadSession) {
    const state = await this.recoverComplete(session);
    if (state === "processing") return this.progress(session);
    if (["complete", "published"].includes(session.state)) return this.view(session);
    if (!["transferring", "completing"].includes(session.state)) throw new UploadFailure(409, "upload cannot finish");
    const count = Math.ceil(session.sizeBytes / PART_BYTES);
    const parts: R2UploadedPart[] = [];
    for (let number = 1; number <= count; number++) {
      const etag = session.parts[number]?.etag;
      if (!etag) throw new UploadFailure(409, "upload has missing parts");
      parts.push({ partNumber: number, etag });
    }
    session.state = "completing";
    session.nextCheck = this.now() + 1000;
    await this.save(session);
    await this.bucket.resumeMultipartUpload(session.key, session.multipartId ?? "").complete(parts);
    if (await this.recoverComplete(session) === "processing") return this.progress(session);
    return this.view(session);
  }

  async progress(session: UploadSession, retry = false) {
    if (session.state !== "processing") throw new UploadFailure(409, "upload is not processing");
    if (!this.process) throw new UploadFailure(503, "processing unavailable");
    const result = await this.process(session, retry);
    session.processingFailure = result.failure;
    if (result.ready) { session.state = "complete"; session.rendition = result.artifact; }
    session.checks = 0;
    session.nextCheck = result.nextCheck;
    await this.save(session);
    return this.view(session);
  }

  async activate(session: UploadSession) {
    await this.recoverComplete(session);
    if (session.state === "published") return this.view(session);
    if (session.state !== "complete") throw new UploadFailure(409, "upload not complete");
    const result = await this.inspect(session);
    if (result === "published") {
      session.state = "published";
      session.nextCheck = null;
      await this.save(session);
    }
    return this.view(session);
  }

  async cancel(session: UploadSession) {
    await this.recoverComplete(session);
    if (session.state === "published") throw new UploadFailure(409, "published audio cannot be cancelled");
    if (session.state === "cancelled") return this.view(session);
    if (["complete", "completing", "processing"].includes(session.state)) {
      const result = await this.inspect(session);
      if (result !== "absent") throw new UploadFailure(409, "publication must be resolved before cancellation");
      // A later client create can still race absence, so completed bytes are retained.
      throw new UploadFailure(409, "completed upload requires publication recovery");
    }
    session.state = "cancelling";
    await this.save(session);
    if (session.multipartId) await this.bucket.resumeMultipartUpload(session.key, session.multipartId).abort();
    session.state = "cancelled";
    session.nextCheck = null;
    await this.save(session);
    return this.view(session);
  }

  async alarm() {
    const active = await this.storage.get<string[]>("active") ?? [];
    for (const id of active) {
      const session = await this.load(id);
      if (!session || session.nextCheck == null || session.nextCheck > this.now()) continue;
      if (session.state === "processing") {
        try { await this.progress(session); }
        catch { session.checks += 1; session.nextCheck = session.checks < MAX_ATTEMPTS ? this.now() + 30000 : null; await this.save(session); }
        continue;
      }
      try {
        await this.recoverComplete(session);
        if (session.state === "completing") await this.finish(session);
        if (session.state === "complete") await this.activate(session);
        if (["starting", "transferring", "cancelling"].includes(session.state) && this.now() >= session.createdAt + DAY) await this.cancel(session);
      } catch { /* Persisted intent is retried by the bounded alarm. */ }
      if (!["published", "cancelled"].includes(session.state)) {
        session.checks += 1;
        session.nextCheck = session.checks < MAX_ATTEMPTS ? this.now() + Math.min(3600000, 1000 * 2 ** session.checks) : null;
        await this.save(session);
      }
    }
    const remaining = await Promise.all((await this.storage.get<string[]>("active") ?? []).map(id => this.load(id)));
    const times = remaining.map(session => session?.nextCheck).filter(time => time != null);
    if (times.length) await this.storage.setAlarm(Math.min(...times));
  }
}

export async function boundedBody(request: Request, expected: number) {
  if (!request.body) throw new UploadFailure(400, "missing part bytes");
  const reader = request.body.getReader();
  const bytes = new Uint8Array(expected);
  let offset = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > expected - offset) throw new UploadFailure(413, "part too large");
      bytes.set(value, offset);
      offset += value.byteLength;
    }
    if (offset !== expected) throw new UploadFailure(400, "incomplete part");
    return bytes;
  } finally {
    await reader.cancel();
  }
}

function hex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");
}
