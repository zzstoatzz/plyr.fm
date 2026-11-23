import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_AT_CLIENT, isAtClient, profileUrl } from '../src/at-clients.ts';

test('profile links open in the chosen app', () => {
	assert.equal(profileUrl('dawn.plyr.fm', 'blacksky'), 'https://blacksky.community/profile/dawn.plyr.fm');
	assert.equal(profileUrl('did:plc:abc', 'pdsls'), 'https://pdsls.dev/at/did:plc:abc');
});

test('an unknown or missing choice falls back to bluesky', () => {
	assert.equal(DEFAULT_AT_CLIENT, 'bsky');
	assert.equal(profileUrl('dawn.plyr.fm', undefined), 'https://bsky.app/profile/dawn.plyr.fm');
	assert.equal(profileUrl('dawn.plyr.fm', 'myspace'), 'https://bsky.app/profile/dawn.plyr.fm');
	assert.equal(isAtClient('myspace'), false);
	assert.equal(isAtClient('reddwarf'), true);
});
