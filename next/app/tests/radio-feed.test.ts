import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { RadioFeed } from '../src/radio-feed.ts';
import type { RadioSnapshot } from '../src/radio.ts';

function snapshot(position: number): RadioSnapshot {
	return Object.freeze({ currentSong: null, state: Object.freeze({ status: 'playing', positionSeconds: position }), receivedAt: position * 1000 });
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
	assert.equal(feed.getSnapshot().snapshot, undefined);
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
	}, 10, 20);
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
