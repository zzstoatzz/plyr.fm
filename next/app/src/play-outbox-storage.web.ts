import { pendingPlay, PLAY_OUTBOX_LIMIT, type PendingPlay, type PlayOutboxStorage } from './play-outbox';

let database: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
	if (!database) database = new Promise((resolve, reject) => {
		const request = indexedDB.open('plyr-next-play-outbox', 1);
		request.onupgradeneeded = () => { request.result.createObjectStore('plays', { keyPath: 'occurrenceId' }); };
		request.onsuccess = () => { resolve(request.result); };
		request.onerror = () => { database = undefined; reject(request.error); };
	});
	return database;
}

function completed(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => { resolve(); };
		transaction.onerror = () => { reject(transaction.error); };
		transaction.onabort = () => { reject(transaction.error); };
	});
}

export const playOutboxStorage: PlayOutboxStorage = {
	async load() {
		const db = await open();
		return new Promise((resolve, reject) => {
			const request = db.transaction('plays', 'readonly').objectStore('plays').getAll();
			request.onsuccess = () => { resolve(request.result.flatMap(value => { const play = pendingPlay(value); return play ? [play] : []; })); };
			request.onerror = () => { reject(request.error); };
		});
	},
	async put(play: PendingPlay) {
		const db = await open();
		const transaction = db.transaction('plays', 'readwrite');
		const store = transaction.objectStore('plays');
		store.put(play);
		const all = store.getAll();
		all.onsuccess = () => {
			const plays: PendingPlay[] = all.result.flatMap(value => { const parsed = pendingPlay(value); return parsed ? [parsed] : []; });
			plays.sort((a, b) => a.createdAt - b.createdAt);
			for (const stale of plays.slice(0, Math.max(0, plays.length - PLAY_OUTBOX_LIMIT))) store.delete(stale.occurrenceId);
		};
		await completed(transaction);
	},
	async delete(occurrenceId: string) {
		const db = await open();
		const transaction = db.transaction('plays', 'readwrite');
		transaction.objectStore('plays').delete(occurrenceId);
		await completed(transaction);
	}
};
