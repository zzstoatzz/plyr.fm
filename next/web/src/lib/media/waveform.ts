// Decoding holds the whole file as PCM, so very large picks keep a flat line.
const DECODE_LIMIT = 120 * 1024 * 1024;

export async function waveformPeaks(file: Blob, bars: number): Promise<number[] | undefined> {
	if (file.size > DECODE_LIMIT || typeof OfflineAudioContext === 'undefined') return undefined;
	const context = new OfflineAudioContext(1, 1, 44100);
	const buffer = await context.decodeAudioData(await file.arrayBuffer());
	const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
	const bucket = Math.max(1, Math.floor(buffer.length / bars));
	const stride = Math.max(1, Math.floor(bucket / 400));
	const peaks: number[] = [];
	for (let bar = 0; bar < bars; bar++) {
		let peak = 0;
		const end = Math.min(buffer.length, (bar + 1) * bucket);
		for (let sample = bar * bucket; sample < end; sample += stride) {
			for (const channel of channels) peak = Math.max(peak, Math.abs(channel[sample]));
		}
		peaks.push(peak);
	}
	const loudest = Math.max(...peaks, 0.0001);
	return peaks.map(peak => peak / loudest);
}
