import type { Track } from '../api';
import { getAuth, type Auth } from '../auth-state';
import { resolveGatedAudio } from '../gated-audio-shared';
import { protectedTransport } from './protected-transport';
import { protectedDownloadPolicy, requireProtectedReference } from './protected-policy';

export async function prepareProtectedDownload(track: Track, uri: string, auth: Auth, signal: AbortSignal) {
  function guard() {
    signal.throwIfAborted();
    const current = getAuth();
    if (!auth.did || !auth.agent) throw new Error('sign in to download this protected track.');
    if (current.did !== auth.did || current.agent !== auth.agent || current.rpc !== auth.rpc) throw new Error('account changed. try the download again.');
  }
  guard();
  requireProtectedReference(track, uri);
  let policy: 'open' | 'ask' | undefined;
  const transport = { ...protectedTransport, guard, async fetch(url: string, init: RequestInit) {
    // Credential minting is shared with playback; only this download's reads are cancellable.
    if (new URL(url).pathname === '/xrpc/com.atproto.space.getSpaceCredential') return protectedTransport.fetch(url, init);
    guard();
    const response = await protectedTransport.fetch(url, { ...init, signal, cache: 'no-store' });
    try { guard(); } catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
    return response;
  } };
  const source = await resolveGatedAudio(uri, auth, transport, record => { guard(); policy = protectedDownloadPolicy(record); });
  guard();
  if (!policy) throw new Error('downloads are unavailable for this protected track.');
  return { kind: 'protected' as const, mime: source.mimeType, sizeBytes: source.size, policy, guard,
    async open() {
      guard();
      const headers = await source.headers();
      return transport.fetch(source.url, { headers, redirect: 'error' });
    }
  };
}
