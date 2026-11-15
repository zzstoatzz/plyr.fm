import { sameRecord } from '@plyr/next-core/publishing/create-operation';
import { uploadOperation, type UploadStorage } from '@plyr/next-core/publishing/upload-model';
import { queuedUploadKey, readQueuedUploadDraft, type QueuedUploadDrafts } from '@plyr/next-core/publishing/queued-upload-draft';
function databaseFor(name: string, store: string) {
  let database: Promise<IDBDatabase> | undefined;
  return () => database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}
const open = databaseFor('plyr-next-uploads', 'uploads');
const openDrafts = databaseFor('plyr-next-upload-drafts', 'drafts');
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
    if (operation.draftId) await queuedDrafts.take({ owner: operation.owner, id: operation.draftId });
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

export const queuedDrafts: QueuedUploadDrafts = {
  async load(owner) {
    const db = await openDrafts();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('drafts');
      const store = transaction.objectStore('drafts');
      const range = IDBKeyRange.bound(`${owner}/`, `${owner}/\uffff`);
      const values = store.getAll(range);
      const keys = store.getAllKeys(range);
      transaction.oncomplete = () => {
        try { resolve(values.result.map((value, index) => readQueuedUploadDraft(value, owner, keys.result[index]))); }
        catch (failure) { reject(failure); }
      };
      transaction.onabort = () => reject(transaction.error ?? new Error('could not load queued uploads.'));
    });
  },
  async put(draft) {
    const db = await openDrafts();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readwrite');
      transaction.objectStore('drafts').add(draft, queuedUploadKey(draft));
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('could not save the queued upload.'));
    });
  },
  async has(draft) {
    const db = await openDrafts();
    return new Promise((resolve, reject) => {
      const request = db.transaction('drafts').objectStore('drafts').getKey(queuedUploadKey(draft));
      request.onsuccess = () => resolve(request.result !== undefined);
      request.onerror = () => reject(request.error);
    });
  },
  async take(draft) {
    const db = await openDrafts();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readwrite');
      const store = transaction.objectStore('drafts');
      const key = queuedUploadKey(draft);
      const existing = store.getKey(key);
      existing.onsuccess = () => { if (existing.result !== undefined) store.delete(key); };
      transaction.oncomplete = () => resolve(existing.result !== undefined);
      transaction.onabort = () => reject(transaction.error ?? new Error('could not open the queued upload.'));
    });
  },
  withLock(draft, task) {
    const { locks } = navigator;
    if (!locks) throw new Error('queued uploads need a secure browser session.');
    return locks.request(`plyr-next-queued-upload/${queuedUploadKey(draft)}`, { ifAvailable: true }, lock => {
      if (!lock) throw new Error('this queued upload is open in another tab.');
      return task();
    });
  },
};
