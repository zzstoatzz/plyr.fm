import { routeUpload } from "./upload-worker.ts";
import { routeGenres } from "./genres.ts";
import { routeImages, cidDigestHex } from "./images.ts";
import { verifyCapability } from "./upload-capability.ts";
import { SNIFF_BYTES, sniffAudioType } from "./audio-sniff.ts";
export { OwnerUploads } from "./upload-worker.ts";

// Content-addressed audio for next.plyr.fm (cover art: images.ts).
//
//   GET/HEAD /audio/{cid}  public, Range-capable, immutable
//   PUT      /audio/{cid}  bearer UPLOAD_TOKEN (the backend mirror) or an upload
//                          capability (the uploading client); body must hash to the cid
//
// The key's CID (v1, raw codec, sha2-256) fixes the digest, and R2 rejects the
// write unless the streamed bytes match it, so even a leaked token can only
// store bytes that some record already names.
//
// The served content type is what the bytes are (audio-sniff.ts), not what the
// uploader claimed: objects written since record the sniff in customMetadata, and
// older ones are sniffed on read and rewritten once with the corrected type.

const MAX_BYTES = 104_857_600; // track lexicon audioBlob.maxSize
const SNIFFED = "sniffed"; // customMetadata key: the sniffed type, or "unknown"
const KEY = /^audio\/(b[a-z2-7]{58})$/;
const IMMUTABLE = "public, max-age=31536000, immutable";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers":
    "accept-ranges, content-length, content-range, etag",
};

export default {
  async fetch(request, env, ctx) {
    const upload = await routeUpload(request, env) ?? await routeGenres(request, env) ?? await routeImages(request, env);
    if (upload) return upload;
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
        return read(request, env, key, match[1], ctx);
      case "PUT":
        return write(request, env, key, match[1]);
      default:
        return text(405, "method not allowed", {
          allow: "GET, HEAD, PUT, OPTIONS",
        });
    }
  },
};

async function read(request, env, key, cid, ctx) {
  if (request.method === "HEAD") {
    const head = await env.AUDIO.head(key);
    if (!head) return text(404, "not found");
    const headers = objectHeaders(head, await servedType(env, key, cid, head, ctx));
    headers.set("content-length", String(head.size));
    return new Response(null, { headers });
  }
  let object;
  try {
    object = await env.AUDIO.get(key, {
      range: request.headers,
      onlyIf: request.headers,
    });
  } catch {
    return text(416, "range not satisfiable");
  }
  if (!object) return text(404, "not found");
  const headers = objectHeaders(object, await servedType(env, key, cid, object, ctx));
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
    const { first, body } = await peek(request.body, length);
    const sniffed = sniffAudioType(first);
    await env.AUDIO.put(key, body, {
      sha256: digest,
      httpMetadata: { contentType: sniffed ?? contentType, cacheControl: IMMUTABLE },
      customMetadata: { [SNIFFED]: sniffed ?? "unknown" },
    });
  } catch (error) {
    return text(422, `rejected: ${error?.message ?? "write failed"}`);
  }
  return text(201, "stored");
}

function objectHeaders(object, type) {
  const headers = new Headers(CORS);
  object.writeHttpMetadata(headers);
  if (type) headers.set("content-type", type);
  if (headers.get("content-type")?.toLowerCase() === "audio/x-flac")
    headers.set("content-type", "audio/flac");
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", IMMUTABLE);
  return headers;
}

/**
 * The type to serve an object written before writes were sniffed: sniffed from its first
 * bytes, with the object rewritten in the background so later reads skip this.
 */
async function servedType(env, key, cid, object, ctx) {
  if (object.customMetadata?.[SNIFFED]) return undefined;
  const start = await env.AUDIO.get(key, { range: { offset: 0, length: SNIFF_BYTES } });
  if (!start) return undefined;
  const sniffed = sniffAudioType(new Uint8Array(await start.arrayBuffer()));
  ctx?.waitUntil(heal(env, key, cid, object, sniffed).catch((error) => console.error(`could not heal ${key}: ${error?.message ?? error}`)));
  return sniffed;
}

async function heal(env, key, cid, object, sniffed) {
  const digest = cidDigestHex(cid);
  const current = await env.AUDIO.get(key);
  if (!digest || !current || current.customMetadata?.[SNIFFED]) return;
  const { readable, writable } = new FixedLengthStream(current.size);
  const copied = current.body.pipeTo(writable);
  const contentType = sniffed ?? current.httpMetadata?.contentType ?? object.httpMetadata?.contentType;
  await env.AUDIO.put(key, readable, {
    sha256: digest,
    onlyIf: { etagMatches: current.etag },
    httpMetadata: { ...current.httpMetadata, ...(contentType ? { contentType } : {}), cacheControl: IMMUTABLE },
    customMetadata: { ...current.customMetadata, [SNIFFED]: sniffed ?? "unknown" },
  });
  await copied;
}

/** The body's first bytes to sniff, and the whole body again, still of its declared length. */
async function peek(stream, length) {
  const reader = stream.getReader();
  const chunks = [];
  let seen = 0;
  while (seen < SNIFF_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    seen += value.byteLength;
  }
  const first = new Uint8Array(seen);
  let offset = 0;
  for (const chunk of chunks) { first.set(chunk, offset); offset += chunk.byteLength; }
  const { readable, writable } = new FixedLengthStream(length);
  const writer = writable.getWriter();
  (async () => {
    try {
      for (const chunk of chunks) await writer.write(chunk);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
      await writer.close();
    } catch (error) {
      await writer.abort(error).catch(() => {});
    }
  })();
  return { first: first.subarray(0, SNIFF_BYTES), body: readable };
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
