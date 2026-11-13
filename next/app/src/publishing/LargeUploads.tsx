import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Action, Copy } from '../controls';
import { getAuth, type Auth } from '../auth-state';
import { createPds, type MediaFile } from '../pds';
import { trackIdFromUri } from '../api';
import { pickMedia } from '../media-picker';
import type { CreateReservation } from './create-operation';
import type { CreateResult } from './create-record';
import { uploadPublication, type UploadOperation, type UploadStatus } from './upload-model';
import { uploadQueue } from './upload-queue';
import { uploadStorage } from './upload-storage';
import { createUploadTransport, UploadRequestError } from './upload-transport';

type TransferView = { archived?: boolean; status?: UploadStatus; publication?: CreateResult; message?: string };
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
  async function run(operation: UploadOperation, action: 'check' | 'publish' | 'activate' | 'cancel' | 'done' | 'archive') {
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
        let status = await transport.status();
        update(operation, { status });
        if (status.audioUrl) {
          const pending = (await pds.pendingCreates('track')).find(item => item.rkey === operation.rkey);
          assertCurrent();
          const publish = status.state !== 'published' && action === 'publish';
          if (!(await uploadStorage.load(operation.owner)).some(item => item.uploadId === operation.uploadId && item.uri === operation.uri)) throw new Error('this upload was already dismissed.');
          assertCurrent();
          const publication = await pds.uploadedTrack(operation.processing ? uploadPublication(operation, status) : operation, status.audioUrl, publish);
          assertCurrent(); update(operation, { publication, archived: !!pending?.archived });
          if (publication.state === 'accepted' && (publish || action === 'activate')) {
            status = await transport.activate(); update(operation, { status });
          }
          if (pending?.archived && !publish) update(operation, { message: 'creation is set aside. publish only if you want to resume this attempt.' });
        }
      }
    } catch (failure) { update(operation, { message: failure instanceof Error ? failure.message : 'upload stopped. check its status.' }); }
    finally {
      controller.current = undefined;
      if (current()) { setBusy(undefined); await refresh(); await onChange(); }
    }
  }
  return { operations, views, loading, error, busy, run, refresh };
}

/** Saved plyr-storage uploads the queue isn't driving: a transfer that needs its file again, or one that needs a decision. */
export function LargeUploads({ uploads, skip }: { uploads: ReturnType<typeof useLargeUploads>; skip: Set<string> }) {
  return <>
    {uploads.error && <><Copy live>{uploads.error}</Copy><Action label="Retry large upload recovery" onPress={() => void uploads.refresh()} /></>}
    {uploads.operations.filter(operation => !skip.has(operation.uploadId)).map(operation => <LargeUpload key={operation.uploadId} operation={operation} uploads={uploads} disabled={false} />)}
  </>;
}
function LargeUpload({ operation, uploads, disabled }: { operation: UploadOperation; uploads: ReturnType<typeof useLargeUploads>; disabled: boolean }) {
  const view = uploads.views[operation.uploadId], [file, setFile] = useState<MediaFile>(), [pickError, setPickError] = useState<string>();
  const status = view?.status, busy = uploads.busy === operation.uploadId, locked = disabled || !!uploads.busy;
  const complete = status?.state === 'complete' || status?.state === 'published';
  const title = typeof operation.record.title === 'string' ? operation.record.title : operation.name;
  function carryOn(original?: MediaFile) {
    try { uploadQueue.continue(operation, original); setPickError(undefined); }
    catch (failure) { setPickError(failure instanceof Error ? failure.message : 'could not resume this upload.'); }
  }
  async function choose() {
    try { const next = await pickMedia('audio/*'); if (next) setFile(next); setPickError(undefined); }
    catch { setPickError('could not select the file. try again.'); }
  }
  return <>
    <Copy>{title}</Copy>
    <Copy live>{status?.state === 'published' ? 'saved. public audio is available.' : complete ? 'audio uploaded. publication still needs confirmation.'
      : status?.state === 'processing' ? status.processingFailure === 'output_budget_exceeded' ? 'the mp3 needs more space than reserved. the original is kept.' : 'converting to mp3.'
        : 'upload saved for recovery.'}</Copy>
    {(view?.message || pickError) && <Copy live>{pickError ?? view?.message}</Copy>}
    {!busy && <Action label="Check upload status" disabled={locked} onPress={() => void uploads.run(operation, 'check')} />}
    {busy && <Copy live>checking…</Copy>}
    {!complete && !busy && (status?.state === 'completing' || status?.state === 'processing' || (status && status.receivedParts.length === status.partCount)
      ? <Action label="Continue upload" disabled={locked} onPress={() => carryOn()} /> : <>
      <Action label={file?.name ?? 'Reselect original audio'} disabled={locked} onPress={() => void choose()} />
      <Action label="Resume upload" disabled={locked || !file} onPress={() => carryOn(file)} />
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
