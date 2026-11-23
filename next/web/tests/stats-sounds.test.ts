import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AtlasData, AtlasPoint } from '@plyr/next-core/atlas/types';
import { artistSounds, homeSounds, lift, soundHeadline, sounds } from '../src/lib/stats/sounds.ts';

let next = 1;
const point = (cluster: number, handle: string, plays: number): AtlasPoint => ({
	x: 0, y: 0, id: next++, title: `t${next}`, artist: handle.split('.')[0], handle, thumb: '', plays, likes: 0,
	clusterCoarse: cluster, clusterFine: 0, core: true
});
const atlas = (points: AtlasPoint[]): AtlasData => ({
	points, artists: [], meta: { generatedAt: '', nTracks: points.length },
	clusters: { coarse: [{ id: 1, label: 'deep house', cx: 0, cy: 0, count: 0 }, { id: 2, label: 'piano', cx: 0, cy: 0, count: 0 }, { id: 3, label: 'drones', cx: 0, cy: 0, count: 0 }], fine: [] }
});

test('sounds rank by plays and compare play share to track share', () => {
	const data = atlas([
		point(1, 'stellz.test', 60), point(1, 'stellz.test', 20), point(1, 'dark.test', 20),
		point(2, 'goose.test', 50),
		point(3, 'drone.test', 0), point(3, 'drone.test', 0), point(3, 'drone.test', 0), point(3, 'drone.test', 0), point(3, 'drone.test', 0), point(3, 'drone.test', 0)
	]);
	const list = sounds(data);
	assert.deepEqual(list.map(sound => sound.label), ['deep house', 'piano', 'drones']);
	assert.equal(list[0].tracks, 3);
	assert.equal(list[0].plays, 100);
	assert.equal(list[0].top.plays, 60);
	assert.deepEqual(list[0].artists, ['stellz', 'dark']);
	assert.equal(lift(list[1]), (50 / 150) / (1 / 10));
	const headline = soundHeadline(list);
	assert.equal(headline?.top.label, 'deep house');
	assert.equal(headline?.standout?.label, 'piano');
	assert.equal(homeSounds(data).get('stellz.test'), 'deep house');
	assert.equal(homeSounds(data).get('drone.test'), 'drones', 'an artist with no plays still has a home');
});

test('an artist’s sounds give their slice of each sound’s plays', () => {
	const mine = [point(1, 'stellz.test', 60), point(2, 'stellz.test', 10)];
	const data = atlas([...mine, point(1, 'dark.test', 40), point(2, 'goose.test', 30)]);
	const result = artistSounds(data, 'stellz.test');
	assert.equal(result.mapped, 2);
	assert.deepEqual(result.sounds.map(sound => [sound.label, sound.tracks, sound.plays, sound.share]), [['deep house', 1, 60, 0.6], ['piano', 1, 10, 0.25]]);
	assert.equal(result.byLegacyId.get(mine[1].id), 'piano');
	assert.equal(artistSounds(data, 'nobody.test').sounds.length, 0);
});
