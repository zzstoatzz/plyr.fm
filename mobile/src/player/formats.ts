// react-native-audio-api plays a URL through its bundled FFmpeg, built with only the hls, mov and mp3
// demuxers; everything else decodes in miniaudio, which needs the whole file in memory first
const STREAMABLE = new Set(["mp3", "mpeg", "m4a", "mp4"]);
const DOWNLOADED = new Set(["wav", "flac", "ogg", "opus"]);

const normalize = (format: string) => format.toLowerCase().replace(".", "");

export function decodes(format: string): boolean {
  const f = normalize(format);
  return STREAMABLE.has(f) || DOWNLOADED.has(f);
}

/** False for a format that would open, report playing and never produce a frame if handed over as a URL. */
export function streams(format: string): boolean {
  return STREAMABLE.has(normalize(format));
}
