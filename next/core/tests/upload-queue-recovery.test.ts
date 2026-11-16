import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { Auth } from '../src/auth-state.ts';
import type { createPublicPds } from '../src/pds.ts';
import type { RepoRpc } from '../src/publishing/repo-rpc.ts';
import type { CreateOperation } from '../src/publishing/create-operation.ts';
import { UPLOAD_PART_BYTES, type UploadOperation, type UploadStatus } from '../src/publishing/upload-model.ts';
import { createUploadQueue } from '../src/publishing/upload-queue.ts';
import { jobLine, uploadInProgress } from '../src/publishing/upload-queue-model.ts';
import { queuedUploadKey, readQueuedUploadDraft, type QueuedUploadDraft } from '../src/publishing/queued-upload-draft.ts';
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

function fixture({ statusGate, reserve = async () => record, beforeSaveTransfer, beforeLoadTransfers, start }: {
  statusGate?: Promise<void>;
  reserve?: (kind: 'track', rkey?: string) => Promise<typeof record>;
  beforeSaveTransfer?: (operation: UploadOperation) => Promise<void>;
  beforeLoadTransfers?: () => void;
  start?: () => Promise<UploadStatus>;
} = {}) {
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
    prepareTrackRecord: async () => record.record,
    pendingCreates: async () => saved.length ? [record] : [],
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
      load: async () => { beforeLoadTransfers?.(); return saved; },
      put: async value => { await beforeSaveTransfer?.(value); saved = [value]; },
      delete: async () => { saved = []; },
    },
    queuedDrafts: {
      load: async account => [...drafts.values()].filter(draft => draft.owner === account),
      put: async draft => { drafts.set(draft.id, draft); },
      has: async draft => drafts.has(draft.id),
      take: async draft => drafts.delete(draft.id),
      withLock: async (_draft, task) => task(),
    },
    createUploadTransport: () => ({
      start: start ?? (async () => status()),
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
  assert.deepEqual(await model.takeBack(oldest.id, () => () => {}), { file, artist: 'fixture', title: 'Take 0' });
});

test('a failed queue cannot reopen a draft already consumed elsewhere', async () => {
  const { model, drafts } = fixture({ reserve: async () => { throw new Error('resolve an earlier create first'); } });
  const file = { name: 'fixture.mp3', type: 'audio/mpeg', size: 1, arrayBuffer: async () => new ArrayBuffer(1) };
  await model.add({ file, artist: 'fixture', title: 'Take' });
  await setImmediate();
  const job = model.snapshot()[0];
  assert.equal(job.phase, 'failed');
  assert.equal(drafts.delete(job.id), true);
  await assert.rejects(model.takeBack(job.id, () => () => {}), /this queued upload was already opened elsewhere/);
  assert.deepEqual(model.snapshot(), []);
});

test('processed upload keeps its draft until the transfer is durable', async () => {
  const saving = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const f = fixture({ beforeSaveTransfer: () => { saving.resolve(); return release.promise; } });
  f.confirm();
  const file = { name: 'fixture.wav', type: 'audio/wav', size: 1, arrayBuffer: async () => new ArrayBuffer(1) };
  await f.model.add({ file, artist: 'fixture', title: 'Take', description: 'Saved notes' });
  await saving.promise;
  assert.deepEqual(f.recordForRecovery(), []);
  assert.equal([...f.drafts.values()][0].description, 'Saved notes');
  release.resolve();
  await setImmediate();
  assert.equal(f.drafts.size, 0);
  assert.equal(f.model.snapshot()[0].phase, 'done');
});

test('a worker rejection after handoff leaves transfer recovery without a second edit path', async () => {
  const f = fixture({ start: async () => { throw new Error('upload reservation refused'); } });
  const file = { name: 'fixture.wav', type: 'audio/wav', size: 1, arrayBuffer: async () => new ArrayBuffer(1) };
  await f.model.add({ file, artist: 'fixture', title: 'Take' });
  await setImmediate();
  const job = f.model.snapshot()[0];
  assert.equal(job.phase, 'failed');
  assert.equal(f.recordForRecovery()[0].draftId, job.id);
  assert.equal(f.model.editable(job.id), false);
});

test('an automatic retry is visible and keeps the same active upload until it succeeds', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let attempts = 0;
  const f = fixture({ start: async () => {
    if (++attempts < 3) throw Object.assign(new Error('service unavailable'), { status: 503 });
    return {
      state: 'published', recoveryRequired: false, reservedBytes: 1, partSizeBytes: UPLOAD_PART_BYTES,
      partCount: 1, receivedParts: [], reservedDigests: [],
    };
  } });
  f.seed();
  await f.model.resume(owner);
  await setImmediate();
  const retry = f.model.snapshot()[0];
  assert.ok(uploadInProgress(retry.phase));
  assert.equal(jobLine(retry), 'retrying "fixture"…');
  context.mock.timers.tick(2_000);
  await setImmediate();
  assert.equal(jobLine(f.model.snapshot()[0]), 'retrying "fixture"…');
  context.mock.timers.tick(4_000);
  await setImmediate();
  const finished = f.model.snapshot()[0];
  assert.equal(finished.id, retry.id);
  assert.equal(jobLine(finished), '"fixture" uploaded');
  assert.deepEqual(f.recordForRecovery(), []);
});

test('a completed recovery cannot race a stale draft into a new reservation', async () => {
  let reservations = 0;
  const f = fixture({
    reserve: async () => { reservations++; return record; },
    beforeLoadTransfers: () => { f.drafts.clear(); },
  });
  const file = { name: 'fixture.mp3', type: 'audio/mpeg', size: 1, arrayBuffer: async () => new ArrayBuffer(1) };
  await f.model.add({ file, artist: 'fixture', title: 'Take' });
  await setImmediate();
  assert.equal(f.model.snapshot()[0].phase, 'failed');
  assert.equal(reservations, 0);
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
  const f = fixture({ statusGate: gate.promise });
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

test('planned uploads keep their record address across the draft and transfer handoff', async () => {
  const save = Promise.withResolvers<UploadOperation>();
  const release = Promise.withResolvers<void>();
  const planned = { owner, id: 'slot-two', reservedRkey: '3222222222223' } as const;
  const expectedUri = `at://${owner}/${collection}/${planned.reservedRkey}`;
  const f = fixture({
    reserve: async (kind, rkey) => {
      assert.equal(kind, 'track');
      assert.equal(rkey, planned.reservedRkey);
      return { ...record, rkey, uri: expectedUri };
    },
    beforeSaveTransfer: transfer => { save.resolve(transfer); return release.promise; },
  });
  f.confirm();
  const file = { name: 'fixture.wav', type: 'audio/wav', size: 1, arrayBuffer: async () => new ArrayBuffer(1) };
  const input = { file, artist: 'fixture', title: 'Take', album: 'Sessions' };
  await assert.rejects(f.model.add(input, { ...planned, owner: 'did:plc:other' }), /sign in to the account that started it/);
  assert.equal(f.drafts.size, 0);
  await f.model.add(input, planned);
  const transfer = await save.promise;
  try {
    const draft = f.drafts.get(planned.id);
    assert.ok(draft);
    assert.equal(readQueuedUploadDraft(draft, owner, queuedUploadKey(draft)).reservedRkey, planned.reservedRkey);
    assert.equal(transfer.uri, expectedUri);
    assert.equal(transfer.draftId, planned.id);
    assert.equal(f.model.snapshot()[0].draftId, planned.id);
  } finally { release.resolve(); }
  await setImmediate();
  assert.equal(f.model.snapshot()[0].uri, expectedUri);
});

test('resuming a saved service upload retains the original draft identity', async () => {
  const f = fixture();
  f.confirm();
  f.seed({ ...operation, draftId: 'slot-two' });
  await f.model.resume(owner);
  await setImmediate();
  const job = f.model.snapshot().find(entry => entry.phase === 'done');
  assert.ok(job);
  assert.notEqual(job.id, 'slot-two');
  assert.equal(job.draftId, 'slot-two');
  assert.equal(job.uri, uri);
});

test('editing a failed album song cannot replace its reserved address', async () => {
  let attempts = 0;
  const f = fixture({ reserve: async (_kind, rkey) => { attempts++; assert.equal(rkey, record.rkey); return record; } });
  const file = { name: 'fixture.mp3', type: 'audio/mpeg', size: 1, arrayBuffer: async () => new ArrayBuffer(1) };
  const planned = { owner, id: 'album-song', reservedRkey: record.rkey };
  await f.model.add({ file, artist: 'fixture', title: 'Take' }, planned);
  await setImmediate();
  const draft = f.drafts.get(planned.id);
  assert.ok(draft);
  assert.equal(f.model.editable(planned.id), false);
  assert.equal(await f.model.takeBack(planned.id, () => { throw new Error('must keep the original address'); }), undefined);
  f.model.reattach(draft, file);
  await setImmediate();
  assert.equal(attempts, 2);
});
