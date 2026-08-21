import { describe, expect, it } from 'vitest';
import { __testing } from './wav';

const { encodeWav } = __testing;

/** minimal AudioBuffer stand-in — encodeWav only reads these four members. */
function fakeBuffer(channels: number[][], sampleRate = 48000): AudioBuffer {
	return {
		numberOfChannels: channels.length,
		length: channels[0].length,
		sampleRate,
		getChannelData: (ch: number) => Float32Array.from(channels[ch])
	} as unknown as AudioBuffer;
}

function parse(blob: ArrayBuffer) {
	const view = new DataView(blob);
	const ascii = (offset: number, length: number) =>
		String.fromCharCode(...new Uint8Array(blob, offset, length));
	return {
		riff: ascii(0, 4),
		wave: ascii(8, 4),
		fmt: ascii(12, 4),
		formatTag: view.getUint16(20, true),
		channels: view.getUint16(22, true),
		sampleRate: view.getUint32(24, true),
		byteRate: view.getUint32(28, true),
		blockAlign: view.getUint16(32, true),
		bitsPerSample: view.getUint16(34, true),
		dataId: ascii(36, 4),
		dataBytes: view.getUint32(40, true),
		riffSize: view.getUint32(4, true),
		sampleAt: (i: number) => view.getInt16(44 + i * 2, true)
	};
}

describe('encodeWav', () => {
	it('writes a canonical 16-bit PCM header', async () => {
		const wav = encodeWav(fakeBuffer([[0, 0, 0, 0]], 44100));
		const h = parse(await wav.arrayBuffer());

		expect(h.riff).toBe('RIFF');
		expect(h.wave).toBe('WAVE');
		expect(h.fmt).toBe('fmt ');
		expect(h.dataId).toBe('data');
		expect(h.formatTag).toBe(1);
		expect(h.channels).toBe(1);
		expect(h.sampleRate).toBe(44100);
		expect(h.bitsPerSample).toBe(16);
		expect(h.blockAlign).toBe(2);
		expect(h.byteRate).toBe(44100 * 2);
		expect(wav.type).toBe('audio/wav');
	});

	it('sizes the data chunk and RIFF chunk to the samples written', async () => {
		const wav = encodeWav(fakeBuffer([new Array(100).fill(0), new Array(100).fill(0)]));
		const h = parse(await wav.arrayBuffer());

		// 100 frames x 2 channels x 2 bytes
		expect(h.dataBytes).toBe(400);
		expect(h.riffSize).toBe(436);
		expect(wav.size).toBe(444);
	});

	it('interleaves channels frame by frame', async () => {
		const wav = encodeWav(fakeBuffer([[1, 1], [-1, -1]]));
		const h = parse(await wav.arrayBuffer());

		// L R L R, not L L R R
		expect(h.sampleAt(0)).toBe(32767);
		expect(h.sampleAt(1)).toBe(-32768);
		expect(h.sampleAt(2)).toBe(32767);
		expect(h.sampleAt(3)).toBe(-32768);
	});

	it('clamps out-of-range samples instead of wrapping', async () => {
		const wav = encodeWav(fakeBuffer([[2, -2, 0]]));
		const h = parse(await wav.arrayBuffer());

		expect(h.sampleAt(0)).toBe(32767);
		expect(h.sampleAt(1)).toBe(-32768);
		expect(h.sampleAt(2)).toBe(0);
	});
});
