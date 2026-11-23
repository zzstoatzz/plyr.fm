import assert from 'node:assert/strict';
import test from 'node:test';
import { createWaveEasing, levelsAt, parseTrackWaveform, waveFloor } from '../src/track-waveform.ts';

const body = (bytes: number[], bands = 4, fps = 20) => ({ uri: 'at://did:plc:a/fm.plyr.track/3k', cid: 'bafy', fps, bands, levels: btoa(String.fromCharCode(...bytes)) });

test('levels decode from base64 and refuse a ragged or malformed body', () => {
	const waveform = parseTrackWaveform(body([0, 64, 128, 255, 255, 0, 0, 0]));
	assert.deepEqual(Array.from(waveform!.levels), [0, 64, 128, 255, 255, 0, 0, 0]);
	assert.equal(parseTrackWaveform(body([1, 2, 3])), null);
	assert.equal(parseTrackWaveform({ ...body([1, 2, 3, 4]), levels: '!!' }), null);
	assert.equal(parseTrackWaveform(body([1, 2, 3, 4], 4, 0)), null);
});

test('bars read between the two nearest frames and hold at the ends', () => {
	const waveform = parseTrackWaveform(body([0, 0, 0, 0, 255, 51, 0, 0], 4, 2))!;
	assert.deepEqual(levelsAt(waveform, 0), [0, 0, 0, 0]);
	assert.deepEqual(levelsAt(waveform, 0.25), [0.5, 0.1, 0, 0]);
	assert.deepEqual(levelsAt(waveform, 99), [1, 0.2, 0, 0]);
	assert.deepEqual(levelsAt(waveform, -3), [0, 0, 0, 0]);
});

test('bars rise faster than they fall and never drop below the floor', () => {
	const easing = createWaveEasing();
	const up = easing.step([1, 1, 1, 1], 1 / 60)[0];
	assert.ok(up > 0.4);
	for (let frame = 0; frame < 120; frame++) easing.step([1, 1, 1, 1], 1 / 60);
	assert.ok(easing.heights[0] > 0.99);
	const down = 1 - easing.step([0, 0, 0, 0], 1 / 60)[0];
	assert.ok(down < 1 - up, 'falling one frame moves less than rising one frame');
	for (let frame = 0; frame < 240; frame++) easing.step([0, 0, 0, 0], 1 / 60);
	assert.ok(Math.abs(easing.heights[0] - waveFloor) < 1e-3);
});
