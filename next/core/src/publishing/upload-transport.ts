import type { Auth } from '../auth-state.ts';
import type { AuthConfig } from '../auth-config.ts';
import { uploadStatus, type UploadOperation, type UploadReceipt } from './upload-model.ts';

export class UploadRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
type Capability = { uploadUrl: string; capability: string; expiresAt: number };
export type UploadConfig = Pick<AuthConfig, 'UPLOAD_AUTHORIZE_METHOD' | 'UPLOAD_COORDINATOR_URL' | 'UPLOAD_SERVICE_AUDIENCE'>;
export type AdmissionFields = Pick<UploadOperation, 'uploadId' | 'sizeBytes' | 'contentType' | 'fileType' | 'processing'> & { recordUri: string };

/** Asks the upload coordinator for a capability to store these bytes for this record, as the signed-in owner. */
export async function admitUpload({ UPLOAD_AUTHORIZE_METHOD, UPLOAD_COORDINATOR_URL, UPLOAD_SERVICE_AUDIENCE }: UploadConfig, agent: NonNullable<Auth<unknown>['agent']>,
  fields: AdmissionFields, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<Capability> {
  const response = await agent.handle(`/xrpc/com.atproto.server.getServiceAuth?${new URLSearchParams({ aud: UPLOAD_SERVICE_AUDIENCE, lxm: UPLOAD_AUTHORIZE_METHOD })}`, { signal });
  if (!response.ok) throw new UploadRequestError(response.status, 'could not authorize this upload. sign in again.');
  const token: unknown = await response.json();
  if (!token || typeof token !== 'object' || !('token' in token) || typeof token.token !== 'string') throw new Error('invalid upload authorization.');
  signal?.throwIfAborted();
  const admission = await fetcher(`${UPLOAD_COORDINATOR_URL}/v1/uploads/authorize`, { method: 'POST', signal, redirect: 'error', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ serviceToken: token.token, uploadId: fields.uploadId, recordUri: fields.recordUri, sizeBytes: fields.sizeBytes,
      contentType: fields.contentType, fileType: fields.fileType, visibility: 'public', downloadPolicy: 'open', processing: fields.processing }) });
  if (!admission.ok) throw new UploadRequestError(admission.status, admission.status === 403 ? 'large uploads are not allowed for this account.' : 'large upload service is unavailable. try again.');
  const value: unknown = await admission.json();
  if (!value || typeof value !== 'object' || !('uploadUrl' in value) || !('capability' in value) || !('expiresAt' in value)
    || typeof value.uploadUrl !== 'string' || typeof value.capability !== 'string' || typeof value.expiresAt !== 'number' || value.expiresAt <= Date.now() || value.expiresAt > Date.now() + 600000 || !value.capability || value.capability.length > 4096) throw new Error('invalid upload admission.');
  const url = new URL(value.uploadUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || !new RegExp(`^/v1/uploads/[a-f0-9]{64}/${fields.uploadId}$`).test(url.pathname)) throw new Error('invalid upload address.');
  return { uploadUrl: url.href, capability: value.capability, expiresAt: value.expiresAt };
}

export function uploadTransport(config: UploadConfig, auth: Pick<Auth<unknown>, 'did' | 'agent' | 'uploadStorage'>, operation: UploadOperation,
  assertCurrent: () => void, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  let capability: Capability | undefined;
  const active = () => { assertCurrent(); if (signal.aborted) throw new Error('upload paused.'); };
  async function authorize() {
    active();
    if (!auth.agent || auth.did !== operation.owner || !auth.uploadStorage) throw new Error('sign in again to allow large uploads.');
    const admitted = await admitUpload(config, auth.agent, { ...operation, recordUri: operation.uri }, signal, fetcher);
    active();
    return capability = admitted;
  }
  async function request(method: string, suffix = '', body?: Uint8Array<ArrayBuffer>, refreshed = false): Promise<unknown> {
    active();
    const admission = !capability || capability.expiresAt < Date.now() + 30000 ? await authorize() : capability;
    active();
    const response = await fetcher(admission.uploadUrl + suffix, { method, signal, redirect: 'error', headers: { authorization: `Bearer ${admission.capability}`, ...(body ? { 'content-type': operation.contentType } : {}) }, body });
    if (response.status === 403 && !refreshed) { capability = undefined; return request(method, suffix, body, true); }
    active();
    if (!response.ok) {
      const value: unknown = await response.json().catch(() => undefined);
      const message = value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : 'upload request failed. check its status before retrying.';
      throw new UploadRequestError(response.status, message);
    }
    return await response.json();
  }
  async function statusRequest(method: string, suffix = '') {
    const status = uploadStatus(await request(method, suffix), operation);
    if (status.audioUrl) {
      const expected = capability?.uploadUrl.replace('/v1/uploads/', '/media/');
      if (status.audioUrl !== expected) throw new Error('uploaded audio address differs from its reservation.');
    }
    return status;
  }
  return {
    /** Address and credentials for one part, for a native background upload that bypasses fetch. */
    async partTarget(number: number, minimumMs = 300000) {
      active();
      const admission = !capability || capability.expiresAt < Date.now() + minimumMs ? await authorize() : capability;
      return { url: `${admission.uploadUrl}/parts/${number}`, headers: { authorization: `Bearer ${admission.capability}`, 'content-type': operation.contentType } };
    },
    forgetCapability() { capability = undefined; },
    start: () => statusRequest('POST'), status: () => statusRequest('GET'), finish: () => statusRequest('POST', '/finish'),
    activate: () => statusRequest('POST', '/activate'), cancel: () => statusRequest('DELETE'),
    retryProcessing: () => statusRequest('POST', '/retry-processing'),
    async part(number: number, bytes: Uint8Array<ArrayBuffer>): Promise<UploadReceipt> {
      const value = await request('PUT', `/parts/${number}`, bytes);
      if (!value || typeof value !== 'object' || !('number' in value) || value.number !== number || !('sha256' in value) || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('invalid upload receipt.');
      return { number, sha256: value.sha256 };
    },
  };
}

export type UploadTransport = ReturnType<typeof uploadTransport>;
