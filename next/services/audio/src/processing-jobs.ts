import { PART_BYTES, ownerHash } from "./upload-capability.ts";
import { signProcessing } from "./processing-capability.ts";
import type { ProcessingClaim } from "./processing-capability.ts";
import { UploadFailure, boundedBody } from "./upload-session.ts";
import type { UploadSession } from "./upload-session.ts";

type Part = { size: number; sha256: string; etag?: string };
export type ProcessingJob = {
  claim: ProcessingClaim; key: string; phase: "preparing" | "running" | "completing" | "ready" | "cleanup" | "recovery";
  attempts: number; starts: number; leaseUntil: number; started?: boolean; multipartId?: string; parts: Record<number, Part>; outputSize?: number; duration?: number;
};
type Settings = { secret: string; url: string; auth: string };
type Bucket = Pick<R2Bucket, "get" | "head" | "delete" | "createMultipartUpload" | "resumeMultipartUpload">;
const lease = 90000;
const lifetime = 7200000;

function absentMultipart(error: unknown) {
  return error instanceof Error && (("code" in error && error.code === 10024 && "action" in error && error.action === "abortMultipartUpload")
    || /^abortMultipartUpload: .+ \(10024\)$/.test(error.message));
}

export class ProcessingJobs {
  private pending = Promise.resolve();
  constructor(private storage: DurableObjectStorage, private bucket: Bucket, private settings: Settings | null, private now = Date.now, private dispatch: typeof fetch = (input, init) => fetch(input, init)) {}

  private async locked<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.pending;
    let release = () => {};
    this.pending = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }
  async load(id: string) { return this.storage.get<ProcessingJob>(`processing:${id}`); }
  private async save(job: ProcessingJob) { await this.storage.put(`processing:${job.claim.uploadId}`, job); }

  private async recover(job: ProcessingJob) {
    if (job.phase !== "completing") return;
    const object = await this.bucket.head(job.key);
    if (!object) return;
    if (object.size !== job.outputSize || object.customMetadata?.generation !== String(job.claim.generation)
      || object.customMetadata?.uploadId !== job.claim.uploadId || object.customMetadata?.ownerHash !== job.claim.ownerHash)
      throw new UploadFailure(409, "rendition differs from reserved attempt");
    job.phase = "ready";
    await this.save(job);
  }

  async advance(session: UploadSession, retry = false): Promise<{ ready: boolean; nextCheck: number | null; artifact?: { duration: number; sizeBytes: number } }> {
    if (!session.processing) throw new UploadFailure(409, "upload has no processing recipe");
    const settings = this.settings;
    if (!settings) throw new UploadFailure(503, "processing is not configured");
    const job = await this.locked(async () => {
      let current = await this.load(session.uploadId);
      if (current) await this.recover(current);
      if (current?.phase === "ready") return current;
      if (current?.phase === "recovery" && !retry) return current;
      if (retry && current?.phase === "running" && current.leaseUntil > this.now()) throw new UploadFailure(409, "processing is still active");
      if (current && (retry || (current.phase === "running" && current.leaseUntil <= this.now()))) {
        current.phase = "cleanup";
        await this.save(current);
      }
      if (current?.phase === "cleanup") {
        if (current.multipartId) {
          try { await this.bucket.resumeMultipartUpload(current.key, current.multipartId).abort(); }
          catch (error) { if (!absentMultipart(error) && !await this.bucket.head(current.key)) throw new UploadFailure(503, "processing cleanup requires recovery"); }
        }
        await this.bucket.delete(current.key);
        if (current.attempts >= 3 && !retry) {
          current.phase = "recovery";
          await this.save(current);
          return current;
        }
        const generation = current.claim.generation + 1;
        current = this.fresh(session, current.claim.ownerHash, generation, retry ? 1 : current.attempts + 1);
      }
      if (!current) current = this.fresh(session, await ownerHash(session.owner), 1, 1);
      if (current.phase === "preparing") {
        if (current.starts >= 3) { current.phase = "recovery"; await this.save(current); return current; }
        current.starts += 1;
        await this.save(current);
        const multipart = await this.bucket.createMultipartUpload(current.key, { httpMetadata: { contentType: "audio/mpeg" },
          customMetadata: { uploadId: session.uploadId, generation: String(current.claim.generation), ownerHash: current.claim.ownerHash } });
        current.multipartId = multipart.uploadId;
        current.phase = "running";
        await this.save(current);
      }
      return current;
    });
    if (job.phase === "ready") return this.ready(job);
    if (job.phase === "recovery") return { ready: false, nextCheck: null };
    if (job.phase === "completing") {
      await this.finish(job.claim);
      const completed = await this.load(session.uploadId);
      if (!completed) throw new UploadFailure(409, "processing state missing");
      return this.ready(completed);
    }
    if (job.phase === "running" && !job.started) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
      const response = await this.dispatch(settings.url, { method: "POST", redirect: "manual", signal: controller.signal,
        headers: { "content-type": "application/json", "X-Processing-Key": settings.auth },
        body: JSON.stringify({ uploadId: session.uploadId, generation: job.claim.generation, sourceBytes: session.sizeBytes,
          outputBudget: session.processing.outputBudget, recipe: session.processing.recipe, capability: await signProcessing(job.claim, settings.secret) }) });
      await response.body?.cancel();
      if (!response.ok) throw new UploadFailure(503, "processing executor unavailable");
      } finally { clearTimeout(timeout); }
    }
    return { ready: false, nextCheck: this.now() + 30000 };
  }

  private ready(job: ProcessingJob) {
    if (job.phase !== "ready" || job.outputSize === undefined || job.duration === undefined) throw new UploadFailure(409, "rendition metadata incomplete");
    return { ready: true, nextCheck: this.now() + 1000, artifact: { duration: job.duration, sizeBytes: job.outputSize } };
  }

  private fresh(session: UploadSession, hash: string, generation: number, attempts: number): ProcessingJob {
    return { claim: { kind: "processing-v1", ownerHash: hash, uploadId: session.uploadId, generation, expiresAt: this.now() + lifetime },
      key: `processing/${hash}/${session.uploadId}/${generation}`, phase: "preparing", attempts, starts: 0, leaseUntil: this.now() + lease, parts: {} };
  }

  private async authorized(claim: ProcessingClaim) {
    const job = await this.load(claim.uploadId);
    if (!job || job.claim.generation !== claim.generation || job.claim.ownerHash !== claim.ownerHash || job.claim.expiresAt !== claim.expiresAt
      || job.leaseUntil <= this.now() || claim.expiresAt <= this.now() || !["running", "completing"].includes(job.phase))
      throw new UploadFailure(409, "processing lease is no longer active");
    return job;
  }

  async heartbeat(claim: ProcessingClaim) {
    await this.locked(async () => { const job = await this.authorized(claim); job.started = true; job.leaseUntil = Math.min(claim.expiresAt, this.now() + lease); await this.save(job); });
  }
  async source(claim: ProcessingClaim, session: UploadSession) {
    await this.authorized(claim);
    if (session.uploadId !== claim.uploadId || await ownerHash(session.owner) !== claim.ownerHash || session.state !== "processing") throw new UploadFailure(409, "processing source unavailable");
    const object = await this.bucket.get(session.key);
    if (!object || object.size !== session.sizeBytes) throw new UploadFailure(409, "processing source missing");
    return new Response(object.body, { headers: { "content-type": session.contentType, "content-length": String(object.size), "cache-control": "no-store" } });
  }

  async part(claim: ProcessingClaim, session: UploadSession, number: number, request: Request) {
    const budget = session.processing?.outputBudget ?? 0;
    const length = Number(request.headers.get("content-length"));
    if (!Number.isSafeInteger(number) || number < 1 || number > Math.ceil(budget / PART_BYTES)
      || !Number.isSafeInteger(length) || length < 1 || length > Math.min(PART_BYTES, budget - (number - 1) * PART_BYTES)) throw new UploadFailure(400, "invalid rendition part");
    await this.authorized(claim);
    const bytes = await boundedBody(request, length);
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
    if (request.headers.get("X-Part-SHA256") !== sha256) throw new UploadFailure(400, "rendition digest mismatch");
    const job = await this.locked(async () => {
      const current = await this.authorized(claim);
      if (current.phase !== "running") throw new UploadFailure(409, "rendition is completing");
      const old = current.parts[number];
      if (old && (old.sha256 !== sha256 || old.size !== length)) throw new UploadFailure(409, "rendition part differs");
      current.parts[number] = old ?? { size: length, sha256 };
      await this.save(current);
      return current;
    });
    if (job.parts[number].etag) return;
    const receipt = await this.bucket.resumeMultipartUpload(job.key, job.multipartId ?? "").uploadPart(number, bytes);
    await this.locked(async () => { const current = await this.authorized(claim); current.parts[number] = { size: length, sha256, etag: receipt.etag }; await this.save(current); });
  }

  async complete(claim: ProcessingClaim, session: UploadSession, value: unknown) {
    await this.locked(async () => {
      const job = await this.authorized(claim);
      if (value === null || typeof value !== "object" || !("sizeBytes" in value) || typeof value.sizeBytes !== "number" || !Number.isSafeInteger(value.sizeBytes)
        || value.sizeBytes <= 0 || value.sizeBytes > (session.processing?.outputBudget ?? 0) || !("contentType" in value) || value.contentType !== "audio/mpeg"
        || !("duration" in value) || typeof value.duration !== "number" || !Number.isInteger(value.duration) || value.duration < 0 || value.duration > 4294967295
        || !("parts" in value) || !Array.isArray(value.parts) || value.parts.length !== Math.ceil(value.sizeBytes / PART_BYTES)) throw new UploadFailure(400, "invalid rendition completion");
      for (let index = 0; index < value.parts.length; index++) {
        const part: unknown = value.parts[index];
        const stored = job.parts[index + 1];
        if (!part || typeof part !== "object" || !("number" in part) || part.number !== index + 1 || !("sha256" in part) || part.sha256 !== stored?.sha256
          || !stored?.etag || stored.size !== Math.min(PART_BYTES, value.sizeBytes - index * PART_BYTES)) throw new UploadFailure(409, "rendition receipts incomplete");
      }
      if (Object.keys(job.parts).length !== value.parts.length || (job.outputSize !== undefined && job.outputSize !== value.sizeBytes)
        || (job.duration !== undefined && job.duration !== value.duration)) throw new UploadFailure(409, "rendition completion differs");
      job.outputSize = value.sizeBytes; job.duration = value.duration; job.phase = "completing"; await this.save(job);
    });
    await this.finish(claim);
  }

  private async finish(claim: ProcessingClaim) {
    const job = await this.locked(async () => {
      const current = await this.load(claim.uploadId);
      if (!current || current.claim.generation !== claim.generation) throw new UploadFailure(409, "processing generation changed");
      await this.recover(current);
      return current;
    });
    if (job.phase === "ready") return;
    if (job.phase !== "completing") throw new UploadFailure(409, "rendition not completing");
    const parts = Object.entries(job.parts).sort(([a], [b]) => Number(a) - Number(b)).map(([number, part]) => {
      if (!part.etag) throw new UploadFailure(409, "rendition receipt missing");
      return { partNumber: Number(number), etag: part.etag };
    });
    await this.bucket.resumeMultipartUpload(job.key, job.multipartId ?? "").complete(parts);
    await this.locked(async () => {
      const current = await this.load(claim.uploadId);
      if (!current || current.claim.generation !== claim.generation || !["completing", "ready"].includes(current.phase)) throw new UploadFailure(409, "processing generation changed");
      await this.recover(current);
    });
  }
}
