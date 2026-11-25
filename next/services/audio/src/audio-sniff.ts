// What stored audio bytes are, from their first bytes, by core's sniffer (the twin of the
// backend's audio_format.zig).
//
// A file's name and its picker's type are only claims: a WAV renamed to .m4a arrives
// as audio/mp4, and Safari and iOS believe the content type over the bytes, so they
// refuse to play it while Chrome sniffs and plays. Whatever is served is what the
// bytes say. Undefined means the claim stands.
import { AUDIO_HEAD_BYTES, audioLabel, audioRoute, sniffAudio, type AudioFormat } from "../../../core/src/audio-format.ts";

/** How many leading bytes `sniffHead` reads. */
export const SNIFF_BYTES = AUDIO_HEAD_BYTES;

/**
 * What `head` (an object's first `SNIFF_BYTES`) is, or undefined when it can't tell. An ID3 tag
 * can front AAC as well as MP3, so one that runs past the head (cover art) names nothing.
 */
export function sniffHead(head: Uint8Array): AudioFormat | undefined {
  if (head.length >= 10 && head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
    const skip = 10 + (head[5] & 0x10 ? 10 : 0) + ((head[6] & 0x7f) << 21 | (head[7] & 0x7f) << 14 | (head[8] & 0x7f) << 7 | (head[9] & 0x7f));
    if (skip + 2 > head.length) return undefined;
  }
  return sniffAudio(head);
}

/** The content type to serve `head`'s object as, or undefined to keep the claimed one. */
export function sniffAudioType(head: Uint8Array): string | undefined {
  const format = sniffHead(head);
  return format && audioLabel(format).contentType;
}

/**
 * Whether bytes are known to need the MP3 playback copy: a container no browser plays everywhere,
 * or an M4A whose codec (ALAC) is read from the head. An M4A whose `moov` lies past the head is
 * not known, and the uploader, who read the whole file, decided it.
 */
export function needsProcessing(head: Uint8Array): boolean {
  const format = sniffHead(head);
  if (!format || audioRoute(format) === "as_is") return false;
  return format.container !== "mp4" || format.codec !== "unknown";
}
