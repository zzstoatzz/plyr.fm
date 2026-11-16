import assert from 'node:assert/strict';
import { test } from 'node:test';
import { embedProtocol, embedPosition, parseEmbedRequest, parseEmbedEvent, type EmbedSnapshot } from '../src/embed-events.ts';

test('subscriptions validate untrusted messages and bound update rates', () => {
	for (const value of [null, [], {}, { protocol: 'v2' }, { protocol: embedProtocol, type: 'subscribe', subscription: '' }]) {
		assert.equal(parseEmbedRequest(value), undefined);
	}
	const request = { protocol: embedProtocol, type: 'subscribe', subscription: 'consumer' };
	assert.equal(parseEmbedRequest({ ...request, hz: Infinity }), undefined);
	assert.equal(parseEmbedRequest({ ...request, hz: '10' }), undefined);
	assert.equal(parseEmbedRequest({ ...request, subscription: 'a'.repeat(129) }), undefined);
	assert.equal(parseEmbedRequest({ ...request, hz: 100 })?.type, 'subscribe');
	assert.deepEqual(parseEmbedRequest({ ...request, hz: 100 }), { ...request, hz: 10 });
	assert.deepEqual(parseEmbedRequest({ ...request, hz: -1 }), { ...request, hz: 1 });
	assert.deepEqual(parseEmbedRequest(request), { ...request, hz: 4 });
});

test('interpolation stops on discontinuous states and stale clocks', () => {
	const sample: EmbedSnapshot = { instance: 'one', discontinuity: 0, track: null, audioContent: null, state: 'playing', position: 5, duration: 10, rate: 2, visible: true };
	assert.equal(embedPosition(sample, 0.2), 5.4);
	assert.equal(embedPosition(sample, 60), 6);
	assert.equal(embedPosition(sample, -2), 5);
	assert.equal(embedPosition({ ...sample, position: 9.8 }, 0.5), 10);
	for (const state of ['idle', 'paused', 'buffering', 'seeking', 'ended', 'error'] as const) {
		assert.equal(embedPosition({ ...sample, state }, 0.3), 5);
	}
	assert.equal(embedPosition({ ...sample, visible: false }, 0.3), 5);
});

test('received snapshots reject malformed analysis and timing fields', () => {
	const sample = { protocol: embedProtocol, type: 'snapshot', subscription: 'one', sequence: 1,
		instance: 'one', discontinuity: 0, track: { uri: 'at://test/track/one', cid: null }, audioContent: null,
		state: 'playing', position: 5, duration: 10, rate: 1, visible: true,
		clock: { epochMs: 1000, monotonicMs: 500 }, analysis: null };
	assert.deepEqual(parseEmbedEvent(sample), sample);
	for (const change of [{ position: NaN }, { state: 'invented' }, { state: ['playing'] }, { clock: {} }, { track: {} }, { analysis: {} }, { sequence: 0.5 }]) {
		assert.equal(parseEmbedEvent({ ...sample, ...change }), undefined);
	}
});
