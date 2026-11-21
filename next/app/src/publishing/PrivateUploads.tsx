import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { View } from 'react-native';
import { getAuth, type Auth } from '../auth-state';
import { Action, Copy } from '../controls';
import { Heading } from '../CatalogPieces';
import { measureAudioDuration } from '../media-picker';
import type { MediaFile } from '../pds';
import { privatePds, type PrivateResult } from './private-pds';
import type { PrivateCreate } from '@plyr/next-core/publishing/private-music';
import { hideUploadIsland, showUploadIsland } from './upload-island-store';
import { toast } from '../toast';

export interface PrivateTrack { file: MediaFile; artwork: MediaFile | null; title: string; artist: string; description: string; tags: string[] }

/** only-you uploads: earlier attempts to check or set aside, and saving a new one to the private library */
export function usePrivateUploads(auth: Auth) {
  const pds = useMemo(() => privatePds(auth), [auth.did, auth.rpc]);
  const [pending, setPending] = useState<PrivateCreate[]>([]), [results, setResults] = useState<Record<string, PrivateResult>>({});
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [recoveryError, setRecoveryError] = useState<string>();
  const [notice, setNotice] = useState<{ area: string; text: string }>();
  const live = useRef(true), locked = useRef(false), generation = useRef(0);
  const current = () => live.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc;
  useEffect(() => { live.current = true; return () => { live.current = false; generation.current++; }; }, []);
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    const [operations] = await Promise.allSettled([pds.pending()]);
    if (!live.current || getAuth().rpc !== auth.rpc || getAuth().did !== auth.did || version !== generation.current) return;
    if (operations.status === 'fulfilled') { setPending(operations.value); setRecoveryError(undefined); }
    else setRecoveryError('could not load upload drafts. try again.');
    setLoading(false);
  }, [pds, auth.did, auth.rpc]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  async function run(area: string, action: () => Promise<void>) {
    if (!current() || locked.current) return;
    locked.current = true; setBusy(true); setNotice(undefined);
    try { await action(); }
    catch (failure) { if (current()) setNotice({ area, text: failure instanceof Error ? failure.message : 'could not save this track.' }); }
    finally { locked.current = false; if (current()) { await refresh(); setBusy(false); } }
  }

  /** saves to the private library; true once it's there */
  async function save(track: PrivateTrack): Promise<boolean> {
    let saved = false;
    await run('upload', async () => {
      const title = track.title.trim(), name = `"${title}"`, island = `private:${title}`;
      showUploadIsland(island, { phase: 'active', title, summary: 'uploading', announce: `uploading ${name}…` });
      let result: Awaited<ReturnType<typeof pds.upload>>;
      try {
        const duration = await measureAudioDuration(track.file).catch(() => undefined);
        if (!current()) { hideUploadIsland(island); return; }
        // the cover rides along: a private track keeps its artwork in the library too
        result = await pds.upload({ ...track, duration }, () => showUploadIsland(island, { phase: 'active', title, summary: 'saving', announce: `saving ${name}…` }));
      } catch (failure) {
        const reason = failure instanceof Error ? failure.message.replace(/\.$/, '') : undefined;
        const line = reason ? `${name} didn't upload: ${reason}` : `${name} didn't upload`;
        showUploadIsland(island, { phase: 'failed', title, summary: 'failed', announce: line });
        toast.add(line, 'error', 10000, { label: 'open upload', href: '/upload' }, island);
        throw failure;
      }
      const accepted = result.result.state === 'accepted';
      showUploadIsland(island, accepted ? { phase: 'done', title, summary: 'uploaded', announce: `${name} uploaded` }
        : { phase: 'failed', title, summary: 'check it', announce: `${name} may not have saved. check its status on the upload page.` });
      if (accepted) toast.add(`${name} uploaded`, 'success', 6000, { label: 'your uploads', href: '/portal' }, island);
      else toast.add(`${name} may not have saved`, 'warning', 10000, { label: 'open upload', href: '/upload' }, island);
      if (!current()) return;
      setResults(values => ({ ...values, [result.operation.rkey]: result.result }));
      if (accepted) { await pds.dismiss(result.operation); saved = true; }
    });
    return saved;
  }

  const recover = (operation: PrivateCreate, retry: boolean) => run(operation.rkey, async () => {
    const result = await pds.recover(operation, retry);
    if (current()) setResults(values => ({ ...values, [operation.rkey]: result }));
  });
  const view = <>
    {notice?.area === 'recovery' && <Copy live>{notice.text}</Copy>}
    {recoveryError && <><Copy live>{recoveryError}</Copy><Action label="Try again" onPress={() => void refresh()} /></>}
    {pending.map(operation => {
      const state = results[operation.rkey]?.state;
      return <View key={operation.rkey} style={{ gap: 10 }}>
        {notice?.area === operation.rkey && <Copy live>{notice.text}</Copy>}
        <Heading>{typeof operation.record.title === 'string' ? operation.record.title : 'track upload'}</Heading>
        <Copy>{state === 'accepted' ? 'track saved.' : operation.archived ? 'this earlier upload might still finish.' : 'this track may already be saved. check its status before trying again.'}</Copy>
        <Action label="Check upload status" disabled={busy} onPress={() => void recover(operation, false)} />
        {state === 'different' ? <><Copy>another track already exists. keep that track to clear this attempt.</Copy>
          <Action label="Keep existing track" disabled={busy} onPress={() => void run(operation.rkey, () => pds.dismiss(operation, true))} /></>
          : state === 'accepted' ? <Action label="Done with upload" disabled={busy} onPress={() => void run(operation.rkey, () => pds.dismiss(operation))} />
            : <Action label="Retry upload" disabled={busy} onPress={() => void recover(operation, true)} />}
        {!operation.archived && state !== 'accepted' && <><Copy>this attempt may still appear. starting again could create a duplicate.</Copy>
          <Action label="Set aside upload" disabled={busy} onPress={() => void run(operation.rkey, () => pds.archive(operation, true))} /></>}
      </View>;
    })}
  </>;
  return {
    view, busy, save,
    /** a new only-you upload has to wait: an earlier one may still land */
    blocked: loading || !!recoveryError || pending.some(operation => !operation.archived),
    problem: notice?.area === 'upload' ? notice.text : undefined,
  };
}
