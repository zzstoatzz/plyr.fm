import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { readLocal, writeLocal } from './storage';

const key = (did: string) => `plyr-next:avatar:${did}`;

/**
 * The signed-in person's avatar, straight from their Bluesky profile. It paints from the last one seen,
 * then rereads the profile when the app opens and each time it comes back to the foreground, so a new picture shows without a reload.
 */
export function useMyAvatar(did: string | null): string | undefined {
  const [avatar, setAvatar] = useState<{ did: string; url?: string }>();
  useEffect(() => {
    if (!did) return;
    setAvatar({ did, url: readLocal(key(did)) || undefined });
    let controller: AbortController | undefined;
    const refresh = () => {
      controller?.abort();
      controller = new AbortController();
      const url = new URL('https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile');
      url.searchParams.set('actor', did);
      fetch(url, { signal: controller.signal }).then(response => response.ok ? response.json() : undefined).then((profile: { avatar?: unknown } | undefined) => {
        if (!profile) return;
        const next = typeof profile.avatar === 'string' ? profile.avatar : '';
        writeLocal(key(did), next);
        setAvatar({ did, url: next || undefined });
      }, () => undefined);
    };
    refresh();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { controller?.abort(); subscription.remove(); };
  }, [did]);
  return avatar?.did === did ? avatar.url : undefined;
}
