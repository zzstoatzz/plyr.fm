import assert from 'node:assert/strict';
import test from 'node:test';
import { ListeningSession, type ListeningObservation } from '../src/listening-session.ts';

const sample = (positionSeconds: number, monotonicMs = positionSeconds * 1000): ListeningObservation => ({
	positionSeconds, monotonicMs, playing: true, buffering: false
});

test('qualifies real progress once at the duration-aware threshold', () => {
	const session = new ListeningSession();
	const token = session.begin('track', 'occurrence', 20);
	assert.equal(session.observe(token, sample(0)), null);
	assert.equal(session.observe(token, sample(9.99)), null);
	assert.deepEqual(session.observe(token, sample(10)), { trackId: 'track', occurrenceId: 'occurrence' });
	assert.equal(session.observe(token, sample(15)), null);
});

test('sparse background progress is evidence when media and monotonic clocks agree', () => {
	const session = new ListeningSession();
	const token = session.begin('track', 'occurrence', 180);
	session.observe(token, sample(0));
	assert.deepEqual(session.observe(token, sample(30)), { trackId: 'track', occurrenceId: 'occurrence' });
});

test('unknown duration waits thirty seconds, but real media duration supersedes metadata', () => {
	const session = new ListeningSession();
	const token = session.begin('track', 'occurrence');
	session.observe(token, sample(0));
	assert.equal(session.observe(token, sample(10)), null);
	assert.deepEqual(session.observe(token, { ...sample(11), durationSeconds: 20 }), { trackId: 'track', occurrenceId: 'occurrence' });
});

test('pause, buffering, restoration and unexplained jumps earn no listening', () => {
	const session = new ListeningSession();
	const token = session.begin('track', 'occurrence', 200);
	session.observe(token, sample(100, 0));
	session.observe(token, { ...sample(130, 1000), playing: false });
	session.observe(token, sample(130, 60_000));
	session.observe(token, { ...sample(135, 65_000), buffering: true });
	session.observe(token, sample(135, 70_000));
	session.observe(token, sample(195, 71_000));
	assert.equal(session.listenedSeconds, 0);
	assert.equal(session.observe(token, sample(196, 72_000)), null);
	assert.equal(session.listenedSeconds, 1);
});

test('explicit asynchronous seek suppresses intermediate samples and resumes from a fresh baseline', () => {
	const session = new ListeningSession();
	const token = session.begin('track', 'occurrence', 200);
	session.observe(token, sample(0));
	session.observe(token, sample(5));
	session.discontinue(token);
	session.observe(token, sample(100, 6000));
	session.settle(token);
	session.observe(token, sample(100, 7000));
	assert.equal(session.listenedSeconds, 5);
	assert.equal(session.observe(token, sample(124, 31_000)), null);
	assert.deepEqual(session.observe(token, sample(125, 32_000)), { trackId: 'track', occurrenceId: 'occurrence' });
});

test('rapid source switches reject stale observations and duplicate records get new occurrences', () => {
	const session = new ListeningSession();
	const old = session.begin('A', 'first', 20);
	session.observe(old, sample(0));
	session.begin('B', 'second', 20);
	const current = session.begin('A', 'third', 20);
	assert.equal(session.observe(old, sample(30)), null);
	session.discontinue(old);
	session.observe(current, sample(0));
	assert.deepEqual(session.observe(current, sample(10)), { trackId: 'A', occurrenceId: 'third' });
	session.stop();
	assert.equal(session.observe(current, sample(30)), null);
});

test('backward movement alone never fabricates a repeat occurrence', () => {
	const session = new ListeningSession();
	const token = session.begin('track', 'first', 20);
	session.observe(token, sample(10, 0));
	session.observe(token, sample(0, 1000));
	assert.equal(session.listenedSeconds, 0);
	session.observe(token, sample(10, 11_000));
	const repeated = session.begin('track', 'repeat', 20);
	session.observe(repeated, sample(0, 12_000));
	assert.deepEqual(session.observe(repeated, sample(10, 22_000)), { trackId: 'track', occurrenceId: 'repeat' });
});

test('invalid observations and backwards monotonic clocks cannot add credit', () => {
	const session = new ListeningSession();
	const token = session.begin('track', 'occurrence', 20);
	session.observe(token, sample(0, 100));
	session.observe(token, sample(10, 50));
	session.observe(token, sample(Number.NaN));
	session.observe(token, sample(20, 500));
	assert.equal(session.listenedSeconds, 0);
});
