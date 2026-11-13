import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import { parseGenres, routeGenres } from "./genres.ts";
import type { GenreEnv } from "./genres.ts";

const did = "did:plc:abcdefghijklmnopqrstuvwx";
const self = "https://audio.example";

function world(record: Record<string, unknown>, status = "succeeded") {
  const calls: string[] = [];
  const get = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url === `https://plc.directory/${did}`) return Response.json({ service: [{ id: "#atproto_pds", serviceEndpoint: "https://pds.example/" }] });
    if (url.startsWith("https://pds.example/xrpc/com.atproto.repo.getRecord")) return Response.json({ value: record });
    if (url === "https://api.replicate.com/v1/predictions") return Response.json({ id: "p1", status: "starting" });
    if (url === "https://api.replicate.com/v1/predictions/p1") return Response.json({ status, output: status === "succeeded" ? "https://replicate.example/out.json" : undefined });
    if (url === "https://replicate.example/out.json") return Response.json({ "Electronic---Ambient": 0.61, "Electronic---Downtempo": 0.3, "Rock---Post Rock": 0.12 });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { calls, get };
}

const genreEnv = (token = "r8_test") => ({ AUDIO: env.AUDIO, UPLOAD_ALLOWED_ORIGINS: "https://next.plyr.fm", REPLICATE_API_TOKEN: token }) as GenreEnv;
const ask = (uri: string, get: typeof fetch, configured = genreEnv()) =>
  routeGenres(new Request(`${self}/v1/genres`, { method: "POST", headers: { origin: "https://next.plyr.fm", "content-type": "application/json" }, body: JSON.stringify({ uri }) }), configured, get).then(response => response!);

test("discogs pairs split into separate tags, best score first", () => {
  expect(parseGenres({ "Electronic---Ambient": 0.6, "Electronic---Techno": 0.7, "Jazz": 0.1 })).toEqual([
    { name: "electronic", confidence: 0.7 }, { name: "techno", confidence: 0.7 }, { name: "ambient", confidence: 0.6 }, { name: "jazz", confidence: 0.1 },
  ]);
});

test("a blob track is classified once: the first call starts a prediction, later calls read it, then the saved result", async () => {
  const { calls, get } = world({ audioBlob: { ref: { $link: `bafkrei${crypto.randomUUID().replaceAll("-", "")}` } } });
  const uri = `at://${did}/fm.plyr.track/3mblob${crypto.randomUUID().slice(0, 8)}`;
  expect(await (await ask(uri, get)).json()).toEqual({ state: "pending" });
  const ready = await (await ask(uri, get)).json() as { state: string; genres: { name: string }[] };
  expect(ready.state).toBe("ready");
  expect(ready.genres.map(genre => genre.name)).toEqual(["electronic", "ambient", "downtempo", "rock", "post rock"]);
  expect(await (await ask(uri, get)).json()).toEqual(ready);
  expect(calls.filter(call => call.includes("replicate.com"))).toEqual(["POST https://api.replicate.com/v1/predictions", "GET https://api.replicate.com/v1/predictions/p1"]);
});

test("a failed prediction is remembered rather than retried", async () => {
  const { calls, get } = world({ audioBlob: { ref: { $link: `bafkrei${crypto.randomUUID().replaceAll("-", "")}` } } }, "failed");
  const uri = `at://${did}/fm.plyr.track/3mfail`;
  await ask(uri, get);
  expect(await (await ask(uri, get)).json()).toEqual({ state: "failed" });
  expect(await (await ask(uri, get)).json()).toEqual({ state: "failed" });
  expect(calls.filter(call => call.includes("replicate.com")).length).toBe(2);
});

test("plyr storage audio is classified only when served here, and other collections or a missing token are refused", async () => {
  const id = crypto.randomUUID();
  const own = world({ audioUrl: `${self}/media/${"a".repeat(64)}/${id}` });
  expect((await ask(`at://${did}/fm.plyr.track/3mown${id.slice(0, 6)}`, own.get)).status).toBe(200);
  expect(own.calls.find(call => call.startsWith("POST https://api.replicate.com"))).toBeTruthy();
  const elsewhere = world({ audioUrl: "https://evil.example/huge.wav" });
  expect((await ask(`at://${did}/fm.plyr.track/3mevil`, elsewhere.get)).status).toBe(404);
  expect(elsewhere.calls.some(call => call.includes("replicate.com"))).toBe(false);
  expect((await ask(`at://${did}/app.bsky.feed.post/3mpost`, own.get)).status).toBe(404);
  expect((await ask(`at://${did}/fm.plyr.track/3mown`, own.get, genreEnv(""))).status).toBe(503);
});
