import { useEffect, useState } from 'react';
import { resolveArtists, type NetworkArtist } from './home-api';
import { readFollows, resolveFollowArtists } from './home-network';
import { readLocal, writeLocal } from './storage';

const expectedKey = 'plyr-next:artists-you-know';

const cache = new Map<string, { artists: NetworkArtist[]; at: number }>();

export function useNetworkArtists(did: string | null, ready: boolean) {
  const [result, setResult] = useState<{ did: string | null; artists: NetworkArtist[]; error?: string }>({ did: null, artists: [] });
  useEffect(() => {
    if (!did) return;
    const saved = cache.get(did);
    if (saved && Date.now() - saved.at < 300_000) {
      setResult({ did, artists: saved.artists });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setResult({ did, artists: [], error: "could not load artists you know. try again later" });
      controller.abort();
    }, 60_000);
    void readFollows(did, controller.signal)
      .then((follows) => resolveFollowArtists(follows, resolveArtists, controller.signal))
      .then((artists) => {
        if (controller.signal.aborted) return;
        cache.delete(did);
        cache.set(did, { artists, at: Date.now() });
        if (cache.size > 4) {
          const first = cache.keys().next().value;
          if (first) cache.delete(first);
        }
        setResult({ did, artists });
      }, (error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({ did, artists: [], error: error instanceof Error ? error.message : 'could not load artists you know.' });
          controller.abort();
        }
      }).finally(() => clearTimeout(timer));
    return () => { controller.abort(); clearTimeout(timer); };
  }, [did]);
  const settled = ready && (!did || result.did === did);
  const shown = settled && result.did === did && result.artists.length > 0;
  useEffect(() => { if (settled) writeLocal(expectedKey, shown ? '1' : '0'); }, [settled, shown]);
  if (result.did === did && did) return { ...result, loading: false };
  return { did, artists: [], error: undefined, loading: !settled && readLocal(expectedKey) === '1' };
}
