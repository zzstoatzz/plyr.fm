import type { Track } from './api.ts';
import { readFollows } from './home-network.ts';

export const followingShelfSize = 12;

// the appview refuses a whole batch for one malformed DID, so leave those out
const didSyntax = /^did:[a-z]+:[a-zA-Z0-9._:%-]*[a-zA-Z0-9._-]$/;

/**
 * The newest track from each person `actor` follows, newest first: each page of
 * the follow graph asks the appview for its people's newest tracks while the
 * next page loads, so the shelf costs one round trip after the graph.
 */
export async function followingLatest(actor: string, api: {
  latestTracks(dids: string[], limit: number, signal: AbortSignal): Promise<Track[]>;
}, signal: AbortSignal, request: typeof fetch = fetch) {
  let failed = 0;
  const lookups: Promise<Track[]>[] = [];
  const follows = await readFollows(actor, signal, request, (page) => {
    const dids = page.map(follow => follow.did).filter(did => did.length <= 2048 && didSyntax.test(did));
    if (!dids.length) return;
    lookups.push(api.latestTracks(dids, followingShelfSize, signal).catch(() => {
      if (!signal.aborted) failed++;
      return [];
    }));
  }).catch(async (error: unknown) => {
    await Promise.allSettled(lookups);
    throw error;
  });
  const found = (await Promise.all(lookups)).flat();
  signal.throwIfAborted();
  const avatars = new Map(follows.map(follow => [follow.did, follow.avatar]));
  const newest = new Map<string, Track>();
  for (const track of found) {
    if (!avatars.has(track.artist.did)) continue;
    const seen = newest.get(track.artist.did);
    if (!seen || track.metadata.created_at > seen.metadata.created_at) newest.set(track.artist.did, track);
  }
  const tracks = [...newest.values()]
    .sort((a, b) => b.metadata.created_at.localeCompare(a.metadata.created_at))
    .slice(0, followingShelfSize)
    .map(track => ({ ...track, artist: { ...track.artist, profile: { ...track.artist.profile, avatar_url: avatars.get(track.artist.did) ?? track.artist.profile.avatar_url } } }));
  return { tracks, failed };
}
