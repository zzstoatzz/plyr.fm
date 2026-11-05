import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { PlayMetrics } from '../src/play-metrics.ts';
import { PlayOutbox, PlayDeliveryError, PLAY_OUTBOX_TTL_MS, type PendingPlay, type PlayOutboxStorage, type PlayReceipt } from '../src/play-outbox.ts';

const occurrence = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const play = (number: number): PendingPlay => ({ trackId: 'trk_record', occurrenceId: occurrence(number), createdAt: 1000 });
const receipt = (number: number, count = 1): PlayReceipt => ({
	object: 'play_receipt', occurrence: occurrence(number), track_id: 'trk_record',
	record: { uri: 'at://artist/track/one' }, play_count: count, counted: true,
	dedup: { status: 'claimed', window_seconds: 30 },
	sources: { metrics: 'application_metrics', dedup: 'postgres_durable' }
});

class MemoryStorage implements PlayOutboxStorage {
	items = new Map<string, PendingPlay>();
	async load(): Promise<PendingPlay[]> { return [...this.items.values()]; }
	async put(item: PendingPlay): Promise<void> { this.items.set(item.occurrenceId, item); }
	async delete(id: string): Promise<void> { this.items.delete(id); }
}

async function until(condition: () => boolean): Promise<void> {
	for (let iteration = 0; iteration < 20; iteration++) {
		if (condition()) return;
		await setImmediate();
	}
	assert.ok(condition(), 'outbox did not settle');
}

test('lost response and app restart reuse the persisted occurrence identity', async () => {
	const storage = new MemoryStorage();
	const received: string[] = [];
	const first = new PlayOutbox({ storage, now: () => 1000, send: async item => {
		received.push(item.occurrenceId);
		throw new Error('response lost after server commit');
	}, onReceipt: () => { assert.fail('failed response is not accepted'); } });
	first.enqueue(play(1));
	await until(() => received.length === 1);
	first.dispose();
	assert.equal(storage.items.size, 1);
	const accepted: PlayReceipt[] = [];
	const second = new PlayOutbox({ storage, now: () => 2000, send: async item => {
		received.push(item.occurrenceId);
		return { ...receipt(1), dedup: { status: 'duplicate', window_seconds: 30 } };
	}, onReceipt: item => { accepted.push(item); } });
	await until(() => accepted.length === 1);
	assert.deepEqual(received, [occurrence(1), occurrence(1)]);
	assert.equal(accepted[0].counted, true);
	assert.equal(second.pendingCount, 0);
	assert.equal(storage.items.size, 0);
	second.dispose();
});

test('a retryable failure does not block another play and manual retry settles it', async () => {
	const storage = new MemoryStorage();
	let online = false;
	let calls = 0;
	const accepted: string[] = [];
	const outbox = new PlayOutbox({ storage, now: () => 1000, send: async item => {
		calls++;
		if (item.occurrenceId === occurrence(1) && !online) throw new PlayDeliveryError('unavailable', true);
		return receipt(item.occurrenceId === occurrence(1) ? 1 : 2);
	}, onReceipt: item => { accepted.push(item.occurrence); } });
	outbox.enqueue(play(1));
	outbox.enqueue(play(2));
	await until(() => accepted.length === 1);
	assert.deepEqual(accepted, [occurrence(2)]);
	assert.equal(outbox.pendingCount, 1);
	online = true;
	outbox.retry();
	await until(() => accepted.length === 2);
	assert.equal(calls, 3);
	assert.equal(outbox.pendingCount, 0);
	outbox.dispose();
});

test('permanent rejection is removed without inventing a count', async () => {
	const storage = new MemoryStorage();
	let calls = 0;
	const outbox = new PlayOutbox({ storage, now: () => 1000, send: async () => {
		calls++;
		throw new PlayDeliveryError('not found', false);
	}, onReceipt: () => { assert.fail('rejection cannot earn a count'); } });
	outbox.enqueue(play(1));
	await until(() => calls === 1 && outbox.pendingCount === 0);
	outbox.retry();
	await setImmediate();
	assert.equal(calls, 1);
	assert.equal(storage.items.size, 0);
	outbox.dispose();
});

test('receipt identity mismatch remains retryable instead of acknowledging the wrong play', async () => {
	const storage = new MemoryStorage();
	let calls = 0;
	const outbox = new PlayOutbox({ storage, now: () => 1000, send: async () => {
		calls++;
		return receipt(2);
	}, onReceipt: () => { assert.fail('wrong receipt cannot be accepted'); } });
	outbox.enqueue(play(1));
	await until(() => calls === 1);
	await setImmediate();
	assert.equal(outbox.pendingCount, 1);
	outbox.dispose();
});

test('hydration discards expired events and bounds the remaining queue to newest64', async () => {
	const storage = new MemoryStorage();
	for (let number = 1; number <= 70; number++) storage.items.set(occurrence(number), { ...play(number), createdAt: number });
	storage.items.set(occurrence(71), { ...play(71), createdAt: -PLAY_OUTBOX_TTL_MS });
	let first = '';
	const outbox = new PlayOutbox({ storage, now: () => 1000, send: async item => {
		first = item.occurrenceId;
		return new Promise<PlayReceipt>(() => {});
	}, onReceipt: () => {} });
	await until(() => first !== '');
	assert.equal(first, occurrence(7));
	assert.equal(outbox.pendingCount, 64);
	assert.equal(storage.items.size, 64);
	outbox.dispose();
});

test('storage failure keeps in-memory delivery usable', async () => {
	const storage: PlayOutboxStorage = {
		async load() { throw new Error('storage denied'); },
		async put() { throw new Error('storage denied'); },
		async delete() { throw new Error('storage denied'); }
	};
	let accepted = false;
	const outbox = new PlayOutbox({ storage, now: () => 1000, send: async () => receipt(1), onReceipt: () => { accepted = true; } });
	outbox.enqueue(play(1));
	await until(() => accepted);
	assert.equal(outbox.pendingCount, 0);
	outbox.dispose();
});

test('authoritative receipt updates only subscribers of the affected record and never regresses', () => {
	const metrics = new PlayMetrics();
	let notifications = 0;
	const unsubscribe = metrics.subscribe('track', () => { notifications++; });
	metrics.subscribe('other', () => { assert.fail('unrelated track rerender'); });
	metrics.observe('track', 5);
	metrics.observe('track', 3);
	metrics.observe('track', Number.NaN);
	metrics.observe('track', 5);
	assert.equal(metrics.get('track'), 5);
	assert.equal(notifications, 1);
	unsubscribe();
	metrics.observe('track', 6);
	assert.equal(notifications, 1);
});

test('submission waits for per-event persistence before touching the transport', async () => {
	const storage = new MemoryStorage();
	let release: (() => void) | undefined;
	const persisted = new Promise<void>(resolve => { release = resolve; });
	const original = storage.put.bind(storage);
	storage.put = async item => { await persisted; await original(item); };
	let sent = false;
	const outbox = new PlayOutbox({ storage, now: () => 1000, send: async () => {
		assert.equal(storage.items.size, 1);
		sent = true;
		return receipt(1);
	}, onReceipt: () => {} });
	outbox.enqueue(play(1));
	await setImmediate();
	assert.equal(sent, false);
	release?.();
	await until(() => sent);
	outbox.dispose();
});

test('metric cache evicts old unobserved tracks while retaining visible subscriptions', () => {
	const metrics = new PlayMetrics();
	metrics.observe('visible', 10);
	const unsubscribe = metrics.subscribe('visible', () => {});
	for (let index = 0; index < 1024; index++) metrics.observe(`track-${index}`, index);
	assert.equal(metrics.get('visible'), 10);
	assert.equal(metrics.get('track-0'), undefined);
	assert.equal(metrics.get('track-1023'), 1023);
	unsubscribe();
});
