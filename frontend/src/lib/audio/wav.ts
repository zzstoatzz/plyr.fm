/**
 * Re-container audio the browser recorded into WAV.
 *
 * Private media is stored in the artist's permissioned space exactly as
 * uploaded — the transcoder only ever writes to the public repo — so a
 * recording has to already be in a format browsers play natively. Firefox and
 * older Chrome hand us webm/opus, which is not one. Rather than refuse the
 * recording (or ask someone to switch browsers), decode it here and write a
 * WAV: uncompressed, universally playable, and entirely on our side.
 */

/** 16-bit PCM keeps the file honest without the weight of 24/32-bit. */
const BYTES_PER_SAMPLE = 2;

function audioContextCtor(): typeof AudioContext {
	const ctor =
		window.AudioContext ??
		(window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!ctor) throw new Error('AudioContext is not available in this browser');
	return ctor;
}

/** interleave channels and clamp to signed 16-bit. */
function encodeWav(audioBuffer: AudioBuffer): Blob {
	const channels = audioBuffer.numberOfChannels;
	const frames = audioBuffer.length;
	const sampleRate = audioBuffer.sampleRate;
	const dataBytes = frames * channels * BYTES_PER_SAMPLE;

	const buffer = new ArrayBuffer(44 + dataBytes);
	const view = new DataView(buffer);
	const writeAscii = (offset: number, text: string) => {
		for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
	};

	writeAscii(0, 'RIFF');
	view.setUint32(4, 36 + dataBytes, true);
	writeAscii(8, 'WAVE');
	writeAscii(12, 'fmt ');
	view.setUint32(16, 16, true); // PCM header size
	view.setUint16(20, 1, true); // PCM format
	view.setUint16(22, channels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * channels * BYTES_PER_SAMPLE, true); // byte rate
	view.setUint16(32, channels * BYTES_PER_SAMPLE, true); // block align
	view.setUint16(34, 8 * BYTES_PER_SAMPLE, true);
	writeAscii(36, 'data');
	view.setUint32(40, dataBytes, true);

	const channelData = Array.from({ length: channels }, (_, ch) => audioBuffer.getChannelData(ch));
	let offset = 44;
	for (let frame = 0; frame < frames; frame++) {
		for (let ch = 0; ch < channels; ch++) {
			const sample = Math.max(-1, Math.min(1, channelData[ch][frame]));
			// asymmetric range: -32768..32767
			view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
			offset += BYTES_PER_SAMPLE;
		}
	}

	return new Blob([buffer], { type: 'audio/wav' });
}

/** decode any container the browser can read and return it as a WAV blob. */
export async function toWav(source: Blob): Promise<Blob> {
	const ctx = new (audioContextCtor())();
	try {
		// decodeAudioData consumes the buffer on some implementations
		const decoded = await ctx.decodeAudioData((await source.arrayBuffer()).slice(0));
		return encodeWav(decoded);
	} finally {
		void ctx.close().catch(() => undefined);
	}
}

export const __testing = { encodeWav };
