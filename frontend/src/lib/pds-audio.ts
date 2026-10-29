import type { Track } from './types';
import { isOptimizing } from './utils/track-audio';

export function hasPdsAudio(track: Track): boolean {
	return Boolean(
		track.audio_space ||
		track.pds_blob_cid ||
		track.audio_storage === 'both' ||
		track.audio_storage === 'pds'
	);
}

export function pdsSaveStatus(track: Track): 'eligible' | 'saved' | 'gated' | 'optimizing' {
	if (hasPdsAudio(track)) return 'saved';
	if (
		track.support_gate ||
		track.audio_storage === 'r2_private' ||
		track.publishing?.access.visibility === 'private'
	)
		return 'gated';
	if (isOptimizing(track)) return 'optimizing';
	return 'eligible';
}
