import type { createPublicPds } from '../pds';
import type { CreateResult } from './create-record';
import { uploadPublication, type UploadOperation, type UploadStatus, type UploadStorage } from './upload-model';
import { UploadRequestError, type UploadTransport } from './upload-transport';

export type UploadRecoveryView = { archived?: boolean; status?: UploadStatus; publication?: CreateResult; message?: string };
export type UploadRecoveryAction = 'check' | 'publish' | 'activate' | 'cancel' | 'done' | 'archive';
export type UploadRecoveryDisposition = 'archived' | 'published' | 'cancelled';

export async function recoverUpload({ operation, action, pds, storage, transport, assertCurrent, update }: {
  operation: UploadOperation;
  action: UploadRecoveryAction;
  pds: ReturnType<typeof createPublicPds>;
  storage: UploadStorage;
  transport: UploadTransport;
  assertCurrent: () => void;
  update: (patch: UploadRecoveryView) => void;
}): Promise<UploadRecoveryDisposition | undefined> {
  async function assertPending() {
    const pending = await storage.load(operation.owner);
    assertCurrent();
    if (!pending.some(item => item.uploadId === operation.uploadId && item.uri === operation.uri)) throw new Error('this upload was already dismissed.');
  }

  await assertPending();
  if (action === 'archive') {
    const status = await transport.status();
    if (status.state !== 'complete' || !status.audioUrl) throw new Error('only an unpublished completed upload can be set aside.');
    await pds.archiveUploadedTrack(uploadPublication(operation, status), status.audioUrl);
    update({ status, archived: true, message: 'creation set aside. the uploaded audio remains available for recovery.' });
    return 'archived';
  }
  if (action === 'done') {
    const status = await transport.status();
    if (status.state !== 'published' && status.state !== 'cancelled') throw new Error('this upload still needs recovery.');
    const pending = (await pds.pendingCreates('track')).find(item => item.rkey === operation.rkey);
    assertCurrent();
    if (pending) await pds.dismissCreate(pending, true);
    await storage.delete(operation);
    return status.state;
  }
  if (action === 'cancel') {
    let status: UploadStatus;
    try { status = await transport.cancel(); }
    catch (failure) {
      if (!(failure instanceof UploadRequestError) || failure.status !== 404) throw failure;
      await transport.start();
      status = await transport.cancel();
    }
    update({ status });
    if (status.state !== 'cancelled') throw new Error('cancellation is not confirmed. check this upload again.');
    assertCurrent();
    await storage.delete(operation);
    return 'cancelled';
  }

  let status = await transport.status();
  update({ status });
  if (!status.audioUrl) return;
  const pending = (await pds.pendingCreates('track')).find(item => item.rkey === operation.rkey);
  assertCurrent();
  const publish = status.state !== 'published' && action === 'publish';
  await assertPending();
  const publication = await pds.uploadedTrack(operation.processing ? uploadPublication(operation, status) : operation, status.audioUrl, publish);
  assertCurrent();
  update({ publication, archived: !!pending?.archived });
  if (publication.state === 'accepted' && (publish || action === 'activate')) {
    status = await transport.activate();
    update({ status });
  }
  if (pending?.archived && !publish) update({ message: 'creation is set aside. publish only if you want to resume this attempt.' });
}
