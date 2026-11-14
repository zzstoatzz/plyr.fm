import { useEffect, useState } from 'react';
import { resolveArtists, type NetworkArtist } from './home-api';
import { readFollows, resolveFollowArtists } from './home-network';
import { readLocal, writeLocal } from './storage';

const expectedKey = 'plyr-next:artists-you-know';

// fetch and graph errors arrive in browser wording ("NetworkError when attempting…"); say what failed instead
const failure = "couldn't load artists you know";
const cache = new Map<string, { artists: NetworkArtist[]; at: number }>();

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
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setResult({ did, artists: [], error: failure });
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
      }, () => {
        if (!controller.signal.aborted) {
          setResult({ did, artists: [], error: failure });
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
