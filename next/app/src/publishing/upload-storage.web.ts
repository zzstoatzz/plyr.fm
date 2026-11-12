import { sameRecord } from './create-operation';
import { uploadOperation, type UploadStorage } from './upload-model';
let database: Promise<IDBDatabase> | undefined;
function open() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('plyr-next-uploads', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('uploads');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}
export const uploadStorage: UploadStorage = {
  async load(owner) {
    const database = await open();
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('uploads'), store = transaction.objectStore('uploads');
      const range = IDBKeyRange.bound(`${owner}/`, `${owner}/\uffff`);
      const request = store.getAll(range), keys = store.getAllKeys(range);
      transaction.oncomplete = () => { try { resolve(request.result.map((value, index) => { const operation = uploadOperation(value, owner); if (keys.result[index] !== `${owner}/${operation.uploadId}`) throw new Error('upload recovery address mismatch.'); return operation; })); } catch (error) { reject(error); } };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('could not load upload recovery.'));
    });
  },
  async put(operation) {
    const database = await open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('uploads', 'readwrite'), store = transaction.objectStore('uploads'), key = `${operation.owner}/${operation.uploadId}`;
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          if (request.result === undefined) store.put(operation, key);
          else if (!sameRecord(uploadOperation(request.result, operation.owner), operation)) transaction.abort();
        } catch { transaction.abort(); }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('could not save upload recovery.'));
    });
  },
  async delete(operation) {
    const database = await open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('uploads', 'readwrite');
      transaction.objectStore('uploads').delete(`${operation.owner}/${operation.uploadId}`);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('could not dismiss upload recovery.'));
    });
  },
};
