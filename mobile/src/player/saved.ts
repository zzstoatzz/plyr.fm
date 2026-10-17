import { Storage } from "expo-sqlite/kv-store";
import { restore, save, type Saved } from "plyr-shared/queue";

const KEY = "queue";

/** The queue this device was last playing; nothing is synced anywhere. */
export function recall(): Saved | null {
  try {
    return restore(Storage.getItemSync(KEY));
  } catch {
    return null;
  }
}

export function remember(saved: Saved): void {
  void Storage.setItem(KEY, save(saved)).catch(() => {});
}

export function forget(): void {
  void Storage.removeItem(KEY).catch(() => {});
}
