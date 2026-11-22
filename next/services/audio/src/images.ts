/**
 * Cover art for next.plyr.fm, copied off the artist's PDS on first request.
 *
 *   GET/HEAD /images/{cid}?did={owner}[&w=96|320|640|1280]
 *
 * A PDS serves the full-size original (often a 12-megapixel phone photo) and can drop a blob nothing references any
 * more, so the API points covers here instead. On a miss the worker fetches the blob from the owner's PDS, keeps it
 * only if the bytes hash to the CID, and stores it in R2 for good; sized WebP variants are made once and stored beside
 * it. The CID fixes the bytes, so anyone may trigger the copy: the most it can store is an image some repo published.
 */

import { pds } from "./genres.ts";

export interface ImageEnv {
  IMAGES: R2Bucket;
  IMAGES_API?: ImagesBinding;
}
type Fetch = typeof fetch;

/** track lexicon `imageBlob.maxSize` */
const MAX_BYTES = 10_000_000;
export const WIDTHS = [96, 320, 640, 1280] as const;
const PATH = /^\/images\/(b[a-z2-7]{58})$/;
const DID = /^did:(?:plc:[a-z2-7]{24}|web:[a-zA-Z0-9.-]+)$/;
const IMMUTABLE = "public, max-age=31536000, immutable";
const CORS = { "access-control-allow-origin": "*" };

export async function routeImages(request: Request, env: ImageEnv, get: Fetch = fetch): Promise<Response | null> {
  const url = new URL(request.url);
  const match = PATH.exec(url.pathname);
  if (!match) return null;
  if (request.method !== "GET" && request.method !== "HEAD")
    return text(405, "method not allowed", { allow: "GET, HEAD" });
  const cid = match[1];
  const widthParam = url.searchParams.get("w");
  const width = widthParam === null ? null : WIDTHS.find(value => String(value) === widthParam);
  if (width === undefined) return text(400, `w must be one of ${WIDTHS.join(", ")}`);
  const did = url.searchParams.get("did");
  if (did !== null && !DID.test(did)) return text(400, "did is not a plc or web DID");

  const original = await stored(env, cid, did, get);
  if (!original) return text(404, "not found");
  if (width === null) return respond(request, original.bytes, original.contentType);

  const key = `images/${cid}/w${width}`;
  const variant = await env.IMAGES.get(key);
  if (variant) return respond(request, await variant.arrayBuffer(), variant.httpMetadata?.contentType ?? "image/webp");
  const made = await resize(env, original.bytes, width);
  if (!made) return respond(request, original.bytes, original.contentType);
  await env.IMAGES.put(key, made, { httpMetadata: { contentType: "image/webp", cacheControl: IMMUTABLE } });
  return respond(request, made, "image/webp");
}

type Original = { bytes: ArrayBuffer; contentType: string };

/** The verified original, from R2 or else copied from the owner's PDS. */
async function stored(env: ImageEnv, cid: string, did: string | null, get: Fetch): Promise<Original | null> {
  const key = `images/${cid}`;
  const object = await env.IMAGES.get(key);
  if (object) {
    const bytes = await object.arrayBuffer();
    return { bytes, contentType: object.httpMetadata?.contentType ?? sniff(new Uint8Array(bytes)) ?? "application/octet-stream" };
  }
  if (!did) return null;
  const digest = cidDigestHex(cid);
  if (!digest) return null;
  const bytes = await fetchBlob(did, cid, get);
  if (!bytes) return null;
  if (hex(await crypto.subtle.digest("SHA-256", bytes)) !== digest) return null;
  const contentType = sniff(new Uint8Array(bytes));
  if (!contentType) return null;
  await env.IMAGES.put(key, bytes, { sha256: digest, httpMetadata: { contentType, cacheControl: IMMUTABLE } });
  return { bytes, contentType };
}

async function fetchBlob(did: string, cid: string, get: Fetch): Promise<ArrayBuffer | null> {
  let host: string;
  try {
    host = await pds(did, get);
  } catch {
    return null;
  }
  const response = await get(`${host}/xrpc/com.atproto.sync.getBlob?${new URLSearchParams({ did, cid })}`, { redirect: "manual" });
  if (!response.ok) return null;
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) return null;
  const bytes = await response.arrayBuffer();
  return bytes.byteLength > 0 && bytes.byteLength <= MAX_BYTES ? bytes : null;
}

/** A WebP `width` pixels wide, or null when Cloudflare Images can't make one (the original is served instead). */
async function resize(env: ImageEnv, bytes: ArrayBuffer, width: number): Promise<ArrayBuffer | null> {
  if (!env.IMAGES_API) return null;
  try {
    const stream = new Response(bytes).body!;
    const result = await env.IMAGES_API.input(stream)
      .transform({ width, fit: "scale-down" })
      .output({ format: "image/webp", quality: 82 });
    return await result.response().arrayBuffer();
  } catch (error) {
    console.warn(`image resize failed: ${(error as Error)?.message ?? error}`);
    return null;
  }
}

/** The accepted cover types, by their bytes: a PDS may report any content type. */
export function sniff(bytes: Uint8Array): string | null {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

/** "b" + base32(0x01 0x55 0x12 0x20 || digest) -> hex digest, or null */
export function cidDigestHex(cid: string): string | null {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const bytes: number[] = [];
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
  if (bytes[0] !== 0x01 || bytes[1] !== 0x55 || bytes[2] !== 0x12 || bytes[3] !== 0x20) return null;
  return hex(new Uint8Array(bytes.slice(4)));
}

function hex(value: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function respond(request: Request, body: ArrayBuffer, contentType: string): Response {
  const headers = { ...CORS, "content-type": contentType, "content-length": String(body.byteLength), "cache-control": IMMUTABLE };
  return new Response(request.method === "HEAD" ? null : body, { headers });
}

function text(status: number, body: string, extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...CORS, ...extra } });
}
