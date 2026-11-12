import type { Track } from '../api';
import { NSID } from '../auth-config.ts';
import { isPrivateTrack, privateSpace } from './private-track.ts';

export type PrivateDeletionResult = 'deleted' | 'present';
export function privateDeletion({ owner, current, policy, allowed, pending, read, send }: {
  owner: string | null; current: () => string; policy: () => Promise<void>; allowed: boolean;
  pending: () => Promise<{ uri: string }[]>; read: (rkey: string) => Promise<unknown>; send: (rkey: string) => Promise<unknown>;
}) {
  function owned(track: Track) {
    const did = current();
    if (did !== owner || track.artist.did !== did || !isPrivateTrack(track)
      || track.record.uri !== `${privateSpace(did)}/${did}/${NSID.track}/${track.record.rkey}`) throw new Error('this private track belongs to another account.');
    return track.record.rkey;
  }
  async function check(track: Track): Promise<PrivateDeletionResult> {
    const rkey = owned(track);
    await policy();
    const record = await read(rkey);
    current();
    if (record === undefined) return 'deleted';
    if (!record || typeof record !== 'object' || !('uri' in record) || record.uri !== track.record.uri
      || !('cid' in record) || typeof record.cid !== 'string') throw new Error('could not confirm deletion. check again.');
    return 'present';
  }
  return {
    check,
    async remove(track: Track): Promise<PrivateDeletionResult> {
      const rkey = owned(track);
      if (!allowed) throw new Error('sign in again to allow private deletion.');
      if ((await pending()).some(operation => operation.uri === track.record.uri)) throw new Error('finish this track’s creation recovery before deleting it.');
      current();
      await policy();
      current();
      try { await send(rkey); } catch { current(); }
      try { return await check(track); }
      catch { current(); throw new Error('could not confirm deletion. check again before retrying.'); }
    },
  };
}
