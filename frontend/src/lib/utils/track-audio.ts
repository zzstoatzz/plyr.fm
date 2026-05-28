import type { Track } from '$lib/types';

/**
 * a track is in the "optimizing" state when it was published with the interim
 * 16-bit WAV compatibility rendition from a lossless source (e.g. AIFF), and
 * the deferred MP3 optimization task is still in flight or pending. once the
 * optimize task completes the swap, `file_type` becomes 'mp3' and the canonical
 * PDS `audioBlob` is written — at which point this returns false again.
 *
 * relevant in the PDS-migration UI: optimizing tracks should NOT be offered
 * for manual migration, because the optimize task will write the canonical
 * (much smaller) MP3 PDS blob automatically. uploading the interim WAV in
 * the meantime would race the optimization and leak a redundant ~hundreds-of-
 * MB blob on the user's PDS.
 *
 * directly-uploaded WAV tracks (no lossless original) are NOT in this state
 * and remain eligible for manual migration — the `original_file_id` check is
 * what distinguishes a transcoded interim from a real WAV upload.
 */
export function isOptimizingInterimWav(track: Track): boolean {
	return (
		track.file_type === 'wav' &&
		!!track.original_file_id &&
		!!track.original_file_type
	);
}
