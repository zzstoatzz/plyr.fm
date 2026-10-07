// react-native-audio-api decodes through its bundled FFmpeg, lossless originals included
const DECODABLE = new Set(["mp3", "m4a", "aac", "wav", "flac", "aiff", "aif", "ogg", "opus"]);

export function decodes(format: string): boolean {
  return DECODABLE.has(format.toLowerCase().replace(".", ""));
}
