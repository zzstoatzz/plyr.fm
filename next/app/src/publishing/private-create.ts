import { sameRecord } from './create-operation.ts';
import { NSID } from '../auth-config.ts';
import { privateSpace } from './private-track.ts';

export type PrivateCreate = { owner: string; rkey: string; uri: string; record: Record<string, unknown>; archived?: boolean };
export interface PrivateCreateStorage {
  load(owner: string): Promise<PrivateCreate[]>;
  put(operation: PrivateCreate): Promise<void>;
  archive(operation: PrivateCreate, archived: boolean): Promise<void>;
  delete(operation: PrivateCreate): Promise<void>;
}
export function privateCreate(value: unknown, owner: string): PrivateCreate {
  if (!value || typeof value !== 'object' || !('owner' in value) || value.owner !== owner
    || !('rkey' in value) || typeof value.rkey !== 'string' || !/^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/.test(value.rkey)
    || !('uri' in value) || value.uri !== `${privateSpace(owner)}/${owner}/${NSID.track}/${value.rkey}`
    || !('record' in value) || !value.record || typeof value.record !== 'object' || Array.isArray(value.record)
    || !('$type' in value.record) || value.record.$type !== NSID.track
    || 'audioUrl' in value.record || 'audioSpace' in value.record || 'supportGate' in value.record
    || !('audioBlob' in value.record) || !value.record.audioBlob || typeof value.record.audioBlob !== 'object'
    || ('archived' in value && typeof value.archived !== 'boolean')) throw new Error('could not read private creation recovery.');
  return { owner, rkey: value.rkey, uri: value.uri, record: value.record as Record<string, unknown>, ...('archived' in value ? { archived: value.archived as boolean } : {}) };
}
export function samePrivateCreate(left: PrivateCreate, right: PrivateCreate) {
  return left.owner === right.owner && left.uri === right.uri && left.rkey === right.rkey && sameRecord(left.record, right.record);
}
export function requirePrivatePolicy(value: unknown, owner: string): void {
  if (!value || typeof value !== 'object' || !('space' in value) || value.space !== privateSpace(owner)
    || !('policy' in value) || !value.policy || typeof value.policy !== 'object' || !('$type' in value.policy)
    || value.policy.$type !== 'com.atproto.memberspace.policy') throw new Error('this private space uses an unsupported access policy.');
  const policy = value.policy;
  for (const key of ['publicRead', 'publicWrite', 'publishPolicy', 'publishMembers']) {
    if (key in policy && Reflect.get(policy, key) !== false) throw new Error('this space is not private. its access policy was left unchanged.');
  }
  if ('allowedApps' in policy) throw new Error('this private space restricts which apps can access it.');
}
