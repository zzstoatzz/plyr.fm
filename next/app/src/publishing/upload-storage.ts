import { createMMKV } from 'react-native-mmkv';
import { sameRecord } from './create-operation';
import { uploadOperation, type UploadStorage } from './upload-model';
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
  async delete(operation) { storage.remove(`${operation.owner}/${operation.uploadId}`); },
};
