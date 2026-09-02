/**
 * the one path for liking a track from any surface.
 *
 * a track's `is_liked` used to be flipped by whichever surface the tap
 * happened on — the queue row, the track page's chip, the actions menu —
 * each with its own optimistic copy, so two hearts for the same track could
 * disagree. this owner keeps an overlay of the states it has set, keyed by
 * track id, on top of whatever `is_liked` a track object arrived with; every
 * heart reads through `isLiked()` and every tap goes through `toggle()`.
 */

import { auth } from './auth.svelte';
import { toast } from './toast.svelte';
import { fetchLikedTracks, likeTrack, unlikeTrack } from './tracks.svelte';
import type { Track } from './types';

class Likes {
	#known = $state<Record<number, boolean>>({});
	#pending = new Set<number>();
	/** the viewer's liked ids, loaded once per session; null until then */
	#liked = $state<Set<number> | null>(null);
	#loading: Promise<void> | null = null;

	/**
	 * a track object cannot be trusted to carry the viewer's `is_liked` — the
	 * queue's server sync hands back tracks without it — so the owner learns
	 * the viewer's liked ids itself. cheap, once, and only when signed in.
	 */
	ensureLoaded(): Promise<void> {
		if (!auth.isAuthenticated || this.#liked !== null) return Promise.resolve();
		this.#loading ??= fetchLikedTracks()
			.then((tracks) => {
				this.#liked = new Set(tracks.map((t) => t.id));
			})
			.catch((e) => console.error('failed to load liked ids:', e))
			.finally(() => {
				this.#loading = null;
			});
		return this.#loading;
	}

	/** forget the loaded list (sign-out); the next `ensureLoaded` refetches */
	reset(): void {
		this.#liked = null;
		this.#known = {};
	}

	isLiked(track: Pick<Track, 'id' | 'is_liked'>): boolean {
		const known = this.#known[track.id];
		if (known !== undefined) return known;
		if (this.#liked !== null) return this.#liked.has(track.id);
		return track.is_liked === true;
	}

	/** a surface that toggled a like on its own (the menus) tells the owner the result. */
	record(trackId: number, liked: boolean): void {
		this.#known[trackId] = liked;
	}

	/** optimistic flip, request, revert on failure. resolves to the liked state afterwards. */
	async toggle(track: Track): Promise<boolean> {
		if (!auth.isAuthenticated) {
			toast.error('sign in to like tracks');
			return this.isLiked(track);
		}
		if (this.#pending.has(track.id)) return this.isLiked(track);
		const was = this.isLiked(track);
		const next = !was;
		this.#pending.add(track.id);
		this.#known[track.id] = next;
		if (this.#liked !== null) {
			if (next) this.#liked.add(track.id);
			else this.#liked.delete(track.id);
		}
		track.is_liked = next;
		if (track.like_count !== undefined) track.like_count = Math.max(0, track.like_count + (next ? 1 : -1));
		try {
			const ok = next ? await likeTrack(track.id, track.file_id, track.gated) : await unlikeTrack(track.id);
			if (!ok) {
				this.#known[track.id] = was;
				track.is_liked = was;
				if (track.like_count !== undefined) track.like_count = Math.max(0, track.like_count + (next ? -1 : 1));
				toast.error('failed to update like');
				return was;
			}
			if (next) toast.success(`liked ${track.title}`);
			else toast.info(`unliked ${track.title}`);
			return next;
		} finally {
			this.#pending.delete(track.id);
		}
	}
}

export const likes = new Likes();
