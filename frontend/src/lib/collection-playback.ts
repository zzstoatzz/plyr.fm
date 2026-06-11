// collection playback — play or queue an entire ordered collection (album,
// playlist) on the shared footer player. this is the seam where a labeled
// playback context ("next from: <collection>") can attach later.
import { queue } from '$lib/queue.svelte';
import { playQueue } from '$lib/playback.svelte';
import { toast } from '$lib/toast.svelte';
import type { Track } from '$lib/types';

/**
 * replace the queue with the collection and start playing from the top.
 * gated-access on the first track is checked before the queue is touched.
 * returns whether playback actually started.
 */
export async function playCollection(tracks: Track[], name: string): Promise<boolean> {
	if (tracks.length === 0) return false;

	const played = await playQueue(tracks);
	if (played) {
		toast.success(`playing ${name}`, 1800);
	}
	return played;
}

/** append the collection to the current queue. */
export function queueCollection(tracks: Track[], name: string): void {
	if (tracks.length === 0) return;

	queue.addTracks(tracks);
	toast.success(`added ${name} to queue`, 1800);
}
