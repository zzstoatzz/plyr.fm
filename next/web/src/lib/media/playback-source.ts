import type { Track } from '@plyr/next-core/api';
import { isPrivateTrack } from '@plyr/next-core/track-access';
import { blobUrl } from '@plyr/next-core/identity';
import { freshPlayback } from '@plyr/next-core/fresh-playback';
import { api } from '$lib/api';
import type { AudioSource } from './gated-audio';

async function protectedSource(uri: string, signal: AbortSignal) {
	const { protectedAudio } = await import('./gated-audio');
	signal.throwIfAborted();
	return protectedAudio(uri, signal);
}

export async function playbackSource(track: Track, signal: AbortSignal): Promise<AudioSource> {
	if (isPrivateTrack(track)) return protectedSource(track.record.uri, signal);
	const { availability } = await freshPlayback(attempt => api.playback(track.id, attempt ? { fresh: true } : undefined), {
		createdAt: track.metadata.created_at,
		stale: () => signal.aborted
	});
	signal.throwIfAborted();
	if (availability.status === 'gated' && availability.space) {
		return protectedSource(availability.space.record, signal);
	}
	if (availability.status === 'available') {
		if (availability.delivery?.url) return { url: availability.delivery.url };
		if (availability.artifact?.cid) return { url: await blobUrl(track.artist.did, availability.artifact.cid) };
	}
	throw new Error('audio unavailable');
}
