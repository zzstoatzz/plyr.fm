import { catalogChanged } from '@plyr/next-core/catalog/changes';
import { pdsEndpoint } from '@plyr/next-core/identity';
import { createPdsAudioStore, type PdsAudioSnapshot } from '@plyr/next-core/publishing/pds-audio-store';
import { auth } from '$lib/auth';
import { authConfig } from '$lib/auth-config';

const store = createPdsAudioStore({
  getAuth: auth.getAuth,
  subscribeAuth: auth.subscribe,
  collection: authConfig.NSID.track as `${string}.${string}.${string}`,
  pdsEndpoint,
  storage: {
    read(key) { try { return localStorage.getItem(key); } catch { return null; } },
    write(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } }
  },
  onMoved: did => catalogChanged(did, 'tracks')
});

let snapshot = $state.raw<PdsAudioSnapshot>(store.snapshot);
store.subscribe(() => { snapshot = store.snapshot; });

/** Audio of yours that isn't on your PDS; shared by the sign-in ask and the card on the you page. */
export const pdsAudio = {
  get state() { return snapshot; },
  check: store.check, moveAll: store.moveAll, dismiss: store.dismiss, markAsked: store.markAsked, close: store.close
};
