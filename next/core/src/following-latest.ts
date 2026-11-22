import type { NetworkArtist, Page, Track } from './api.ts';
import { readFollowArtists } from './home-network.ts';

export async function followingLatest(actor: string, api: {
  resolveArtists(dids: string[], signal: AbortSignal): Promise<NetworkArtist[]>;
  tracks(options: { artist_did: string; limit: number }, signal: AbortSignal): Promise<Page<Track>>;
}, signal: AbortSignal, request: typeof fetch = fetch) {
  const artists = (await readFollowArtists(actor, api.resolveArtists, signal, request)).slice(0, 12);
  signal.throwIfAborted();
  const tracks: Track[] = [];
  let failed = 0;
  // twelve one-row reads: all at once costs one round trip instead of four
  await Promise.all(artists.map(async (artist) => {
    try {
      const page = await api.tracks({ artist_did: artist.did, limit: 1 }, signal);
      const track = page.data[0];
      if (track) tracks.push({ ...track, artist: { ...track.artist, profile: { ...track.artist.profile, avatar_url: artist.avatar_url } } });
    } catch { if (!signal.aborted) failed++; }
  }));
  signal.throwIfAborted();
  tracks.sort((a, b) => b.metadata.created_at.localeCompare(a.metadata.created_at));
  return { tracks, failed };
}
