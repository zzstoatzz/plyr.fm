import { browser } from '$app/environment';

/**
 * Lossless audio formats and their MIME types.
 * Safari supports AIFF and FLAC natively.
 */
const LOSSLESS_FORMATS = ['aiff', 'aif', 'flac'] as const;

type LosslessFormat = (typeof LOSSLESS_FORMATS)[number];

const LOSSLESS_MIME_TYPES = {
	aiff: 'audio/aiff',
	aif: 'audio/aiff',
	flac: 'audio/flac'
} as const satisfies Record<LosslessFormat, string>;

function losslessFormat(format: string): LosslessFormat | null {
	const normalized = format.toLowerCase().replace('.', '');
	return LOSSLESS_FORMATS.find((candidate) => candidate === normalized) ?? null;
}

/**
 * Cache for browser audio format support detection.
 * Computed once per session.
 */
let supportCache: Map<LosslessFormat, boolean> | null = null;

/**
 * Detect which audio formats the browser can play natively.
 */
function detectAudioSupport(): Map<LosslessFormat, boolean> {
	const support = new Map<LosslessFormat, boolean>();
	if (!browser) return support;

	const audio = document.createElement('audio');
	for (const format of LOSSLESS_FORMATS) {
		// canPlayType returns '', 'maybe', or 'probably'
		const result = audio.canPlayType(LOSSLESS_MIME_TYPES[format]);
		support.set(format, result === 'probably' || result === 'maybe');
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

	const lossless = losslessFormat(format);
	return lossless !== null && (supportCache.get(lossless) ?? false);
}

/**
 * Check if a track has a lossless original that this browser can play.
 */
export function hasPlayableLossless(originalFileType: string | null | undefined): boolean {
	return canPlayFormat(originalFileType);
}

/**
 * Check if a format is lossless (regardless of browser playback support).
 */
export function isLosslessFormat(format: string | null | undefined): boolean {
	if (!format) return false;
	return losslessFormat(format) !== null;
}
