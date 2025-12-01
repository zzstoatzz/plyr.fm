/**
 * now-playing service for reporting playback state to backend.
 *
 * enables external integrations like teal.fm/Piper to fetch current playback.
 * reports are throttled to avoid excessive API calls.
 */

import { browser } from '$app/environment';
import { auth } from './auth.svelte';
import { API_URL } from './config';
import type { Track } from './types';

const REPORT_INTERVAL_MS = 10_000; // report every 10 seconds during playback
const REPORT_DEBOUNCE_MS = 1_000; // debounce rapid changes

class NowPlayingService {
	private lastReportTime = 0;
	private reportTimer: number | null = null;
	private lastReportedState: string | null = null;

	/**
	 * report current playback state to backend.
	 * automatically debounces and throttles to avoid excessive API calls.
	 */
	async report(
		track: Track | null,
		isPlaying: boolean,
		currentTimeMs: number,
		durationMs: number
	): Promise<void> {
		if (!browser || !track) {
			return;
		}

		// skip if not authenticated (auth uses HttpOnly cookies)
		if (!auth.isAuthenticated) {
			return;
		}

		// create state fingerprint to detect actual changes
		const stateFingerprint = JSON.stringify({
			trackId: track.id,
			isPlaying,
			// round progress to nearest 5 seconds to reduce noise
			progressBucket: Math.floor(currentTimeMs / 5000)
		});

		// skip if state hasn't meaningfully changed
		if (stateFingerprint === this.lastReportedState) {
			return;
		}

		// throttle reports during continuous playback
		const now = Date.now();
		const timeSinceLastReport = now - this.lastReportTime;

		if (timeSinceLastReport < REPORT_DEBOUNCE_MS) {
			// debounce rapid changes (e.g., seeking)
			this.scheduleReport(track, isPlaying, currentTimeMs, durationMs);
			return;
		}

		if (isPlaying && timeSinceLastReport < REPORT_INTERVAL_MS) {
			// throttle during continuous playback
			this.scheduleReport(track, isPlaying, currentTimeMs, durationMs);
			return;
		}

		// clear any pending scheduled report
		if (this.reportTimer !== null) {
			window.clearTimeout(this.reportTimer);
			this.reportTimer = null;
		}

		await this.sendReport(track, isPlaying, currentTimeMs, durationMs);
		this.lastReportTime = now;
		this.lastReportedState = stateFingerprint;
	}

	private pendingState: { track: Track; isPlaying: boolean; currentTimeMs: number; durationMs: number } | null = null;

	private scheduleReport(
		track: Track,
		isPlaying: boolean,
		currentTimeMs: number,
		durationMs: number
	): void {
		// always update pending state so timer fires with latest values
		this.pendingState = { track, isPlaying, currentTimeMs, durationMs };

		if (this.reportTimer !== null) {
			return; // timer already running
		}

		this.reportTimer = window.setTimeout(async () => {
			this.reportTimer = null;
			if (this.pendingState) {
				await this.sendReport(
					this.pendingState.track,
					this.pendingState.isPlaying,
					this.pendingState.currentTimeMs,
					this.pendingState.durationMs
				);
				this.pendingState = null;
				this.lastReportTime = Date.now();
			}
		}, REPORT_DEBOUNCE_MS);
	}

	private async sendReport(
		track: Track,
		isPlaying: boolean,
		currentTimeMs: number,
		durationMs: number
	): Promise<void> {
		try {
			await fetch(`${API_URL}/now-playing/`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					track_id: track.id,
					file_id: track.file_id,
					track_name: track.title,
					artist_name: track.artist,
					album_name: track.album?.title ?? null,
					duration_ms: Math.round(durationMs),
					progress_ms: Math.round(currentTimeMs),
					is_playing: isPlaying,
					image_url: track.image_url ?? track.artist_avatar_url ?? null
				})
			});
		} catch (error) {
			// fail silently - now-playing is best-effort
			console.debug('failed to report now-playing:', error);
		}
	}

	/**
	 * clear now-playing state when playback stops.
	 */
	async clear(): Promise<void> {
		if (!browser) {
			return;
		}

		// skip if not authenticated (auth uses HttpOnly cookies)
		if (!auth.isAuthenticated) {
			return;
		}

		// clear any pending report
		if (this.reportTimer !== null) {
			window.clearTimeout(this.reportTimer);
			this.reportTimer = null;
		}

		this.lastReportedState = null;

		try {
			await fetch(`${API_URL}/now-playing/`, {
				method: 'DELETE',
				credentials: 'include'
			});
		} catch (error) {
			console.debug('failed to clear now-playing:', error);
		}
	}
}

export const nowPlaying = new NowPlayingService();
