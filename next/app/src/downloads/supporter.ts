import type { Auth } from '../auth-state';
import { DOWNLOAD_AUTHORIZE_METHOD, JAM_COORDINATOR_URL, JAM_SERVICE_AUDIENCE } from '../auth-config.ts';

export class DownloadGrantRequired extends Error {
  constructor() { super('sign in again to allow supporter download checks.'); }
}

type RecordReference = { uri: string; cid: string };
export function downloadDecision(value: unknown, viewer: string, record: RecordReference, now = Date.now()) {
  if (!value || typeof value !== 'object' || !('viewer' in value) || value.viewer !== viewer
    || !('recordUri' in value) || value.recordUri !== record.uri || !('recordCid' in value) || value.recordCid !== record.cid
    || !('downloadPolicy' in value) || value.downloadPolicy !== 'supporters' || !('expiresAt' in value)
    || typeof value.expiresAt !== 'number' || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + 30_000) throw new Error('could not verify download access. try again.');
  return { expiresAt: value.expiresAt };
}

export async function authorizeSupporterDownload(auth: Pick<Auth, 'did' | 'agent' | 'supporterDownloads'>, record: RecordReference,
  guard: () => void, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  if (!auth.did || !auth.agent || !auth.supporterDownloads) throw new DownloadGrantRequired();
  guard();
  const controller = new AbortController(), abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 25_000);
  try {
    signal.throwIfAborted();
    const identity = await auth.agent.handle(`/xrpc/com.atproto.server.getServiceAuth?${new URLSearchParams({ aud: JAM_SERVICE_AUDIENCE, lxm: DOWNLOAD_AUTHORIZE_METHOD })}`, { signal: controller.signal });
    guard();
    if (!identity.ok) throw new Error('could not verify your account for this download. reconnect and try again.');
    const service: unknown = await identity.json();
    if (!service || typeof service !== 'object' || !('token' in service) || typeof service.token !== 'string' || !service.token || service.token.length > 8192) throw new Error('could not verify download access. try again.');
    guard();
    const response = await fetcher(`${JAM_COORDINATOR_URL}/v1/downloads/authorize`, { method: 'POST', signal: controller.signal, redirect: 'error', cache: 'no-store', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serviceToken: service.token, recordUri: record.uri, recordCid: record.cid }) });
    guard();
    if (!response.ok) throw new Error(response.status === 409 ? 'this track changed. try the download again.' : response.status === 503 ? 'download access checks are unavailable. try again.' : 'could not authorize this download.');
    const value: unknown = await response.json();
    const decision = downloadDecision(value, auth.did, record);
    guard();
    return { guard, begin() {
      guard();
      if (Date.now() >= decision.expiresAt) throw new Error('download access expired. try again.');
    } };
  } catch (error) {
    if (controller.signal.aborted && !signal.aborted) throw new Error('download access checks timed out. try again.');
    throw error;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
