import assert from 'node:assert/strict';
import test from 'node:test';
import { listeningElapsed, listeningNow } from '../src/teal-status.ts';

const now = Date.parse('2026-11-19T01:00:00Z');
const at = (offset: number) => new Date(now + offset).toISOString();
const status = (item: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
	$type: 'fm.teal.actor.status', time: at(-60_000), expiry: at(9 * 60_000), item: { trackName: 'Song', artists: [{ artistName: 'Band' }], playedTime: at(-60_000), ...item }, ...extra
});

test('a current status reads as the track, its artists and where it is', () => {
	const shown = listeningNow(status({
		duration: 200, releaseName: 'Record', releaseMbId: 'A1B2C3D4-0000-4000-8000-000000000000',
		artists: [{ artistName: 'Band' }, { artistName: ' ' }, { artistName: 'Guest' }], originUri: 'https://plyr.fm/track/812'
	}), now);
	assert.deepEqual(shown, {
		track: 'Song', artists: ['Band', 'Guest'], release: 'Record', duration: 200,
		startedAt: now - 60_000, endsAt: now - 60_000 + 230_000,
		coverUrl: 'https://coverartarchive.org/release/a1b2c3d4-0000-4000-8000-000000000000/front-250', plyrTrack: '812'
	});
	assert.equal(listeningElapsed(shown!, now), 60);
	assert.equal(listeningElapsed(shown!, now + 999_000), 200);
});

test('a status is gone once it expires or its track has ended', () => {
	assert.equal(listeningNow(status({}, { expiry: at(-1) }), now), null);
	assert.equal(listeningNow(status({ duration: 20 }), now), null);
	assert.equal(listeningNow(status({}, { expiry: undefined, time: at(-11 * 60_000) }), now), null);
	assert.ok(listeningNow(status({}, { expiry: undefined, time: at(-9 * 60_000) }), now));
});

test('malformed records show nothing and unsafe links are dropped', () => {
	assert.equal(listeningNow(null, now), null);
	assert.equal(listeningNow({ time: at(0) }, now), null);
	assert.equal(listeningNow(status({ trackName: '' }), now), null);
	assert.equal(listeningNow(status({}, { time: 'yesterday' }), now), null);
	const shown = listeningNow(status({ originUri: 'javascript:alert(1)', releaseMbId: 'not-an-id', duration: 'long' }), now);
	assert.equal(shown?.link, undefined);
	assert.equal(shown?.coverUrl, undefined);
	assert.equal(shown?.duration, undefined);
	assert.equal(listeningNow(status({ originUri: 'https://open.spotify.com/track/x' }), now)?.link, 'https://open.spotify.com/track/x');
	assert.equal(listeningNow(status({ originUri: 'https://next.plyr.fm/track/trk_1/' }), now)?.plyrTrack, 'trk_1');
	for (const odd of ['https://plyr.fm/track/x%2F', 'https://plyr.fm/track/..%2Fsettings']) {
		const shown = listeningNow(status({ originUri: odd }), now);
		assert.deepEqual([shown?.plyrTrack, shown?.link], [undefined, undefined], odd);
	}
});

test('a play time in the future starts the clock now', () => {
	const shown = listeningNow(status({ playedTime: at(30_000) }), now);
	assert.equal(shown?.startedAt, now);
});
