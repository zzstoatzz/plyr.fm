import type { Track } from '@plyr/next-core/api';
import { isPrivateTrack } from '@plyr/next-core/track-access';
import { blobUrl } from '@plyr/next-core/identity';
import { readyPlayback } from '@plyr/next-core/playback-ready';
import { api } from '$lib/api';
import { auth } from '$lib/auth';
import { authConfig } from '$lib/auth-config';
import { ownerAwarePlayback, ownerAudioUrl } from '@plyr/next-core/owner-audio';
import type { AudioSource } from './gated-audio';

async function protectedSource(uri: string, signal: AbortSignal) {
	const { protectedAudio } = await import('./gated-audio');
	signal.throwIfAborted();
	return protectedAudio(uri, signal);
}

export async function playbackSource(track: Track, signal: AbortSignal, onPreparing?: () => void): Promise<AudioSource> {
	if (isPrivateTrack(track)) return protectedSource(track.record.uri, signal);
	// a track published moments ago may still be copying to the streaming origin
	const account = auth.getAuth();
	const lookup = () => ownerAwarePlayback(track, () => api.playback(track.id), () => ownerAudioUrl(authConfig, account, track.record.uri, signal), account.did);
	const { availability } = await readyPlayback(lookup, { signal, onPreparing });
	signal.throwIfAborted();
	if (availability.status === 'gated' && availability.space) {
		return protectedSource(availability.space.record, signal);
	}
	if (availability.status === 'available') {
		if (availability.delivery?.url) return { url: availability.delivery.url };
		if (availability.artifact?.cid) return { url: await blobUrl(track.artist.did, availability.artifact.cid) };
	}
	throw new Error(availability.status === 'preparing' ? 'this track is still being prepared. try again in a moment.' : 'audio unavailable');
}
