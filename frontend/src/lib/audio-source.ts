import { API_URL } from '$lib/config';
import { getCachedAudioUrl } from '$lib/storage';
import { hasPlayableLossless } from '$lib/audio-support';
import type { Track } from '$lib/types';

/**
 * Structured outcome of resolving a track's audio source.
 *
 * The reactive loader and the next-track prefetcher both produce
 * these so the synchronous `ended` handler in Player.svelte has a
 * deterministic decision — "ready", "gated-denied", or "failed" —
 * without needing to await anything inside the user-activation
 * window. See `advanceToPreloadedSynchronously` in Player.svelte.
 */
export type ResolvedSource =
	| {
			kind: 'ready';
			trackId: number;
			fileIdUsed: string;
			src: string;
			ownsBlob: boolean;
	  }
	| {
			kind: 'gated-denied';
			trackId: number;
			requiresAuth: boolean;
			artistDid: string;
			artistHandle: string;
	  }
	| { kind: 'failed'; trackId: number; error: unknown };

/**
 * Gated-denial shape emitted to the toast/CTA layer. Kept distinct
 * from `ResolvedSource` because the toast pathway predates the
 * structured resolution result and isn't worth changing now.
 */
export interface GatedError {
	type: 'gated';
	artistDid: string;
	artistHandle: string;
	requiresAuth: boolean;
}

/**
 * Choose the file_id to load for a track: the lossless original
 * when the browser can play it natively, the transcoded sibling
 * otherwise. Shared between the reactive loader (current track)
 * and the prefetcher (next track) so the cache key agrees.
 */
export function pickFileIdForTrack(track: Track): string {
	if (track.original_file_id && hasPlayableLossless(track.original_file_type)) {
		return track.original_file_id;
	}
	return track.file_id;
}

/**
 * Resolve a track's audio source URL.
 *
 * Returns a structured result so callers don't have to differentiate
 * gated denials from genuine failures via thrown error types — the
 * synchronous fast path needs the discriminator to decide whether
 * to play, skip, or surface a CTA without doing any further I/O.
 */
export async function resolveAudioSource(
	track: Track,
	fileIdUsed: string
): Promise<ResolvedSource> {
	try {
		const cachedUrl = await getCachedAudioUrl(fileIdUsed);
		if (cachedUrl) {
			return {
				kind: 'ready',
				trackId: track.id,
				fileIdUsed,
				src: cachedUrl,
				ownsBlob: cachedUrl.startsWith('blob:')
			};
		}
	} catch (err) {
		console.error('failed to check audio cache:', err);
	}

	if (track.gated) {
		try {
			const response = await fetch(`${API_URL}/audio/${fileIdUsed}`, {
				method: 'HEAD',
				credentials: 'include'
			});
			if (response.status === 401) {
				return {
					kind: 'gated-denied',
					trackId: track.id,
					requiresAuth: true,
					artistDid: track.artist_did ?? '',
					artistHandle: track.artist_handle
				};
			}
			if (response.status === 402) {
				return {
					kind: 'gated-denied',
					trackId: track.id,
					requiresAuth: false,
					artistDid: track.artist_did ?? '',
					artistHandle: track.artist_handle
				};
			}
		} catch (err) {
			return { kind: 'failed', trackId: track.id, error: err };
		}
	}

	return {
		kind: 'ready',
		trackId: track.id,
		fileIdUsed,
		src: `${API_URL}/audio/${fileIdUsed}`,
		ownsBlob: false
	};
}

export function gatedErrorFromResolution(
	resolved: Extract<ResolvedSource, { kind: 'gated-denied' }>
): GatedError {
	return {
		type: 'gated',
		artistDid: resolved.artistDid,
		artistHandle: resolved.artistHandle,
		requiresAuth: resolved.requiresAuth
	};
}
