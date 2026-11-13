import { getAuth, type Auth } from '../auth-state';

export function downloadSession(auth: Auth, signal: AbortSignal) {
  return () => {
    signal.throwIfAborted();
    const current = getAuth();
    if (!auth.did || !auth.agent) throw new Error('sign in to download this protected track.');
    if (current.did !== auth.did || current.agent !== auth.agent || current.rpc !== auth.rpc) throw new Error('account changed. try the download again.');
  };
}
