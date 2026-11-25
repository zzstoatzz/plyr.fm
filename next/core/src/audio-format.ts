/**
 * What audio bytes are, decided from the bytes: the TS twin of
 * next/backend/src/internal/media/audio_format.zig.
 *
 * A file's name, a picker's type, a record's `fileType` and a blob's `mimeType` are claims.
 * A WAV renamed `.m4a` claims to be AAC, and Safari and iOS believe whatever type they are
 * served, so nothing here routes, labels or serves audio by a claim. The tables come from the
 * zig (`audio-format.gen.ts`); the sniffer is written twice and held to one corpus
 * (`tests/fixtures/audio`), which both test suites read.
 */
import { AUDIO_CONTAINERS, AUDIO_HEAD_BYTES, type AudioCodec, type AudioContainer, type AudioContainerInfo } from './audio-format.gen.ts';

export { AUDIO_CONTAINERS, AUDIO_HEAD_BYTES, type AudioCodec, type AudioContainer, type AudioContainerInfo };
export type AudioFormat = { container: AudioContainer; codec: AudioCodec };
export type AudioRoute = 'as_is' | 'process';

const CONTAINERS = Object.keys(AUDIO_CONTAINERS) as AudioContainer[];

export function containerInfo(container: AudioContainer): AudioContainerInfo {
  return AUDIO_CONTAINERS[container];
}

/** A claimed file type (`"aif"`, `".M4A"`), or undefined when it names no container. */
export function containerFromFileType(text: string | null | undefined): AudioContainer | undefined {
  const name = text?.trim().toLowerCase().replace(/^\./, '');
  if (!name) return;
  return CONTAINERS.find(container => AUDIO_CONTAINERS[container].fileType === name || AUDIO_CONTAINERS[container].fileTypeAliases.includes(name));
}

/** A claimed content type (`"audio/x-wav; codecs=1"`), or undefined when it names no container. */
export function containerFromContentType(text: string | null | undefined): AudioContainer | undefined {
  const essence = text?.split(';')[0].trim().toLowerCase();
  if (!essence) return;
  return CONTAINERS.find(container => AUDIO_CONTAINERS[container].contentType === essence || AUDIO_CONTAINERS[container].contentTypeAliases.includes(essence));
}

/** What sniffed bytes are labelled and served as: a record's `fileType` and the content type. */
export function audioLabel(format: AudioFormat): { fileType: string; contentType: string } {
  const { fileType, contentType } = AUDIO_CONTAINERS[format.container];
  return { fileType, contentType };
}

/** `audioLabel` of whatever `bytes` are, or undefined when they name no audio container. */
export function sniffAudioLabel(bytes: Uint8Array): { fileType: string; contentType: string } | undefined {
  const format = sniffAudio(bytes);
  return format && audioLabel(format);
}

/** Whether browsers everywhere play these bytes as they are, or they need the MP3 playback copy. */
export function audioRoute(format: AudioFormat): AudioRoute {
  const info = AUDIO_CONTAINERS[format.container];
  if (info.rule === 'by_codec') return info.asIsCodecs.includes(format.codec) ? 'as_is' : 'process';
  return info.rule;
}

const ascii = (bytes: Uint8Array, at: number, text: string) => bytes.length >= at + text.length && [...text].every((char, i) => bytes[at + i] === char.charCodeAt(0));
const be32 = (bytes: Uint8Array, at: number) => ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];

/**
 * What `bytes` (a whole file, or its first bytes) are, or undefined when they name no audio
 * container. A codec that can't be read from what is given is `unknown`, which routes an M4A to
 * processing; `sniffAudioReader` finds an M4A's codec wherever its `moov` sits.
 */
export function sniffAudio(bytes: Uint8Array): AudioFormat | undefined {
  if (bytes.length >= 10 && ascii(bytes, 0, 'ID3')) {
    // an ID3v2 tag can front MP3, ADTS or even FLAC: look past it
    const skip = 10 + (bytes[5] & 0x10 ? 10 : 0) + ((bytes[6] & 0x7f) << 21 | (bytes[7] & 0x7f) << 14 | (bytes[8] & 0x7f) << 7 | (bytes[9] & 0x7f));
    return (skip < bytes.length ? sniffAudio(bytes.subarray(skip)) : undefined) ?? { container: 'mp3', codec: 'mp3' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff) {
    if ((bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0) return { container: 'mp3', codec: 'mp3' };
    if ((bytes[1] & 0xf6) === 0xf0) return { container: 'adts', codec: 'aac' };
  }
  if (bytes.length >= 12) {
    if (ascii(bytes, 4, 'ftyp')) return { container: 'mp4', codec: mp4Codec(bytes) };
    if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WAVE')) return { container: 'wav', codec: wavCodec(bytes) };
    if (ascii(bytes, 0, 'FORM') && ascii(bytes, 8, 'AIFF')) return { container: 'aiff', codec: 'pcm' };
    if (ascii(bytes, 0, 'FORM') && ascii(bytes, 8, 'AIFC')) return { container: 'aiff', codec: 'unknown' };
  }
  if (bytes.length >= 4) {
    if (ascii(bytes, 0, 'fLaC')) return { container: 'flac', codec: 'flac' };
    if (ascii(bytes, 0, 'OggS')) return { container: 'ogg', codec: oggCodec(bytes) };
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { container: 'webm', codec: webmCodec(bytes) };
  }
  return undefined;
}

function wavCodec(bytes: Uint8Array): AudioCodec {
  if (bytes.length < 22 || !ascii(bytes, 12, 'fmt ')) return 'unknown';
  const tag = bytes[20] | bytes[21] << 8;
  return tag === 1 || tag === 3 || tag === 0xfffe ? 'pcm' : 'other';
}

function oggCodec(bytes: Uint8Array): AudioCodec {
  if (bytes.length < 27) return 'unknown';
  const packet = 27 + bytes[26];
  if (ascii(bytes, packet, 'OpusHead')) return 'opus';
  if (ascii(bytes, packet, '\x01vorbis')) return 'vorbis';
  if (ascii(bytes, packet, '\x7fFLAC')) return 'flac';
  return 'unknown';
}

function webmCodec(bytes: Uint8Array): AudioCodec {
  const text = String.fromCharCode(...bytes.subarray(0, 4096));
  if (text.includes('A_OPUS')) return 'opus';
  if (text.includes('A_VORBIS')) return 'vorbis';
  return 'unknown';
}

type Box = { kind: string; body: Uint8Array; end: number };

/** The box at `at`, or undefined when its header or body runs past `bytes`. */
function box(bytes: Uint8Array, at: number): Box | undefined {
  if (bytes.length - at < 8) return;
  const size32 = be32(bytes, at);
  let header = 8, size = size32;
  if (size32 === 0) size = bytes.length - at;
  else if (size32 === 1) {
    if (bytes.length - at < 16) return;
    header = 16;
    size = be32(bytes, at + 8) * 2 ** 32 + be32(bytes, at + 12);
  }
  if (size < header || size > bytes.length - at) return;
  return { kind: String.fromCharCode(...bytes.subarray(at + 4, at + 8)), body: bytes.subarray(at + header, at + size), end: at + size };
}

function child(parent: Uint8Array, kind: string): Uint8Array | undefined {
  for (let found = box(parent, 0); found; found = box(parent, found.end)) if (found.kind === kind) return found.body;
}

const SAMPLE_ENTRIES: Record<string, AudioCodec> = { mp4a: 'aac', alac: 'alac', fLaC: 'flac', Opus: 'opus', '.mp3': 'mp3', lpcm: 'pcm', sowt: 'pcm', twos: 'pcm', ipcm: 'pcm', fpcm: 'pcm' };

/** The audio codec named in a `moov` box's body. */
export function moovCodec(moov: Uint8Array): AudioCodec {
  for (let trak = box(moov, 0); trak; trak = box(moov, trak.end)) {
    if (trak.kind !== 'trak') continue;
    const mdia = child(trak.body, 'mdia');
    const hdlr = mdia && child(mdia, 'hdlr');
    if (!mdia || !hdlr || !ascii(hdlr, 8, 'soun')) continue;
    const minf = child(mdia, 'minf'), stbl = minf && child(minf, 'stbl'), stsd = stbl && child(stbl, 'stsd');
    if (!stsd) continue;
    if (stsd.length < 16) return 'unknown';
    return SAMPLE_ENTRIES[String.fromCharCode(...stsd.subarray(12, 16))] ?? 'other';
  }
  return 'unknown';
}

function mp4Codec(bytes: Uint8Array): AudioCodec {
  const moov = child(bytes, 'moov');
  return moov ? moovCodec(moov) : 'unknown';
}

/** Something whose bytes can be read in ranges: a picked file, an upload part. */
export type ByteSource = { size: number; read(offset: number, length: number): Promise<Uint8Array> };

/** The largest `moov` read to find an M4A's codec; a longer one is left `unknown` (and processed). */
const MAX_MOOV_BYTES = 32 * 1024 * 1024;

/**
 * What a whole file is, reading only its first bytes and, for an M4A whose `moov` comes after
 * its audio (ffmpeg's default), the top-level box headers and that `moov`.
 */
export async function sniffAudioSource(source: ByteSource): Promise<AudioFormat | undefined> {
  const head = await source.read(0, Math.min(source.size, AUDIO_HEAD_BYTES));
  const format = sniffAudio(head);
  if (format?.container !== 'mp4' || format.codec !== 'unknown') return format;
  for (let offset = 0, boxes = 0; offset + 8 <= source.size && boxes < 64; boxes++) {
    const header = await source.read(offset, 16);
    const size32 = be32(header, 0);
    const size = size32 === 1 ? be32(header, 8) * 2 ** 32 + be32(header, 12) : size32 === 0 ? source.size - offset : size32;
    if (size < 8 || size > source.size - offset) break;
    if (ascii(header, 4, 'moov')) {
      const headerBytes = size32 === 1 ? 16 : 8;
      if (size > MAX_MOOV_BYTES) break;
      return { container: 'mp4', codec: moovCodec(await source.read(offset + headerBytes, size - headerBytes)) };
    }
    offset += size;
  }
  return format;
}
