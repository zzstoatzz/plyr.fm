import type { NetworkArtist, Page, Track } from './api.ts';
import { readFollows, resolveFollowArtists } from './home-network.ts';

export async function followingLatest(actor: string, api: {
  resolveArtists(dids: string[], signal: AbortSignal): Promise<NetworkArtist[]>;
  tracks(options: { artist_did: string; limit: number }, signal: AbortSignal): Promise<Page<Track>>;
}, signal: AbortSignal, request: typeof fetch = fetch) {
  const follows = await readFollows(actor, signal, request);
  const artists = (await resolveFollowArtists(follows, api.resolveArtists, signal)).slice(0, 12);
  const tracks: Track[] = [];
  let failed = 0;
  let next = 0;
  async function worker() {
    while (next < artists.length) {
      if (signal.aborted) return;
      const artist = artists[next++];
      try {
        const page = await api.tracks({ artist_did: artist.did, limit: 1 }, signal);
        const track = page.data[0];
        if (track) tracks.push({ ...track, artist: { ...track.artist, profile: { ...track.artist.profile, avatar_url: artist.avatar_url } } });
      } catch { if (!signal.aborted) failed++; }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  signal.throwIfAborted();
  tracks.sort((a, b) => b.metadata.created_at.localeCompare(a.metadata.created_at));
  return { tracks, failed };
}
