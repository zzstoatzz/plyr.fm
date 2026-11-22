import { useEffect, useState } from 'react';
import { resolveArtists, type NetworkArtist } from './home-api';
import { readFollowArtists } from '@plyr/next-core/home-network';
import { readLocal, writeLocal } from './storage';

const expectedKey = 'plyr-next:artists-you-know';

// fetch and graph errors arrive in browser wording ("NetworkError when attempting…"); say what failed instead
const failure = "couldn't load artists you know";
const cache = new Map<string, { artists: NetworkArtist[]; at: number }>();
const savedKey = 'plyr-next:network-artists';

/** The list this device last loaded, so a return visit draws the home shelves while the graph reloads. */
function savedArtists(did: string): NetworkArtist[] | null {
  try {
    const value: unknown = JSON.parse(readLocal(savedKey) ?? 'null');
    if (!value || typeof value !== 'object') return null;
    const saved = value as { did?: unknown; at?: unknown; artists?: unknown };
    if (saved.did !== did || typeof saved.at !== 'number' || Date.now() - saved.at > 7 * 86_400_000 || !Array.isArray(saved.artists)) return null;
    const artists = saved.artists.filter((artist: Partial<NetworkArtist> | null): artist is NetworkArtist => !!artist && typeof artist.did === 'string'
      && typeof artist.handle === 'string' && typeof artist.display_name === 'string' && typeof artist.track_count === 'number'
      && (artist.avatar_url === null || typeof artist.avatar_url === 'string'));
    return artists.length === saved.artists.length ? artists : null;
  } catch {
    return null;
  }
}

export function useNetworkArtists(did: string | null, ready: boolean) {
  const [result, setResult] = useState<{ did: string | null; artists: NetworkArtist[]; error?: string }>({ did: null, artists: [] });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!did) return;
    const saved = cache.get(did);
    if (saved && Date.now() - saved.at < 300_000) {
      setResult({ did, artists: saved.artists });
      return;
    }
    const stored = savedArtists(did);
    if (stored) setResult({ did, artists: stored });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (!stored) setResult({ did, artists: [], error: failure });
      controller.abort();
    }, 60_000);
    void readFollowArtists(did, resolveArtists, controller.signal)
      .then((artists) => {
        if (controller.signal.aborted) return;
        cache.delete(did);
        cache.set(did, { artists, at: Date.now() });
        if (cache.size > 4) {
          const first = cache.keys().next().value;
          if (first) cache.delete(first);
        }
        writeLocal(savedKey, JSON.stringify({ did, at: Date.now(), artists }));
        setResult({ did, artists });
      }, () => {
        if (!controller.signal.aborted) {
          if (!stored) setResult({ did, artists: [], error: failure });
          controller.abort();
        }
      }).finally(() => clearTimeout(timer));
    return () => { controller.abort(); clearTimeout(timer); };
  }, [did, attempt]);
  const settled = ready && (!did || result.did === did);
  const shown = settled && result.did === did && result.artists.length > 0;
  useEffect(() => { if (settled) writeLocal(expectedKey, shown ? '1' : '0'); }, [settled, shown]);
  const retry = () => { setResult({ did: null, artists: [] }); setAttempt(value => value + 1); };
  if (result.did === did && did) return { ...result, loading: false, retry };
  return { did, artists: [], error: undefined, loading: !settled && readLocal(expectedKey) === '1', retry };
}
