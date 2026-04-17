import { API_URL } from '$lib/config';
import { getLikers, setLikers, type LikerData } from '$lib/tooltip-cache.svelte';

class LikersSheetState {
	isOpen = $state(false);
	trackId = $state<number | null>(null);
	likeCount = $state(0);
	likers = $state<LikerData[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);

	open(trackId: number, likeCount: number) {
		this.trackId = trackId;
		this.likeCount = likeCount;
		this.isOpen = true;
		this.error = null;

		const cached = getLikers(trackId);
		if (cached) {
			this.likers = cached;
			this.loading = false;
			return;
		}

		this.likers = [];
		this.loading = true;
		this.fetchLikers(trackId);
	}

	close() {
		this.isOpen = false;
	}

	private async fetchLikers(trackId: number) {
		try {
			const response = await fetch(`${API_URL}/tracks/${trackId}/likes`);
			if (!response.ok) throw new Error(`failed to fetch likers: ${response.status}`);
			const data = await response.json();
			const users: LikerData[] = data.users || [];

			// stale guard — sheet may have been closed/reopened for a different track
			if (this.trackId !== trackId) return;

			this.likers = users;
			setLikers(trackId, users);
		} catch {
			if (this.trackId !== trackId) return;
			this.error = 'failed to load';
		} finally {
			if (this.trackId === trackId) this.loading = false;
		}
	}
}

export const likersSheet = new LikersSheetState();
