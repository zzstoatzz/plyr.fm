/** The container from the file's first bytes, which holds even when the served type is generic. */
export function sniffAudioExtension(head: Uint8Array): string | undefined {
	const ascii = (at: number, text: string) => text.split('').every((char, i) => head[at + i] === char.charCodeAt(0));
	// An ID3 tag can front ADTS AAC as well as MP3: look at the first frame after it.
	if (ascii(0, 'ID3') && head.length > 10) {
		const skip = 10 + ((head[6] & 0x7f) << 21 | (head[7] & 0x7f) << 14 | (head[8] & 0x7f) << 7 | (head[9] & 0x7f));
		if (head.length > skip + 1 && head[skip] === 0xff && (head[skip + 1] & 0xf6) === 0xf0) return 'aac';
	}
	if (ascii(0, 'ID3') || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0 && (head[1] & 0x06) !== 0)) return 'mp3';
	if (head[0] === 0xff && (head[1] & 0xf6) === 0xf0) return 'aac';
	if (ascii(4, 'ftyp')) return 'm4a';
	if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'wav';
	if (ascii(0, 'fLaC')) return 'flac';
	if (ascii(0, 'FORM') && (ascii(8, 'AIFF') || ascii(8, 'AIFC'))) return 'aiff';
	if (ascii(0, 'OggS')) return 'ogg';
	if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'webm';
	return undefined;
}
