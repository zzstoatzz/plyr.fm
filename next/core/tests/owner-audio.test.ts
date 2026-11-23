import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Playback } from '../src/api.ts';
import { isOwnerOnlyTrack, ownerAudioUrl, ownerAwarePlayback } from '../src/owner-audio.ts';

const artist = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const track = {
  id: 'track', artist: { did: artist }, record: { uri: `at://${artist}/fm.plyr.track/3m`, cid: 'bafy' },
  access: { visibility: 'public' as const, gate: { type: 'any' }, space_uri: null },
} as Parameters<typeof ownerAwarePlayback>[0];
const refused = () => Promise.reject(Object.assign(new Error('Authentication is required for this resource.'), { status: 401 }));
const link = 'https://audio.example/v1/legacy-audio/abc123?capability=x.y';

test('an owner-only track plays for its artist through their own link', async () => {
  const playback = await ownerAwarePlayback(track, refused, async () => link, artist);
  assert.equal(playback.availability.status, 'available');
  assert.equal(playback.availability.delivery?.url, link);
});

test('everyone else is told only the artist can play it, without asking for a link', async () => {
  for (const viewer of [null, 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb']) {
    await assert.rejects(ownerAwarePlayback(track, refused, () => assert.fail('no link for a listener'), viewer), /only the artist can play this/);
  }
});

test('other answers pass through untouched', async () => {
  const playback = { object: 'playback', availability: { status: 'available' } } as Playback;
  assert.equal(await ownerAwarePlayback(track, async () => playback, () => assert.fail(), null), playback);
  const open = { ...track, access: { ...track.access, gate: null } };
  assert.equal(isOwnerOnlyTrack(open), false);
  await assert.rejects(ownerAwarePlayback(open, refused, () => assert.fail(), artist), /Authentication is required/);
  assert.equal(isOwnerOnlyTrack({ access: { ...track.access, space_uri: `at://${artist}/space/x` } } as never), false);
});

test('the owner link is asked for with the upload grant and checked before use', async () => {
  const config = { UPLOAD_AUTHORIZE_METHOD: 'fm.plyr.upload.authorize', UPLOAD_COORDINATOR_URL: 'https://jams.example', UPLOAD_SERVICE_AUDIENCE: 'did:web:jams.example#jams' };
  const agent = { handle: async (path: string) => { assert.match(path, /lxm=fm.plyr.upload.authorize/); return Response.json({ token: 'jwt' }); } };
  const account = { did: artist, agent, uploadStorage: true } as never;
  const sent: unknown[] = [];
  const answer = (body: unknown, status = 200) => (async (_url: unknown, init?: RequestInit) => { sent.push(JSON.parse(String(init?.body))); return Response.json(body, { status }); }) as typeof fetch;
  assert.equal(await ownerAudioUrl(config, account, track.record.uri, undefined, answer({ url: link })), link);
  assert.deepEqual(sent[0], { serviceToken: 'jwt', recordUri: track.record.uri });
  await assert.rejects(ownerAudioUrl(config, account, track.record.uri, undefined, answer({ url: 'https://evil.example/audio/x' })), /audio unavailable/);
  await assert.rejects(ownerAudioUrl(config, account, track.record.uri, undefined, answer({}, 403)), /only the artist can play this/);
  await assert.rejects(ownerAudioUrl(config, { did: artist, agent, uploadStorage: false } as never, track.record.uri), /sign in again/);
});
