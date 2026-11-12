import { DurableObject } from "cloudflare:workers";
import { ownerHash, verifyCapability, sameUpload } from "./upload-capability.ts";
import { UploadFailure, UploadSessions } from "./upload-session.ts";
import type { UploadSession } from "./upload-session.ts";

export interface UploadEnv {
  AUDIO: R2Bucket;
  UPLOADS: DurableObjectNamespace<OwnerUploads>;
  UPLOAD_CAPABILITY_SECRET: string;
  UPLOAD_INSPECT_URL: string;
  UPLOAD_ALLOWED_ORIGINS: string;
}

export class OwnerUploads extends DurableObject<UploadEnv> {
  private sessions: UploadSessions;
  constructor(ctx: DurableObjectState, env: UploadEnv) {
    super(ctx, env);
    this.sessions = new UploadSessions(ctx.storage, env.AUDIO, session => this.inspect(session));
  }

  private async inspect(session: UploadSession) {
    const response = await fetch(this.env.UPLOAD_INSPECT_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.env.UPLOAD_CAPABILITY_SECRET}` },
      body: JSON.stringify({ owner: session.owner, recordUri: session.recordUri, audioUrl: session.audioUrl }),
      signal: AbortSignal.timeout(15000),
      redirect: "manual",
    });
    if (!response.ok) throw new UploadFailure(503, "record authority unavailable");
    const result: unknown = await response.json();
    if (result !== null && typeof result === "object" && "state" in result && (result.state === "published" || result.state === "absent" || result.state === "conflict")) return result.state;
    throw new UploadFailure(503, "invalid authority response");
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const mediaPath = new URL(request.url).pathname.split("/");
      if (mediaPath[1] === "media" && mediaPath.length === 4) return await this.media(request, mediaPath[3]);
      return await this.sessions.exclusive(async () => {
        const url = new URL(request.url);
        const pieces = url.pathname.split("/");
        const claim = await verifyCapability(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? null, this.env.UPLOAD_CAPABILITY_SECRET);
        if (!claim || pieces[3] !== await ownerHash(claim.owner) || pieces[4] !== claim.uploadId) throw new UploadFailure(403, "invalid upload capability");
        const base = `${url.origin}/media/${pieces[3]}/${claim.uploadId}`;
        if (request.method === "POST" && pieces.length === 5) return Response.json(await this.sessions.start(claim, base));
        const session = await this.sessions.load(claim.uploadId);
        if (!session) throw new UploadFailure(404, "upload not found");
        if (!sameUpload(session, claim)) throw new UploadFailure(403, "upload reservation mismatch");
        if (request.method === "GET" && pieces.length === 5) return Response.json(this.sessions.view(session));
        if (request.method === "PUT" && pieces[5] === "parts" && pieces.length === 7) return Response.json(await this.sessions.part(session, Number(pieces[6]), request));
        if (request.method === "POST" && pieces[5] === "finish" && pieces.length === 6) return Response.json(await this.sessions.finish(session));
        if (request.method === "POST" && pieces[5] === "activate" && pieces.length === 6) return Response.json(await this.sessions.activate(session));
        if (request.method === "DELETE" && pieces.length === 5) return Response.json(await this.sessions.cancel(session));
        throw new UploadFailure(405, "method not allowed");
      });
    } catch (error) {
      return Response.json({ error: error instanceof UploadFailure ? error.message : "upload unavailable" }, { status: error instanceof UploadFailure ? error.status : 503 });
    }
  }

  private async media(request: Request, id: string): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 });
    const session = await this.sessions.load(id);
    if (!session || session.state !== "published") return new Response(null, { status: 404 });
    let read: R2ObjectBody | null;
    try { read = request.method === "HEAD" ? null : await this.env.AUDIO.get(session.key, { range: request.headers }); }
    catch { return new Response(null, { status: 416 }); }
    const object = read ?? (request.method === "HEAD" ? await this.env.AUDIO.head(session.key) : null);
    if (!object) return new Response(null, { status: 404 });
    const headers = new Headers({ "content-type": session.contentType, "x-content-type-options": "nosniff", "accept-ranges": "bytes", etag: object.httpEtag, "cache-control": "public, max-age=300" });
    if (new URL(request.url).searchParams.get("download") === "1") headers.set("content-disposition", `attachment; filename="audio.${session.fileType}"`);
    let size = object.size;
    let status = 200;
    if (request.method !== "HEAD" && request.headers.has("range") && object.range) {
      const range = object.range;
      const suffix = "suffix" in range && typeof range.suffix === "number" ? range.suffix : null;
      const start = suffix !== null ? Math.max(0, size - suffix) : "offset" in range ? range.offset ?? 0 : 0;
      const length = "length" in range ? range.length : null;
      const end = suffix !== null || length == null ? size - 1 : Math.min(size, start + length) - 1;
      headers.set("content-range", `bytes ${start}-${end}/${size}`);
      size = end - start + 1;
      status = 206;
    }
    headers.set("content-length", String(size));
    return new Response(read?.body ?? null, { status, headers });
  }

  async alarm() { await this.sessions.exclusive(() => this.sessions.alarm()); }
}

export async function routeUpload(request: Request, env: UploadEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const match = /^\/(?:v1\/uploads|media)\/([a-f0-9]{64})\/([0-9a-f-]{36})(?:\/.*)?$/.exec(url.pathname);
  if (!match) return null;
  const origin = request.headers.get("origin");
  const media = url.pathname.startsWith("/media/");
  if (!media && origin && !env.UPLOAD_ALLOWED_ORIGINS?.split(",").map(value => value.trim()).includes(origin)) return new Response(null, { status: 403 });
  const cors = { "access-control-allow-origin": media ? "*" : origin ?? "null", "access-control-expose-headers": "accept-ranges, content-length, content-range, etag", "x-content-type-options": "nosniff" };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "access-control-allow-methods": media ? "GET, HEAD, OPTIONS" : "GET, POST, PUT, DELETE, OPTIONS", "access-control-allow-headers": "authorization, content-type, range" } });
  if (!env.UPLOADS) return new Response(null, { status: 503 });
  if (media) {
    if (url.pathname.split("/").length !== 4 || !await env.AUDIO.head(`uploads/${match[1]}/${match[2]}`)) return new Response(null, { status: 404, headers: cors });
  } else {
    const claim = await verifyCapability(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? null, env.UPLOAD_CAPABILITY_SECRET);
    if (!claim || claim.uploadId !== match[2] || await ownerHash(claim.owner) !== match[1]) return new Response(null, { status: 403, headers: cors });
  }
  const response = await env.UPLOADS.get(env.UPLOADS.idFromName(match[1])).fetch(request);
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}
