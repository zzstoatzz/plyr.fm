import { TID } from '@atproto/common-web';
import { createPrivateLibrary, type PrivateArtwork } from '@plyr/next-core/publishing/private-music';
import { auth } from './auth';
import { authConfig } from './auth-config';
import { createPrivateCreateStorage } from './storage/private-create-storage';

export const privateLibrary = createPrivateLibrary(authConfig);
const storage = createPrivateCreateStorage(privateLibrary);

// a cover's blob never changes, so one object URL per account and cid serves every list and screen
const covers = new Map<string, Promise<string>>();
function coverUrl(artwork: PrivateArtwork) {
	const key = `${auth.getAuth().did}|${artwork.cid}`;
	let url = covers.get(key);
	if (!url) {
		url = import('./media/gated-audio').then(({ privateCoverUrl }) => privateCoverUrl(artwork));
		url.catch(() => { if (covers.get(key) === url) covers.delete(key); });
		covers.set(key, url);
	}
	return url;
}

export function privateMusic(account: ReturnType<typeof auth.getAuth>) {
	return privateLibrary.privatePds(account, auth.getAuth, storage, () => TID.nextStr(), coverUrl);
}
