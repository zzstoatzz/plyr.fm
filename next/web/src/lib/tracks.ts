import type { Track } from '@plyr/next-core/api';

export function artistName(track: Track) {
	return track.metadata.artist_name || track.artist.profile.display_name || track.artist.profile.handle;
}

export function clock(seconds: number | null | undefined) {
	if (seconds === undefined || seconds === null || !Number.isFinite(seconds)) return '–:––';
	const whole = Math.max(0, Math.floor(seconds));
	const minutes = Math.floor(whole / 60);
	return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}
