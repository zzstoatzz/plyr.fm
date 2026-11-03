import { api, type Playback, type Track } from './api';
import { blobUrl } from './identity';

class Player {
	queue = $state<Track[]>([]);
	index = $state(-1);
	src = $state<string | null>(null);
	playing = $state(false);
	error = $state<string | null>(null);
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
			this.src = await playableUrl(playback);
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
	const { delivery, artifact } = playback.availability;
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
