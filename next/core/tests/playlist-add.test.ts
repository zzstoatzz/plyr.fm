import assert from 'node:assert/strict';
import test from 'node:test';
import { playlistAddNotice, playlistName, playlistTrackCount } from '../src/collections/playlist-add.ts';

test('the picker names playlists and counts tracks the way a person reads them', () => {
  assert.equal(playlistName({ metadata: { name: '  ', created_at: '', updated_at: null } }), 'untitled playlist');
  assert.equal(playlistName({ metadata: { name: 'late night', created_at: '', updated_at: null } }), 'late night');
  const count = (member_count: number) => playlistTrackCount({ metrics: { member_count, available_count: 0, total_plays: 0 } });
  assert.equal(count(0), '0 tracks');
  assert.equal(count(1), '1 track');
  assert.equal(count(1200), '1,200 tracks');
});

test('an add never claims a write that did not happen', () => {
  assert.deepEqual(playlistAddNotice('late night', 'present'), { message: 'already in late night', tone: 'info' });
  assert.equal(playlistAddNotice('late night', 'indexed').tone, 'success');
  assert.equal(playlistAddNotice('late night', 'pending').message, 'added to late night');
  assert.equal(playlistAddNotice('sunday', 'indexed', true).message, 'created sunday with this track');
  for (const status of ['deleted', 'absent'] as const) assert.equal(playlistAddNotice('x', status).tone, 'error');
  assert.equal(playlistAddNotice('x', 'rejected').tone, 'info');
});
