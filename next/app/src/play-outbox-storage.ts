import { createMMKV } from 'react-native-mmkv';
import { pendingPlay, PLAY_OUTBOX_LIMIT, type PendingPlay, type PlayOutboxStorage } from './play-outbox';

const storage = createMMKV({ id: 'plyr-next-play-outbox' });

function load(): PendingPlay[] {
	return storage.getAllKeys().flatMap(key => {
		try {
			const play = pendingPlay(JSON.parse(storage.getString(key) ?? 'null'));
			return play ? [play] : [];
		} catch { return []; }
	});
}

export const playOutboxStorage: PlayOutboxStorage = {
	async load() { return load(); },
	async put(play) {
		storage.set(play.occurrenceId, JSON.stringify(play));
		const plays = load().sort((a, b) => a.createdAt - b.createdAt);
		for (const stale of plays.slice(0, Math.max(0, plays.length - PLAY_OUTBOX_LIMIT))) storage.remove(stale.occurrenceId);
	},
	async delete(occurrenceId) { storage.remove(occurrenceId); }
};
