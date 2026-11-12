import { P256Keypair } from '@atproto/crypto';

export const protectedTransport = {
  keypair: () => P256Keypair.create(),
  fetch: (url: string, init: RequestInit) => fetch(url, init),
};
