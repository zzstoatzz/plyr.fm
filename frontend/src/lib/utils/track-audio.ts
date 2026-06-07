import type { Track } from '$lib/types';

/**
 * a track is in the "optimizing" state when it was published with an interim
 * playable rendition (the raw lossless source — e.g. AIFF — published directly
 * so the track exists immediately without blocking on a transcode), and the
 * deferred MP3 optimization task is still in flight or pending. once the
 * optimize task completes the swap, `file_type` becomes 'mp3' and the canonical
 * PDS `audioBlob` is written — at which point this returns false again.
 *
 * (tracks still in flight from the prior scheme carry a 16-bit WAV interim
 * instead of the raw source; both are "not yet mp3, with an original" and are
 * caught here.)
 *
 * relevant in the PDS-migration UI: optimizing tracks should NOT be offered
 * for manual migration, because the optimize task will write the canonical
 * (much smaller) MP3 PDS blob automatically. uploading the interim in the
 * meantime would race the optimization and leak a redundant blob on the
 * user's PDS.
 *
 * directly-uploaded web-playable tracks (no lossless original) are NOT in this
 * state and remain eligible for manual migration — the `original_file_id` check
 * is what distinguishes a transcoded interim from a real direct upload.
 */
export function isOptimizing(track: Track): boolean {
	return (
		track.file_type !== 'mp3' &&
		!!track.original_file_id &&
		!!track.original_file_type
	);
}
