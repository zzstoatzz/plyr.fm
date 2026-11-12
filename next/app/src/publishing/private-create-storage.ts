import { createMMKV } from 'react-native-mmkv';
import { privateCreate, samePrivateCreate, type PrivateCreate, type PrivateCreateStorage } from './private-create';
const storage = createMMKV({ id: 'plyr-next-private-creates' });
const key = (operation: PrivateCreate) => `${operation.owner}/${operation.rkey}`;
export const privateCreateStorage: PrivateCreateStorage = {
  async load(owner) {
    return storage.getAllKeys().filter(value => value.startsWith(`${owner}/`)).map(address => {
      const operation = privateCreate(JSON.parse(storage.getString(address) ?? 'null'), owner);
      if (address !== key(operation)) throw new Error('private recovery address mismatch.');
      return operation;
    });
  },
  async put(operation) {
    const previous = storage.getString(key(operation));
    if (previous !== undefined) {
      if (!samePrivateCreate(privateCreate(JSON.parse(previous), operation.owner), operation)) throw new Error('another private creation uses this address.');
      return;
    }
    const encoded = JSON.stringify(privateCreate(operation, operation.owner));
    storage.set(key(operation), encoded);
    if (storage.getString(key(operation)) !== encoded) throw new Error('could not save private recovery.');
  },
  async archive(operation, archived) {
    const current = privateCreate(JSON.parse(storage.getString(key(operation)) ?? 'null'), operation.owner);
    if (!samePrivateCreate(current, operation)) throw new Error('private recovery changed.');
    storage.set(key(operation), JSON.stringify({ ...current, archived }));
  },
  async delete(operation) { storage.remove(key(operation)); },
};
