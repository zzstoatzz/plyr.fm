/**
 * Helpers for keeping `navigator.mediaSession` populated.
 *
 * Use from any component that owns an `<audio>` element and wants the OS
 * lock-screen / system-media controls to show track title / artist /
 * artwork and route play/pause/next/prev to the right handlers.
 *
 * The main app player has its own (older) inline implementation in
 * `Player.svelte`; that's untouched here. These helpers exist so the
 * embed surfaces (which today set NO MediaSession state, leaving lock
 * screens with a placeholder) can match.
 *
 * All functions are no-ops on platforms / contexts where the API isn't
 * available (e.g. SSR, very old browsers).
 */

export interface MediaMetadataInput {
	title: string;
	artist: string;
	album?: string;
	/**
	 * Preferred artwork URL (per-track image). When absent, the helper
	 * falls back to `artworkFallbackUrl` (typically the collection /
	 * album cover); when both are absent it leaves artwork empty so
	 * the OS shows whatever it would by default.
	 */
	artworkUrl?: string | null;
	artworkFallbackUrl?: string | null;
}

function hasMediaSession(): boolean {
	return typeof navigator !== 'undefined' && 'mediaSession' in navigator;
}

function buildArtwork(input: MediaMetadataInput): MediaImage[] {
	const url = input.artworkUrl ?? input.artworkFallbackUrl;
	if (!url) return [];
	// Single 512×512 entry is the documented well-supported shape across
	// Chrome / Safari / Firefox; multiple sizes are nice-to-have but the
	// OS scales as needed.
	return [{ src: url, sizes: '512x512', type: 'image/jpeg' }];
}

export function setMediaSessionMetadata(input: MediaMetadataInput): void {
	if (!hasMediaSession()) return;
	navigator.mediaSession.metadata = new MediaMetadata({
		title: input.title,
		artist: input.artist,
		album: input.album ?? '',
		artwork: buildArtwork(input)
	});
}

export function clearMediaSessionMetadata(): void {
	if (!hasMediaSession()) return;
	navigator.mediaSession.metadata = null;
}

export function setMediaSessionPlaybackState(
	state: 'playing' | 'paused' | 'none'
): void {
	if (!hasMediaSession()) return;
	navigator.mediaSession.playbackState = state;
}

export function setMediaSessionPositionState(opts: {
	duration: number;
	position: number;
	playbackRate?: number;
}): void {
	if (!hasMediaSession()) return;
	if (!opts.duration || opts.duration <= 0) return;
	// `setPositionState` throws on bad input (e.g. position > duration);
	// the OS-level position display is purely cosmetic, so swallow.
	try {
		navigator.mediaSession.setPositionState({
			duration: opts.duration,
			position: Math.max(0, Math.min(opts.position, opts.duration)),
			playbackRate: opts.playbackRate ?? 1
		});
	} catch {
		// no-op: stale duration/position during track transitions can fail
	}
}

export type MediaSessionHandlers = Partial<
	Record<MediaSessionAction, MediaSessionActionHandler | null>
>;

/**
 * Apply (or clear, by passing `null`) a set of action handlers. Pass
 * `null` for an action to remove its handler — useful when a context
 * doesn't support that action (e.g. single-track embeds have no
 * `nexttrack`/`previoustrack`, so passing `null` for those tells the
 * OS to grey them out instead of inheriting a stale handler from a
 * prior page.
 */
export function setMediaSessionActionHandlers(
	handlers: MediaSessionHandlers
): void {
	if (!hasMediaSession()) return;
	for (const [action, handler] of Object.entries(handlers) as Array<
		[MediaSessionAction, MediaSessionActionHandler | null]
	>) {
		try {
			navigator.mediaSession.setActionHandler(action, handler);
		} catch {
			// some browsers throw on unsupported actions; leave them be
		}
	}
}
