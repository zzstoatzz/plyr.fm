// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { pickFileIdForTrack } from './audio-source';
import type { Track } from './types';

vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');

it('streams the protected rendition even when the original is browser-playable', () => {
	const track: Track = {
		id: 1, title: 'protected work', artist: 'artist', artist_handle: 'artist.test',
		file_id: 'rendition', file_type: 'mp3', play_count: 0,
		original_file_id: 'master', original_file_type: 'flac', audio_storage: 'r2_private'
	};
	expect(pickFileIdForTrack(track)).toBe('rendition');
	expect(pickFileIdForTrack({ ...track, audio_storage: 'r2' })).toBe('master');
});
