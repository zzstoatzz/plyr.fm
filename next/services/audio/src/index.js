import { routeUpload } from "./upload-worker.ts";
import { routeGenres } from "./genres.ts";
import { routeImages, cidDigestHex } from "./images.ts";
import { verifyCapability, verifyOwnerAudio } from "./upload-capability.ts";
export { OwnerUploads } from "./upload-worker.ts";

// Content-addressed audio for next.plyr.fm (cover art: images.ts).
//
//   GET/HEAD /audio/{cid}  public, Range-capable, immutable
//   GET/HEAD /v1/legacy-audio/{file_id}?capability=  an owner's supporter-gated
//                          production file, read-only from AUDIO_PRIVATE_LEGACY,
//                          for the record owner only (the coordinator signs it)
//   PUT      /audio/{cid}  bearer UPLOAD_TOKEN (the backend mirror) or an upload
//                          capability (the uploading client); body must hash to the cid
//
// The key's CID (v1, raw codec, sha2-256) fixes the digest, and R2 rejects the
// write unless the streamed bytes match it, so even a leaked token can only
// store bytes that some record already names.

const MAX_BYTES = 104_857_600; // track lexicon audioBlob.maxSize
const KEY = /^audio\/(b[a-z2-7]{58})$/;
const IMMUTABLE = "public, max-age=31536000, immutable";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers":
    "accept-ranges, content-length, content-range, etag",
};

export default {
  async fetch(request, env) {
    const upload = await routeUpload(request, env) ?? await routeGenres(request, env) ?? await routeImages(request, env);
    if (upload) return upload;
    const legacy = await routeOwnerAudio(request, env);
    if (legacy) return legacy;
    const key = new URL(request.url).pathname.slice(1);
    const match = KEY.exec(key);
    if (!match) return text(404, "not found");
    switch (request.method) {
      case "OPTIONS":
        return new Response(null, {
          status: 204,
          headers: {
            ...CORS,
            "access-control-allow-methods": "GET, HEAD, PUT, OPTIONS",
            "access-control-allow-headers": "range, authorization, content-type, x-content-sha256",
            "access-control-max-age": "86400",
          },
        });
      case "GET":
      case "HEAD":
        return read(request, env.AUDIO, key, IMMUTABLE);
      case "PUT":
        return write(request, env, key, match[1]);
      default:
        return text(405, "method not allowed", {
          allow: "GET, HEAD, PUT, OPTIONS",
        });
    }
  },
};

const OWNER_AUDIO = /^\/v1\/legacy-audio\/([A-Za-z0-9]{1,64})$/;

async function routeOwnerAudio(request, env) {
  const url = new URL(request.url);
  const match = OWNER_AUDIO.exec(url.pathname);
  if (!match) return null;
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: { ...CORS, "access-control-allow-methods": "GET, HEAD, OPTIONS", "access-control-allow-headers": "range", "access-control-max-age": "86400" } });
  if (request.method !== "GET" && request.method !== "HEAD")
    return text(405, "method not allowed", { allow: "GET, HEAD, OPTIONS" });
  const claim = await verifyOwnerAudio(url.searchParams.get("capability"), env.UPLOAD_CAPABILITY_SECRET);
  if (!claim || claim.fileId !== match[1]) return text(403, "forbidden");
  const bucket = env.AUDIO_PRIVATE_LEGACY;
  if (!bucket) return text(503, "unavailable");
  // production stored the file as audio/{file_id}.{ext}; the record names no extension
  const listed = await bucket.list({ prefix: `audio/${claim.fileId}.`, limit: 2 });
  if (listed.objects.length !== 1) return text(404, "not found");
  return read(request, bucket, listed.objects[0].key, "private, no-store");
}

async function read(request, bucket, key, cacheControl) {
  if (request.method === "HEAD") {
    const head = await bucket.head(key);
    if (!head) return text(404, "not found");
    const headers = objectHeaders(head, cacheControl);
    headers.set("content-length", String(head.size));
    return new Response(null, { headers });
  }
  let object;
  try {
    object = await bucket.get(key, {
      range: request.headers,
      onlyIf: request.headers,
    });
  } catch {
    return text(416, "range not satisfiable");
  }
  if (!object) return text(404, "not found");
  const headers = objectHeaders(object, cacheControl);
  if (!("body" in object)) return new Response(null, { status: 304, headers });
  if (!request.headers.has("range") || !object.range) {
    headers.set("content-length", String(object.size));
    return new Response(object.body, { headers });
  }
  const { start, end } = span(object.range, object.size);
  headers.set("content-range", `bytes ${start}-${end}/${object.size}`);
  headers.set("content-length", String(end - start + 1));
  return new Response(object.body, { status: 206, headers });
}

async function write(request, env, key, cid) {
  const claim = await writer(request, env);
  if (!claim) return text(401, "unauthorized");
  const digest = cidDigestHex(cid);
  if (!digest) return text(400, "key must be a raw sha2-256 CIDv1");
  if (request.headers.get("x-content-sha256")?.toLowerCase() !== digest)
    return text(400, "x-content-sha256 must match the key's CID");
  const length = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_BYTES)
    return text(413, "content-length required, at most 100 MB");
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^audio\/[a-z0-9.+-]+$/i.test(contentType))
    return text(415, "audio content-type required");
  if (claim !== MIRROR && (claim.sizeBytes !== length || claim.contentType !== contentType))
    return text(403, "the upload capability names a different size or type");
  if (await env.AUDIO.head(key)) return text(200, "exists");
  try {
    await env.AUDIO.put(key, request.body, {
      sha256: digest,
      httpMetadata: { contentType, cacheControl: IMMUTABLE },
    });
  } catch (error) {
    return text(422, `rejected: ${error?.message ?? "write failed"}`);
  }
  return text(201, "stored");
}

function objectHeaders(object, cacheControl) {
  const headers = new Headers(CORS);
  object.writeHttpMetadata(headers);
  if (headers.get("content-type")?.toLowerCase() === "audio/x-flac")
    headers.set("content-type", "audio/flac");
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", cacheControl);
  return headers;
}

function span(range, size) {
  if (typeof range.suffix === "number")
    return { start: Math.max(size - range.suffix, 0), end: size - 1 };
  const start = range.offset ?? 0;
  const end =
    range.length == null
      ? size - 1
      : Math.min(start + range.length, size) - 1;
  return { start, end };
}

const MIRROR = Symbol("mirror");

// The mirror's shared token, or a coordinator upload capability for unprocessed public audio.
async function writer(request, env) {
  if (env.UPLOAD_TOKEN && (await authorized(request, env.UPLOAD_TOKEN))) return MIRROR;
  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  const claim = await verifyCapability(bearer || null, env.UPLOAD_CAPABILITY_SECRET);
  return claim && !claim.processing ? claim : null;
}

async function authorized(request, token) {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const encoder = new TextEncoder();
  const [given, expected] = await Promise.all(
    [header.slice(7), token].map((value) =>
      crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  );
  return crypto.subtle.timingSafeEqual(given, expected);
}

function text(status, body, extra = {}) {
  return new Response(body, { status, headers: { ...CORS, ...extra } });
}
