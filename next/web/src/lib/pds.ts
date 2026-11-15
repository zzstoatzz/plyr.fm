import { TID } from '@atproto/common-web';
import { catalogChanged } from '$core/catalog/changes';
import { createPublicPds } from '$core/pds';
import { api } from './api';
import { auth } from './auth';
import { authConfig } from './auth-config';
import { createStorage } from './storage/create-storage';

export function createPds(account: ReturnType<typeof auth.getAuth>) {
  return createPublicPds(account, {
    NSID: authConfig.NSID, api, getAuth: auth.getAuth, createStorage,
    catalogChanged, newRkey: () => TID.nextStr()
  });
}
