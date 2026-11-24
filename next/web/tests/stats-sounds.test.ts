import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AtlasData, AtlasPoint } from '@plyr/next-core/atlas/types';
import { artistSounds, homeSounds, pace, soundHeadline, sounds, typicalPlays } from '../src/lib/stats/sounds.ts';

let next = 1;
const point = (cluster: number, handle: string, plays: number): AtlasPoint => ({
	x: 0, y: 0, id: next++, title: `t${next}`, artist: handle.split('.')[0], handle, thumb: '', plays, likes: 0,
	clusterCoarse: cluster, clusterFine: 0, core: true
});
const atlas = (points: AtlasPoint[]): AtlasData => ({
	points, artists: [], meta: { generatedAt: '', nTracks: points.length },
	clusters: { coarse: [{ id: 1, label: 'deep house', cx: 0, cy: 0, count: 0 }, { id: 2, label: 'piano', cx: 0, cy: 0, count: 0 }, { id: 3, label: 'drones', cx: 0, cy: 0, count: 0 }], fine: [] }
});

test('sounds rank by plays and compare plays per track with a typical track', () => {
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
	assert.equal(typicalPlays(data), 15);
	assert.equal(pace(list[1], 15), 'above');
	assert.equal(pace(list[0], 15), 'above');
	assert.equal(pace(list[2], 15), 'below');
	assert.equal(pace({ plays: 30, tracks: 2 }, 15), 'about');
	const headline = soundHeadline(list, typicalPlays(data));
	assert.equal(headline?.top.label, 'deep house');
	assert.equal(headline?.standout?.label, 'piano');
	assert.equal(headline?.standoutPerTrack, 50);
	assert.equal(homeSounds(data).get('stellz.test'), 'deep house');
	assert.equal(homeSounds(data).get('drone.test'), 'drones', 'an artist with no plays still has a home');
});

test('an artist’s sounds say where they rank in each', () => {
	const mine = [point(1, 'stellz.test', 60), point(2, 'stellz.test', 10)];
	const data = atlas([...mine, point(1, 'dark.test', 40), point(2, 'goose.test', 30)]);
	const result = artistSounds(data, 'stellz.test');
	assert.equal(result.mapped, 2);
	assert.deepEqual(result.sounds.map(sound => [sound.label, sound.tracks, sound.plays, sound.rank]), [['deep house', 1, 60, 1], ['piano', 1, 10, 2]]);
	assert.equal(result.byTrackId.get(mine[1].id), 'piano');
	assert.equal(artistSounds(data, 'nobody.test').sounds.length, 0);
});
