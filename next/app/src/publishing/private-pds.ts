import { P256Keypair } from '@atproto/crypto';
import { TID } from '@atproto/common-web';
import { getRandomBytesAsync } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { fetch } from 'expo/fetch';
import { MAX_ARTWORK_BYTES } from '@plyr/next-core/publishing/artwork-model';
import type { PrivateArtwork } from '@plyr/next-core/publishing/private-music';
import { getAuth, type Auth } from '../auth-state';
import { openSpaceBlob } from '../gated-audio-shared';
import { privateLibrary } from './private-config';
import { privateCreateStorage } from './private-create-storage';

export type { PrivateResult } from '@plyr/next-core/publishing/private-music';

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const covers = new Map<string, Promise<string>>();

// a cover's blob never changes, so it is kept on disk by cid and read back with the owner's space credential once
async function saveCover(artwork: PrivateArtwork, auth: Auth): Promise<string> {
  const directory = new Directory(Paths.cache, 'plyr-private-covers');
  if (!directory.exists) directory.create();
  const file = new File(directory, `${artwork.cid}.${EXTENSIONS[artwork.mimeType] ?? 'img'}`);
  if (file.exists && file.size > 0) return file.uri;
  const response = await openSpaceBlob(artwork, auth, {
    fetch: (url, init) => fetch(url, init),
    keypair: async () => P256Keypair.import(await getRandomBytesAsync(32)),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_ARTWORK_BYTES) throw new Error('could not load this cover');
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  return file.uri;
}

export function privatePds(auth: Auth) {
  const coverUrl = (artwork: PrivateArtwork) => {
    const key = `${auth.did}|${artwork.cid}`;
    let url = covers.get(key);
    if (!url) {
      url = saveCover(artwork, auth);
      url.catch(() => { if (covers.get(key) === url) covers.delete(key); });
      covers.set(key, url);
    }
    return url;
  };
  return privateLibrary.privatePds(auth, getAuth, privateCreateStorage, () => TID.nextStr(), coverUrl);
}
