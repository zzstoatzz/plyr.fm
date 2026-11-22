import { expect, test } from "vitest";
import { cidDigestHex, routeImages, sniff } from "./images.ts";

const did = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const png: Uint8Array<ArrayBuffer> = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function cidFor(bytes: Uint8Array<ArrayBuffer>) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const raw = [0x01, 0x55, 0x12, 0x20, ...digest];
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let out = "b", buffer = 0, bits = 0;
  for (const byte of raw) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) { bits -= 5; out += alphabet[(buffer >> bits) & 31]; }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += alphabet[(buffer << (5 - bits)) & 31];
  return out;
}

function bucket() {
  const objects = new Map<string, { bytes: ArrayBuffer; contentType?: string }>();
  return {
    objects,
    async get(key: string) {
      const object = objects.get(key);
      return object ? { arrayBuffer: async () => object.bytes, httpMetadata: { contentType: object.contentType } } : null;
    },
    async put(key: string, value: ArrayBuffer, options: { httpMetadata?: { contentType?: string } }) {
      objects.set(key, { bytes: value, contentType: options.httpMetadata?.contentType });
    },
  };
}

function pdsServing(blob: Uint8Array<ArrayBuffer>, calls: string[] = []) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url === `https://plc.directory/${did}`) return Response.json({ service: [{ id: "#atproto_pds", serviceEndpoint: "https://pds.example/" }] });
    if (url.startsWith("https://pds.example/xrpc/com.atproto.sync.getBlob?")) return new Response(blob, { headers: { "content-type": "video/mp4" } });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}

test("copies a verified cover off the PDS once, then serves it from R2", async () => {
  const cid = await cidFor(png);
  const env = { IMAGES: bucket() };
  const calls: string[] = [];
  const first = await routeImages(new Request(`https://w.example/images/${cid}?did=${did}`), env as never, pdsServing(png, calls));
  expect(first!.status).toBe(200);
  expect(first!.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await first!.arrayBuffer())).toEqual(png);
  expect(env.IMAGES.objects.has(`images/${cid}`)).toBe(true);

  const again = await routeImages(new Request(`https://w.example/images/${cid}?did=${did}`), env as never, pdsServing(png, calls));
  expect(again!.status).toBe(200);
  expect(calls.filter(url => url.includes("getBlob")).length).toBe(1);
});

test("refuses bytes that don't hash to the CID", async () => {
  const cid = await cidFor(png);
  const env = { IMAGES: bucket() };
  const tampered: Uint8Array<ArrayBuffer> = new Uint8Array([...png.slice(0, -1), 9]);
  const response = await routeImages(new Request(`https://w.example/images/${cid}?did=${did}`), env as never, pdsServing(tampered));
  expect(response!.status).toBe(404);
  expect(env.IMAGES.objects.size).toBe(0);
});

test("stores each sized variant once and falls back to the original without the Images binding", async () => {
  const cid = await cidFor(png);
  const made: number[] = [];
  const IMAGES_API = {
    input: () => ({
      transform: ({ width }: { width: number }) => ({
        output: async () => { made.push(width); return { response: () => new Response("webp-bytes") }; },
      }),
    }),
  };
  const env = { IMAGES: bucket(), IMAGES_API };
  for (let i = 0; i < 2; i++) {
    const response = await routeImages(new Request(`https://w.example/images/${cid}?did=${did}&w=320`), env as never, pdsServing(png));
    expect(response!.headers.get("content-type")).toBe("image/webp");
    expect(await response!.text()).toBe("webp-bytes");
  }
  expect(made).toEqual([320]);

  const plain = { IMAGES: env.IMAGES };
  const fallback = await routeImages(new Request(`https://w.example/images/${cid}?w=640`), plain as never, pdsServing(png));
  expect(fallback!.headers.get("content-type")).toBe("image/png");
});

test("rejects odd widths and DIDs, and ignores other paths", async () => {
  const cid = await cidFor(png);
  const env = { IMAGES: bucket() };
  expect((await routeImages(new Request(`https://w.example/images/${cid}?w=333`), env as never))!.status).toBe(400);
  expect((await routeImages(new Request(`https://w.example/images/${cid}?did=did:key:x`), env as never))!.status).toBe(400);
  expect((await routeImages(new Request(`https://w.example/images/${cid}`), env as never))!.status).toBe(404);
  expect(await routeImages(new Request(`https://w.example/audio/${cid}`), env as never)).toBe(null);
});

test("sniffs the accepted cover types and decodes raw CIDs", async () => {
  expect(sniff(png)).toBe("image/png");
  expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
  expect(sniff(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]))).toBe(null);
  const cid = await cidFor(png);
  expect(cidDigestHex(cid)?.length).toBe(64);
  expect(cidDigestHex("bafyreibad")).toBe(null);
});
