import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { Auth } from '../src/auth-state.ts';
import type { createPublicPds } from '../src/pds.ts';
import type { RepoRpc } from '../src/publishing/repo-rpc.ts';
import type { CreateOperation } from '../src/publishing/create-operation.ts';
import { UPLOAD_PART_BYTES, type UploadOperation, type UploadStatus } from '../src/publishing/upload-model.ts';
import { createUploadQueue } from '../src/publishing/upload-queue.ts';
import type { QueuedUploadDraft } from '../src/publishing/queued-upload-draft.ts';
import type { UploadTransport } from '../src/publishing/upload-transport.ts';

const owner = 'did:plc:fixture';
const collection = 'fm.plyr.track';
const uri = `at://${owner}/${collection}/3222222222222`;
const record: CreateOperation = {
  owner, collection, uri, rkey: '3222222222222', record: { $type: collection, title: 'fixture' },
};
const operation: UploadOperation = {
  ...record, uploadId: 'fixture', name: 'fixture.mp3', sizeBytes: 1, contentType: 'audio/mpeg', fileType: 'mp3',
};

function fixture(statusGate?: Promise<void>, reserve = async () => record) {
  let counter = 0;
  let confirmations = 0;
  let dismissed = 0;
  let publicationAttempts = 0;
  let tags = 0;
  let published = false;
  let saved: UploadOperation[] = [];
  const drafts = new Map<string, QueuedUploadDraft>();
  const status = (): UploadStatus => ({
    state: published ? 'published' : 'complete', recoveryRequired: false, reservedBytes: 1,
    partSizeBytes: UPLOAD_PART_BYTES, partCount: 1, receivedParts: [], reservedDigests: [],
    audioUrl: 'https://fixture.invalid/media/fixture',
  });
  const pds = {
    reserveCreate: reserve,
    uploadTrack: async () => { throw new Error('host rejected the upload'); },
    pendingCreates: async () => [record],
    recoverCreate: async () => ({ state: 'different' }),
    uploadedTrack: async () => { publicationAttempts++; return { state: 'accepted' }; },
    dismissCreate: async () => { dismissed++; },
  } as unknown as ReturnType<typeof createPublicPds>;
  const model = createUploadQueue({
    getAuth: () => ({ did: owner, rpc: {}, uploadStorage: true }) as Auth<RepoRpc>,
    createPds: () => pds,
    measureAudioDuration: async () => 1,
    openUploadReader: () => { throw new Error('not used'); },
    sendParts: async () => { throw new Error('not used'); },
    uploadStorage: {
      load: async () => saved,
      put: async value => { saved = [value]; },
      delete: async () => { saved = []; },
    },
    queuedDrafts: {
      load: async account => [...drafts.values()].filter(draft => draft.owner === account),
      put: async draft => { drafts.set(draft.id, draft); },
      take: async draft => drafts.delete(draft.id),
    },
    createUploadTransport: () => ({
      start: async () => status(),
      status: async () => { await statusGate; return status(); },
      activate: async () => { confirmations++; return status(); },
    }) as UploadTransport,
    applyGenreTags: async () => { tags++; },
    randomUUID: () => String(++counter),
    sha256: async () => new ArrayBuffer(32),
  });
  return {
    model, recordForRecovery: () => saved,
    confirmations: () => confirmations, dismissals: () => dismissed, publications: () => publicationAttempts,
    seed: (entry = operation) => { saved = [entry]; }, confirm: () => { published = true; }, tags: () => tags,
    drafts,
  };
}

test('failed jobs retain each editable input when more than four attempts fail', async () => {
  const { model } = fixture();
  const file = { name: 'fixture.mp3', type: 'audio/mpeg', size: 1, arrayBuffer: async () => new ArrayBuffer(1) };
  for (let index = 0; index < 6; index++) await model.add({ file, artist: 'fixture', title: `Take ${index}` });
  await setImmediate();
  assert.deepEqual(model.snapshot().map(job => job.phase), Array(6).fill('failed'));
  const oldest = model.snapshot()[0];
  assert.equal(model.editable(oldest.id), true);
  assert.deepEqual(await model.takeBack(oldest.id), { file, artist: 'fixture', title: 'Take 0' });
});

test('a failed queue cannot reopen a draft already consumed elsewhere', async () => {
  const { model, drafts } = fixture(undefined, async () => { throw new Error('resolve an earlier create first'); });
  const file = { name: 'fixture.mp3', type: 'audio/mpeg', size: 1, arrayBuffer: async () => new ArrayBuffer(1) };
  await model.add({ file, artist: 'fixture', title: 'Take' });
  await setImmediate();
  const job = model.snapshot()[0];
  assert.equal(job.phase, 'failed');
  assert.equal(drafts.delete(job.id), true);
  await assert.rejects(model.takeBack(job.id), /this queued upload was already opened elsewhere/);
  assert.deepEqual(model.snapshot(), []);
});

test('publication stays recoverable until the worker confirms it, then cleans up the same upload', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  f.seed();
  await f.model.resume(owner);
  await setImmediate();
  for (let attempt = 1; attempt < 3; attempt++) {
    context.mock.timers.tick(4_000);
    await setImmediate();
  }
  assert.equal(f.confirmations(), 3);
  assert.equal(f.model.snapshot()[0].phase, 'awaiting-publication');
  assert.equal(f.model.snapshot()[0].uri, undefined);
  assert.equal(f.model.active(), false);
  assert.equal(f.model.busy().uploadIds.size, 0);
  assert.equal(f.dismissals(), 0);
  assert.deepEqual(f.recordForRecovery(), [operation]);
  assert.equal(f.publications(), 1);

  f.confirm();
  let recoveryVisibleAtSuccess;
  const unsubscribe = f.model.subscribe(() => {
    if (f.model.snapshot().some(job => job.phase === 'done')) recoveryVisibleAtSuccess = f.recordForRecovery();
  });
  await f.model.resume(owner);
  await setImmediate();
  unsubscribe();
  assert.deepEqual(f.model.snapshot().map(job => [job.phase, job.uri]), [['done', uri]]);
  assert.equal(f.publications(), 1);
  assert.equal(f.dismissals(), 1);
  assert.deepEqual(f.recordForRecovery(), []);
  assert.deepEqual(recoveryVisibleAtSuccess, []);
});

test('a delayed resume does not re-enqueue an upload that has finished meanwhile', async () => {
  const gate = Promise.withResolvers<void>();
  const f = fixture(gate.promise);
  f.confirm();
  f.seed();
  const resumed = f.model.resume(owner);
  await setImmediate();
  f.model.continue(operation);
  await setImmediate();
  assert.deepEqual(f.model.snapshot().map(job => job.phase), ['done']);
  gate.resolve();
  await resumed;
  await setImmediate();
  assert.deepEqual(f.model.snapshot().map(job => job.phase), ['done']);
});

test('manual publication honors auto-tag after the waiting row has been set aside', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const tagged = { ...operation, autoTag: true };
  f.seed(tagged);
  await f.model.resume(owner);
  await setImmediate();
  for (let attempt = 1; attempt < 3; attempt++) {
    context.mock.timers.tick(4_000);
    await setImmediate();
  }
  assert.equal(f.model.snapshot()[0].phase, 'awaiting-publication');
  f.model.dismissRecovery(tagged, 'archived');
  assert.deepEqual(f.model.snapshot(), []);
  assert.equal(f.tags(), 0);
  f.model.dismissRecovery(tagged, 'published');
  assert.equal(f.tags(), 1);
});
