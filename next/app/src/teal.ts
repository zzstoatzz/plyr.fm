import type { Track } from '@plyr/next-core/api';
import type { QualifiedPlay } from '@plyr/next-core/listening-session';
import { RepoResponseError } from '@plyr/next-core/publishing/repo-rpc';
import { tealPlay, writeTealPlay } from '@plyr/next-core/teal-scrobble';
import { canScrobble } from './auth';
import { SITE_URL } from './auth-config';
import { getAuth } from './auth-state';

export async function scrobble(track: Track, play: QualifiedPlay, confirmConsent: () => Promise<boolean>) {
  const { did, rpc } = getAuth();
  if (!did || !rpc || !canScrobble()) return;
  const record = tealPlay(track, play, Date.now(), `${SITE_URL}/track/${encodeURIComponent(track.id)}`);
  if (!record) return;
  for (const delay of [0, 1000, 4000]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (!await confirmConsent().catch(() => false) || getAuth().rpc !== rpc || !canScrobble()) return;
    try {
      await writeTealPlay(rpc, did, record);
      return;
    } catch (error) {
      if (error instanceof RepoResponseError && error.status < 500 && error.status !== 429) return;
    }
  }
}
