import { AUDIO_SPACE_TYPE, NSID, SPACE_MANAGING_APP } from '../auth-config.ts';

// closing moves a track's audio out of its public record into a record in a
// managed space on the artist's PDS; plyr answers who may read that space.

type Value = Record<string, unknown>;
const PROTECTED = ['audioBlob', 'originalAudioBlob', 'audioFileId', 'originalFileId', 'originalFileType'] as const;
const object = (value: unknown): value is Value => !!value && typeof value === 'object' && !Array.isArray(value);

export const spaceFor = (did: string, skey: string) => `at://${did}/space/${AUDIO_SPACE_TYPE}/${skey}`;
export const spaceRecordUri = (space: string, did: string, rkey: string) => `${space}/${did}/${NSID.track}/${rkey}`;

export function managedPolicy() {
  return { $type: 'com.atproto.managedspace.policy', managingApp: SPACE_MANAGING_APP };
}

/** a space plyr can answer for, or an error saying why not */
export function requireManagedSpace(value: unknown, space: string): void {
  if (!object(value) || value.space !== space || !object(value.policy) || value.policy.$type !== 'com.atproto.managedspace.policy') {
    throw new Error('that space already exists with a different kind of access. pick another name.');
  }
  if (value.policy.managingApp !== SPACE_MANAGING_APP) throw new Error('another app manages who can listen to that space.');
}

/** split a public track record into the closed public record and the protected copy that holds its audio */
export function closedRecords(current: Value, space: string, did: string, rkey: string): { public: Value; protected: Value } {
  if (current.$type !== NSID.track || !object(current.audioBlob)) throw new Error('only tracks with audio on your PDS can be closed.');
  if ('audioSpace' in current || 'supportGate' in current) throw new Error('this track is already closed.');
  const open: Value = { ...current };
  const protectedCopy: Value = { $type: NSID.track, title: current.title, artist: current.artist, createdAt: current.createdAt };
  for (const key of ['fileType', 'duration', ...PROTECTED] as const) if (key in current) protectedCopy[key] = current[key];
  for (const key of [...PROTECTED, 'audioUrl'] as const) delete open[key];
  open.audioSpace = spaceRecordUri(space, did, rkey);
  if (open.downloadPolicy !== 'supporters') delete open.downloadPolicy;
  return { public: open, protected: protectedCopy };
}

/** put the protected audio back on the public record */
export function reopenedRecord(current: Value, protectedCopy: Value): Value {
  if (current.$type !== NSID.track || typeof current.audioSpace !== 'string') throw new Error('this track is not closed.');
  if (!object(protectedCopy.audioBlob)) throw new Error('could not find the audio for this track.');
  const open: Value = { ...current };
  delete open.audioSpace;
  delete open.supportGate;
  for (const key of PROTECTED) if (key in protectedCopy) open[key] = protectedCopy[key];
  return open;
}
