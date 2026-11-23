import type { Playback, Track } from './api.ts';
import type { Auth } from './auth-state.ts';
import type { UploadConfig } from './publishing/upload-transport.ts';

type Account = Pick<Auth<unknown>, 'did' | 'agent' | 'uploadStorage'>;

/** A production track that only its supporters could play: next has no supporter check for it, so only its artist can. */
export function isOwnerOnlyTrack(track: Pick<Track, 'access'>): boolean {
  return !!track.access.gate && !track.access.space_uri;
}

/** Asks the coordinator, as the signed-in artist, for a short-lived link to their own track's audio. */
export async function ownerAudioUrl({ UPLOAD_AUTHORIZE_METHOD, UPLOAD_COORDINATOR_URL, UPLOAD_SERVICE_AUDIENCE }: UploadConfig, account: Account,
  recordUri: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<string> {
  if (!account.agent || !account.uploadStorage) throw new Error('sign in again to play your own track.');
  const identity = await account.agent.handle(`/xrpc/com.atproto.server.getServiceAuth?${new URLSearchParams({ aud: UPLOAD_SERVICE_AUDIENCE, lxm: UPLOAD_AUTHORIZE_METHOD })}`, { signal });
  if (!identity.ok) throw new Error('sign in again to play your own track.');
  const token: unknown = await identity.json();
  if (!token || typeof token !== 'object' || !('token' in token) || typeof token.token !== 'string' || !token.token) throw new Error('could not verify your account. try again.');
  const response = await fetcher(`${UPLOAD_COORDINATOR_URL}/v1/playback/owner-audio`, { method: 'POST', signal, redirect: 'error', cache: 'no-store',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serviceToken: token.token, recordUri }) });
  if (!response.ok) throw new Error(response.status === 403 ? 'only the artist can play this' : 'audio unavailable');
  const value: unknown = await response.json();
  const url = value && typeof value === 'object' && 'url' in value && typeof value.url === 'string' ? new URL(value.url) : undefined;
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.hash
    || !/^\/v1\/legacy-audio\/[A-Za-z0-9]{1,64}$/.test(url.pathname) || !url.searchParams.get('capability')) throw new Error('audio unavailable');
  return url.href;
}

// api.ts's ApiError, by shape: the appview refuses an owner-only track to everyone
const refused = (error: unknown) => !!error && typeof error === 'object' && 'status' in error && error.status === 401;

/**
 * The playback lookup for a track, where an owner-only track answers its artist with their own link and
 * everyone else with why it won't play.
 */
export async function ownerAwarePlayback(track: Pick<Track, 'id' | 'access' | 'artist' | 'record'>, lookup: () => Promise<Playback>,
  ownerUrl: () => Promise<string>, viewer: string | null): Promise<Playback> {
  try {
    return await lookup();
  } catch (error) {
    if (!refused(error) || !isOwnerOnlyTrack(track)) throw error;
    if (viewer !== track.artist.did) throw new Error('only the artist can play this');
    return { object: 'playback', track_id: track.id, record: { uri: track.record.uri, cid: track.record.cid ?? '' },
      availability: { status: 'available', delivery: { url: await ownerUrl(), media_type: 'audio/mpeg' } } };
  }
}
