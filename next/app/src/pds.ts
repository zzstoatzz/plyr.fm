import type {} from '@atcute/atproto';
import { TID } from '@atproto/common-web';
import { createPublicPds } from '@plyr/next-core/pds';
import { api } from './api-client';
import { getAuth, type Auth } from './auth-state';
import { NSID } from './config';
import { catalogChanged } from '@plyr/next-core/catalog/changes';
import { createStorage } from './publishing/create-storage';

export type { LikeRef, ListRecord, MediaFile, NewTrack, ProfileRecord, TrackEdits } from '@plyr/next-core/pds';
export { MAX_AUDIO_BYTES, TrackRevisionConflict } from '@plyr/next-core/pds';

export function createPds(auth: Pick<Auth, 'did' | 'rpc'>) {
  return createPublicPds(auth, { NSID, api, getAuth, createStorage, catalogChanged, newRkey: () => TID.nextStr() });
}
