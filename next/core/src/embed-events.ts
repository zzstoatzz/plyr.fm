export const embedProtocol = 'fm.plyr.embed.experimental.v1';

export type EmbedState = 'idle' | 'playing' | 'paused' | 'buffering' | 'seeking' | 'ended' | 'error';
export interface EmbedSnapshot {
	instance: string;
	discontinuity: number;
	track: { uri: string; cid: string | null } | null;
	audioContent: { kind: 'sha256'; value: string } | null;
	state: EmbedState;
	position: number;
	duration: number | null;
	rate: number;
	visible: boolean;
}
export interface EmbedEvent extends EmbedSnapshot {
	protocol: typeof embedProtocol;
	type: 'snapshot';
	subscription: string;
	sequence: number;
	clock: { epochMs: number; monotonicMs: number };
	analysis: { source: 'live'; rms: number; bands: number[]; sampleRate: number; windowSamples: number } | null;
}
export type EmbedRequest = {
	protocol: typeof embedProtocol;
	type: 'subscribe';
	subscription: string;
	hz: number;
} | {
	protocol: typeof embedProtocol;
	type: 'unsubscribe';
	subscription: string;
};

export function parseEmbedRequest(value: unknown): EmbedRequest | undefined {
	if (!value || typeof value !== 'object' || !('protocol' in value) || value.protocol !== embedProtocol
		|| !('subscription' in value) || typeof value.subscription !== 'string'
		|| value.subscription.length < 1 || value.subscription.length > 128 || !('type' in value)) return;
	if (value.type === 'unsubscribe') return { protocol: embedProtocol, type: value.type, subscription: value.subscription };
	if (value.type !== 'subscribe') return;
	const hz = 'hz' in value ? value.hz : 4;
	if (typeof hz !== 'number' || !Number.isFinite(hz)) return;
	return { protocol: embedProtocol, type: value.type, subscription: value.subscription, hz: Math.max(1, Math.min(10, hz)) };
}

export function embedPosition(snapshot: EmbedSnapshot, elapsedSeconds: number): number {
	const elapsed = snapshot.state === 'playing' && snapshot.visible ? Math.max(0, Math.min(0.5, elapsedSeconds)) : 0;
	return Math.max(0, Math.min(snapshot.duration ?? Infinity, snapshot.position + elapsed * snapshot.rate));
}

export function parseEmbedEvent(value: unknown): EmbedEvent | undefined {
	if (!value || typeof value !== 'object') return;
	if (!('protocol' in value) || value.protocol !== embedProtocol || !('type' in value) || value.type !== 'snapshot') return;
	if (!('subscription' in value) || typeof value.subscription !== 'string'
		|| !('instance' in value) || typeof value.instance !== 'string'
		|| !('discontinuity' in value) || !Number.isSafeInteger(value.discontinuity)
		|| !('sequence' in value) || !Number.isSafeInteger(value.sequence)
		|| !('position' in value) || typeof value.position !== 'number' || !Number.isFinite(value.position)
		|| !('rate' in value) || typeof value.rate !== 'number' || !Number.isFinite(value.rate)
		|| !('duration' in value) || value.duration !== null && (typeof value.duration !== 'number' || !Number.isFinite(value.duration))
		|| !('visible' in value) || typeof value.visible !== 'boolean'
		|| !('state' in value) || typeof value.state !== 'string' || !['idle', 'playing', 'paused', 'buffering', 'seeking', 'ended', 'error'].includes(value.state)) return;
	if (!('track' in value) || value.track !== null && (!value.track || typeof value.track !== 'object'
		|| !('uri' in value.track) || typeof value.track.uri !== 'string'
		|| !('cid' in value.track) || value.track.cid !== null && typeof value.track.cid !== 'string')) return;
	if (!('audioContent' in value) || value.audioContent !== null && (!value.audioContent || typeof value.audioContent !== 'object'
		|| !('kind' in value.audioContent) || value.audioContent.kind !== 'sha256'
		|| !('value' in value.audioContent) || typeof value.audioContent.value !== 'string' || !/^[a-f0-9]{64}$/.test(value.audioContent.value))) return;
	if (!('clock' in value) || !value.clock || typeof value.clock !== 'object'
		|| !('epochMs' in value.clock) || typeof value.clock.epochMs !== 'number' || !Number.isFinite(value.clock.epochMs)
		|| !('monotonicMs' in value.clock) || typeof value.clock.monotonicMs !== 'number' || !Number.isFinite(value.clock.monotonicMs)) return;
	if (!('analysis' in value)) return;
	const analysis = value.analysis;
	if (analysis !== null && (!analysis || typeof analysis !== 'object'
		|| !('source' in analysis) || analysis.source !== 'live'
		|| !('rms' in analysis) || typeof analysis.rms !== 'number' || !Number.isFinite(analysis.rms)
		|| !('bands' in analysis) || !Array.isArray(analysis.bands) || analysis.bands.length !== 3
		|| !analysis.bands.every((band: unknown) => typeof band === 'number' && Number.isFinite(band))
		|| !('sampleRate' in analysis) || typeof analysis.sampleRate !== 'number' || !Number.isFinite(analysis.sampleRate) || analysis.sampleRate <= 0
		|| !('windowSamples' in analysis) || typeof analysis.windowSamples !== 'number' || !Number.isSafeInteger(analysis.windowSamples) || analysis.windowSamples <= 0)) return;
	// All fields in the wire contract are validated above.
	return value as EmbedEvent;
}
