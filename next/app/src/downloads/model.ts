import type { Artist, Playback, Track } from '../api.ts';
import { readDownloadManifest, serviceMediaUrl, type DownloadManifest } from './manifest.ts';

export const MAX_BUFFERED_DOWNLOAD_BYTES = 104_857_600;

export function downloadAllowed(track: Track): boolean {
  return (track.access.visibility === 'public' || track.access.visibility === 'unlisted')
    && !track.access.gate && !track.access.space_uri
    && (track.access.download_policy === 'open' || track.access.download_policy === 'ask');
}

export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function attachmentUrl(source: string): string | undefined {
  const base = serviceMediaUrl(source);
  if (!base) return;
  const url = new URL(base);
  url.searchParams.set('download', '1');
  return url.href;
}

export function downloadFilename(track: Track, mime: string): string {
  const extensions: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/aiff': 'aiff', 'audio/x-aiff': 'aiff' };
  const artist = track.metadata.artist_name || track.artist.profile.display_name || track.artist.profile.handle;
  const clean = `${artist} - ${track.metadata.title}`.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '').trim();
  const encoder = new TextEncoder();
  let stem = '';
  for (const character of clean) {
    if (encoder.encode(stem + character).byteLength > 180) break;
    stem += character;
  }
  stem = stem.replace(/[. ]+$/, '') || 'audio';
  return `${stem}.${extensions[mime.toLowerCase()] || 'audio'}`;
}

export async function prepareDownload(id: string, uri: string, read: {
  track: (id: string) => Promise<Track>; playback: (id: string) => Promise<Playback>; artist: (did: string) => Promise<Artist>;
  manifest?: (source: string, signal?: AbortSignal) => Promise<DownloadManifest>;
}, signal?: AbortSignal) {
  const track = await read.track(id);
  if (track.record.uri !== uri || !track.record.cid || !downloadAllowed(track)) throw new Error('downloads are unavailable for this track.');
  const support = track.access.download_policy === 'ask' ? await read.artist(track.artist.did).then(artist => safeHttpUrl(artist.support_url)).catch(() => null) : null;
  const playback = await read.playback(id);
  const availability = playback.availability;
  if (playback.record.uri !== uri || playback.record.cid !== track.record.cid || availability.status !== 'available' || availability.space) throw new Error('this track changed or is unavailable. try again.');
  const source = safeHttpUrl(availability.delivery?.url);
  if (!source || !availability.delivery?.media_type.startsWith('audio/')) throw new Error('no downloadable audio is available.');
  const manifest = serviceMediaUrl(source) ? await (read.manifest || readDownloadManifest)(source, signal) : undefined;
  const playbackAudio = manifest?.playback || { source, mime: availability.delivery.media_type, sizeBytes: undefined };
  const playbackDownload = { ...playbackAudio, attachment: attachmentUrl(source), filename: downloadFilename(track, playbackAudio.mime) };
  const original = manifest?.processed ? { ...manifest.original, attachment: manifest.original.source, filename: downloadFilename(track, manifest.original.mime) } : undefined;
  return { ...playbackDownload, original, support, title: track.metadata.title };
}

export type PreparedDownload = Pick<Awaited<ReturnType<typeof prepareDownload>>, 'source' | 'attachment' | 'mime' | 'filename'>;
