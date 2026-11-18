import type { Auth } from '@plyr/next-core/auth-state';
import { auth as authState } from '$lib/auth';

/** throws once the download is cancelled or the account it started under is gone */
export function downloadSession(auth: Pick<Auth<unknown>, 'did' | 'agent' | 'rpc'>, signal: AbortSignal) {
  return () => {
    signal.throwIfAborted();
    const current = authState.getAuth();
    if (!auth.did || !auth.agent) throw new Error('sign in to download this protected track.');
    if (current.did !== auth.did || current.agent !== auth.agent || current.rpc !== auth.rpc) throw new Error('account changed. try the download again.');
  };
}
