import assert from 'node:assert/strict';
import test from 'node:test';
import type { Track } from '../src/api.ts';
import { followingLatest } from '../src/following-latest.ts';

const track = (did: string, when: string): Track => ({
  object: 'track', id: did + when, record: { uri: `at://${did}/fm.plyr.track/${when}`, cid: null, revision: null, collection: 'fm.plyr.track', rkey: when },
  metadata: { title: did, description: null, album: null, duration_seconds: 10, created_at: when },
  artist: { did, profile: { handle: 'artist.test', display_name: 'artist', avatar_url: 'appview.jpg' } }, media: {}, access: { visibility: 'public' }, metrics: { play_count: 0, like_count: 0 }
});

const graph = (pages: Record<string, { follows: { did: string; avatar?: string }[]; cursor?: string }>, wait?: Promise<void>) => async (input: RequestInfo | URL) => {
  const cursor = new URL(String(input)).searchParams.get('cursor') ?? '';
  if (cursor && wait) await wait;
  return Response.json(pages[cursor]);
};

test('the shelf is the newest track per followed person, newest first, across pages, with a partial-failure count', async () => {
  const result = await followingLatest('did:plc:me', {
    latestTracks: async dids => {
      if (dids.includes('did:plc:bad')) throw new Error('offline');
      return dids.map(did => track(did, did === 'did:plc:new' ? '2026-11-16' : '2026-11-15'));
    }
  }, new AbortController().signal, graph({
    '': { follows: [{ did: 'did:plc:old', avatar: 'bsky.jpg' }, { did: 'did:plc:new' }], cursor: 'two' },
    two: { follows: [{ did: 'did:plc:bad' }] },
  }));
  assert.equal(result.failed, 1);
  assert.deepEqual(result.tracks.map(item => item.artist.did), ['did:plc:new', 'did:plc:old']);
  assert.equal(result.tracks[1].artist.profile.avatar_url, 'bsky.jpg', 'the followed account\'s own avatar wins');
  assert.equal(result.tracks[0].artist.profile.avatar_url, 'appview.jpg');
});

test('the shelf keeps the twelve newest, not the first twelve followed', async () => {
  const follows = Array.from({ length: 20 }, (_, index) => ({ did: `did:plc:a${index}` }));
  const result = await followingLatest('did:plc:me', {
    latestTracks: async (dids, limit) => dids.map((did, index) => track(did, `2026-11-${String(index + 1).padStart(2, '0')}`)).reverse().slice(0, limit),
  }, new AbortController().signal, graph({ '': { follows } }));
  assert.equal(result.tracks.length, 12);
  assert.equal(result.tracks[0].artist.did, 'did:plc:a19');
});

test('each page of follows is looked up while the next page loads', async () => {
  const events: string[] = [];
  let release: () => void = () => undefined;
  const second = new Promise<void>(resolve => { release = resolve; });
  await followingLatest('did:plc:me', {
    latestTracks: async dids => { events.push('lookup ' + dids.join(' ')); release(); return []; },
  }, new AbortController().signal, async input => {
    const response = await graph({ '': { follows: [{ did: 'did:plc:a' }], cursor: 'two' }, two: { follows: [{ did: 'did:plc:b' }] } }, second)(input);
    if (new URL(String(input)).searchParams.get('cursor')) events.push('page 2');
    return response;
  });
  assert.deepEqual(events, ['lookup did:plc:a', 'page 2', 'lookup did:plc:b']);
});

test('cancellation stops the shelf', async () => {
  const controller = new AbortController();
  await assert.rejects(followingLatest('did:plc:me', {
    latestTracks: async () => { controller.abort(); return []; },
  }, controller.signal, graph({ '': { follows: [{ did: 'did:plc:artist' }] } })));
});
