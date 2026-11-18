import assert from 'node:assert/strict';
import test from 'node:test';
import { editedProfile, type ProfileRecord } from '../src/profile-record.ts';

const TYPE = 'fm.plyr.actor.profile';
const NOW = '2026-11-17T00:00:00.000Z';
const blob = { $type: 'blob', ref: { $link: 'bafyavatar' }, mimeType: 'image/jpeg', size: 1 };
const stored: ProfileRecord = {
	$type: TYPE, createdAt: '2026-01-01T00:00:00.000Z', bio: 'old', avatar: 'https://cdn.example/a.jpg', displayName: 'nate', favoriteTrack: 'at://x'
};

test('an uploaded avatar writes the blob and its url, keeping other fields', () => {
	const record = editedProfile(stored, { bio: 'new', image: { blob, url: 'https://pds.example/blob' } }, TYPE, NOW);
	assert.deepEqual(record, { ...stored, bio: 'new', avatar: 'https://pds.example/blob', avatarBlob: blob, updatedAt: NOW });
});

test('removing the avatar drops both fields', () => {
	const record = editedProfile({ ...stored, avatarBlob: blob }, { bio: 'old', image: null }, TYPE, NOW);
	assert.equal(record.avatar, undefined);
	assert.equal(record.avatarBlob, undefined);
	assert.equal(record.displayName, 'nate');
});

test('a bio-only edit keeps an uploaded avatar', () => {
	const record = editedProfile({ ...stored, avatarBlob: blob }, { bio: 'new' }, TYPE, NOW);
	assert.equal(record.avatar, stored.avatar);
	assert.deepEqual(record.avatarBlob, blob);
});

test('an unchanged avatar url keeps the blob; a new url replaces it', () => {
	const withBlob = { ...stored, avatarBlob: blob };
	assert.deepEqual(editedProfile(withBlob, { bio: 'old', avatar: stored.avatar }, TYPE, NOW).avatarBlob, blob);
	const replaced = editedProfile(withBlob, { bio: 'old', avatar: 'https://example.com/b.png' }, TYPE, NOW);
	assert.equal(replaced.avatar, 'https://example.com/b.png');
	assert.equal(replaced.avatarBlob, undefined);
});

test('a first profile has no updatedAt', () => {
	const record = editedProfile(null, { bio: 'hi', image: { blob, url: 'https://pds.example/blob' } }, TYPE, NOW);
	assert.deepEqual(record, { $type: TYPE, createdAt: NOW, bio: 'hi', avatar: 'https://pds.example/blob', avatarBlob: blob });
});
