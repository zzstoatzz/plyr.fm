import { TID } from '@atproto/common-web';
import { createPrivateLibrary } from '$core/publishing/private-music';
import { auth } from './auth';
import { authConfig } from './auth-config';
import { createPrivateCreateStorage } from './storage/private-create-storage';

export const privateLibrary = createPrivateLibrary(authConfig);
const storage = createPrivateCreateStorage(privateLibrary);

export function privateMusic(account: ReturnType<typeof auth.getAuth>) {
	return privateLibrary.privatePds(account, auth.getAuth, storage, () => TID.nextStr());
}
