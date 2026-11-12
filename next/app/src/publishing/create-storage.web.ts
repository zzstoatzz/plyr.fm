import { createKey, scopedCreate, sameRecord, type CreateStorage } from './create-operation';

let database: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('plyr-next-pending-creates', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('operations');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
  return database;
}

export const createStorage: CreateStorage = {
  async load(owner, collection) {
    const database = await open(), prefix = `${owner}/${collection}/`;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('operations'), store = transaction.objectStore('operations');
      const range = IDBKeyRange.bound(prefix, prefix + '\uffff');
      const values = store.getAll(range), keys = store.getAllKeys(range);
      transaction.oncomplete = () => { try { resolve(values.result.map((value, index) => scopedCreate(value, owner, collection, String(keys.result[index])))); } catch (error) { reject(error); } };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('could not load creation recovery.'));
    });
  },
  async accept(operation, cid) {
    const database = await open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('operations', 'readwrite'), store = transaction.objectStore('operations'), key = createKey(operation);
      const request = store.get(key);
      request.onsuccess = () => {
        if (request.result === undefined) return;
        try { store.put({ ...scopedCreate(request.result, operation.owner, operation.collection, key), cid }, key); } catch { transaction.abort(); }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('could not update recovery information.'));
    });
  },
  async put(operation) {
    const database = await open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('operations', 'readwrite');
      const store = transaction.objectStore('operations'), key = createKey(operation), request = store.get(key);
      request.onsuccess = () => {
        try {
          if (request.result !== undefined) {
            const existing = scopedCreate(request.result, operation.owner, operation.collection, key);
            if (!sameRecord(existing.record, operation.record)) throw new Error('another creation uses this address.');
          } else store.put(operation, key);
        } catch { transaction.abort(); }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('could not save recovery information.'));
    });
  },
  async delete(operation) {
    const database = await open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('operations', 'readwrite');
      transaction.objectStore('operations').delete(createKey(operation));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  },
};
