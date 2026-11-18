import type { Auth } from '../auth-state';
import { DOWNLOAD_AUTHORIZE_METHOD, JAM_COORDINATOR_URL, JAM_SERVICE_AUDIENCE } from '../auth-config.ts';
import { authorizeSupporterDownload as authorize } from '@plyr/next-core/downloads/supporter';

export { BUSY_RETRY_DELAYS_MS, DownloadGrantRequired, downloadDecision } from '@plyr/next-core/downloads/supporter';

export function authorizeSupporterDownload(auth: Pick<Auth, 'did' | 'agent' | 'supporterDownloads'>, record: { uri: string; cid: string },
  guard: () => void, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  return authorize({ DOWNLOAD_AUTHORIZE_METHOD, JAM_COORDINATOR_URL, JAM_SERVICE_AUDIENCE }, auth, record, guard, signal, fetcher);
}
