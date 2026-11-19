import assert from 'node:assert/strict';
import test from 'node:test';
import type { Track } from '../src/api.ts';
import { createAuthConfig } from '../src/auth-config.ts';
import { oauthMetadata } from '../src/oauth-metadata.ts';
import { hasTealGrant, hasTealPlayGrant, tealPlay, tealStatus, tealStatusWriter, TEAL_SCOPE_PARTS, writeTealPlay, type TealStatus } from '../src/teal-scrobble.ts';
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

test('Teal consent is advertised by both clients and excluded from ordinary login', () => {
	const config = createAuthConfig();
	assert.equal(hasTealGrant(config.SCOPE_PARTS.join(' ')), false);
	assert.equal(hasTealGrant(oauthMetadata(config, 'web').scope), true);
	assert.equal(hasTealGrant(oauthMetadata(config, 'native').scope), true);
	assert.equal(hasTealGrant(TEAL_SCOPE_PARTS.join(' ')), true);
	assert.equal(hasTealGrant(TEAL_SCOPE_PARTS[0]), false, 'a play-only grant from before now-playing asks again');
	assert.equal(hasTealPlayGrant(TEAL_SCOPE_PARTS[0]), true, 'and still logs plays meanwhile');
	assert.equal(hasTealGrant(`${TEAL_SCOPE_PARTS[0]} repo:fm.teal.actor.status?action=create`), false);
	assert.equal(hasTealGrant(TEAL_SCOPE_PARTS.join(' ').replace('feed.play?action=create', 'feed.play?action=delete')), false);
	assert.equal(hasTealGrant('repo:fm.teal.feed.play repo:fm.teal.actor.status'), true);
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

test('now playing runs to the end of the track, or the lexicon default when the length is unknown', () => {
	const status = tealStatus(track, time - 30_000, time, url)!;
	assert.equal(status.$type, 'fm.teal.actor.status');
	assert.equal(status.time, new Date(time).toISOString());
	assert.equal(status.expiry, new Date(time - 30_000 + 120_500 + 30_000).toISOString());
	assert.equal(status.item.playedTime, new Date(time - 30_000).toISOString());
	assert.equal(status.item.originUri, url);
	const unknown = { ...track, metadata: { ...track.metadata, duration_seconds: null } } as unknown as Track;
	assert.equal(tealStatus(unknown, time, time, url)!.expiry, new Date(time + 600_000).toISOString());
	assert.equal(tealStatus({ ...track, access: { visibility: 'private' } } as Track, time, time, url), undefined);
});

test('the writer sets now playing once the player settles, re-sets after a seek, and ends it on pause', async () => {
	let clock = time;
	const written: TealStatus[] = [];
	const writer = tealStatusWriter({ write: async record => { written.push(record); return true; }, origin: () => url, settle: 5, now: () => clock });
	const settle = () => new Promise(resolve => setTimeout(resolve, 20));
	const other = { ...track, id: 'trk_other' };

	writer.observe({ track: other, playing: true, positionSeconds: 0 });
	writer.observe({ track, playing: true, positionSeconds: 0 });
	await settle();
	assert.equal(written.length, 1, 'skipping through tracks writes once');
	assert.equal(written[0].item.trackName, 'A track');

	clock += 10_000;
	writer.observe({ track, playing: true, positionSeconds: 10 });
	await settle();
	assert.equal(written.length, 1, 'ordinary playback writes nothing new');

	writer.observe({ track, playing: true, positionSeconds: 90 });
	await settle();
	assert.equal(written.length, 2);
	assert.equal(written[1].item.playedTime, new Date(clock - 90_000).toISOString());

	writer.observe({ track, playing: false, positionSeconds: 90 });
	writer.observe({ track, playing: true, positionSeconds: 90 });
	await settle();
	assert.equal(written.length, 2, 'a blip of pause writes nothing');

	writer.observe({ track, playing: false, positionSeconds: 90 });
	await settle();
	assert.equal(written.length, 3);
	assert.equal(written[2].expiry, new Date(clock).toISOString(), 'pausing ends the status now');

	writer.observe({ track: { ...track, access: { visibility: 'private' } } as Track, playing: true, positionSeconds: 0 });
	await settle();
	assert.equal(written.length, 3, 'private tracks are never shown');
});

test('a failed write waits before trying again', async () => {
	let fail = true;
	let clock = time;
	const written: TealStatus[] = [];
	const writer = tealStatusWriter({ write: async record => { if (fail) throw new Error('offline'); written.push(record); return true; }, origin: () => url, settle: 5, now: () => clock });
	writer.observe({ track, playing: true, positionSeconds: 0 });
	await new Promise(resolve => setTimeout(resolve, 20));
	assert.equal(written.length, 0);
	fail = false;
	writer.observe({ track, playing: true, positionSeconds: 0 });
	await new Promise(resolve => setTimeout(resolve, 20));
	assert.equal(written.length, 0, 'no hammering a PDS that just failed');
	clock += 31_000;
	writer.observe({ track, playing: true, positionSeconds: 31 });
	await new Promise(resolve => setTimeout(resolve, 20));
	assert.equal(written.length, 1);
});
