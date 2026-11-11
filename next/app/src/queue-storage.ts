import { mergeQueueMutations, queueMutations } from './queue-mutation';
import { createMMKV } from 'react-native-mmkv';
import { applyQueueProgress, queueCheckpoint, type QueueStorage } from './queue-checkpoint';

const storage = createMMKV({ id: 'plyr-next-queue' });
function read(key: string): unknown {
  try { return JSON.parse(storage.getString(key) ?? 'null'); } catch { return null; }
}
export const queueStorage: QueueStorage = {
  async loadMutations(owner) { return queueMutations(read(owner + ':mutations'), owner); },
  async saveMutations(owner, entries, remove) { const merged = mergeQueueMutations(queueMutations(read(owner + ':mutations'), owner), entries, remove); storage.set(owner + ':mutations', JSON.stringify({ owner, entries: merged })); return merged; },
  async load(owner) { return applyQueueProgress(read(owner), read(owner + ':progress'), owner); },
  async save(owner, snapshot) { const safe = queueCheckpoint(snapshot, owner); if (!safe) throw new Error('could not save this queue'); storage.set(owner, JSON.stringify(safe)); },
  async progress(owner, progress) { storage.set(owner + ':progress', JSON.stringify(progress)); },
};
