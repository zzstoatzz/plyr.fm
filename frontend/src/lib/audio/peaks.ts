/**
 * extract normalized peak values from an audio source.
 *
 * samples the decoded audio into `buckets` equal-width windows and records
 * the maximum absolute amplitude in each window. the result is normalized
 * so the loudest bucket is 1.0 — bars will always reach the full height of
 * whatever renderer displays them.
 *
 * channels are reduced by taking the per-bucket max across channels (so a
 * transient in either channel still shows up), not averaged — averaged
 * peaks look flat for stereo recordings where channels are uncorrelated.
 *
 * this is intentionally browser-only (AudioContext). pure-function inputs
 * make it trivial to cache peaks in localStorage, IndexedDB, or memoized
 * maps once we start reusing the Waveform component elsewhere in the app.
 */
export async function extractPeaks(
	source: Blob | ArrayBuffer,
	buckets: number = 120
): Promise<number[]> {
	const arrayBuffer = source instanceof Blob ? await source.arrayBuffer() : source;

	// AudioContext is unprefixed in all current browsers; webkit prefix is
	// still present on some older iOS Safari versions
	const AudioCtor =
		window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!AudioCtor) {
		throw new Error('AudioContext is not available in this browser');
	}
	const ctx = new AudioCtor();

	try {
		// decodeAudioData mutates/consumes the buffer on some implementations,
		// so pass a copy
		const copy = arrayBuffer.slice(0);
		const audioBuffer = await ctx.decodeAudioData(copy);

		const length = audioBuffer.length;
		const channels = audioBuffer.numberOfChannels;
		const samplesPerBucket = Math.max(1, Math.floor(length / buckets));
		const peaks = new Array<number>(buckets).fill(0);

		for (let ch = 0; ch < channels; ch++) {
			const data = audioBuffer.getChannelData(ch);
			for (let b = 0; b < buckets; b++) {
				const start = b * samplesPerBucket;
				const end = Math.min(start + samplesPerBucket, length);
				let max = 0;
				for (let i = start; i < end; i++) {
					const v = Math.abs(data[i]);
					if (v > max) max = v;
				}
				if (max > peaks[b]) peaks[b] = max;
			}
		}

		// normalize so the loudest bucket is 1.0
		let loudest = 0;
		for (const p of peaks) {
			if (p > loudest) loudest = p;
		}
		if (loudest > 0) {
			for (let i = 0; i < peaks.length; i++) peaks[i] /= loudest;
		}

		return peaks;
	} finally {
		// safari's AudioContext keeps the mic indicator alive if not closed
		if (typeof ctx.close === 'function') {
			await ctx.close().catch(() => undefined);
		}
	}
}
