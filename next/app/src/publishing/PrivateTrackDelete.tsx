import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { Track } from '../api';
import { getAuth, type Auth } from '../auth-state';
import { Action, Copy, row } from '../controls';
import type { privatePds } from './private-pds';

export function PrivateTrackDelete({ track, auth, deletion, pending, deleted }: {
  track: Track; auth: Auth; deletion: ReturnType<typeof privatePds>['deletion']; pending: boolean; deleted: () => void;
}) {
  const [state, setState] = useState<'closed' | 'confirm' | 'unknown' | 'present'>('closed');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string>();
  const live = useRef(true), locked = useRef(false);
  const sameSession = () => getAuth().did === auth.did && getAuth().rpc === auth.rpc;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  async function run(remove: boolean) {
    if (locked.current || !sameSession()) return;
    locked.current = true; setBusy(true); setMessage(undefined);
    try {
      const result = await (remove ? deletion.remove(track) : deletion.check(track));
      if (!sameSession()) return;
      if (result === 'deleted') { deleted(); return; }
      if (live.current) { setState('present'); setMessage('this track is still here. review it before deleting again.'); }
    } catch (error) {
      if (live.current && sameSession()) { setState('unknown'); setMessage(error instanceof Error ? error.message : 'could not confirm deletion. check again.'); }
    } finally { locked.current = false; if (live.current && sameSession()) setBusy(false); }
  }
  if (state === 'closed') return <View style={{ alignSelf: 'flex-start', gap: 6 }}>
    <Action label={`Delete ${track.metadata.title}`} destructive disabled={pending} onPress={() => setState('confirm')} />
    {pending && <Copy>finish this track’s creation recovery before deleting it.</Copy>}
  </View>;
  return <View style={{ gap: 10 }}>
    <Copy>delete “{track.metadata.title}” from your private music? this deletes the current version, including changes made elsewhere. it cannot be undone here.</Copy>
    <Copy>people who already downloaded the audio may still have a copy.</Copy>
    {message && <Copy live>{message}</Copy>}
    <View style={row}>
      {!auth.privateDeleting ? <Action label="Sign in to delete private music" href={{ pathname: '/login', params: { return_to: '/private' } }} />
        : state === 'unknown' ? <Action label={busy ? 'Checking deletion…' : 'Check deletion'} disabled={busy} onPress={() => void run(false)} />
          : <Action label={busy ? 'Deleting…' : 'Delete current track'} primary destructive disabled={busy} onPress={() => void run(true)} />}
      <Action label="Cancel deletion" disabled={busy} onPress={() => { setState('closed'); setMessage(undefined); }} />
    </View>
  </View>;
}
