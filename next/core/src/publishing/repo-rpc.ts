import type { Did } from '../auth-state.ts';

type Nsid = `${string}.${string}.${string}`;
type Collection = { repo: Did; collection: Nsid };
type RecordAddress = Collection & { rkey: string };
type RecordWrite = Collection & { record: Record<string, unknown>; rkey?: string };
type RepoFailure = { ok: false; status: number; data: { error: string; message?: string } };
type RepoResponse<T = unknown> = { ok: true; data: T } | RepoFailure;

export interface RepoRpc {
  get(method: 'com.atproto.repo.getRecord', options: { params: RecordAddress }): Promise<RepoResponse>;
  get(method: 'com.atproto.repo.listRecords', options: { params: Collection & { limit: number; cursor?: string } }): Promise<RepoResponse>;
  post(method: 'com.atproto.repo.createRecord', options: { input: RecordWrite }): Promise<RepoResponse>;
  post(method: 'com.atproto.repo.putRecord', options: { input: RecordWrite & { rkey: string; swapRecord?: string } }): Promise<RepoResponse>;
  post(method: 'com.atproto.repo.deleteRecord', options: { input: RecordAddress & { swapRecord?: string } }): Promise<RepoResponse>;
  post(method: 'com.atproto.repo.uploadBlob', options: { input: ArrayBuffer; headers: { 'content-type': string } }): Promise<RepoResponse>;
}

export class RepoResponseError extends Error {
  readonly status: number;
  readonly error: string;
  constructor(response: RepoFailure) {
    super(`${response.data.error} > ${response.data.message ?? '(unspecified description)'}`);
    this.status = response.status;
    this.error = response.data.error;
  }
}

export function repoOk<T>(response: RepoResponse<T>): T;
export function repoOk<T>(response: Promise<RepoResponse<T>>): Promise<T>;
export function repoOk<T>(response: RepoResponse<T> | Promise<RepoResponse<T>>): T | Promise<T> {
  if (response instanceof Promise) return response.then(result => repoOk(result));
  if (!response.ok) throw new RepoResponseError(response);
  return response.data;
}

function recordObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid record response.');
  return Object.fromEntries(Object.entries(value));
}

function storedRecord(value: unknown) {
  const { uri, cid, value: record } = recordObject(value);
  if (typeof uri !== 'string' || (cid !== undefined && typeof cid !== 'string')) throw new Error('invalid record address.');
  return { uri, cid, value: recordObject(record) };
}

export async function getRecord(rpc: RepoRpc, options: { params: RecordAddress }) {
  const response = await rpc.get('com.atproto.repo.getRecord', options);
  return response.ok ? { ok: true as const, data: storedRecord(response.data) } : response;
}

export async function listRecords(rpc: RepoRpc, options: { params: Collection & { limit: number; cursor?: string } }) {
  const response = await rpc.get('com.atproto.repo.listRecords', options);
  if (!response.ok) return response;
  const { records, cursor } = recordObject(response.data);
  if (!Array.isArray(records) || (cursor !== undefined && typeof cursor !== 'string')) throw new Error('invalid record list.');
  return { ok: true as const, data: { records: records.map((value: unknown) => {
    const { cid, ...record } = storedRecord(value);
    if (!cid) throw new Error('missing record cid.');
    return { ...record, cid };
  }), cursor } };
}

async function writeResult(request: Promise<RepoResponse>) {
  const response = await request;
  if (!response.ok) return response;
  const { uri, cid } = recordObject(response.data);
  if (typeof uri !== 'string' || typeof cid !== 'string') throw new Error('invalid record write response.');
  return { ok: true as const, data: { uri, cid } };
}

export function createRecord(rpc: RepoRpc, options: { input: RecordWrite }) {
  return writeResult(rpc.post('com.atproto.repo.createRecord', options));
}

export function putRecord(rpc: RepoRpc, options: { input: RecordWrite & { rkey: string; swapRecord?: string } }) {
  return writeResult(rpc.post('com.atproto.repo.putRecord', options));
}

export async function uploadRepoBlob(rpc: RepoRpc, options: { input: ArrayBuffer; headers: { 'content-type': string } }) {
  const response = await rpc.post('com.atproto.repo.uploadBlob', options);
  if (!response.ok) return response;
  const { blob } = recordObject(response.data);
  if (!blob || typeof blob !== 'object') throw new Error('invalid blob response.');
  return { ok: true as const, data: { blob } };
}
