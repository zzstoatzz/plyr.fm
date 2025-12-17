/**
 * offline storage layer for plyr.fm
 *
 * uses Cache API for audio bytes (large binary files, quota-managed)
 * uses IndexedDB for download metadata (queryable, persistent)
 *
 * this module bypasses the service worker entirely - we fetch directly
 * from R2 and store in Cache API from the main thread. this avoids
 * iOS PWA issues with service worker + redirects + range requests.
 */

/* eslint-disable no-undef */

import { API_URL } from './config';

// cache name for audio files
const AUDIO_CACHE_NAME = 'plyr-audio-v1';

// IndexedDB config
const DB_NAME = 'plyr-offline';
const DB_VERSION = 1;
const DOWNLOADS_STORE = 'downloads';

export interface DownloadRecord {
	file_id: string;
	size: number;
	downloaded_at: number;
	file_type: string | null;
}

// IndexedDB helpers

function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;

			if (!db.objectStoreNames.contains(DOWNLOADS_STORE)) {
				const store = db.createObjectStore(DOWNLOADS_STORE, { keyPath: 'file_id' });
				store.createIndex('downloaded_at', 'downloaded_at', { unique: false });
			}
		};
	});
}

async function getDownloadRecord(file_id: string): Promise<DownloadRecord | null> {
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(DOWNLOADS_STORE, 'readonly');
		const store = tx.objectStore(DOWNLOADS_STORE);
		const request = store.get(file_id);

		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result || null);
	});
}

async function setDownloadRecord(record: DownloadRecord): Promise<void> {
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(DOWNLOADS_STORE, 'readwrite');
		const store = tx.objectStore(DOWNLOADS_STORE);
		const request = store.put(record);

		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve();
	});
}

async function deleteDownloadRecord(file_id: string): Promise<void> {
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(DOWNLOADS_STORE, 'readwrite');
		const store = tx.objectStore(DOWNLOADS_STORE);
		const request = store.delete(file_id);

		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve();
	});
}

/**
 * get all download records from IndexedDB
 */
export async function getAllDownloads(): Promise<DownloadRecord[]> {
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(DOWNLOADS_STORE, 'readonly');
		const store = tx.objectStore(DOWNLOADS_STORE);
		const request = store.getAll();

		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
	});
}

// Cache API helpers

/**
 * get the cache key for an audio file
 * Cache API requires http/https URLs, so we use a fake but valid URL
 */
function getCacheKey(file_id: string): string {
	return `https://plyr.fm/_offline/${file_id}`;
}

/**
 * check if audio is cached locally
 */
export async function isDownloaded(file_id: string): Promise<boolean> {
	const record = await getDownloadRecord(file_id);
	return record !== null;
}

/**
 * get cached audio as a blob URL for playback
 * returns null if not cached
 */
export async function getCachedAudioUrl(file_id: string): Promise<string | null> {
	try {
		const cache = await caches.open(AUDIO_CACHE_NAME);
		const response = await cache.match(getCacheKey(file_id));

		if (!response) {
			return null;
		}

		const blob = await response.blob();
		return URL.createObjectURL(blob);
	} catch (error) {
		console.error('failed to get cached audio:', error);
		return null;
	}
}

/**
 * download audio file and cache it locally
 *
 * 1. fetch presigned URL from backend
 * 2. fetch audio from R2 directly
 * 3. store in Cache API
 * 4. record in IndexedDB
 */
export async function downloadAudio(
	file_id: string,
	onProgress?: (loaded: number, total: number) => void
): Promise<void> {
	// 1. get presigned URL from backend
	const urlResponse = await fetch(`${API_URL}/audio/${file_id}/url`, {
		credentials: 'include'
	});

	if (!urlResponse.ok) {
		throw new Error(`failed to get audio URL: ${urlResponse.status}`);
	}

	const { url, file_type } = await urlResponse.json();

	// 2. fetch audio from R2
	const audioResponse = await fetch(url);

	if (!audioResponse.ok) {
		throw new Error(`failed to fetch audio: ${audioResponse.status}`);
	}

	// get total size for progress tracking
	const contentLength = audioResponse.headers.get('content-length');
	const total = contentLength ? parseInt(contentLength, 10) : 0;

	// read the response as a blob, tracking progress if callback provided
	let blob: Blob;

	if (onProgress && audioResponse.body && total > 0) {
		const reader = audioResponse.body.getReader();
		const chunks: BlobPart[] = [];
		let loaded = 0;

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			chunks.push(value);
			loaded += value.length;
			onProgress(loaded, total);
		}

		blob = new Blob(chunks, {
			type: audioResponse.headers.get('content-type') || 'audio/mpeg'
		});
	} else {
		blob = await audioResponse.blob();
	}

	// 3. store in Cache API
	const cache = await caches.open(AUDIO_CACHE_NAME);
	const cacheResponse = new Response(blob, {
		headers: {
			'content-type': blob.type,
			'content-length': blob.size.toString()
		}
	});
	await cache.put(getCacheKey(file_id), cacheResponse);

	// 4. record in IndexedDB
	await setDownloadRecord({
		file_id,
		size: blob.size,
		downloaded_at: Date.now(),
		file_type
	});
}

/**
 * remove downloaded audio from cache and IndexedDB
 */
export async function removeDownload(file_id: string): Promise<void> {
	// remove from Cache API
	const cache = await caches.open(AUDIO_CACHE_NAME);
	await cache.delete(getCacheKey(file_id));

	// remove from IndexedDB
	await deleteDownloadRecord(file_id);
}

/**
 * get storage usage estimate
 * returns bytes used and quota
 */
export async function getStorageUsage(): Promise<{ used: number; quota: number }> {
	if ('storage' in navigator && 'estimate' in navigator.storage) {
		const estimate = await navigator.storage.estimate();
		return {
			used: estimate.usage || 0,
			quota: estimate.quota || 0
		};
	}

	// fallback: sum up our download records
	const downloads = await getAllDownloads();
	const used = downloads.reduce((sum, d) => sum + d.size, 0);

	return { used, quota: 0 };
}

/**
 * clear all downloaded audio
 */
export async function clearAllDownloads(): Promise<void> {
	// clear Cache API
	await caches.delete(AUDIO_CACHE_NAME);

	// clear IndexedDB
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(DOWNLOADS_STORE, 'readwrite');
		const store = tx.objectStore(DOWNLOADS_STORE);
		const request = store.clear();

		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve();
	});
}

/**
 * download all liked tracks that aren't already cached
 * returns the number of tracks that were downloaded
 */
export async function downloadAllLikedTracks(): Promise<number> {
	// fetch liked tracks from API
	const response = await fetch(`${API_URL}/tracks/liked`, {
		credentials: 'include'
	});

	if (!response.ok) {
		throw new Error(`failed to fetch liked tracks: ${response.status}`);
	}

	const data = await response.json();
	const tracks = data.tracks as { file_id: string }[];

	let downloadedCount = 0;

	// download each track that isn't already cached
	for (const track of tracks) {
		try {
			const alreadyDownloaded = await isDownloaded(track.file_id);
			if (!alreadyDownloaded) {
				await downloadAudio(track.file_id);
				downloadedCount++;
			}
		} catch (err) {
			console.error(`failed to download track ${track.file_id}:`, err);
			// continue with other tracks
		}
	}

	return downloadedCount;
}
