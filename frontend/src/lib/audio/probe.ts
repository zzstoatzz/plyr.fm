/**
 * what the browser can learn about an audio file before a byte is sent:
 * its format from the name, its duration from the container header, and
 * whether a waveform can be decoded within a memory budget.
 */

import { extensionForMime } from '$lib/recorder.svelte';

/** how long to wait for a header-less container to be scanned for its length. */
export const DURATION_SCAN_TIMEOUT_MS = 15_000;

/**
 * the waveform's decoded PCM is kept at this rate, but the browser still
 * decodes at the file's own rate first: measured in chromium at roughly
 * 100 MB of transient memory per minute of audio (2026-09-01, an 85 MB
 * hour-long m4a took the process to +5.5 GB). the caps keep that transient
 * near a gigabyte on desktop and a few hundred megabytes on touch devices.
 */
export const WAVEFORM_DECODE_RATE = 8000;
export const WAVEFORM_MAX_SECONDS = 10 * 60;
export const WAVEFORM_MAX_SECONDS_TOUCH = 3 * 60;
export const WAVEFORM_MAX_BYTES = 100 * 1024 * 1024;

export function waveformMaxSeconds(): number {
	const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
	return touch ? WAVEFORM_MAX_SECONDS_TOUCH : WAVEFORM_MAX_SECONDS;
}

export function isUsableDuration(d: number): boolean {
	return Number.isFinite(d) && d > 0;
}

/** bare lowercase extension from a filename, or from the mime type when the name has none. */
export function audioFormatOf(name: string, mime = ''): string {
	const dot = name.lastIndexOf('.');
	if (dot !== -1 && dot < name.length - 1) return name.slice(dot + 1).toLowerCase();
	return mime === '' ? '' : extensionForMime(mime);
}

/** the slice of HTMLMediaElement that `mediaDuration` drives. */
export interface MediaDurationSource {
	duration: number;
	currentTime: number;
	addEventListener(type: 'durationchange' | 'error', listener: () => void): void;
	removeEventListener(type: 'durationchange' | 'error', listener: () => void): void;
}

/**
 * the element's duration once the browser knows it.
 *
 * MediaRecorder output (webm/ogg) carries no duration in its header, so the
 * element reports Infinity, 0, or NaN until it has scanned to the end. seeking
 * past any plausible time makes it scan and emit `durationchange` with the
 * real value; the position is then put back to the start.
 */
export function mediaDuration(
	el: MediaDurationSource,
	timeoutMs = DURATION_SCAN_TIMEOUT_MS
): Promise<number | null> {
	if (isUsableDuration(el.duration)) return Promise.resolve(el.duration);
	return new Promise((resolve) => {
		const cleanup = () => {
			clearTimeout(timer);
			el.removeEventListener('durationchange', onChange);
			el.removeEventListener('error', onError);
		};
		const done = (value: number | null) => {
			cleanup();
			resolve(value);
		};
		const onChange = () => {
			if (!isUsableDuration(el.duration)) return;
			el.currentTime = 0;
			done(el.duration);
		};
		const onError = () => done(null);
		const timer = setTimeout(() => done(null), timeoutMs);
		el.addEventListener('durationchange', onChange);
		el.addEventListener('error', onError);
		el.currentTime = 1e101;
	});
}

/** whether decoding a waveform for this file stays inside the memory budget. */
export function canRenderWaveform(
	sizeBytes: number,
	durationSeconds: number | null,
	maxSeconds = WAVEFORM_MAX_SECONDS
): boolean {
	if (sizeBytes > WAVEFORM_MAX_BYTES) return false;
	return durationSeconds !== null && durationSeconds <= maxSeconds;
}

/** `m:ss`, or `h:mm:ss` from an hour up. */
export function formatClock(seconds: number): string {
	const whole = isUsableDuration(seconds) ? Math.floor(seconds) : 0;
	const h = Math.floor(whole / 3600);
	const m = Math.floor((whole % 3600) / 60);
	const s = whole % 60;
	const ss = s.toString().padStart(2, '0');
	if (h === 0) return `${m}:${ss}`;
	return `${h}:${m.toString().padStart(2, '0')}:${ss}`;
}

export function formatMegabytes(bytes: number): string {
	const mb = bytes / 1024 / 1024;
	return `${mb >= 100 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
}
