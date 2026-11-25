// What audio container stored bytes actually are, from their first bytes (core's sniffer).
//
// A file's name and its picker's type are only claims: a WAV renamed to .m4a arrives
// as audio/mp4, and Safari and iOS believe the content type over the bytes, so they
// refuse to play it while Chrome sniffs and plays. Whatever is served is what the
// bytes say. Undefined means the claim stands.
import { sniffAudioFormat } from "../../../core/src/audio-sniff.ts";

/** How many leading bytes `sniffAudioType` reads. */
export const SNIFF_BYTES = 16;

export function sniffAudioType(head: Uint8Array): string | undefined {
  // an ID3 tag can front AAC as well as MP3, and the frame after it is out of reach here
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return undefined;
  return sniffAudioFormat(head)?.contentType;
}
