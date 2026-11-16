import assert from 'node:assert/strict';
import test from 'node:test';
import type { Track } from '../src/api.ts';
import { createAuthConfig } from '../src/auth-config.ts';
import { oauthMetadata } from '../src/oauth-metadata.ts';
import { hasTealGrant, tealPlay, TEAL_SCOPE, writeTealPlay } from '../src/teal-scrobble.ts';
import type { RepoRpc } from '../src/publishing/repo-rpc.ts';

const track: Track = {
	object: 'track', id: 'trk_fixture',
	record: { uri: 'at://did:plc:fixture/fm.plyr.track/item', cid: null, revision: null, collection: 'fm.plyr.track', rkey: 'item' },
	artist: { did: 'did:plc:fixture', profile: { display_name: 'A musician', handle: 'artist.test', avatar_url: null } },
	metadata: { title: 'A track', album: 'A release', duration_seconds: 120.5, description: null, created_at: '' },
	media: {}, access: { visibility: 'public' }, metrics: { play_count: 0, like_count: 0 }
};
const play = { trackId: track.id, occurrenceId: 'fe84c36c-7418-4bf9-ad35-220b288f36f1' };
const time = Date.parse('2026-11-15T12:00:00Z');
const url = 'https://next.plyr.fm/track/trk_fixture';

test('Teal consent is advertised for web but excluded from ordinary login', () => {
	const config = createAuthConfig();
	assert.equal(hasTealGrant(config.SCOPE_PARTS.join(' ')), false);
	assert.equal(hasTealGrant(oauthMetadata(config, 'web').scope), true);
	assert.equal(hasTealGrant(oauthMetadata(config, 'native').scope), false);
	assert.equal(hasTealGrant(TEAL_SCOPE.replace('create', 'delete')), false);
	assert.equal(hasTealGrant('repo:fm.teal.feed.play'), true);
});

test('scrobbles only the matching public track at one stable address', () => {
	const published = tealPlay(track, play, time, url);
	assert.ok(published);
	assert.match(published.rkey, /^[234567abcdefghijk][234567abcdefghijklmnopqrstuvwxyz]{12}$/);
	assert.deepEqual(tealPlay(track, play, time, url), published);
	assert.deepEqual(published.record, {
		$type: 'fm.teal.feed.play', trackName: 'A track', artists: [{ artistName: 'A musician' }],
		musicServiceUri: 'https://plyr.fm', submissionClientAgent: 'plyr.fm/next',
		playedTime: '2026-11-15T12:00:00.000Z', originUri: url, releaseName: 'A release', duration: 120
	});
	const credit = '歌'.repeat(200);
	const credited = tealPlay({ ...track, metadata: { ...track.metadata, artist_name: credit } }, play, time, url);
	assert.equal(credited?.record.artists[0].artistName, '歌'.repeat(85));
	for (const visibility of ['unlisted', 'supporters', 'private'] as const) {
		assert.equal(tealPlay({ ...track, access: { visibility } }, play, time, url), undefined);
	}
	assert.equal(tealPlay({ ...track, access: { visibility: 'public', gate: { type: 'any' } } }, play, time, url), undefined);
	assert.equal(tealPlay(track, { ...play, trackId: 'trk_different' }, time, url), undefined);
});

test('a lost write response can be retried at the same play address', async () => {
	const published = tealPlay(track, play, time, url)!;
	let address: string | undefined;
	const rpc = {
		async post(_method: string, { input }: { input: { rkey: string } }) {
			address = input.rkey;
			return { ok: false, status: 409, data: { error: 'RecordAlreadyExists' } };
		},
		async get(_method: string, { params }: { params: { rkey: string } }) {
			assert.equal(params.rkey, address);
			return { ok: true, data: { uri: 'at://did:plc:fixture/fm.teal.feed.play/' + address, cid: 'cid', value: published.record } };
		}
	} as RepoRpc;
	await writeTealPlay(rpc, 'did:plc:fixture', published);
});
