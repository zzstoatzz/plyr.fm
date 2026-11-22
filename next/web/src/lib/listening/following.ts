import { followingLatest } from '@plyr/next-core/following-latest';
import { api } from '$lib/api';
import { auth } from '$lib/auth';
import { saveShelf } from './saved-shelf';

type Result = Awaited<ReturnType<typeof followingLatest>>;

const memory = new Map<string, { at: number; result: Result }>();
const loading = new Map<string, Promise<Result>>();

/** One load per account at a time: the shelf asks before and after sign-in restores, and both share it. */
export function newFromFollows(did: string, refresh = false): Promise<Result> {
  const saved = memory.get(did);
  if (!refresh && saved && Date.now() - saved.at < 300_000) return Promise.resolve(saved.result);
  const pending = loading.get(did);
  if (pending) return pending;
  const load = followingLatest(did, api, new AbortController().signal).then(result => {
    if (!result.failed) {
      memory.delete(did);
      memory.set(did, { at: Date.now(), result });
      if (memory.size > 4) { const first = memory.keys().next().value; if (first) memory.delete(first); }
      const now = auth.getAuth();
      if (!now.ready || now.did === did) saveShelf({ did, at: Date.now(), tracks: result.tracks });
    }
    return result;
  }).finally(() => loading.delete(did));
  loading.set(did, load);
  return load;
}
