import type { Track } from '$core/api';
import { blobUrl } from '$core/identity';
import { api } from '$lib/api';
import { protectedAudio, type AudioSource } from './gated-audio';

export async function playbackSource(track: Track, signal: AbortSignal): Promise<AudioSource> {
	const { availability } = await api.playback(track.id);
	signal.throwIfAborted();
	if (availability.status === 'gated' && availability.space) {
		return protectedAudio(availability.space.record, signal);
	}
	if (availability.status === 'available') {
		if (availability.delivery?.url) return { url: availability.delivery.url };
		if (availability.artifact?.cid) return { url: await blobUrl(track.artist.did, availability.artifact.cid) };
	}
	throw new Error('audio unavailable');
}
