// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { defaultPublishing } from './publishing';
import { clearTrackFormStash, restoreTrackForm, stashTrackForm } from './upload-form-stash';

afterEach(clearTrackFormStash);

it('preserves track rights and restricted access across sign-in', () => {
	const draft = {
		title: 'a work', albumTitle: '', description: '', featuredArtists: [],
		uploadTags: [], attestedRights: true, autoTag: false,
		publishing: { ...defaultPublishing(), attach_rights: true },
		copyrightRights: { iswc: 'T-000.000.001-0' }
	};
	draft.publishing.access.downloads = 'off';
	stashTrackForm(draft);
	expect(restoreTrackForm()).toEqual(draft);
});
