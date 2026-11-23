import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClosing } from '../src/access/close.ts';

const { closedRecords, spaceFor } = createClosing({ NSID: { track: 'fm.plyr.track' }, AUDIO_SPACE_TYPE: 'fm.plyr.audio', SPACE_MANAGING_APP: 'did:web:plyr.fm' });

test('closing a track that is already closed says so, even though its audio is gone from the record', () => {
  const closed = { $type: 'fm.plyr.track', title: 't', audioSpace: 'at://did:plc:a/space/fm.plyr.audio/r/did:plc:a/fm.plyr.track/r' };
  assert.throws(() => closedRecords(closed, spaceFor('did:plc:a', 'r'), 'did:plc:a', 'r'), /already closed/);
});
