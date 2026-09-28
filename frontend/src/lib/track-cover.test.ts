import { expect, it } from 'vitest';
import { trackCoverUrl, trackThumbnailUrl } from './track-cover';
import type { Track } from './types';

const track: Track = {
	id: 1,
	title: 'Crystal cathedral',
	artist: 'santi.codes',
	artist_handle: 'santi.codes',
	file_id: 'audio',
	file_type: 'mp3',
	play_count: 0,
	artist_avatar_url: 'https://example.com/avatar.jpg'
};

it('uses the artist avatar when neither track nor album has artwork', () => {
	expect(trackCoverUrl(track)).toBe(track.artist_avatar_url);
	expect(trackThumbnailUrl(track)).toBe(track.artist_avatar_url);
});

it('keeps track and album artwork ahead of the avatar', () => {
	const album = {
		id: 'album',
		title: 'Album',
		slug: 'album',
		track_count: 1,
		total_plays: 0,
		image_url: 'album.jpg',
		thumbnail_url: 'album-thumb.jpg'
	};
	expect(trackCoverUrl({ ...track, album })).toBe('album.jpg');
	expect(trackThumbnailUrl({ ...track, album })).toBe('album-thumb.jpg');
	const withArt = { ...track, album, image_url: 'track.jpg', thumbnail_url: 'track-thumb.jpg' };
	expect(trackCoverUrl(withArt)).toBe('track.jpg');
	expect(trackThumbnailUrl(withArt)).toBe('track-thumb.jpg');
});

it('leaves the placeholder available when no image exists', () => {
	const withoutAvatar = { ...track, artist_avatar_url: undefined };
	expect(trackCoverUrl(withoutAvatar)).toBeUndefined();
	expect(trackThumbnailUrl(withoutAvatar)).toBeUndefined();
});
