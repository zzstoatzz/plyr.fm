import type { Track } from '../api';
import type { Auth } from '../auth-state';
import { resolveGatedAudio } from '../gated-audio-shared';
import { protectedTransport } from './protected-transport';
import { protectedDownloadPolicy, requireProtectedReference } from './protected-policy';
import { downloadSession } from './session';
import type { DownloadAdmission } from './model';

export async function prepareProtectedDownload(track: Track, uri: string, auth: Auth, signal: AbortSignal, admission?: DownloadAdmission) {
  const guard = downloadSession(auth, signal);
  guard();
  requireProtectedReference(track, uri);
  let policy: 'open' | 'ask' | 'supporters' | undefined;
  const transport = { ...protectedTransport, guard, async fetch(url: string, init: RequestInit) {
    // Credential minting is shared with playback; only this download's reads are cancellable.
    if (new URL(url).pathname === '/xrpc/com.atproto.space.getSpaceCredential') return protectedTransport.fetch(url, init);
    guard();
    const response = await protectedTransport.fetch(url, { ...init, signal, cache: 'no-store' });
    try { guard(); } catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
    return response;
  } };
  const source = await resolveGatedAudio(uri, auth, transport, record => { guard(); admission?.begin(); policy = protectedDownloadPolicy(record, !!admission); });
  guard();
  if (!policy) throw new Error('downloads are unavailable for this protected track.');
  return { kind: 'protected' as const, mime: source.mimeType, sizeBytes: source.size, policy, guard,
    async open() {
      guard();
      admission?.begin();
      const headers = await source.headers();
      admission?.begin();
      return transport.fetch(source.url, { headers, redirect: 'error' });
    }
  };
}
