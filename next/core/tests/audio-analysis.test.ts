import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { analysisFrame, analysisOnsets, matchesAnalysis, type AudioAnalysis } from '../src/audio-analysis.ts';
import { embedProtocol, type EmbedEvent } from '../src/embed-events.ts';

const manifest: AudioAnalysis = JSON.parse(readFileSync(new URL('../../web/static/experiments/embed-analysis.json', import.meta.url), 'utf8'));

test('fixture binds measurements to the exact content and bounded window grid', () => {
	const wav = readFileSync(new URL('../../web/static' + manifest.content.path, import.meta.url));
	assert.equal(createHash('sha256').update(wav).digest('hex'), manifest.content.sha256);
	assert.equal(wav.byteLength, manifest.content.bytes);
	assert.equal(manifest.frames.length, 640);
	assert.equal(analysisFrame(manifest, -1), undefined);
	assert.equal(analysisFrame(manifest, 16), undefined);
	assert.equal(analysisFrame(manifest, 60 * 60 * 12), undefined);
	assert.equal(analysisFrame(manifest, 0.026), manifest.frames[1]);
	for (const frame of manifest.frames) {
		assert.ok(frame.min <= frame.max && frame.min >= -1 && frame.max <= 1);
		assert.ok(frame.rms >= 0 && frame.rms <= 1);
		assert.equal(frame.bands.length, 3);
		assert.ok(frame.bands.every(value => Number.isFinite(value) && value >= 0));
	}
});

test('onsets are consumed once and never caught up across seeks or background gaps', () => {
	const before: EmbedEvent = { protocol: embedProtocol, type: 'snapshot', subscription: 'one', sequence: 1, instance: 'one', discontinuity: 0,
		track: null, audioContent: { kind: 'sha256', value: manifest.content.sha256 }, position: 0.4, duration: 16, rate: 1, state: 'playing', visible: true,
		clock: { epochMs: 1000, monotonicMs: 1000 }, analysis: null };
	const after = { ...before, sequence: 2, position: 0.6, clock: { epochMs: 1200, monotonicMs: 1200 } };
	assert.deepEqual(analysisOnsets(manifest, before, after), [0.5]);
	assert.equal(matchesAnalysis(manifest, { ...after, audioContent: null }), false);
	assert.equal(matchesAnalysis(manifest, { ...after, audioContent: { kind: 'sha256', value: '0'.repeat(64) } }), false);
	assert.deepEqual(analysisOnsets(manifest, after, after), []);
	assert.deepEqual(analysisOnsets(manifest, undefined, after), []);
	for (const change of [{ discontinuity: 1 }, { instance: 'two' }, { visible: false }, { state: 'buffering' as const }, { clock: { epochMs: 9000, monotonicMs: 9000 } }]) {
		assert.deepEqual(analysisOnsets(manifest, before, { ...after, ...change }), []);
	}
});
