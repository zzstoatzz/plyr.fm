import { NSID } from './config';
import { trackIdFromUri } from './api';

const resolved = new Map<string, string>();

export async function radioTrackId(songId: string, signal: AbortSignal): Promise<string> {
  if (songId.startsWith('trk_')) return songId;
  const cached = resolved.get(songId);
  if (cached) return cached;
  if (!/^\d+$/.test(songId)) throw new Error('Radio track identity unavailable');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) controller.abort();
  const timeout = setTimeout(cancel, 10_000);
  let track: unknown;
  try {
    const response = await fetch(`https://api.plyr.fm/tracks/${encodeURIComponent(songId)}`, { signal: controller.signal });
    if (!response.ok) throw new Error('Could not resolve radio track');
    track = await response.json();
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', cancel);
  }
  if (typeof track !== 'object' || track === null || !('atproto_record_uri' in track) ||
    typeof track.atproto_record_uri !== 'string' ||
    track.atproto_record_uri.match(/^at:\/\/did:[^/]+\/([^/]+)\/[^/]+$/)?.[1] !== NSID.track) {
    throw new Error('Radio track has no canonical record');
  }
  const id = trackIdFromUri(track.atproto_record_uri);
  const oldest = resolved.keys().next().value;
  if (resolved.size >= 64 && oldest !== undefined) resolved.delete(oldest);
  resolved.set(songId, id);
  return id;
}
