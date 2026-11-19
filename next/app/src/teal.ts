import type { Track } from '@plyr/next-core/api';
import type { QualifiedPlay } from '@plyr/next-core/listening-session';
import { RepoResponseError } from '@plyr/next-core/publishing/repo-rpc';
import { tealPlay, tealStatusWriter, writeTealPlay, writeTealStatus } from '@plyr/next-core/teal-scrobble';
import { canScrobble } from './auth';
import { SITE_URL } from './auth-config';
import { getAuth, type Did } from './auth-state';

export async function scrobble(track: Track, play: QualifiedPlay, expectedDid: Did | null, confirmConsent: (did: Did) => Promise<boolean>) {
  const { did, rpc } = getAuth();
  if (!did || did !== expectedDid || !rpc || !canScrobble()) return;
  const record = tealPlay(track, play, Date.now(), `${SITE_URL}/track/${encodeURIComponent(String(track.legacy_id ?? track.id))}`);
  if (!record) return;
  for (const delay of [0, 1000, 4000]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (!await confirmConsent(did).catch(() => false) || getAuth().rpc !== rpc || !canScrobble()) return;
    try {
      await writeTealPlay(rpc, did, record);
      return;
    } catch (error) {
      if (error instanceof RepoResponseError && error.status < 500 && error.status !== 429) return;
    }
  }
}

let statusAccount: Did | null = null;
let statusConsent: (did: Did) => Promise<boolean> = async () => false;
const nowPlaying = tealStatusWriter({
  origin: track => `${SITE_URL}/track/${encodeURIComponent(String(track.legacy_id ?? track.id))}`,
  write: async record => {
    const { did, rpc } = getAuth();
    if (!did || did !== statusAccount || !rpc || !canScrobble() || !await statusConsent(did).catch(() => false) || getAuth().rpc !== rpc) return;
    await writeTealStatus(rpc, did, record);
  },
});

/** keep the listener's teal.fm "now playing" in step with the player */
export function showNowPlaying(track: Track | null, playing: boolean, positionSeconds: number, expectedDid: Did | null, confirmConsent: (did: Did) => Promise<boolean>) {
  statusConsent = confirmConsent;
  if (expectedDid !== statusAccount) {
    statusAccount = expectedDid;
    nowPlaying.reset();
  }
  nowPlaying.observe({ track, playing, positionSeconds });
}
