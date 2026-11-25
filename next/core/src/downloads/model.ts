import { AUDIO_CONTAINERS, containerFromContentType, containerFromFileType } from '../audio-format.ts';
import type { Artist, ListSummary, Playback, Track } from '../api.ts';
import { readDownloadManifest, serviceMediaUrl, type DownloadManifest } from './manifest.ts';
import { albumNamed, offerFor, offerLabel, supportLink } from '../selling.ts';

export const MAX_BUFFERED_DOWNLOAD_BYTES = 104_857_600;
export type DownloadAdmission = { guard(): void; begin(): void };
type PublicDownload = { kind: 'public'; source: string; attachment?: string; mime: string; filename: string; sizeBytes?: number; guard?(): void; begin?(): void };
export type ProtectedDownload = { kind: 'protected'; mime: string; sizeBytes: number; filename: string; guard(): void; begin?(): void; open(): Promise<Response> };
export type PreparedDownload = PublicDownload | ProtectedDownload;
type DownloadChoice = PreparedDownload & { original?: PublicDownload; support: string | null; buy?: { url: string; label: string } | null; title: string };

export function downloadAllowed(track: Track): boolean {
  if (track.access.download_policy === 'supporters') return ['public', 'unlisted', 'supporters'].includes(track.access.visibility)
    && !track.access.space_uri && (!track.access.gate || track.access.gate.type === 'any');
  return (track.access.visibility === 'public' || track.access.visibility === 'unlisted')
    && !track.access.gate && !track.access.space_uri
    && (track.access.download_policy === 'open' || track.access.download_policy === 'ask');
}

/** Records uploaded by the legacy app carry a bare file type ("mp3") where a MIME type belongs. */
export function audioMime(value: string | null | undefined): string | null {
  const type = value?.trim().toLowerCase();
  if (!type) return null;
  if (type.startsWith('audio/')) return type;
  const container = containerFromFileType(type);
  return container ? AUDIO_CONTAINERS[container].contentType : null;
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
  const container = containerFromContentType(mime);
  const artist = track.metadata.artist_name || track.artist.profile.display_name || track.artist.profile.handle;
  const clean = `${artist} - ${track.metadata.title}`.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '').trim();
  const encoder = new TextEncoder();
  let stem = '';
  for (const character of clean) {
    if (encoder.encode(stem + character).byteLength > 180) break;
    stem += character;
  }
  stem = stem.replace(/[. ]+$/, '') || 'audio';
  return `${stem}.${container ? AUDIO_CONTAINERS[container].fileType : 'audio'}`;
}

export async function prepareDownload(id: string, uri: string, read: {
  track: (id: string) => Promise<Track>; playback: (id: string) => Promise<Playback>; artist: (did: string) => Promise<Artist>;
  /** the artist's albums, so a track sold as part of one gets its buy link */
  albums?: (did: string) => Promise<ListSummary[]>;
  manifest?: (source: string, signal?: AbortSignal) => Promise<DownloadManifest>;
  authorize?: (record: { uri: string; cid: string }) => Promise<DownloadAdmission>;
  protected?: (track: Track, uri: string, admission?: DownloadAdmission) => Promise<Omit<ProtectedDownload, 'filename'> & { policy: 'open' | 'ask' | 'supporters' }>;
}, signal?: AbortSignal): Promise<DownloadChoice> {
  let track = await read.track(id);
  if (track.record.uri !== uri || !track.record.cid || !downloadAllowed(track)) throw new Error('downloads are unavailable for this track.');
  let admission: DownloadAdmission | undefined;
  if (track.access.download_policy === 'supporters') {
    if (!read.authorize) throw new Error('could not authorize this download.');
    const cid = track.record.cid;
    admission = await read.authorize({ uri: track.record.uri, cid });
    track = await read.track(id);
    if (track.record.uri !== uri || track.record.cid !== cid || track.access.download_policy !== 'supporters' || !downloadAllowed(track)) throw new Error('this track changed or is unavailable. try again.');
    admission.begin();
  }
  const playback = await read.playback(id);
  const availability = playback.availability;
  if (playback.record.uri !== uri || playback.record.cid !== track.record.cid) throw new Error('this track changed or is unavailable. try again.');
  const asks = async (ask: boolean) => {
    if (!ask) return { support: null, buy: null };
    const [artist, albums] = await Promise.all([
      read.artist(track.artist.did).catch(() => undefined),
      track.metadata.album && read.albums ? read.albums(track.artist.did).catch(() => []) : [],
    ]);
    const offer = offerFor(artist, [track.record.uri, albumNamed(track.metadata.album, albums)?.record.uri]);
    return { support: supportLink(artist) ?? null, buy: offer ? { url: offer.url, label: offerLabel(offer) } : null };
  };
  if (availability.status === 'gated' && availability.space && read.protected) {
    const protectedAudio = await read.protected(track, availability.space.record, admission);
    const { support, buy } = await asks(track.access.download_policy === 'ask' || protectedAudio.policy === 'ask');
    protectedAudio.guard();
    admission?.begin();
    return { ...protectedAudio, begin: admission?.begin, filename: downloadFilename(track, protectedAudio.mime), support, buy, title: track.metadata.title };
  }
  if (availability.status !== 'available' || availability.space) throw new Error('this track changed or is unavailable. try again.');
  const { support, buy } = await asks(track.access.download_policy === 'ask');
  const source = safeHttpUrl(availability.delivery?.url);
  const mime = audioMime(availability.delivery?.media_type);
  if (!source || !mime) throw new Error('no downloadable audio is available.');
  const manifest = serviceMediaUrl(source) ? await (read.manifest || readDownloadManifest)(source, signal) : undefined;
  const playbackAudio = manifest?.playback || { source, mime, sizeBytes: undefined };
  admission?.begin();
  const playbackDownload: PublicDownload = { kind: 'public', ...playbackAudio, ...admission, attachment: attachmentUrl(source), filename: downloadFilename(track, playbackAudio.mime) };
  const original: PublicDownload | undefined = manifest?.processed ? { kind: 'public', ...manifest.original, ...admission, attachment: manifest.original.source, filename: downloadFilename(track, manifest.original.mime) } : undefined;
  return { ...playbackDownload, original, support, buy, title: track.metadata.title };
}
