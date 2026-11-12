import type { Did } from '../auth-state';

export type CreateReservation = { owner: Did; collection: string; rkey: string; uri: string };
export type CreateOperation = CreateReservation & { record: Record<string, unknown>; cid?: string; archived?: boolean };
export interface CreateStorage {
  load(owner: string, collection: string): Promise<CreateOperation[]>;
  put(operation: CreateOperation): Promise<void>;
  accept(operation: CreateReservation, cid: string): Promise<void>;
  archive(operation: CreateReservation, archived: boolean): Promise<void>;
  delete(operation: CreateReservation): Promise<void>;
}

export function scopedCreate(value: unknown, owner: string, collection: string, key: string) {
  const operation = createOperation(value);
  if (operation.owner !== owner || operation.collection !== collection || createKey(operation) !== key) throw new Error('pending creation does not match this account.');
  return operation;
}

export function createKey(operation: Pick<CreateReservation, 'owner' | 'collection' | 'rkey'>) {
  return `${operation.owner}/${operation.collection}/${operation.rkey}`;
}

export function createOperation(value: unknown): CreateOperation {
  if (!value || typeof value !== 'object') throw new Error('could not read pending creation.');
  const item = value as Record<string, unknown>;
  if (typeof item.owner !== 'string' || !/^did:[a-z]+:.+$/u.test(item.owner) || typeof item.collection !== 'string'
    || typeof item.rkey !== 'string' || !/^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/.test(item.rkey)
    || item.uri !== `at://${item.owner}/${item.collection}/${item.rkey}`
    || !item.record || typeof item.record !== 'object' || Array.isArray(item.record)
    || (item.record as Record<string, unknown>).$type !== item.collection
    || (item.cid !== undefined && typeof item.cid !== 'string')
    || (item.archived !== undefined && typeof item.archived !== 'boolean')) throw new Error('could not read pending creation.');
  return { owner: item.owner as Did, collection: item.collection, rkey: item.rkey, uri: item.uri,
    record: item.record as Record<string, unknown>, ...(item.cid === undefined ? {} : { cid: item.cid }), ...(item.archived === undefined ? {} : { archived: item.archived }) };
}

export function sameRecord(left: unknown, right: unknown): boolean {
  const encode = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const object = item as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).sort().map(key => [key, object[key]]));
  });
  return encode(left) === encode(right);
}
