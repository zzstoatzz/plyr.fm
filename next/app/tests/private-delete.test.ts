import assert from 'node:assert/strict';
import test from 'node:test';
import { privateDeletion } from '../src/publishing/private-delete.ts';
import { privateTrack, withoutPrivateTrack } from '../src/publishing/private-track.ts';
import { hasPrivateDeleteGrant, PRIVATE_DELETE_SCOPE } from '../src/auth-config.ts';

const owner = 'did:plc:fixture';
const track = privateTrack(owner, '3jzfcijpj2z2a', 'oldcid', { $type: 'fm.plyr.track', title: 'private', artist: 'artist', createdAt: '2026-11-12T00:00:00Z' });
function fixture() {
  const state = { session: true, record: { uri: track.record.uri, cid: 'newer-cid' } as { uri: string; cid: string } | undefined, writes: 0, lost: false, offline: false, pending: false };
  const deletion = privateDeletion({ owner, allowed: true,
    current: () => { if (!state.session) throw new Error('account changed'); return owner; }, policy: async () => {},
    pending: async () => state.pending ? [{ uri: track.record.uri }] : [],
    read: async () => { if (state.offline) throw new Error('offline'); return state.record; },
    send: async () => { state.writes++; state.record = undefined; if (state.lost) throw new Error('response lost'); },
  });
  return { state, deletion };
}
test('explicit deletion removes the current URI without inventing a CID precondition', async () => {
  const { state, deletion } = fixture();
  assert.equal(await deletion.remove(track), 'deleted');
  assert.equal(state.writes, 1);
});
test('lost acknowledgement reconciles by authoritative read and never repeats automatically', async () => {
  const { state, deletion } = fixture(); state.lost = true; state.offline = true;
  await assert.rejects(deletion.remove(track), /could not confirm deletion/);
  assert.equal(state.writes, 1); state.offline = false;
  assert.equal(await deletion.check(track), 'deleted'); assert.equal(state.writes, 1);
});
test('a record that still exists requires a new explicit deletion, and creation recovery blocks mutation', async () => {
  const { state, deletion } = fixture();
  assert.equal(await deletion.check(track), 'present'); assert.equal(state.writes, 0);
  state.pending = true; await assert.rejects(deletion.remove(track), /creation recovery/); assert.equal(state.writes, 0);
});
test('another owner or expired session cannot send deletion', async () => {
  const { state, deletion } = fixture();
  await assert.rejects(deletion.remove({ ...track, artist: { ...track.artist, did: 'did:plc:other' } }));
  state.session = false; await assert.rejects(deletion.remove(track), /account changed/); assert.equal(state.writes, 0);
});
test('deleting exact private URI removes duplicate occurrences and preserves other queue positions', () => {
  const other = { ...track, id: 'private_other', record: { ...track.record, uri: track.record.uri + '-other' } };
  assert.deepEqual(withoutPrivateTrack([track, other, track], 1, track.record.uri), { queue: [other], index: 0, currentRemoved: false });
  assert.deepEqual(withoutPrivateTrack([track, other, track], 0, track.record.uri), { queue: [other], index: 0, currentRemoved: true });
  assert.deepEqual(withoutPrivateTrack([track], 0, track.record.uri), { queue: [], index: -1, currentRemoved: true });
});
test('delete permission is separate from create permission and explicitly requested', () => {
  assert.ok(hasPrivateDeleteGrant(PRIVATE_DELETE_SCOPE));
  assert.ok(!hasPrivateDeleteGrant(PRIVATE_DELETE_SCOPE.replace('action=delete', 'action=create')));
});
