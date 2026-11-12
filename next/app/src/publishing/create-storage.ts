import { createMMKV } from 'react-native-mmkv';
import { createKey, scopedCreate, sameRecord, type CreateStorage } from './create-operation';

const storage = createMMKV({ id: 'plyr-next-pending-creates' });
export const createStorage: CreateStorage = {
  async load(owner, collection) {
    return storage.getAllKeys().filter(key => key.startsWith(`${owner}/${collection}/`))
      .map(key => scopedCreate(JSON.parse(storage.getString(key) ?? 'null'), owner, collection, key));
  },
  async accept(operation, cid) {
    const key = createKey(operation), value = storage.getString(key);
    if (value) storage.set(key, JSON.stringify({ ...scopedCreate(JSON.parse(value), operation.owner, operation.collection, key), cid }));
  },
  async put(operation) {
    const value = JSON.stringify(operation), key = createKey(operation);
    const previous = storage.getString(key);
    if (previous !== undefined) {
      const existing = scopedCreate(JSON.parse(previous), operation.owner, operation.collection, key);
      if (!sameRecord(existing.record, operation.record)) throw new Error('another creation uses this address.');
      return;
    }
    storage.set(key, value);
    if (storage.getString(key) !== value) throw new Error('could not save recovery information.');
  },
  async delete(operation) { storage.remove(createKey(operation)); },
};
