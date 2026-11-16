import assert from 'node:assert/strict';
import test from 'node:test';
import type { Track } from '../src/api.ts';
import { followingLatest } from '../src/following-latest.ts';

const track = (did: string, when: string): Track => ({
  object: 'track', id: did, record: { uri: `at://${did}/fm.plyr.track/1`, cid: null, revision: null, collection: 'fm.plyr.track', rkey: '1' },
  metadata: { title: did, description: null, album: null, duration_seconds: 10, created_at: when },
  artist: { did, profile: { handle: 'artist.test', display_name: 'artist', avatar_url: null } }, media: {}, access: { visibility: 'public' }, metrics: { play_count: 0, like_count: 0 }
});

test('followed releases are one per artist, newest first, with bounded catalog fanout and a partial-failure result', async () => {
  let active = 0;
  let peak = 0;
  const result = await followingLatest('did:plc:me', {
    resolveArtists: async dids => dids.map(did => ({ did, handle: 'artist.test', display_name: 'artist', avatar_url: null, track_count: 1 })),
    tracks: async ({ artist_did }) => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      if (artist_did === 'did:plc:bad') throw new Error('offline');
      return { object: 'list', data: [track(artist_did, artist_did === 'did:plc:new' ? '2026-11-16' : '2026-11-15')], has_more: false };
    }
  }, new AbortController().signal, async () => Response.json({ follows: ['did:plc:old', 'did:plc:bad', 'did:plc:new', 'did:plc:other'].map(did => ({ did })) }));
  assert.equal(result.failed, 1);
  assert.equal(result.tracks[0].artist.did, 'did:plc:new');
  assert.equal(result.tracks.length, 3);
  assert.ok(peak <= 3);
});

test('cancellation prevents a completed graph from starting release requests', async () => {
  const controller = new AbortController();
  let requested = false;
  await assert.rejects(followingLatest('did:plc:me', {
    resolveArtists: async () => { controller.abort(); return [{ did: 'did:plc:artist', handle: '', display_name: '', avatar_url: null, track_count: 1 }]; },
    tracks: async () => { requested = true; return { object: 'list', data: [], has_more: false }; }
  }, controller.signal, async () => Response.json({ follows: [{ did: 'did:plc:artist' }] })));
  assert.equal(requested, false);
});
