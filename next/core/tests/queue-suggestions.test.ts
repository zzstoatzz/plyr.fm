import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStarter, maxExclude, maxSeeds, starters, suggestionRequest } from '../src/queue-suggestions.ts';
import type { Track } from '../src/api.ts';

const track = (n: number) => ({ id: `t${n}`, record: { uri: `at://did:plc:a/fm.plyr.track/${n}` } }) as unknown as Track;
const uri = (n: number) => `at://did:plc:a/fm.plyr.track/${n}`;

test('suggestions go with what is playing and what follows, never repeating the queue', () => {
  const queue = [1, 2, 3, 4, 2].map(track);
  const request = suggestionRequest(queue, 1, [uri(9)]);
  assert.deepEqual(request?.seeds, [uri(2), uri(3), uri(4)]);
  assert.deepEqual(request?.exclude, [uri(1), uri(9)]);
  assert.equal(suggestionRequest([], 0), undefined);
});

test('suggestion requests stay inside the server bounds', () => {
  const queue = Array.from({ length: 200 }, (_, n) => track(n));
  const request = suggestionRequest(queue, 100, Array.from({ length: 80 }, (_, n) => uri(1000 + n)))!;
  assert.equal(request.seeds.length, maxSeeds);
  assert.equal(request.exclude.length, maxExclude);
  assert.equal(request.seeds[0], uri(100));
  assert.ok(!request.exclude.includes(uri(1000)), 'the queue is never crowded out by earlier suggestions');
});

test('signed-out starters never ask for an account', () => {
  assert.deepEqual(starters(false).map(item => item.key), ['top', 'latest', 'playlist']);
  assert.deepEqual(starters(true).map(item => item.key), ['for-you', 'likes', 'playlist']);
});

test('for you falls back to top tracks the listener has not liked when suggestions are thin', async () => {
  const api = {
    actorLikes: async () => ({ object: 'list', data: [track(1)], has_more: false }),
    suggestions: async (seeds: string[]) => { assert.deepEqual(seeds, [uri(1)]); return { object: 'track_suggestions', data: [track(2)] }; },
    chart: async () => ({ period: 'week', data: [1, 2, 3].map(n => ({ rank: n, period_like_count: 1, all_time_like_count: 1, track: track(n) })) }),
  } as never;
  const result = await loadStarter(api, 'for-you', 'did:plc:me');
  assert.deepEqual(result.tracks.map(item => item.id), ['t2', 't3']);
});

test('a random playlist only offers available tracks', async () => {
  const api = {
    playlists: async () => ({ object: 'list', has_more: false, data: [
      { id: 'empty', metadata: { name: 'empty' }, metrics: { available_count: 0 } },
      { id: 'night', metadata: { name: 'late night' }, metrics: { available_count: 1 } },
    ] }),
    playlist: async (id: string) => {
      assert.equal(id, 'night');
      return { members: [{ availability: 'available', track: track(1) }, { availability: 'unavailable', track: null }] };
    },
  } as never;
  const result = await loadStarter(api, 'playlist', undefined, () => 0);
  assert.equal(result.label, 'late night');
  assert.deepEqual(result.tracks.map(item => item.id), ['t1']);
});
