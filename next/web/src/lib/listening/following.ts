import { followingLatest } from '@plyr/next-core/following-latest';
import { api } from '$lib/api';

const cache = new Map<string, { at: number; result: Awaited<ReturnType<typeof followingLatest>> }>();
export async function newFromFollows(did: string, signal: AbortSignal, refresh = false) {
  const saved = cache.get(did);
  if (!refresh && saved && Date.now() - saved.at < 300_000) return saved.result;
  const result = await followingLatest(did, api, signal);
  if (!signal.aborted && !result.failed) {
    cache.delete(did);
    cache.set(did, { at: Date.now(), result });
    if (cache.size > 4) { const first = cache.keys().next().value; if (first) cache.delete(first); }
  }
  return result;
}
