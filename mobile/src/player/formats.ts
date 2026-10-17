// react-native-audio-api plays a URL through its bundled FFmpeg, built with only the hls, mov and mp3
// demuxers; everything else decodes in miniaudio, which needs the whole file first
const STREAMABLE = new Set(["mp3", "mpeg", "m4a", "mp4"]);
const DOWNLOADED = new Set(["wav", "flac", "ogg", "opus"]);

const AHEAD_STREAMABLE_BYTES = 40 * 1024 * 1024;
const AHEAD_WHOLE_BYTES = 150 * 1024 * 1024;

export const extension = (format: string) => format.toLowerCase().replace(".", "");

export function decodes(format: string): boolean {
  const f = extension(format);
  return STREAMABLE.has(f) || DOWNLOADED.has(f);
}

/** False for a format that would open, report playing and never produce a frame if handed over as a URL. */
export function streams(format: string): boolean {
  return STREAMABLE.has(extension(format));
}

/** Whether the next track is fetched whole before it is asked for: an hour-long mix that can stream is not. */
export function fetchesAhead(format: string, bytes: number): boolean {
  return bytes <= (streams(format) ? AHEAD_STREAMABLE_BYTES : AHEAD_WHOLE_BYTES);
}

/** The file's size from a `Content-Range: bytes 0-0/1234` header; null when the server did not say. */
export function totalBytes(contentRange: string | null): number | null {
  const total = /\/(\d+)$/.exec(contentRange ?? "")?.[1];
  return total === undefined ? null : Number(total);
}
