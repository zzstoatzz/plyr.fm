import assert from 'node:assert/strict';
import test from 'node:test';
import type { Artist, Playback, Track } from '../src/api.ts';
import { attachmentUrl, downloadAllowed, downloadFilename, prepareDownload } from '../src/downloads/model.ts';

const track: Track = { object: 'track', id: 'track', record: { uri: 'at://did:plc:artist/fm.plyr.track/song', cid: 'revision', revision: null, collection: 'fm.plyr.track', rkey: 'song' }, metadata: { title: 'a/b: song', artist_name: 'artist', description: null, album: null, duration_seconds: 1, created_at: '2026-11-12T00:00:00Z' }, artist: { did: 'did:plc:artist', profile: { handle: 'artist.test', display_name: 'artist', avatar_url: null } }, media: {}, access: { visibility: 'public', download_policy: 'open' }, metrics: { play_count: 0, like_count: 0 } };
const playback: Playback = { object: 'playback', track_id: track.id, record: { uri: track.record.uri, cid: 'revision' }, availability: { status: 'available', delivery: { url: 'https://media.test/audio.wav', media_type: 'audio/wav' } } };
const artist: Artist = { object: 'artist', did: track.artist.did, handle: 'artist.test', display_name: 'artist', bio: null, avatar_url: null, support_url: 'https://support.test/artist' };
const read = { track: async () => track, playback: async () => playback, artist: async () => artist };

test('downloads require a known allowed preference and public listening', () => {
  for (const policy of [undefined, null, '', 'future', 'off', 'supporters']) assert.equal(downloadAllowed({ ...track, access: { visibility: 'public', download_policy: policy } }), false);
  for (const patch of [{ visibility: 'private' as const }, { visibility: 'supporters' as const }, { gate: { type: 'signed-in' } }, { space_uri: 'at://space' }]) assert.equal(downloadAllowed({ ...track, access: { ...track.access, ...patch } }), false);
  assert.ok(downloadAllowed({ ...track, access: { visibility: 'unlisted', download_policy: 'ask' } }));
});
test('current playback must belong to the exact current record revision', async () => {
  assert.equal((await prepareDownload(track.id, track.record.uri, read)).filename, 'artist - ab song.wav');
  for (const patch of [{ record: { ...playback.record, cid: 'other' } }, { availability: { status: 'gated' as const } }, { record: { ...playback.record, uri: 'at://other' } }]) await assert.rejects(prepareDownload(track.id, track.record.uri, { ...read, playback: async () => ({ ...playback, ...patch }) }));
  await assert.rejects(prepareDownload(track.id, track.record.uri, { ...read, track: async () => ({ ...track, access: { visibility: 'public', download_policy: 'off' } }) }));
  await assert.rejects(prepareDownload(track.id, track.record.uri, { ...read, track: async () => { throw new Error('moderation unavailable'); } }));
});
test('ask uses an existing safe support destination without making payment mandatory', async () => {
  const ask = { ...read, track: async () => ({ ...track, access: { ...track.access, download_policy: 'ask' } }) };
  assert.equal((await prepareDownload(track.id, track.record.uri, ask)).support, artist.support_url);
  assert.equal((await prepareDownload(track.id, track.record.uri, { ...ask, artist: async () => ({ ...artist, support_url: 'javascript:alert(1)' }) })).support, null);
});
test('attachment routing is limited to the published service contract', () => {
  const path = '/media/' + 'a'.repeat(64) + '/12345678-1234-4123-8123-123456789abc';
  assert.equal(attachmentUrl('https://plyr-next-audio.n8-3e9.workers.dev' + path), 'https://plyr-next-audio.n8-3e9.workers.dev' + path + '?download=1');
  for (const url of ['https://other.test' + path, 'https://plyr-next-audio.n8-3e9.workers.dev/other', 'https://plyr-next-audio.n8-3e9.workers.dev' + path + '?other=1']) assert.equal(attachmentUrl(url), undefined);
  assert.ok(!downloadFilename(track, 'text/html').endsWith('.html'));
});

test('Unicode filenames fit native filesystem component limits without splitting characters', () => {
  const filename = downloadFilename({ ...track, metadata: { ...track.metadata, title: '🎵'.repeat(120) } }, 'audio/wav');
  assert.ok(new TextEncoder().encode(filename).byteLength <= 184);
  assert.match(filename, /🎵\.wav$/u);
});
