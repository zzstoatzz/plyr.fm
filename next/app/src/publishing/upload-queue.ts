import { useSyncExternalStore } from 'react';
import { CryptoDigestAlgorithm, digest, randomUUID } from 'expo-crypto';
import { getAuth, type Auth, type Did } from '../auth-state';
import { trackIdFromUri } from '../api';
import { measureAudioDuration } from '../media-picker';
import { createPds, type MediaFile, type NewTrack } from '../pds';
import { toast } from '../toast';
import type { CreateReservation } from './create-operation';
import { audioFormat, transferParts, uploadPublication, type UploadOperation, type UploadStatus } from './upload-model';
import { jobLine, processingStep, retryDelay, transient, uploadRoute, type UploadJobView } from './upload-queue-model';
import { openUploadReader } from './upload-reader';
import { uploadStorage } from './upload-storage';
import { createUploadTransport } from './upload-transport';

/**
 * Uploads run here, above the route stack, one at a time: leaving the upload page, opening another screen or
 * queueing more tracks never interrupts one. Each job keeps a single toast current. Plyr-storage uploads are
 * saved before transfer, so after a reload the queue picks up any whose bytes already arrived.
 */
type Job = UploadJobView & { owner: Did; input?: NewTrack; file?: MediaFile; operation?: UploadOperation; rkey?: string; uploadId?: string };

const POLL_MS = 4_000, NUDGE_MS = 20_000, ATTEMPTS = 5, KEEP_FINISHED = 4;
let jobs: Job[] = [];
let running = false;
const listeners = new Set<() => void>();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');

function publish() {
  const finished = jobs.filter(job => job.phase === 'done' || job.phase === 'failed');
  const stale = new Set(finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED)));
  if (stale.size) jobs = jobs.filter(job => !stale.has(job));
  for (const listener of listeners) listener();
}

function patch(job: Job, change: Partial<Job>) {
  Object.assign(job, change);
  jobs = [...jobs];
  const key = `upload:${job.id}`;
  if (job.phase === 'done') toast.add(jobLine(job), 'success', 6000, job.uri ? { label: 'view track', href: `/track/${trackIdFromUri(job.uri)}` } : undefined, key);
  else if (job.phase === 'failed') toast.add(jobLine(job), 'error', 10000, { label: 'open upload', href: '/upload' }, key);
  else if (job.phase !== 'waiting') toast.add(jobLine(job), 'info', 0, undefined, key);
  publish();
}

function session(job: Job): Auth {
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

async function finishCreate(job: Job, uri: string) {
  const pds = createPds(session(job));
  const pending = (await pds.pendingCreates('track')).find(item => item.uri === uri);
  if (pending) await pds.dismissCreate(pending).catch(() => undefined);
  patch(job, { phase: 'done', uri });
}

async function runPds(job: Job, input: NewTrack, reservation: CreateReservation) {
  patch(job, { phase: 'uploading', progress: undefined });
  try {
    await withRetries(job, () => createPds(session(job)).uploadTrack(input, reservation));
  } catch (failure) {
    // A reauthentication or lost reply can interrupt a create that still reached the PDS: settle it at the same address.
    const pds = createPds(session(job)), pending = (await pds.pendingCreates('track')).find(item => item.rkey === reservation.rkey);
    if (!pending) throw failure;
    if ((await withRetries(job, () => pds.recoverCreate(pending, true))).state !== 'accepted') throw failure;
  }
  patch(job, { phase: 'publishing' });
  await finishCreate(job, reservation.uri);
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
    status = await withRetries(job, () => transferParts(operation, openUploadReader(file), transport,
      async bytes => hex(await digest(CryptoDigestAlgorithm.SHA256, bytes)), abort.signal,
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
  await finishCreate(job, operation.uri);
  if (status.state === 'published') await uploadStorage.delete(operation);
}

async function prepare(job: Job, input: NewTrack) {
  const auth = session(job), pds = createPds(auth);
  const duration = input.duration ?? await measureAudioDuration(input.file).catch(() => undefined);
  const ready = { ...input, duration };
  const route = uploadRoute(input.file, duration);
  const reservation = await pds.reserveCreate('track').catch(() => { throw new Error('finish the earlier upload first'); });
  patch(job, { rkey: reservation.rkey });
  if (route.kind === 'pds') return () => runPds(job, ready, reservation);
  if (!auth.uploadStorage) throw new Error('sign in again to allow plyr storage');
  const format = audioFormat(input.file.name, input.file.type, !!route.processing);
  const record = await pds.prepareTrackRecord(ready);
  const operation: UploadOperation = { ...reservation, record: { ...record, fileType: format.fileType }, uploadId: randomUUID(),
    name: input.file.name, sizeBytes: input.file.size, ...format, ...(route.processing ? { processing: route.processing } : {}) };
  await uploadStorage.put(operation);
  patch(job, { operation, uploadId: operation.uploadId });
  return () => runService(job, operation);
}

function enqueueSaved(operation: UploadOperation, file?: MediaFile) {
  const title = typeof operation.record.title === 'string' ? operation.record.title : operation.name;
  const job: Job = { id: randomUUID(), owner: operation.owner, title, phase: 'waiting', operation, file, uploadId: operation.uploadId, rkey: operation.rkey };
  jobs = [...jobs, job];
  patch(job, {});
}

async function drain() {
  if (running) return;
  running = true;
  try {
    for (let job = jobs.find(item => item.phase === 'waiting'); job; job = jobs.find(item => item.phase === 'waiting')) {
      try {
        patch(job, { phase: 'uploading' });
        const run = job.operation ? () => runService(job!, job!.operation!) : await prepare(job, job.input!);
        await run();
      } catch (failure) {
        patch(job, { phase: 'failed', error: failure instanceof Error ? failure.message.replace(/\.$/, '') : undefined });
      } finally { job.input = undefined; job.file = undefined; }
    }
  } finally { running = false; }
}

export const uploadQueue = {
  /** Queue a track; the form can reset immediately. */
  add(input: NewTrack) {
    const owner = getAuth().did;
    if (!owner) throw new Error('sign in first.');
    uploadRoute(input.file);
    const job: Job = { id: randomUUID(), owner, title: input.title.trim(), phase: 'waiting', input, file: input.file };
    jobs = [...jobs, job];
    patch(job, {});
    void drain();
  },
  /** Pick up saved plyr-storage uploads whose bytes already arrived, e.g. after a reload. */
  async resume(owner: Did) {
    const pds = createPds(getAuth()), pending = await pds.pendingCreates('track');
    for (const operation of await uploadStorage.load(owner)) {
      if (jobs.some(job => job.uploadId === operation.uploadId) || pending.some(item => item.rkey === operation.rkey && item.archived)) continue;
      const status = await createUploadTransport(getAuth(), operation, () => undefined, new AbortController().signal).status().catch(() => undefined);
      if (!status || !['completing', 'processing', 'complete'].includes(status.state)) continue;
      enqueueSaved(operation);
    }
    void drain();
  },
  /** Carry on with a saved upload; a transfer that stopped part way needs its original file. */
  continue(operation: UploadOperation, file?: MediaFile) {
    if (jobs.some(job => job.uploadId === operation.uploadId && job.phase !== 'done' && job.phase !== 'failed')) return;
    if (file) {
      const format = audioFormat(file.name, file.type, !!operation.processing);
      if (format.fileType !== operation.fileType || format.contentType !== operation.contentType) throw new Error('select the original audio file.');
    }
    enqueueSaved(operation, file);
    void drain();
  },
  /** Creations and transfers the queue is driving, so recovery screens leave them alone. */
  busy() {
    const active = jobs.filter(job => job.phase !== 'done' && job.phase !== 'failed');
    return { rkeys: new Set(active.flatMap(job => job.rkey ? [job.rkey] : [])), uploadIds: new Set(active.flatMap(job => job.uploadId ? [job.uploadId] : [])) };
  },
  active: () => jobs.some(job => job.phase !== 'done' && job.phase !== 'failed'),
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  snapshot: () => jobs as readonly UploadJobView[],
};

export function useUploadQueue() {
  return useSyncExternalStore(uploadQueue.subscribe, uploadQueue.snapshot, uploadQueue.snapshot);
}
