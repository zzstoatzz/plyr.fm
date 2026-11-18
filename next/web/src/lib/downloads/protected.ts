import { P256Keypair } from '@atproto/crypto';
import type { Track } from '@plyr/next-core/api';
import type { Auth } from '@plyr/next-core/auth-state';
import { isSpaceCredentialRequest } from '@plyr/next-core/gated-audio';
import type { DownloadAdmission } from '@plyr/next-core/downloads/model';
import { protectedDownloadPolicy, requireProtectedReference } from '@plyr/next-core/downloads/protected-policy';
import { resolveGatedAudio } from '$lib/media/gated-audio';
import { downloadSession } from './session';

export async function prepareProtectedDownload(track: Track, uri: string, auth: Auth<unknown>, signal: AbortSignal, admission?: DownloadAdmission) {
  const guard = downloadSession(auth, signal);
  guard();
  requireProtectedReference(track, uri);
  let policy: 'open' | 'ask' | 'supporters' | undefined;
  const transport = { guard, keypair: () => P256Keypair.create(), async fetch(url: string, init: RequestInit) {
    // Credential minting is shared with playback; only this download's reads are cancellable.
    if (isSpaceCredentialRequest(url)) return fetch(url, init);
    guard();
    const response = await fetch(url, { ...init, signal, cache: 'no-store' });
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
