/**
 * Genre suggestions for a published track, as production makes them: Replicate's effnet-discogs model, top 10.
 *
 *   POST /v1/genres {uri}  → { state: "pending" | "ready" | "failed", genres? }
 *
 * The worker reads the track record from its own PDS to find the audio, so a caller can only ask about audio a record
 * already names. Each audio source is classified once; R2 keeps the prediction id and then the result. The client
 * applies the tags to its own record; nothing here writes one.
 */

const MODEL_VERSION = "1532dd069fb4f0e27c6833e28815f6b8c194dfec76fd9cd73460540fd720ffe1";
const REPLICATE = "https://api.replicate.com/v1/predictions";
const TOP_N = 10;
const STALE_MS = 15 * 60_000;

export interface GenreEnv {
  AUDIO: R2Bucket;
  UPLOAD_ALLOWED_ORIGINS: string;
  REPLICATE_API_TOKEN?: string;
  TRACK_COLLECTIONS?: string;
}
export type Genre = { name: string; confidence: number };
type Entry = { prediction?: string; startedAt: number; genres?: Genre[]; failed?: boolean };
type Fetch = typeof fetch;

/** Discogs names pair a genre with a subgenre ("Electronic---Deep Techno"); keep each as its own tag, best score wins. */
export function parseGenres(output: Record<string, number>): Genre[] {
  const best = new Map<string, number>();
  for (const [raw, score] of Object.entries(output)) {
    if (typeof score !== "number" || !Number.isFinite(score)) continue;
    for (const name of raw.split("---", 2).map(part => part.trim().toLowerCase()).filter(Boolean))
      if ((best.get(name) ?? -1) < score) best.set(name, Math.round(score * 10_000) / 10_000);
  }
  return [...best].map(([name, confidence]) => ({ name, confidence })).sort((a, b) => b.confidence - a.confidence);
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`${response.url} ${response.status}`);
  return await response.json() as T;
}

async function pds(did: string, get: Fetch) {
  const url = did.startsWith("did:plc:") ? `https://plc.directory/${did}`
    : did.startsWith("did:web:") ? `https://${did.slice(8)}/.well-known/did.json` : null;
  if (!url) throw new Error("unsupported did");
  const doc = await json<{ service?: { id: string; serviceEndpoint: string }[] }>(await get(url));
  const endpoint = doc.service?.find(service => service.id.endsWith("#atproto_pds"))?.serviceEndpoint;
  if (!endpoint?.startsWith("https://")) throw new Error("no PDS");
  return endpoint.replace(/\/$/, "");
}

/** The public URL Replicate should fetch: the record's playback audio or its PDS blob. */
export async function trackAudio(uri: string, collections: string[], origin: string, get: Fetch = fetch) {
  const match = /^at:\/\/(did:(?:plc:[a-z2-7]{24}|web:[a-zA-Z0-9.-]+))\/([a-zA-Z0-9.]+)\/([a-zA-Z0-9._:~-]{1,512})$/.exec(uri);
  if (!match || !collections.includes(match[2])) return null;
  const [, did, collection, rkey] = match;
  const host = await pds(did, get);
  const query = new URLSearchParams({ repo: did, collection, rkey });
  const record = await get(`${host}/xrpc/com.atproto.repo.getRecord?${query}`);
  if (record.status === 400 || record.status === 404) return null;
  const value = (await json<{ value?: { audioUrl?: unknown; audioBlob?: { ref?: { $link?: unknown } } } }>(record)).value;
  // Only plyr storage audio served here; a record cannot point the classifier at an arbitrary address.
  if (typeof value?.audioUrl === "string") return value.audioUrl.startsWith(`${origin}/media/`) ? value.audioUrl : null;
  const cid = value?.audioBlob?.ref?.$link;
  return typeof cid === "string" ? `${host}/xrpc/com.atproto.sync.getBlob?${new URLSearchParams({ did, cid })}` : null;
}

async function sourceKey(source: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return `genres/${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}.json`;
}

export async function genresFor(source: string, env: GenreEnv, get: Fetch = fetch, now = Date.now): Promise<{ state: "pending" | "ready" | "failed"; genres?: Genre[] }> {
  const key = await sourceKey(source);
  const saved = await env.AUDIO.get(key);
  let entry: Entry | null = saved ? await saved.json<Entry>() : null;
  if (entry?.genres) return { state: "ready", genres: entry.genres };
  if (entry?.failed) return { state: "failed" };
  const headers = { authorization: `Bearer ${env.REPLICATE_API_TOKEN}`, "content-type": "application/json" };
  if (entry?.prediction) {
    const prediction = await json<{ status: string; output?: unknown }>(await get(`${REPLICATE}/${entry.prediction}`, { headers }));
    if (prediction.status === "succeeded" && typeof prediction.output === "string") {
      entry = { ...entry, genres: parseGenres(await json<Record<string, number>>(await get(prediction.output))) };
    } else if (["failed", "canceled"].includes(prediction.status) || now() - entry.startedAt > STALE_MS) {
      entry = { ...entry, failed: true };
    } else return { state: "pending" };
  } else {
    const prediction = await json<{ id: string }>(await get(REPLICATE, {
      method: "POST", headers,
      body: JSON.stringify({ version: MODEL_VERSION, input: { audio: source, top_n: TOP_N, output_format: "JSON" } }),
    }));
    entry = { prediction: prediction.id, startedAt: now() };
  }
  await env.AUDIO.put(key, JSON.stringify(entry), { httpMetadata: { contentType: "application/json" } });
  return entry.genres ? { state: "ready", genres: entry.genres } : entry.failed ? { state: "failed" } : { state: "pending" };
}

export async function routeGenres(request: Request, env: GenreEnv, get: Fetch = fetch): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/v1/genres") return null;
  const origin = request.headers.get("origin");
  if (origin && !env.UPLOAD_ALLOWED_ORIGINS.split(",").map(value => value.trim()).includes(origin)) return new Response(null, { status: 403 });
  const cors = { "access-control-allow-origin": origin ?? "null", vary: "origin" };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" } });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: cors });
  if (!env.REPLICATE_API_TOKEN) return Response.json({ error: "genre suggestions are not configured" }, { status: 503, headers: cors });
  const body = await request.json().catch(() => null) as { uri?: unknown } | null;
  if (typeof body?.uri !== "string") return Response.json({ error: "uri required" }, { status: 400, headers: cors });
  try {
    const source = await trackAudio(body.uri, (env.TRACK_COLLECTIONS ?? "fm.plyr.track").split(","), new URL(request.url).origin, get);
    if (!source) return Response.json({ error: "track not found" }, { status: 404, headers: cors });
    return Response.json(await genresFor(source, env, get), { headers: cors });
  } catch {
    return Response.json({ error: "genre suggestions unavailable" }, { status: 502, headers: cors });
  }
}
