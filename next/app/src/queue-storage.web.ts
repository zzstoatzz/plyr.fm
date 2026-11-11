import { mergeQueueMutations, queueMutations } from './queue-mutation';
import { applyQueueProgress, queueCheckpoint, type QueueStorage } from './queue-checkpoint';

let database: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('plyr-next-queue', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('checkpoints');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
  return database;
}
async function write(key: string, value: unknown): Promise<void> {
  const database = await open();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('checkpoints', 'readwrite');
    transaction.objectStore('checkpoints').put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
export const queueStorage: QueueStorage = {
  async loadMutations(owner) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const request = database.transaction('checkpoints', 'readonly').objectStore('checkpoints').get(owner + ':mutations');
      request.onsuccess = () => resolve(queueMutations(request.result, owner));
      request.onerror = () => reject(request.error);
    });
  },
  async saveMutations(owner, entries, remove) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('checkpoints', 'readwrite');
      const store = transaction.objectStore('checkpoints');
      const request = store.get(owner + ':mutations');
      let merged: typeof entries = [];
      request.onsuccess = () => {
        try {
          merged = mergeQueueMutations(queueMutations(request.result, owner), queueMutations({ owner, entries }, owner), remove);
          store.put({ owner, entries: merged }, owner + ':mutations');
        } catch { transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(merged);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('could not save your queue change'));
    });
  },
  async load(owner) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('checkpoints', 'readonly');
      const store = transaction.objectStore('checkpoints');
      const snapshot = store.get(owner);
      const progress = store.get(owner + ':progress');
      transaction.oncomplete = () => resolve(applyQueueProgress(snapshot.result, progress.result, owner));
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  },
  async save(owner, snapshot) { const safe = queueCheckpoint(snapshot, owner); if (!safe) throw new Error('could not save this queue'); await write(owner, safe); },
  progress: (owner, progress) => write(owner + ':progress', progress),
};
