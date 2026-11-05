import { randomUUID } from 'expo-crypto';
import { readLocal, writeLocal } from './storage';

const key = 'plyr-next:anonymous-play-listener';
let listener: string | undefined;

export function playListenerId(): string {
  if (listener) return listener;
  const stored = readLocal(key);
  listener = stored && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(stored) ? stored : randomUUID();
  writeLocal(key, listener);
  return listener;
}
