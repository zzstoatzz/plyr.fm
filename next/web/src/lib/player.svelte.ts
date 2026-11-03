import { api, type Playback, type Track } from './api';
import { auth } from './auth.svelte';
import { blobUrl } from './identity';

class Player {
	queue = $state<Track[]>([]);
	index = $state(-1);
	src = $state<string | null>(null);
	playing = $state(false);
	error = $state<string | null>(null);
	#objectUrl: string | null = null;
	current = $derived(this.index >= 0 ? (this.queue[this.index] ?? null) : null);

	async play(tracks: Track[], start = 0) {
		this.queue = tracks;
		await this.#load(start);
	}

	async next() {
		if (this.index + 1 < this.queue.length) await this.#load(this.index + 1);
		else this.playing = false;
	}

	async prev() {
		if (this.index > 0) await this.#load(this.index - 1);
	}

	async #load(i: number) {
		this.index = i;
		this.error = null;
		const track = this.queue[i];
		try {
			const playback = await api.playback(track.id);
			const src = await playableUrl(playback);
			if (this.#objectUrl) URL.revokeObjectURL(this.#objectUrl);
			this.#objectUrl = src.startsWith('blob:') ? src : null;
			this.src = src;
			this.playing = true;
		} catch (e) {
			this.src = null;
			this.playing = false;
			this.error = `can't play "${track.metadata.title}": ${(e as Error).message}`;
		}
	}
}

export const player = new Player();

/**
 * prefer the appview's delivery (verified mirror or authored url); otherwise
 * stream the record's audio blob straight from the owner's PDS.
 */
async function playableUrl(playback: Playback): Promise<string> {
	const { delivery, artifact, space } = playback.availability;
	if (playback.availability.status === 'gated' && space) {
		if (!auth.did) throw new Error(space.gate === 'supporters' ? 'sign in to hear supporter tracks' : 'sign in to hear this track');
		if (!auth.spaces) throw new Error("your PDS doesn't support spaces yet, so gated tracks can't play here");
		const { gatedAudioUrl, NotAuthorized, SpacesUnsupported } = await import('./spaces');
		try {
			return await gatedAudioUrl(space.record);
		} catch (e) {
			if (e instanceof NotAuthorized) throw new Error('this track is for supporters of the artist');
			if (e instanceof SpacesUnsupported) throw new Error(e.message);
			throw e;
		}
	}
	if (playback.availability.status === 'available' && delivery?.url) return delivery.url;
	if (artifact?.cid) return blobUrl(playback.record.uri.slice('at://'.length).split('/')[0], artifact.cid);
	throw new Error('unavailable');
}

export function formatDuration(seconds: number | null | undefined) {
	if (!seconds || seconds < 0) return '';
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, '0')}`;
}
