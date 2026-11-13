import { P256Keypair } from '@atproto/crypto';
import { getRandomBytesAsync } from 'expo-crypto';
import { fetch } from 'expo/fetch';

export const protectedTransport = {
  keypair: async () => P256Keypair.import(await getRandomBytesAsync(32)),
  fetch: (url: string, init: RequestInit) => fetch(url, init),
};
