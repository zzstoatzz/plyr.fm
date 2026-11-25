import type { Auth } from '../auth-state.ts';
import { audioOrigin } from '../downloads/manifest.ts';
import { sniffAudioFormat } from '../audio-sniff.ts';
import { audioFormat } from './upload-model.ts';
import { admitUpload, type UploadConfig } from './upload-transport.ts';

export type DeliverAudio = (input: { uri: string; name: string; type: string; bytes: Uint8Array<ArrayBuffer>; cid: string }) => Promise<boolean>;

/** The sha2-256 digest a raw CIDv1 (`bafkrei…`) names, as hex, or undefined for any other CID. */
export function rawCidDigest(cid: string) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  if (!cid.startsWith('b')) return;
  const bytes: number[] = [];
  let buffer = 0, bits = 0;
  for (const char of cid.slice(1)) {
    const value = alphabet.indexOf(char);
    if (value < 0) return;
    buffer = (buffer << 5) | value; bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 0xff); buffer &= (1 << bits) - 1; }
  }
  if (bytes.length !== 36 || bytes[0] !== 0x01 || bytes[1] !== 0x55 || bytes[2] !== 0x12 || bytes[3] !== 0x20) return;
  return bytes.slice(4).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Stores a track's audio at the streaming origin before its record is written, so it plays the
 * moment it is published. Returns false when this session can't (no upload permission, an
 * unsupported format, a refused write); the appview then copies it from the PDS after ingest.
 */
export function audioDelivery(config: UploadConfig, getAuth: () => Pick<Auth<unknown>, 'did' | 'agent' | 'uploadStorage'>, newId: () => string,
  fetcher: typeof fetch = fetch): DeliverAudio {
  return async ({ uri, name, type, bytes, cid }) => {
    const auth = getAuth();
    const digest = rawCidDigest(cid);
    if (!auth.agent || !auth.did || !auth.uploadStorage || !digest || !uri.startsWith(`at://${auth.did}/`)) return false;
    try {
      // the bytes decide: the origin serves this type, and Safari and iOS won't play audio served as something else
      const { fileType, contentType } = sniffAudioFormat(bytes.subarray(0, 64)) ?? audioFormat(name, type);
      const { capability } = await admitUpload(config, auth.agent, { uploadId: newId(), recordUri: uri, sizeBytes: bytes.byteLength, contentType, fileType }, undefined, fetcher);
      const stored = await fetcher(`${audioOrigin}/audio/${cid}`, { method: 'PUT', body: bytes, redirect: 'error',
        headers: { authorization: `Bearer ${capability}`, 'content-type': contentType, 'x-content-sha256': digest } });
      return stored.ok;
    } catch {
      return false;
    }
  };
}
