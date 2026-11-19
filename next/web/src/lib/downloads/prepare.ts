import { ApiError, type Track } from '@plyr/next-core/api';
import type { Auth } from '@plyr/next-core/auth-state';
import { prepareDownload } from '@plyr/next-core/downloads/model';
import { authorizeSupporterDownload } from '@plyr/next-core/downloads/supporter';
import { api } from '$lib/api';
import { authConfig } from '$lib/auth-config';
import { prepareProtectedDownload } from './protected';
import { downloadSession } from './session';

export { saveDownload } from './delivery';
export { DownloadGrantRequired } from '@plyr/next-core/downloads/supporter';

export function prepareTrackDownload(track: Track, account: Auth<unknown>, signal: AbortSignal) {
  return prepareDownload(track.id, track.record.uri, {
    track: id => api.track(id, { fresh: true }), artist: api.artist,
    playback: id => api.playback(id, { fresh: true }).catch(error => {
      if (error instanceof ApiError && error.status === 401) throw new Error('this track has no supported download source.');
      throw error;
    }),
    authorize: record => authorizeSupporterDownload(authConfig, account, record, downloadSession(account, signal), signal),
    protected: (latest, uri, admission) => prepareProtectedDownload(latest, uri, account, signal, admission)
  }, signal);
}
