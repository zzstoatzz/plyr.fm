import type { Artist, Playback, Track } from '../api.ts';

export const MAX_BUFFERED_DOWNLOAD_BYTES = 104_857_600;
const audioOrigin = 'https://plyr-next-audio.n8-3e9.workers.dev';
const mediaPath = /^\/media\/[a-f0-9]{64}\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

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
  const url = new URL(source);
  if (url.origin !== audioOrigin || !mediaPath.test(url.pathname) || url.search || url.hash) return;
  url.searchParams.set('download', '1');
  return url.href;
}

export function downloadFilename(track: Track, mime: string): string {
  const extensions: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/webm': 'webm' };
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
}) {
  const track = await read.track(id);
  if (track.record.uri !== uri || !track.record.cid || !downloadAllowed(track)) throw new Error('downloads are unavailable for this track.');
  const support = track.access.download_policy === 'ask' ? await read.artist(track.artist.did).then(artist => safeHttpUrl(artist.support_url)).catch(() => null) : null;
  const playback = await read.playback(id);
  const availability = playback.availability;
  if (playback.record.uri !== uri || playback.record.cid !== track.record.cid || availability.status !== 'available' || availability.space) throw new Error('this track changed or is unavailable. try again.');
  const source = safeHttpUrl(availability.delivery?.url);
  if (!source || !availability.delivery?.media_type.startsWith('audio/')) throw new Error('no downloadable audio is available.');
  return { source, attachment: attachmentUrl(source), mime: availability.delivery.media_type, filename: downloadFilename(track, availability.delivery.media_type), support, title: track.metadata.title };
}

export type PreparedDownload = Awaited<ReturnType<typeof prepareDownload>>;
