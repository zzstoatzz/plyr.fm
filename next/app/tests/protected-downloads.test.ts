import assert from 'node:assert/strict';
import test from 'node:test';
import { protectedDownloadPolicy, requireProtectedReference } from '../src/downloads/protected-policy.ts';
import type { Track } from '../src/api.ts';

const track: Track = { object: 'track', id: 'track', record: { uri: 'at://did:plc:artist/fm.plyr.track/song', cid: 'revision', revision: null, collection: 'fm.plyr.track', rkey: 'song' }, metadata: { title: 'public title', artist_name: 'artist', description: null, album: null, duration_seconds: 1, created_at: '2026-11-12T00:00:00Z' }, artist: { did: 'did:plc:artist', profile: { handle: 'artist.test', display_name: 'artist', avatar_url: null } }, media: {}, access: { visibility: 'public', download_policy: 'open' }, metrics: { play_count: 0, like_count: 0 } };

test('protected download permission must be explicit on the verified record', () => {
  for (const downloadPolicy of ['open', 'ask']) assert.equal(protectedDownloadPolicy({ downloadPolicy }), downloadPolicy);
  for (const downloadPolicy of [undefined, null, 'off', 'supporters', 'future']) assert.throws(() => protectedDownloadPolicy({ downloadPolicy }));
  for (const supportGate of [undefined, null, { type: 'any' }, { type: 'owner' }]) assert.throws(() => protectedDownloadPolicy({ downloadPolicy: 'open', supportGate }));
  for (const visibility of ['private', 'supporters', 'future', null]) assert.throws(() => protectedDownloadPolicy({ downloadPolicy: 'open', visibility }));
});

test('a protected source stays bound to the public author and track collection', () => {
  const uri = 'at://did:plc:artist/space/fm.plyr.audio/signed-in/did:plc:artist/fm.plyr.track/private-copy';
  requireProtectedReference(track, uri);
  for (const invalid of [uri.replace('at://did:plc:artist', 'at://did:plc:other'), uri.replace('/did:plc:artist/', '/did:plc:other/'), uri.replace('/fm.plyr.track/', '/fm.plyr.list/'), uri + '/extra', track.record.uri]) assert.throws(() => requireProtectedReference(track, invalid));
});
