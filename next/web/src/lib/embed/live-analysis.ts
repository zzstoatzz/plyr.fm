export function createLiveAnalysis(audio: HTMLAudioElement) {
	const context = new AudioContext();
	const source = context.createMediaElementSource(audio);
	const analyser = context.createAnalyser();
	analyser.fftSize = 2048;
	analyser.smoothingTimeConstant = 0;
	source.connect(analyser);
	analyser.connect(context.destination);
	const samples = new Float32Array(analyser.fftSize);
	const bins = new Float32Array(analyser.frequencyBinCount);
	return {
		resume: () => context.resume(),
		read: () => {
			if (context.state !== 'running' || audio.paused || audio.seeking || audio.readyState < 3 || audio.ended) return null;
			analyser.getFloatTimeDomainData(samples);
			analyser.getFloatFrequencyData(bins);
			const bandsHz = [[60, 250], [250, 2000], [2000, 7500]] as const;
			return {
				source: 'live' as const,
				rms: Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length),
				bands: bandsHz.map(([low, high]) => bins.reduce((sum, db, i) => {
					const hz = i * context.sampleRate / analyser.fftSize;
					return sum + (hz >= low && hz < high ? Math.pow(10, db / 10) : 0);
				}, 0)),
				sampleRate: context.sampleRate, windowSamples: analyser.fftSize
			};
		},
		close: () => { source.disconnect(); analyser.disconnect(); void context.close(); }
	};
}
