import type { Auth, Did } from '../auth-state';
import type { createPublicPds, MediaFile, NewTrack } from '../pds';
import type { RepoRpc } from './repo-rpc';
import type { CreateReservation } from './create-operation';
import { audioFormat, uploadPublication, type ChunkReader, type UploadOperation, type UploadStatus, type UploadStorage, type transferParts } from './upload-model.ts';
import { processingStep, retryDelay, transient, uploadInProgress, uploadRoute, type UploadJobView } from './upload-queue-model.ts';
import type { UploadTransport } from './upload-transport';
import type { UploadRecoveryDisposition } from './upload-recovery';
import { draftInRecovery, queuedUploadDraft, reattachQueuedUpload, type QueuedUploadDraft, type QueuedUploadDrafts } from './queued-upload-draft.ts';

type Job = UploadJobView & { owner: Did; draft?: QueuedUploadDraft; input?: NewTrack; file?: MediaFile; operation?: UploadOperation; rkey?: string; uploadId?: string; handedOff?: boolean };
type Session = Pick<Auth<unknown>, 'did' | 'agent' | 'uploadStorage'>;
type Pds = ReturnType<typeof createPublicPds>;
const POLL_MS = 4_000, NUDGE_MS = 20_000, ATTEMPTS = 5, KEEP_FINISHED = 4;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');

export function createUploadQueue<Rpc extends RepoRpc>({
  getAuth, createPds, measureAudioDuration, openUploadReader, sendParts, uploadStorage, queuedDrafts, createUploadTransport,
  applyGenreTags, randomUUID, sha256, onJob, onDismiss
}: {
  getAuth: () => Auth<Rpc>;
  createPds: (auth: Auth<Rpc>) => Pds;
  measureAudioDuration: (file: MediaFile) => Promise<number | undefined>;
  openUploadReader: (file: MediaFile) => ChunkReader;
  sendParts: (operation: UploadOperation, reader: ChunkReader, transport: UploadTransport, hash: Parameters<typeof transferParts>[3], signal: AbortSignal, onProgress: Parameters<typeof transferParts>[5]) => Promise<UploadStatus>;
  uploadStorage: UploadStorage;
  queuedDrafts: QueuedUploadDrafts;
  createUploadTransport: (auth: Session, operation: UploadOperation, assertCurrent: () => void, signal: AbortSignal) => UploadTransport;
  applyGenreTags: (session: () => Auth<Rpc>, uri: string) => Promise<void>;
  randomUUID: () => string;
  sha256: (bytes: Uint8Array<ArrayBuffer>) => Promise<ArrayBuffer>;
  onJob?: (job: UploadJobView) => void;
  onDismiss?: (job: UploadJobView) => void;
}) {
  let jobs: Job[] = [];
  let snapshot: readonly UploadJobView[] = [];
  let running = false;
  const listeners = new Set<() => void>();

  function publish() {
    const finished = jobs.filter(job => job.phase === 'done' || (job.phase === 'failed' && !job.input));
    const stale = new Set(finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED)));
    if (stale.size) jobs = jobs.filter(job => !stale.has(job));
    snapshot = jobs.map(({ id, owner, title, phase, progress, uri, error }) => ({ id, owner, title, phase, progress, uri, error }));
    for (const listener of listeners) listener();
  }

  function patch(job: Job, change: Partial<Job>) {
    Object.assign(job, change);
    onJob?.(job);
    publish();
  }

  function remove(job: Job) {
    jobs = jobs.filter(item => item !== job);
    onDismiss?.(job);
    publish();
  }

  function session(job: Pick<Job, 'owner'>): Auth<Rpc> {
    const auth = getAuth();
    if (auth.did !== job.owner || !auth.rpc) throw new Error('sign in to the account that started it');
    return auth;
  }

  async function withRetries<T>(job: Job, step: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await step(); }
      catch (failure) {
        if (attempt + 1 >= ATTEMPTS || !transient(failure)) throw failure;
        await sleep(retryDelay(attempt));
        session(job);
      }
    }
  }

  async function finishCreate(job: Job, uri: string, autoTag?: boolean, operation?: UploadOperation) {
    const pds = createPds(session(job));
    const pending = (await pds.pendingCreates('track')).find(item => item.uri === uri);
    if (pending) await pds.dismissCreate(pending).catch(() => undefined);
    if (operation) await uploadStorage.delete(operation).catch(() => undefined);
    patch(job, { phase: 'done', uri });
    if (autoTag) void applyGenreTags(() => session(job), uri).catch(() => undefined);
  }

  async function runPds(job: Job, input: NewTrack, reservation: CreateReservation, draft: QueuedUploadDraft) {
    const handedOff = async () => {
      job.handedOff = true;
      await queuedDrafts.take(draft);
    };
    try {
      await withRetries(job, () => createPds(session(job)).uploadTrack(input, reservation, { id: draft.id, handedOff }));
    } catch (failure) {
      // A reauthentication or lost reply can interrupt a create that still reached the PDS: settle it at the same address.
      const pds = createPds(session(job));
      const pending = (await pds.pendingCreates('track')).find(item => item.rkey === reservation.rkey && item.draftId === draft.id);
      if (!pending) throw failure;
      await handedOff();
      if ((await withRetries(job, () => pds.recoverCreate(pending, true))).state !== 'accepted') throw failure;
    }
    patch(job, { phase: 'publishing' });
    await finishCreate(job, reservation.uri, input.autoTag);
  }

  async function runService(job: Job, operation: UploadOperation) {
    session(job);
    const abort = new AbortController();
    // Read the account at each request so a same-account sign-in mid-transfer carries on with the fresh session.
    const current = { get did() { return session(job).did; }, get agent() { return session(job).agent; }, get uploadStorage() { return session(job).uploadStorage; } };
    const transport = createUploadTransport(current, operation, () => { session(job); }, abort.signal);
    let status: UploadStatus = await withRetries(job, () => transport.start());
    if (status.state === 'completing') status = await withRetries(job, () => transport.finish());
    if (status.state === 'transferring') {
      const file = job.file;
      if (!file) throw new Error('reselect the original file on the upload page');
      status = await withRetries(job, () => sendParts(operation, openUploadReader(file), transport,
        async bytes => hex(await sha256(bytes)), abort.signal,
        (sent, checking) => patch(job, { phase: 'uploading', progress: checking ? undefined : sent / operation.sizeBytes })));
    }
    let retried = false, nudged = Date.now();
    for (;;) {
      const step = processingStep(status);
      if (step === 'publish') break;
      if (step === 'stop') throw new Error(status.processingFailure === 'output_budget_exceeded' ? 'the mp3 came out larger than expected' : 'this upload needs attention');
      if (step === 'retry') {
        if (retried) throw new Error('conversion failed. the original is kept');
        retried = true;
        status = await withRetries(job, () => transport.retryProcessing());
        continue;
      }
      if (job.phase !== 'processing') patch(job, { phase: 'processing', progress: undefined });
      await sleep(POLL_MS);
      const nudge = Date.now() - nudged > NUDGE_MS;
      if (nudge) nudged = Date.now();
      status = await withRetries(job, () => nudge ? transport.finish() : transport.status());
    }
    patch(job, { phase: 'publishing' });
    if (status.state !== 'published') {
      const audioUrl = status.audioUrl!;
      const publication = await withRetries(job, () => createPds(session(job)).uploadedTrack(uploadPublication(operation, status), audioUrl, true));
      if (publication.state !== 'accepted') throw new Error('a different record already uses this address');
      for (let check = 0; status.state !== 'published' && check < 3; check++) {
        if (check) await sleep(POLL_MS);
        status = await withRetries(job, () => transport.activate());
      }
    }
    if (status.state !== 'published') {
      patch(job, { phase: 'awaiting-publication' });
      return;
    }
    await finishCreate(job, operation.uri, operation.autoTag, operation);
  }

  async function draftAvailable(draft: QueuedUploadDraft) {
    const pds = createPds(session(draft));
    const [creates, uploads] = await Promise.all([pds.pendingCreates('track'), uploadStorage.load(draft.owner)]);
    // Recovery deletes a linked draft before removing its operation.
    return !draftInRecovery(draft, creates, uploads) && queuedDrafts.has(draft);
  }

  async function runDraft(job: Job, input: NewTrack, draft: QueuedUploadDraft) {
    if (!await draftAvailable(draft)) {
      job.input = undefined;
      job.file = undefined;
      throw new Error('this queued upload has already moved to upload recovery');
    }
    const auth = session(job), pds = createPds(auth);
    const duration = input.duration ?? await measureAudioDuration(input.file).catch(() => undefined);
    const ready = { ...input, duration };
    const route = uploadRoute(input.file, duration);
    if (route.kind === 'service' && !auth.uploadStorage) throw new Error('sign in again to allow plyr storage');
    const reservation = await pds.reserveCreate('track').catch(() => { throw new Error('finish the earlier upload first'); });
    session(job);
    patch(job, { phase: 'uploading', rkey: reservation.rkey });
    if (route.kind === 'pds') return runPds(job, ready, reservation, draft);
    const format = audioFormat(input.file.name, input.file.type, !!route.processing);
    const record = await pds.prepareTrackRecord(ready);
    const operation: UploadOperation = { ...reservation, draftId: draft.id, record: { ...record, fileType: format.fileType }, uploadId: randomUUID(),
      name: input.file.name, sizeBytes: input.file.size, ...format, ...(route.processing ? { processing: route.processing } : {}), ...(input.autoTag ? { autoTag: true } : {}) };
    await uploadStorage.put(operation);
    job.handedOff = true;
    await queuedDrafts.take(draft);
    patch(job, { operation, uploadId: operation.uploadId });
    return runService(job, operation);
  }

  async function run(job: Job) {
    if (job.operation) return runService(job, job.operation);
    const { draft, input } = job;
    if (!draft || !input) throw new Error('the queued upload is missing its draft');
    return queuedDrafts.withLock(draft, () => runDraft(job, input, draft));
  }

  function alreadyQueued(operation: UploadOperation) {
    return jobs.some(job => job.owner === operation.owner && job.uploadId === operation.uploadId &&
      (uploadInProgress(job.phase) || job.phase === 'done'));
  }

  function enqueueSaved(operation: UploadOperation, file?: MediaFile) {
    if (alreadyQueued(operation)) return;
    const title = typeof operation.record.title === 'string' ? operation.record.title : operation.name;
    const job: Job = { id: randomUUID(), owner: operation.owner, title, phase: 'waiting', operation, file, uploadId: operation.uploadId, rkey: operation.rkey };
    const previous = jobs.find(item => item.owner === operation.owner && item.uploadId === operation.uploadId && item.phase === 'awaiting-publication');
    if (previous) onDismiss?.(previous);
    jobs = [...jobs.filter(item => item !== previous), job];
    patch(job, {});
  }

  async function drain() {
    if (running) return;
    running = true;
    try {
      for (let job = jobs.find(item => item.phase === 'waiting'); job; job = jobs.find(item => item.phase === 'waiting')) {
        try {
          await run(job);
          job.input = undefined; job.file = undefined;
        } catch (failure) {
          if (job.handedOff) { job.input = undefined; job.file = undefined; }
          patch(job, { phase: 'failed', error: failure instanceof Error ? failure.message.replace(/\.$/, '') : undefined });
        }
      }
    } finally { running = false; }
  }

  function enqueueDraft(draft: QueuedUploadDraft, input: NewTrack) {
    const job: Job = { id: draft.id, owner: draft.owner, title: draft.title.trim(), phase: 'waiting', draft, input, file: input.file };
    jobs = [...jobs, job];
    patch(job, {});
    void drain();
  }

  return {
    async add(input: NewTrack) {
      const owner = getAuth().did;
      if (!owner) throw new Error('sign in first.');
      uploadRoute(input.file);
      const draft = queuedUploadDraft(input, owner, randomUUID());
      await queuedDrafts.put(draft);
      if (getAuth().did === owner) enqueueDraft(draft, input);
    },
    reattach(draft: QueuedUploadDraft, file: MediaFile, artwork?: MediaFile) {
      if (draft.owner !== getAuth().did) throw new Error('sign in to the account that queued it.');
      if (jobs.some(job => job.id === draft.id)) return;
      enqueueDraft(draft, reattachQueuedUpload(draft, file, artwork));
    },
    /** Pick up saved plyr-storage uploads whose bytes already arrived, e.g. after a reload. */
    async resume(owner: Did) {
      const account = getAuth();
      if (account.did !== owner || !account.rpc) return;
      const assertCurrent = () => { if (getAuth().rpc !== account.rpc) throw new Error('account changed.'); };
      const pds = createPds(account), pending = await pds.pendingCreates('track');
      for (const operation of await uploadStorage.load(owner)) {
        if (jobs.some(job => job.uploadId === operation.uploadId && job.phase !== 'awaiting-publication') || pending.some(item => item.rkey === operation.rkey && item.archived)) continue;
        const status = await createUploadTransport(account, operation, assertCurrent, new AbortController().signal).status().catch(() => undefined);
        if (!status || !['completing', 'processing', 'complete', 'published'].includes(status.state)) continue;
        enqueueSaved(operation);
      }
      void drain();
    },
    /** Carry on with a saved upload; a transfer that stopped part way needs its original file. */
    continue(operation: UploadOperation, file?: MediaFile) {
      if (alreadyQueued(operation)) return;
      if (file) {
        const format = audioFormat(file.name, file.type, !!operation.processing);
        if (format.fileType !== operation.fileType || format.contentType !== operation.contentType) throw new Error('select the original audio file.');
      }
      enqueueSaved(operation, file);
      void drain();
    },
    /** A failed upload's form entries, taken out of the queue so they can be edited and sent again. */
    async takeBack(id: string, saveEditor: (input: NewTrack) => () => void): Promise<NewTrack | undefined> {
      const job = jobs.find(item => item.id === id && item.owner === getAuth().did && item.phase === 'failed' && item.input);
      if (!job) return;
      const { draft, input } = job;
      if (!draft || !input) return;
      return queuedDrafts.withLock(draft, async () => {
        if (!await draftAvailable(draft)) {
          remove(job);
          throw new Error('this queued upload was already opened elsewhere');
        }
        const undo = saveEditor(input);
        try {
          if (!await queuedDrafts.take(draft)) throw new Error('could not reopen the queued upload.');
        } catch (failure) {
          undo();
          throw failure;
        }
        remove(job);
        return input;
      });
    },
    dismissRecovery(operation: UploadOperation, disposition: UploadRecoveryDisposition) {
      if (operation.owner !== getAuth().did) return;
      const job = jobs.find(item => item.phase === 'awaiting-publication' && item.owner === operation.owner &&
        item.uploadId === operation.uploadId && item.operation?.uri === operation.uri);
      if (job) remove(job);
      if (disposition === 'published' && operation.autoTag && !alreadyQueued(operation)) {
        void applyGenreTags(() => session(operation), operation.uri).catch(() => undefined);
      }
    },
    /** Creations and transfers the queue is driving, so recovery screens leave them alone. */
    busy() {
      const active = jobs.filter(job => uploadInProgress(job.phase));
      return { rkeys: new Set(active.flatMap(job => job.rkey ? [job.rkey] : [])), uploadIds: new Set(active.flatMap(job => job.uploadId ? [job.uploadId] : [])) };
    },
    active: () => jobs.some(job => uploadInProgress(job.phase)),
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => snapshot,
    editable: (id: string) => jobs.some(job => job.id === id && job.owner === getAuth().did && job.phase === 'failed' && !!job.input),
  };
}
