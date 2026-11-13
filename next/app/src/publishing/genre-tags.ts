import { audioOrigin } from '../downloads/manifest';
import { createPds } from '../pds';
import type { Auth } from '../auth-state';
import { genreTags, type Genre } from './upload-queue-model';

const POLL_MS = 5_000, GIVE_UP_MS = 5 * 60_000;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function genres(uri: string): Promise<Genre[] | undefined> {
  for (const started = Date.now(); Date.now() - started < GIVE_UP_MS; await sleep(POLL_MS)) {
    const response = await fetch(`${audioOrigin}/v1/genres`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uri }) }).catch(() => undefined);
    // Not configured, not indexed yet on the PDS's side, or a hiccup: keep trying until the window closes, except a refusal.
    if (response?.status === 503 || response?.status === 400) return undefined;
    const body = response?.ok ? await response.json() as { state: string; genres?: Genre[] } : undefined;
    if (body?.state === 'ready') return body.genres;
    if (body?.state === 'failed') return undefined;
  }
}

/**
 * Production's auto-tag: once the track is up, ask for genre suggestions and add the strongest to the record's tags.
 * It runs beside the queue, so the next upload doesn't wait on classification; a miss leaves the tags as they were.
 */
export async function applyGenreTags(session: () => Auth, uri: string) {
  const found = await genres(uri);
  if (!found?.length) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    const pds = createPds(session());
    const revision = await pds.myTrack(uri);
    const value = revision.value as { title?: string; album?: string; description?: string; tags?: string[] };
    const current = Array.isArray(value.tags) ? value.tags : [];
    const tags = genreTags(current, found);
    if (tags.length === current.length) return;
    try {
      await pds.editTrack(uri, { title: value.title ?? '', album: value.album ?? '', description: value.description ?? '', tags }, revision);
      return;
    } catch (failure) {
      if (attempt) throw failure;
    }
  }
}
