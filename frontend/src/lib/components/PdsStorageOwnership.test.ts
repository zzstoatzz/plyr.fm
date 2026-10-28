import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AudioRevisionsSheet from './AudioRevisionsSheet.svelte';
import PdsSaveControl from './PdsSaveControl.svelte';
import PdsSaveModal from './PdsSaveModal.svelte';
import type { Track } from '$lib/types';

let cleanup: (() => void) | undefined;

const protectedSpace: Track = {
	id: 1,
	title: 'Space audio',
	artist: 'artist',
	artist_handle: 'artist.test',
	file_id: 'protected',
	file_type: 'mp3',
	play_count: 0,
	audio_storage: 'r2_private',
	pds_blob_cid: null,
	audio_space:
		'at://did:plc:artist/space/fm.plyr.stg.privateMedia/playback/did:plc:artist/fm.plyr.stg.track/audio'
};

const protectedR2: Track = {
	...protectedSpace,
	id: 2,
	title: 'plyr-only audio',
	audio_space: null
};
const publicR2: Track = { ...protectedR2, id: 3, title: 'public audio', audio_storage: 'r2' };

afterEach(() => {
	cleanup?.();
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

it('counts protected Space audio as owned without offering a public blob save', () => {
	const component = mount(PdsSaveControl, {
		target: document.body,
		props: { tracks: [protectedSpace] }
	});
	cleanup = () => {
		void unmount(component);
	};
	flushSync();
	expect(document.body.textContent).toContain('all your audio is on your PDS');
	expect(document.querySelector('.save-trigger-btn')).toBeNull();
});

it('does not claim every track is on the PDS when protected R2-only audio remains', () => {
	const component = mount(PdsSaveControl, {
		target: document.body,
		props: { tracks: [protectedSpace, protectedR2] }
	});
	cleanup = () => {
		void unmount(component);
	};
	flushSync();
	expect(document.body.textContent).not.toContain('all your audio is on your PDS');
	expect(document.body.textContent).toContain('1 protected track remains');
});

it('shows Space audio as saved and offers only ordinary public audio for migration', async () => {
	vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ sizes: {} })));
	const save = vi.fn();
	const component = mount(PdsSaveModal, {
		target: document.body,
		props: {
			tracks: [protectedSpace, protectedR2, publicR2],
			open: true,
			onClose: () => {},
			onSave: save
		}
	});
	cleanup = () => {
		void unmount(component);
	};
	flushSync();
	await vi.waitFor(() => expect(document.querySelectorAll('.pds-track-row')).toHaveLength(3));
	const rows = document.querySelectorAll('.pds-track-row');
	expect(rows[0].textContent).toContain('on your PDS');
	expect(rows[0].querySelector('input')).toBeNull();
	expect(rows[1].textContent).toContain('gated');
	expect(rows[1].querySelector('input')).toBeNull();
	const choice = rows[2].querySelector('input');
	if (!choice) throw new Error('public audio choice missing');
	choice.click();
	flushSync();
	document.querySelector<HTMLButtonElement>('.pds-save-btn')?.click();
	expect(save).toHaveBeenCalledWith([3]);
});

it('identifies a historical protected Space source as audio on the PDS', () => {
	const component = mount(AudioRevisionsSheet, {
		target: document.body,
		props: {
			open: true,
			trackTitle: 'Space audio',
			loading: false,
			error: null,
			onClose: () => {},
			onRestore: () => {},
			revisions: [
				{
					id: 1,
					track_id: 1,
					created_at: new Date().toISOString(),
					file_type: 'mp3',
					original_file_type: null,
					audio_storage: 'r2_private',
					audio_space: protectedSpace.audio_space,
					duration: 30,
					was_gated: true
				}
			]
		}
	});
	cleanup = () => {
		void unmount(component);
	};
	flushSync();
	expect(document.body.textContent).toContain('on your PDS');
	expect(document.body.textContent).not.toContain('on plyr.fm');
});
