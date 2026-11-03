// Content-addressed audio for next.plyr.fm.
//
//   GET/HEAD /audio/{cid}  public, Range-capable, immutable
//   PUT      /audio/{cid}  bearer UPLOAD_TOKEN; body must hash to the cid
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
    const key = new URL(request.url).pathname.slice(1);
    const match = KEY.exec(key);
    if (!match) return text(404, "not found");
    switch (request.method) {
      case "OPTIONS":
        return new Response(null, {
          status: 204,
          headers: {
            ...CORS,
            "access-control-allow-methods": "GET, HEAD, OPTIONS",
            "access-control-allow-headers": "range",
            "access-control-max-age": "86400",
          },
        });
      case "GET":
      case "HEAD":
        return read(request, env, key);
      case "PUT":
        return write(request, env, key, match[1]);
      default:
        return text(405, "method not allowed", {
          allow: "GET, HEAD, PUT, OPTIONS",
        });
    }
  },
};

async function read(request, env, key) {
  if (request.method === "HEAD") {
    const head = await env.AUDIO.head(key);
    if (!head) return text(404, "not found");
    const headers = objectHeaders(head);
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
  const headers = objectHeaders(object);
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
  if (!env.UPLOAD_TOKEN || !(await authorized(request, env.UPLOAD_TOKEN)))
    return text(401, "unauthorized");
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

function objectHeaders(object) {
  const headers = new Headers(CORS);
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", IMMUTABLE);
  return headers;
}

function span(range, size) {
  if ("suffix" in range)
    return { start: Math.max(size - range.suffix, 0), end: size - 1 };
  const start = range.offset ?? 0;
  const end =
    range.length === undefined
      ? size - 1
      : Math.min(start + range.length, size) - 1;
  return { start, end };
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

// "b" + base32(0x01 0x55 0x12 0x20 || digest) -> hex digest, or null
function cidDigestHex(cid) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const char of cid.slice(1)) {
    if (!alphabet.includes(char)) return null;
    buffer = (buffer << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  if (bytes.length !== 36) return null;
  if (bytes[0] !== 0x01 || bytes[1] !== 0x55) return null;
  if (bytes[2] !== 0x12 || bytes[3] !== 0x20) return null;
  return bytes
    .slice(4)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function text(status, body, extra = {}) {
  return new Response(body, { status, headers: { ...CORS, ...extra } });
}
