import { createMMKV } from 'react-native-mmkv';

const storage = createMMKV({ id: 'plyr-next' });

export function readLocal(key: string): string | null {
	return storage.getString(key) ?? null;
}
export function writeLocal(key: string, value: string) {
	storage.set(key, value);
}
export function removeLocal(key: string) {
	storage.remove(key);
}
