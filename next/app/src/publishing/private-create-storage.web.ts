import { privateCreate, samePrivateCreate, type PrivateCreate, type PrivateCreateStorage } from './private-create';
let database: Promise<IDBDatabase> | undefined;
function open() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('plyr-next-private-creates', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('operations');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}
async function change(operation: PrivateCreate, action: 'put' | 'delete' | boolean) {
  const database = await open();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('operations', 'readwrite'), store = transaction.objectStore('operations'), key = `${operation.owner}/${operation.rkey}`;
    const request = store.get(key);
    request.onsuccess = () => {
      try {
        const current = request.result === undefined ? undefined : privateCreate(request.result, operation.owner);
        if (current && !samePrivateCreate(current, operation)) throw new Error('private recovery changed.');
        if (action === 'put') { if (!current) store.put(privateCreate(operation, operation.owner), key); }
        else if (action === 'delete') store.delete(key);
        else { if (!current) throw new Error('private recovery was dismissed.'); store.put({ ...current, archived: action }, key); }
      } catch { transaction.abort(); }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('could not save private recovery.'));
  });
}
export const privateCreateStorage: PrivateCreateStorage = {
  async load(owner) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('operations'), store = transaction.objectStore('operations'), range = IDBKeyRange.bound(`${owner}/`, `${owner}/\uffff`);
      const values = store.getAll(range), keys = store.getAllKeys(range);
      transaction.oncomplete = () => { try { resolve(values.result.map((value, index) => {
        const operation = privateCreate(value, owner);
        if (keys.result[index] !== `${owner}/${operation.rkey}`) throw new Error('private recovery address mismatch.');
        return operation;
      })); } catch (error) { reject(error); } };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('could not load private recovery.'));
    });
  },
  put: operation => change(operation, 'put'),
  archive: (operation, archived) => change(operation, archived),
  delete: operation => change(operation, 'delete'),
};
