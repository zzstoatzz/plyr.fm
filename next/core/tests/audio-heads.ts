import type { ChunkReader } from '../src/publishing/upload-model.ts';

const ascii = (text: string) => [...text].map(char => char.charCodeAt(0));
/** The first bytes of each kind of file the queue tests pick, enough for the sniffer to name it. */
const HEADS: Record<string, number[]> = {
  mp3: [0xff, 0xfb, 0x90, 0x64],
  wav: [...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WAVEfmt '), 16, 0, 0, 0, 1, 0, 2, 0],
};

/** A queue's `openUploadReader` for fixture files: each reads as its name's kind of audio, however small it claims to be. */
export function headReader(file: { name: string; size: number }): ChunkReader {
  const head = HEADS[file.name.split('.').pop()!.toLowerCase()];
  if (!head) throw new Error(`no fixture head for ${file.name}`);
  return { size: Math.max(file.size, head.length), read: async (offset, length) => new Uint8Array(head).slice(offset, offset + length), close() {} };
}
