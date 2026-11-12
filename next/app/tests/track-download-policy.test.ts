import assert from 'node:assert/strict';
import test from 'node:test';
import { changedDownloadPreference, editableDownloadPreference } from '../src/publishing/track-download-policy.ts';

test('download preferences preserve public audio, labels and unknown fields', () => {
  const record = { audioUrl: 'https://public.example/audio', labels: { values: [{ val: 'porn' }] }, extra: { kept: true } };
  for (const visibility of ['public', 'unlisted']) {
    assert.equal(editableDownloadPreference(record, visibility), 'open');
    for (const policy of ['open', 'ask', 'off'] as const) {
      const changed = changedDownloadPreference(record, visibility, policy);
      assert.deepEqual(changed, { ...record, downloadPolicy: policy });
      assert.equal(Object.hasOwn(record, 'downloadPolicy'), false);
    }
  }
});

test('unknown, supporter and protected policies cannot become public download preferences', () => {
  for (const record of [{ downloadPolicy: 'future' }, { downloadPolicy: 'supporters' }, { downloadPolicy: null },
    { audioSpace: null }, { audioFileId: 'protected' }, { originalAudioBlob: {} }, { audioPayload: {} }, { privateAudio: {} }, { supportGate: {} }, { visibility: 'private' }, { visibility: 'future' }]) {
    assert.equal(editableDownloadPreference(record, 'public'), undefined);
    assert.throws(() => changedDownloadPreference(record, 'public', 'open'));
  }
  for (const visibility of ['private', 'supporters', 'blocked', 'future']) {
    assert.equal(editableDownloadPreference({}, visibility), undefined);
    assert.throws(() => changedDownloadPreference({}, visibility, 'open'));
  }
});
