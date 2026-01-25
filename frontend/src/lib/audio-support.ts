import { browser } from '$app/environment';

/**
 * MIME types for lossless audio formats.
 * Safari supports AIFF and FLAC natively.
 */
const LOSSLESS_MIME_TYPES: Record<string, string> = {
	aiff: 'audio/aiff',
	aif: 'audio/aiff',
	flac: 'audio/flac'
};

/**
 * Cache for browser audio format support detection.
 * Computed once per session.
 */
let supportCache: Record<string, boolean> | null = null;

/**
 * Detect which audio formats the browser can play natively.
 */
function detectAudioSupport(): Record<string, boolean> {
	if (!browser) return {};

	const audio = document.createElement('audio');
	const support: Record<string, boolean> = {};

	for (const [format, mimeType] of Object.entries(LOSSLESS_MIME_TYPES)) {
		// canPlayType returns '', 'maybe', or 'probably'
		const result = audio.canPlayType(mimeType);
		support[format] = result === 'probably' || result === 'maybe';
	}

	return support;
}

/**
 * Check if the browser can play a specific audio format natively.
 */
export function canPlayFormat(format: string | null | undefined): boolean {
	if (!format || !browser) return false;

	if (!supportCache) {
		supportCache = detectAudioSupport();
	}

	const normalized = format.toLowerCase().replace('.', '');
	return supportCache[normalized] ?? false;
}

/**
 * Check if a track has a lossless original that this browser can play.
 */
export function hasPlayableLossless(originalFileType: string | null | undefined): boolean {
	return canPlayFormat(originalFileType);
}
