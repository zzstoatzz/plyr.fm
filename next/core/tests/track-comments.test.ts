import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import type { Artist, Track, TrackComment } from '../src/api.ts';
import { createTrackComments } from '../src/track-comments.ts';

const uri = 'at://did:plc:artist/fm.plyr.track/track';
const commentUri = 'at://did:plc:listener/fm.plyr.comment/comment';
const subject = { uri, cid: 'bafytrack' };
const track: Track = {
  object: 'track', id: 'track',
  record: { ...subject, revision: null, collection: 'fm.plyr.track', rkey: 'track' },
  metadata: { title: 'Sketch', description: null, album: null, duration_seconds: 30, created_at: '' },
  artist: { did: 'did:plc:artist', profile: { handle: 'artist.test', display_name: 'Artist', avatar_url: null } },
  media: {}, access: { visibility: 'public' }, metrics: { play_count: 0, like_count: 0 }
};
const listener: Artist = {
  object: 'artist', did: 'did:plc:listener', handle: 'listener.test', display_name: 'Listener',
  bio: null, avatar_url: null, support_url: null
};

test('a pending comment survives indexing lag and failed deletion', async () => {
  let projected: TrackComment[] = [];
  let rejectDelete = true;
  let rejectCreate = true;
  const attemptedKeys: string[] = [];
  const store = createTrackComments({
    api: {
      async artist() { return listener; },
      async trackComments() { return { object: 'list', data: projected, has_more: false, comments_enabled: true }; }
    },
    getAuth: () => ({ did: listener.did, handle: listener.handle, rpc: {} }),
    createPds: () => ({
      newCommentAttempt() { return { rkey: String(attemptedKeys.length + 1), createdAt: '2026-11-14T18:01:00Z' }; },
      async comment(_track, _text, _timestampMs, attempt) {
        attemptedKeys.push(attempt.rkey);
        if (rejectCreate) throw new Error('temporarily unavailable');
        return { uri: commentUri, cid: 'bafycomment', rkey: 'comment', subject };
      },
      async deleteComment() { if (rejectDelete) throw new Error('temporarily unavailable'); }
    })
  });
  function comments() { return store.snapshot(track.id).comments; }
  async function refresh() {
    store.loadComments(track.id);
    await setImmediate();
  }

  await refresh();
  await assert.rejects(store.addComment(track, 'great moment', 14_000), /temporarily unavailable/);
  rejectCreate = false;
  await store.addComment(track, 'great moment', 14_000);
  assert.deepEqual(attemptedKeys, ['1', '1']);
  await refresh();
  const [optimistic] = comments();
  assert.equal(optimistic.timestamp_ms, 14_000);
  assert.equal(optimistic.author.display_name, 'Listener');
  projected = [{ ...optimistic, created_at: '2026-11-14T18:01:03Z' }];
  await refresh();
  assert.deepEqual(comments(), projected);
  await assert.rejects(store.removeComment(track.id, projected[0]), /temporarily unavailable/);
  assert.deepEqual(comments(), projected);
  rejectDelete = false;
  await store.removeComment(track.id, projected[0]);
  await refresh();
  assert.deepEqual(comments(), []);
});

test('comments stay hidden and uninvited until the artist has opted in', async () => {
  let enabled: boolean | undefined;
  const store = createTrackComments({
    api: {
      async artist() { return listener; },
      async trackComments() { return { object: 'list', data: [], has_more: false, comments_enabled: enabled }; }
    },
    getAuth: () => ({ did: listener.did, handle: listener.handle, rpc: {} }),
    createPds: () => ({
      newCommentAttempt() { return { rkey: '1', createdAt: '2026-11-18T00:00:00Z' }; },
      async comment() { throw new Error('should not write'); },
      async deleteComment() {}
    })
  });
  assert.equal(store.snapshot(track.id).enabled, false);
  store.loadComments(track.id);
  assert.equal(store.snapshot(track.id).enabled, false, 'unknown while loading');
  await setImmediate();
  assert.equal(store.snapshot(track.id).enabled, false, 'an older server without the field reads as off');
  await assert.rejects(store.addComment(track, 'hi', 0), /comments are off/);
  enabled = false;
  store.loadComments(track.id);
  await setImmediate();
  assert.equal(store.snapshot(track.id).enabled, false);
  enabled = true;
  store.loadComments(track.id);
  await setImmediate();
  assert.equal(store.snapshot(track.id).enabled, true);
});

test('changing the setting rereads tracks on screen and forgets the rest', async () => {
  let enabled = false;
  let reads = 0;
  const store = createTrackComments({
    api: {
      async artist() { return listener; },
      async trackComments() { reads++; return { object: 'list', data: [], has_more: false, comments_enabled: enabled }; }
    },
    getAuth: () => ({ did: listener.did, handle: listener.handle, rpc: {} }),
    createPds: () => ({ newCommentAttempt() { return { rkey: '1', createdAt: '' }; }, async comment() { throw new Error('unused'); }, async deleteComment() {} })
  });
  const stop = store.subscribe(track.id, () => {});
  store.loadComments(track.id);
  store.loadComments('elsewhere');
  await setImmediate();
  assert.equal(store.snapshot(track.id).enabled, false);
  enabled = true;
  store.refresh();
  await setImmediate();
  assert.equal(store.snapshot(track.id).enabled, true);
  assert.equal(store.hasLoaded('elsewhere'), false);
  assert.equal(reads, 3);
  stop();
});
