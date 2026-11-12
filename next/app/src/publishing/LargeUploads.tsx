import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { CryptoDigestAlgorithm, digest, randomUUID } from 'expo-crypto';
import { Action, Copy } from '../controls';
import { getAuth, type Auth } from '../auth-state';
import { createPds, type MediaFile, type NewTrack } from '../pds';
import { trackIdFromUri } from '../api';
import { pickMedia } from '../media-picker';
import type { CreateReservation } from './create-operation';
import type { CreateResult } from './create-record';
import { audioFormat, MAX_SERVICE_AUDIO_BYTES, transferParts, type UploadOperation, type UploadStatus } from './upload-model';
import { uploadStorage } from './upload-storage';
import { createUploadTransport, UploadRequestError } from './upload-transport';
import { openUploadReader } from './upload-reader';

type TransferView = { archived?: boolean; status?: UploadStatus; publication?: CreateResult; message?: string; progress?: number; checking?: boolean };
export function useLargeUploads(auth: Auth, onChange: () => Promise<unknown>, onDismiss: (operation: CreateReservation) => void) {
  const pds = useMemo(() => createPds(auth), [auth.did, auth.rpc]);
  const [operations, setOperations] = useState<UploadOperation[]>([]);
  const [views, setViews] = useState<Record<string, TransferView>>({});
  const [loading, setLoading] = useState(true), [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const controller = useRef<AbortController | undefined>(undefined), live = useRef(true);
  const current = () => live.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc;
  const assertCurrent = () => { if (!current()) throw new Error('account changed. resume from the original account.'); };
  useEffect(() => { live.current = true; return () => { live.current = false; controller.current?.abort(); }; }, []);
  const refresh = useCallback(async () => {
    try {
      const entries = auth.did ? await uploadStorage.load(auth.did) : [];
      if (live.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc) { setOperations(entries); setError(undefined); }
    } catch { if (live.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc) setError('could not load large upload recovery. try again.'); }
    finally { if (live.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc) setLoading(false); }
  }, [auth.did, auth.rpc]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const update = (operation: UploadOperation, patch: TransferView) => { if (current()) setViews(values => ({ ...values, [operation.uploadId]: { ...values[operation.uploadId], ...patch } })); };
  async function run(operation: UploadOperation, action: 'check' | 'resume' | 'finish' | 'publish' | 'activate' | 'cancel' | 'done' | 'archive', file?: MediaFile) {
    if (controller.current || !current()) return;
    const abort = new AbortController(); controller.current = abort; setBusy(operation.uploadId);
    update(operation, { message: undefined });
    const transport = createUploadTransport(auth, operation, assertCurrent, abort.signal);
    try {
      if (!(await uploadStorage.load(operation.owner)).some(item => item.uploadId === operation.uploadId && item.uri === operation.uri)) throw new Error('this upload was already dismissed.');
      assertCurrent();
      if (action === 'archive') {
        const status = await transport.status();
        if (status.state !== 'complete' || !status.audioUrl) throw new Error('only an unpublished completed upload can be set aside.');
        await pds.archiveUploadedTrack(operation, status.audioUrl);
        if (current()) onDismiss(operation);
        update(operation, { status, archived: true, message: 'creation set aside. the uploaded audio remains available for recovery.' });
      } else if (action === 'done') {
        const status = await transport.status();
        if (status.state !== 'published' && status.state !== 'cancelled') throw new Error('this upload still needs recovery.');
        const pending = (await pds.pendingCreates('track')).find(item => item.rkey === operation.rkey);
        assertCurrent();
        if (pending) await pds.dismissCreate(pending, true);
        await uploadStorage.delete(operation); if (current()) onDismiss(operation);
      } else if (action === 'cancel') {
        let status: UploadStatus;
        try { status = await transport.cancel(); }
        catch (failure) {
          if (!(failure instanceof UploadRequestError) || failure.status !== 404) throw failure;
          await transport.start();
          status = await transport.cancel();
        }
        update(operation, { status });
        if (status.state !== 'cancelled') throw new Error('cancellation is not confirmed. check this upload again.');
        assertCurrent(); await uploadStorage.delete(operation); if (current()) onDismiss(operation);
      } else {
        let status = action === 'resume' ? await transport.start() : action === 'finish' ? await transport.finish() : await transport.status();
        if (action === 'resume' && status.state === 'completing') status = await transport.finish();
        update(operation, { status });
        if (action === 'resume' && !['complete', 'published'].includes(status.state)) {
          if (!file) throw new Error('select the original audio file to resume.');
          const format = audioFormat(file.name, file.type);
          if (format.fileType !== operation.fileType || format.contentType !== operation.contentType) throw new Error('select the original audio format.');
          status = await transferParts(operation, openUploadReader(file), transport, async bytes => {
            const value = await digest(CryptoDigestAlgorithm.SHA256, bytes);
            return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('');
          }, abort.signal, (progress, checking) => update(operation, { progress, checking }));
          update(operation, { status });
        }
        if (status.audioUrl) {
          const pending = (await pds.pendingCreates('track')).find(item => item.rkey === operation.rkey);
          assertCurrent();
          const publish = status.state !== 'published' && (action === 'publish' || ((action === 'resume' || action === 'finish') && !pending?.archived));
          if (!(await uploadStorage.load(operation.owner)).some(item => item.uploadId === operation.uploadId && item.uri === operation.uri)) throw new Error('this upload was already dismissed.');
          assertCurrent();
          const publication = await pds.uploadedTrack(operation, status.audioUrl, publish);
          assertCurrent(); update(operation, { publication, archived: !!pending?.archived });
          if (publication.state === 'accepted' && (publish || action === 'activate')) {
            status = await transport.activate(); update(operation, { status });
          }
          if (pending?.archived && !publish) update(operation, { message: 'creation is set aside. publish only if you want to resume this attempt.' });
        }
      }
    } catch (failure) { update(operation, { message: abort.signal.aborted ? 'upload paused. reselect the original file to resume.' : failure instanceof Error ? failure.message : 'upload stopped. check its status.' }); }
    finally {
      controller.current = undefined;
      if (current()) { setBusy(undefined); await refresh(); await onChange(); }
    }
  }
  async function start(input: NewTrack, reservation: CreateReservation) {
    assertCurrent();
    if (!auth.uploadStorage) throw new Error('sign in again to allow large uploads.');
    if (!Number.isSafeInteger(input.file.size) || input.file.size <= 0 || input.file.size > MAX_SERVICE_AUDIO_BYTES) throw new Error('audio files are limited to 1.5 GiB.');
    const format = audioFormat(input.file.name, input.file.type);
    const record = await pds.prepareTrackRecord(input);
    assertCurrent();
    const operation: UploadOperation = { ...reservation, record: { ...record, fileType: format.fileType }, uploadId: randomUUID(), name: input.file.name, sizeBytes: input.file.size, ...format };
    await uploadStorage.put(operation);
    assertCurrent(); await refresh();
    await run(operation, 'resume', input.file);
  }
  return { operations, views, loading, error, busy, start, run, refresh, pause: () => controller.current?.abort() };
}

export function LargeUploads({ uploads, disabled = false }: { uploads: ReturnType<typeof useLargeUploads>; disabled?: boolean }) {
  return <>
    {uploads.error && <><Copy live>{uploads.error}</Copy><Action label="Retry large upload recovery" onPress={() => void uploads.refresh()} /></>}
    {uploads.operations.map(operation => <LargeUpload key={operation.uploadId} operation={operation} uploads={uploads} disabled={disabled} />)}
  </>;
}
function LargeUpload({ operation, uploads, disabled }: { operation: UploadOperation; uploads: ReturnType<typeof useLargeUploads>; disabled: boolean }) {
  const view = uploads.views[operation.uploadId], [file, setFile] = useState<MediaFile>(), [pickError, setPickError] = useState<string>();
  const status = view?.status, busy = uploads.busy === operation.uploadId, locked = disabled || !!uploads.busy;
  const complete = status?.state === 'complete' || status?.state === 'published';
  const title = typeof operation.record.title === 'string' ? operation.record.title : operation.name;
  async function choose() {
    try { const next = await pickMedia('audio/*'); if (next) setFile(next); setPickError(undefined); }
    catch { setPickError('could not select the file. try again.'); }
  }
  return <>
    <Copy>{title}</Copy>
    <Copy live>{status?.state === 'published' ? 'saved. public audio is available.' : complete ? 'audio uploaded. publication still needs confirmation.'
      : view?.progress !== undefined ? `${view.checking ? 'checking original file' : 'uploaded'}: ${Math.min(100, Math.floor(view.progress / operation.sizeBytes * 100))}%` : 'large upload saved for recovery.'}</Copy>
    {(view?.message || pickError) && <Copy live>{pickError ?? view?.message}</Copy>}
    {!busy && <Action label="Check upload status" disabled={locked} onPress={() => void uploads.run(operation, 'check')} />}
    {busy && (complete ? <Copy live>confirming publication…</Copy> : <Action label="Pause upload" onPress={uploads.pause} />)}
    {!complete && !busy && (status?.state === 'completing' || (status && status.receivedParts.length === status.partCount)
      ? <Action label="Finish upload" disabled={locked} onPress={() => void uploads.run(operation, 'finish')} /> : <>
      <Action label={file?.name ?? 'Reselect original audio'} disabled={locked} onPress={() => void choose()} />
      <Action label="Resume upload" disabled={locked || !file} onPress={() => void uploads.run(operation, 'resume', file)} />
    </>)}
    {complete && status.state !== 'published' && <>
      {view?.publication?.state === 'different' ? <Copy>a different record exists at this address. it will not be overwritten.</Copy>
        : <Action label={view?.publication?.state === 'accepted' ? 'Check playback availability' : 'Publish this track'} disabled={locked} onPress={() => void uploads.run(operation, view?.publication?.state === 'accepted' ? 'activate' : 'publish')} />}
      {!view?.archived && <><Copy>this record may still appear. starting again could create a duplicate.</Copy>
      <Action label="Set aside creation" disabled={locked} onPress={() => void uploads.run(operation, 'archive')} /></>}
    </>}
    {status?.state === 'published' && <><Action label="View track" href={`/track/${trackIdFromUri(operation.uri)}`} /><Action label="Done with upload" disabled={locked} onPress={() => void uploads.run(operation, 'done')} /></>}
    {status?.state !== 'published' && (complete ? <Copy>completed audio is retained for publication recovery and cannot be cancelled here.</Copy>
      : <Action label="Cancel transfer" disabled={locked} onPress={() => void uploads.run(operation, 'cancel')} />)}
  </>;
}
