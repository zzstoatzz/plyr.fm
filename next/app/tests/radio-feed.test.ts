import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { RadioFeed } from '../src/radio-feed.ts';
import { nextRead, parseRadio } from '../src/radio.ts';
import type { RadioSnapshot } from '../src/radio.ts';

function snapshot(position: number): RadioSnapshot {
	return Object.freeze({ currentSong: null, positionSeconds: position, endsAt: null, upNext: [], receivedAt: position * 1000 });
}

async function until(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (condition()) return;
		await setImmediate();
	}
	assert.ok(condition(), 'radio feed did not settle');
}

test('two observers share one read and one leaving cannot cancel the other', async context => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const requests: { signal: AbortSignal; resolve(value: RadioSnapshot): void }[] = [];
	const feed = new RadioFeed(signal => new Promise(resolve => { requests.push({ signal, resolve }); }), 20);
	let updates = 0;
	const observer = () => { updates++; };
	const first = feed.subscribe(observer);
	const second = feed.subscribe(observer);
	try {
		assert.equal(requests.length, 1);
		first();
		assert.equal(requests[0].signal.aborted, false);
		const received = snapshot(7);
		requests[0].resolve(received);
		await until(() => feed.getSnapshot().snapshot === received);
		assert.equal(updates, 1);
		assert.equal(feed.getSnapshot().snapshot?.receivedAt, 7000);
		assert.equal(feed.getSnapshot(), feed.getSnapshot());
	} finally { first(); second(); }
	context.mock.timers.tick(40);
	await setImmediate();
	assert.equal(requests.length, 1, 'last observer stops the next poll');
	assert.equal(feed.getSnapshot().snapshot?.receivedAt, 7000, 'the last snapshot stays, so returning to the station draws at once');
});

test('last unsubscribe aborts a pending read and stale completion cannot replace a new subscription', async () => {
	const requests: { signal: AbortSignal; resolve(value: RadioSnapshot): void }[] = [];
	const feed = new RadioFeed(signal => new Promise(resolve => { requests.push({ signal, resolve }); }));
	const old = feed.subscribe(() => {});
	old();
	assert.equal(requests[0].signal.aborted, true);
	const current = feed.subscribe(() => {});
	try {
		assert.equal(requests.length, 2);
		const latest = snapshot(20);
		requests[1].resolve(latest);
		await until(() => feed.getSnapshot().snapshot === latest);
		requests[0].resolve(snapshot(2));
		await setImmediate();
		assert.equal(feed.getSnapshot().snapshot, latest);
		assert.equal(requests[1].signal.aborted, false);
	} finally { current(); }
});

test('a hung transport times out and a later poll recovers without overlapping requests', async context => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	let calls = 0;
	let firstSignal: AbortSignal | undefined;
	const received = snapshot(30);
	const feed = new RadioFeed(async signal => {
		calls++;
		if (calls === 1) {
			firstSignal = signal;
			return new Promise<RadioSnapshot>(() => {});
		}
		assert.equal(firstSignal?.aborted, true);
		return received;
	}, 10, 20, 10);
	const unsubscribe = feed.subscribe(() => {});
	try {
		context.mock.timers.tick(20);
		await until(() => feed.getSnapshot().error !== '');
		assert.equal(firstSignal?.aborted, true);
		assert.equal(feed.getSnapshot().snapshot, undefined);
		assert.ok(feed.getSnapshot().error);
		context.mock.timers.tick(10);
		await until(() => feed.getSnapshot().snapshot === received);
		assert.equal(feed.getSnapshot().snapshot, received);
		assert.equal(feed.getSnapshot().error, '');
		assert.equal(calls, 2);
	} finally { unsubscribe(); }
});

test('each poll publishes the one received snapshot to all observers', async context => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	let calls = 0;
	const first: RadioSnapshot[] = [];
	const second: RadioSnapshot[] = [];
	const feed = new RadioFeed(async () => snapshot(++calls), 20);
	const unsubscribeFirst = feed.subscribe(() => {
		const value = feed.getSnapshot().snapshot;
		if (value) first.push(value);
	});
	const unsubscribeSecond = feed.subscribe(() => {
		const value = feed.getSnapshot().snapshot;
		if (value) second.push(value);
	});
	try {
		await until(() => first.length === 1);
		context.mock.timers.tick(20);
		await until(() => first.length === 2);
		assert.equal(calls, 2);
		assert.equal(first.length, 2);
		assert.deepEqual(first, second);
		assert.equal(first[0], second[0]);
		assert.equal(first[1], second[1]);
	} finally { unsubscribeFirst(); unsubscribeSecond(); }
});

test('the next read lands just after the song changes, never later than the ceiling', () => {
	const now = 1_000_000;
	const ending = { ...snapshot(0), endsAt: now + 12_000 };
	assert.equal(nextRead(ending, 30_000, now), 12_400);
	assert.equal(nextRead({ ...ending, endsAt: now + 90_000 }, 30_000, now), 30_000);
	assert.equal(nextRead({ ...ending, endsAt: now - 5_000 }, 30_000, now), 500, 'a stale end time retries soon, not in a tight loop');
	assert.equal(nextRead(snapshot(0), 30_000, now), 30_000);
});

test('a station state becomes a catalog track that now playing and likes can use', () => {
	const uri = 'at://did:plc:artistaaaaaaaaaaaaaaaaaa/fm.plyr.track/3lradio';
	const parsed = parseRadio({
		current: { id: 42, title: 'tide', artist: 'sea', artist_handle: 'sea.test', artist_did: 'did:plc:artistaaaaaaaaaaaaaaaaaa', stream_url: 'https://api.plyr.fm/audio/abc',
			duration: 200, artwork_url: 'https://images.plyr.fm/images/x.webp', thumbnail_url: 'https://images.plyr.fm/images/x_thumb.webp',
			atproto_record_uri: uri, atproto_record_cid: 'bafy', created_at: '2026-01-01T00:00:00Z', like_count: 2, play_count: 9 },
		current_ends_at: new Date(2_000_000).toISOString(), progress_seconds: 50, up_next: [],
	}, 5, 1_900_000);
	const song = parsed.currentSong!;
	assert.match(song.id, /^trk_/);
	assert.equal(song.track.record.uri, uri);
	assert.equal(song.track.record.cid, 'bafy');
	assert.equal(song.track.artist.profile.handle, 'sea.test');
	assert.equal(song.thumbnail, 'https://images.plyr.fm/images/x_thumb.webp');
	assert.equal(parsed.endsAt, 2_000_000);
	assert.equal(parsed.positionSeconds, 50);
});
