import type { EmbedEvent } from './embed-events.ts';

export interface AudioAnalysis {
	schema: 'fm.plyr.analysis.experimental.v1';
	content: { sha256: string; bytes: number; path: string };
	timebase: 'seconds';
	channels: 'mono';
	sampleRate: number;
	windowSamples: number;
	hopSamples: number;
	normalization: 'none';
	bandsHz: readonly (readonly [number, number])[];
	frames: { min: number; max: number; rms: number; bands: number[] }[];
	onsets: number[];
}

export function analysisFrame(analysis: AudioAnalysis, seconds: number) {
	if (!Number.isFinite(seconds) || seconds < 0) return undefined;
	return analysis.frames[Math.floor(seconds * analysis.sampleRate / analysis.hopSamples)];
}

export function matchesAnalysis(analysis: AudioAnalysis, snapshot: EmbedEvent | undefined): boolean {
	return snapshot?.audioContent?.kind === 'sha256' && snapshot.audioContent.value === analysis.content.sha256;
}

export function analysisOnsets(analysis: AudioAnalysis, before: EmbedEvent | undefined, after: EmbedEvent): number[] {
	if (!matchesAnalysis(analysis, before) || !matchesAnalysis(analysis, after) || !before || before.instance !== after.instance || before.discontinuity !== after.discontinuity
		|| before.state !== 'playing' || after.state !== 'playing' || !before.visible || !after.visible
		|| after.sequence <= before.sequence || after.clock.monotonicMs - before.clock.monotonicMs > 500
		|| after.clock.monotonicMs < before.clock.monotonicMs || after.position < before.position) return [];
	return analysis.onsets.filter(time => time > before.position && time <= after.position);
}
