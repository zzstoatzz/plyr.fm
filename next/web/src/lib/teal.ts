import type { Track } from '@plyr/next-core/api';
import type { QualifiedPlay } from '@plyr/next-core/listening-session';
import { RepoResponseError } from '@plyr/next-core/publishing/repo-rpc';
import { tealPlay, writeTealPlay } from '@plyr/next-core/teal-scrobble';
import { auth, canScrobble } from './auth';
import { confirmScrobblingConsent, scrobblingEnabled } from './prefs.svelte';
import { trackHref } from './tracks';

export async function scrobble(track: Track, play: QualifiedPlay) {
	const { did, rpc } = auth.getAuth();
	if (!did || !rpc || !scrobblingEnabled() || !canScrobble()) return;
	const record = tealPlay(track, play, Date.now(), new URL(trackHref(track), location.origin).href);
	if (!record) return;
	for (const delay of [0, 1000, 4000]) {
		if (delay) await new Promise(resolve => setTimeout(resolve, delay));
		if (!await confirmScrobblingConsent() || auth.getAuth().rpc !== rpc || !canScrobble()) return;
		try {
			await writeTealPlay(rpc, did, record);
			return;
		} catch (error) {
			if (error instanceof RepoResponseError && error.status < 500 && error.status !== 429) return;
		}
	}
}
