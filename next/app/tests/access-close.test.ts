import assert from 'node:assert/strict';
import test from 'node:test';
import { AUDIO_SPACE_TYPE, CLOSE_SCOPE, NSID, SPACE_MANAGING_APP, hasCloseGrant } from '../src/auth-config.ts';
import { closedRecords, managedPolicy, reopenedRecord, requireManagedSpace, spaceFor } from '../src/access/close.ts';

const did = 'did:plc:artist';
const space = spaceFor(did, '3album');
const blob = { $type: 'blob', ref: { $link: 'bafkreiaudio' }, mimeType: 'audio/mpeg', size: 10 };
const track = { $type: NSID.track, title: 'song', artist: 'a', createdAt: '2026-11-13T00:00:00Z', fileType: 'mp3', duration: 90,
  audioBlob: blob, audioUrl: 'https://cdn.test/song.mp3', imageUrl: 'https://cdn.test/cover.jpg', album: 'record', downloadPolicy: 'open' };

test('closing moves every audio field into the protected copy and points the public record at it', () => {
  const closed = closedRecords(track, space, did, '3song');
  assert.equal(closed.public.audioSpace, `${space}/${did}/${NSID.track}/3song`);
  for (const key of ['audioBlob', 'audioUrl', 'downloadPolicy']) assert.equal(key in closed.public, false, key);
  assert.equal(closed.public.album, 'record');
  assert.equal(closed.public.imageUrl, 'https://cdn.test/cover.jpg');
  assert.deepEqual(closed.protected, { $type: NSID.track, title: 'song', artist: 'a', createdAt: track.createdAt, fileType: 'mp3', duration: 90, audioBlob: blob });
  assert.equal(closedRecords({ ...track, downloadPolicy: 'supporters' }, space, did, '3song').public.downloadPolicy, 'supporters');
});

test('closing refuses what it cannot close and reopening restores the audio', () => {
  assert.throws(() => closedRecords({ ...track, audioBlob: undefined }, space, did, '3song'), /audio on your PDS/);
  assert.throws(() => closedRecords({ ...track, audioSpace: 'at://x' }, space, did, '3song'), /already closed/);
  const closed = closedRecords(track, space, did, '3song');
  const reopened = reopenedRecord(closed.public, closed.protected);
  assert.deepEqual(reopened.audioBlob, blob);
  assert.equal('audioSpace' in reopened, false);
  assert.throws(() => reopenedRecord(track, closed.protected), /not closed/);
});

test('only a space plyr manages is reused', () => {
  requireManagedSpace({ space, policy: managedPolicy() }, space);
  assert.throws(() => requireManagedSpace({ space, policy: { $type: 'com.atproto.memberspace.policy' } }, space), /different kind/);
  assert.throws(() => requireManagedSpace({ space, policy: { ...managedPolicy(), managingApp: 'did:web:other.test' } }, space), /another app/);
  assert.equal(managedPolicy().managingApp, SPACE_MANAGING_APP);
  assert.ok(space.includes(`/space/${AUDIO_SPACE_TYPE}/`));
});

test('the close grant is the scope the app asks for', () => {
  assert.ok(hasCloseGrant(`atproto ${CLOSE_SCOPE}`));
  assert.equal(hasCloseGrant(`space:${AUDIO_SPACE_TYPE}?authority=*&collection=${NSID.track}&action=read`), false);
});
