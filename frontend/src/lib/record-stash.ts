/**
 * Holds a pending recording across the one-time private-media consent redirect.
 *
 * The upload form stashes its fields in sessionStorage, but a recording is a
 * multi-megabyte Blob — IndexedDB stores it natively, where sessionStorage
 * would need base64 and would blow the quota. Every call is best-effort:
 * storage access throws outright in sandboxed embeds.
 */

const DB_NAME = 'plyr-record';
const STORE = 'pending';
const KEY = 'recording';
const UPLOAD_KEY = 'upload-files';

/** the audio + cover files of an /upload draft, kept across the consent redirect. */
export interface StashedUploadFiles {
	file: File;
	imageFile: File | null;
}

export interface StashedRecording {
	blob: Blob;
	title: string;
	tags: string[];
	visibility: string;
	capturedDuration: number;
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1);
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(STORE)) {
				request.result.createObjectStore(STORE);
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function tx<T>(mode: IDBTransactionMode, run: (_store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return openDb().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const request = run(db.transaction(STORE, mode).objectStore(STORE));
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			})
	);
}

export async function stashRecording(recording: StashedRecording): Promise<boolean> {
	try {
		await tx('readwrite', (store) => store.put(recording, KEY));
		return true;
	} catch (e) {
		console.error('could not stash the recording:', e);
		return false;
	}
}

export async function takeStashedRecording(): Promise<StashedRecording | null> {
	try {
		const stashed = await tx<StashedRecording | undefined>('readonly', (store) => store.get(KEY));
		if (!stashed?.blob) return null;
		await clearStashedRecording();
		return stashed;
	} catch (e) {
		console.error('could not read the stashed recording:', e);
		return null;
	}
}

export async function clearStashedRecording(): Promise<void> {
	try {
		await tx('readwrite', (store) => store.delete(KEY));
	} catch (e) {
		console.error('could not clear the stashed recording:', e);
	}
}

export async function stashUploadFiles(files: StashedUploadFiles): Promise<boolean> {
	try {
		await tx('readwrite', (store) => store.put(files, UPLOAD_KEY));
		return true;
	} catch (e) {
		console.error('could not stash the upload files:', e);
		return false;
	}
}

export async function takeUploadFiles(): Promise<StashedUploadFiles | null> {
	try {
		const stashed = await tx<StashedUploadFiles | undefined>('readonly', (store) => store.get(UPLOAD_KEY));
		await clearUploadFiles();
		return stashed?.file ? stashed : null;
	} catch (e) {
		console.error('could not read the stashed upload files:', e);
		return null;
	}
}

export async function clearUploadFiles(): Promise<void> {
	try {
		await tx('readwrite', (store) => store.delete(UPLOAD_KEY));
	} catch (e) {
		console.error('could not clear the stashed upload files:', e);
	}
}
