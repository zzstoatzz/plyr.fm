import { createMMKV } from 'react-native-mmkv';
import { sameRecord } from '@plyr/next-core/publishing/create-operation';
import { uploadOperation, type UploadStorage } from '@plyr/next-core/publishing/upload-model';
import { queuedUploadKey, queuedUploadPrefix, readQueuedUploadDraft, type QueuedUploadDrafts } from '@plyr/next-core/publishing/queued-upload-draft';
const storage = createMMKV({ id: 'plyr-next-uploads' });
export const uploadStorage: UploadStorage = {
  async load(owner) {
    return storage.getAllKeys().filter(key => key.startsWith(`${owner}/`)).map(key => {
      const operation = uploadOperation(JSON.parse(storage.getString(key) ?? 'null'), owner);
      if (key !== `${owner}/${operation.uploadId}`) throw new Error('upload recovery does not match its address.');
      return operation;
    });
  },
  async put(operation) {
    const key = `${operation.owner}/${operation.uploadId}`, value = JSON.stringify(operation), previous = storage.getString(key);
    if (previous !== undefined) {
      if (!sameRecord(uploadOperation(JSON.parse(previous), operation.owner), operation)) throw new Error('another upload uses this address.');
      return;
    }
    storage.set(key, value);
    if (storage.getString(key) !== value) throw new Error('could not save upload recovery.');
  },
  async delete(operation) {
    if (operation.draftId) await queuedDrafts.take({ owner: operation.owner, id: operation.draftId });
    storage.remove(`${operation.owner}/${operation.uploadId}`);
  },
};

const drafts = createMMKV({ id: 'plyr-next-upload-drafts' });
const lockedDrafts = new Set<string>();
export const queuedDrafts: QueuedUploadDrafts = {
  async load(owner) {
    return drafts.getAllKeys().filter(key => key.startsWith(queuedUploadPrefix(owner)) || key.startsWith(queuedUploadPrefix(owner, true)))
      .map(key => readQueuedUploadDraft(JSON.parse(drafts.getString(key) ?? 'null'), owner, key));
  },
  async put(draft) {
    const key = queuedUploadKey(draft);
    if (drafts.contains(key)) throw new Error('another queued upload uses this address.');
    const value = JSON.stringify(draft);
    drafts.set(key, value);
    if (drafts.getString(key) !== value) throw new Error('could not save the queued upload.');
  },
  async take(draft) {
    return drafts.remove(queuedUploadKey(draft));
  },
  async has(draft) { return drafts.contains(queuedUploadKey(draft)); },
  async withLock(draft, task) {
    const key = queuedUploadKey(draft);
    if (lockedDrafts.has(key)) throw new Error('this queued upload is already open.');
    lockedDrafts.add(key);
    try { return await task(); }
    finally { lockedDrafts.delete(key); }
  },
};
