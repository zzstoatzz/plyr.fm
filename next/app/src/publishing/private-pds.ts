import { TID } from '@atproto/common-web';
import { getAuth, type Auth } from '../auth-state';
import { privateLibrary } from './private-config';
import { privateCreateStorage } from './private-create-storage';

export type { PrivateResult } from '../../../core/src/publishing/private-music';

export function privatePds(auth: Auth) {
  return privateLibrary.privatePds(auth, getAuth, privateCreateStorage, () => TID.nextStr());
}
