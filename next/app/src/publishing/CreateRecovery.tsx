import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { getAuth, type Auth } from '../auth-state';
import { albumIdFromUri, playlistIdFromUri, trackIdFromUri } from '@plyr/next-core/api';
import { Action, Copy } from '../controls';
import { createPds } from '../pds';
import { WaveLoading } from '../WaveLoading';
import type { CreateOperation } from '@plyr/next-core/publishing/create-operation';
import { applyGenreTags } from '@plyr/next-core/publishing/genre-tags';

export function useCreateRecovery(auth: Auth, kind: 'track' | 'playlist' | 'album') {
  const pds = useMemo(() => createPds(auth), [auth.did, auth.rpc]);
  const [entries, setEntries] = useState<CreateOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const refresh = useCallback(async () => {
    try {
      const pending = await pds.pendingCreates(kind);
      if (live.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc) { setEntries(pending); setError(undefined); }
      return pending.filter(operation => !operation.archived);
    } catch {
      if (live.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc) setError('could not load creation recovery. try again before publishing.');
      return [];
    } finally { if (live.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc) setLoading(false); }
  }, [pds, kind, auth.did, auth.rpc]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  return { pds, operations: entries.filter(operation => !operation.archived), archived: entries.filter(operation => operation.archived), loading, error, refresh };
}

export function EarlierCreates({ recovery, auth, kind }: { recovery: Recovery; auth: Auth; kind: 'track' | 'playlist' | 'album' }) {
  const [expanded, setExpanded] = useState(false);
  if (!recovery.archived.length) return null;
  return <>
    <Action label={`${expanded ? 'Hide' : 'Show'} earlier attempts (${recovery.archived.length})`} onPress={() => setExpanded(value => !value)} />
    {expanded && recovery.archived.map(operation => <PendingCreate key={operation.rkey} operation={operation} auth={auth} kind={kind} recovery={recovery} onDismiss={() => {}} />)}
  </>;
}

type Recovery = ReturnType<typeof useCreateRecovery>;
export function CreateRecovery({ recovery, auth, kind, onDismiss }: { recovery: Recovery; auth: Auth; kind: 'track' | 'playlist' | 'album'; onDismiss: (operation: CreateOperation) => void }) {
  return <>
    {recovery.loading && <WaveLoading label="Loading creation recovery" />}
    {recovery.error && <><Copy live>{recovery.error}</Copy><Action label="Retry loading recovery" onPress={() => void recovery.refresh()} /></>}
    {recovery.operations.map(operation => <PendingCreate key={operation.rkey} operation={operation} auth={auth} kind={kind} recovery={recovery} onDismiss={onDismiss} />)}
  </>;
}

function PendingCreate({ operation, auth, kind, recovery, onDismiss }: { operation: CreateOperation; auth: Auth; kind: 'track' | 'playlist' | 'album'; recovery: Recovery; onDismiss: (operation: CreateOperation) => void }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof recovery.pds.recoverCreate>> | undefined>(() => operation.cid
    ? { state: 'accepted', uri: operation.uri, cid: operation.cid, status: 'pending' } : undefined);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const locked = useRef(false), live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const current = () => live.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc;
  async function check(retry = false) {
    if (!current() || locked.current) return;
    locked.current = true; setBusy(true); setError(undefined);
    try {
      const next = await recovery.pds.recoverCreate(operation, retry);
      if (current()) setResult(next);
    } catch { if (current()) setError('could not confirm creation. check again when connected.'); }
    finally { locked.current = false; if (current()) setBusy(false); }
  }
  useEffect(() => { void check(); }, []);
  function dismiss(keepExisting = false) {
    if (locked.current || !current()) return;
    locked.current = true; setBusy(true);
    void recovery.pds.dismissCreate(operation, keepExisting).then(async () => {
      if (kind === 'track' && result?.state === 'accepted' && operation.autoTag) {
        void applyGenreTags(() => recovery.pds, operation.uri).catch(() => undefined);
      }
      if (current()) { await recovery.refresh(); if (current()) onDismiss(operation); }
    }).catch(() => { if (current()) { setError('could not clear recovery. try again.'); setBusy(false); } }).finally(() => { locked.current = false; });
  }
  function archive(archived: boolean) {
    if (locked.current || !current()) return;
    locked.current = true; setBusy(true);
    void recovery.pds.archiveCreate(operation, archived).then(async () => {
      if (current()) { await recovery.refresh(); if (current()) onDismiss(operation); }
    }).catch(() => { if (current()) { setError('could not update this attempt. try again.'); } }).finally(() => { locked.current = false; if (current()) setBusy(false); });
  }
  const accepted = result?.state === 'accepted';
  const album = operation.record.listType === 'album';
  const name = typeof operation.record.title === 'string' ? operation.record.title : typeof operation.record.name === 'string' ? operation.record.name : kind;
  return <>
    <Copy>{name}</Copy>
    <Copy live>{accepted ? result.status === 'indexed' ? 'saved.' : result.status === 'rejected' ? 'saved, but it couldn’t be added to the catalog.' : 'saved. it might take a moment to appear.'
      : result?.state === 'different' ? 'another item was saved instead.'
        : result?.state === 'missing' ? 'this hasn’t been saved yet.' : busy ? 'checking whether it was saved…' : 'this may already be saved. check its status before trying again.'}</Copy>
    {error && <Copy live>{error}</Copy>}
    {!accepted && <Action label={busy ? 'Checking…' : 'Check status'} disabled={busy} onPress={() => void check()} />}
    {result?.state === 'missing' && !operation.archived && <Action label="Try saving again" disabled={busy} onPress={() => void check(true)} />}
    {!accepted && operation.archived && <Action label="Resume recovery" disabled={busy} onPress={() => archive(false)} />}
    {!accepted && !operation.archived && result?.state !== 'different' && <>
      <Copy>this attempt may still appear. starting again could create a duplicate.</Copy>
      <Action label="Set aside attempt" disabled={busy} onPress={() => archive(true)} />
    </>}
    {(accepted || result?.state === 'different') && <Action label={kind === 'track' ? 'View track' : accepted ? `Open created ${album ? 'album' : 'playlist'}` : `View existing ${album ? 'album' : 'playlist'}`} href={kind === 'track' ? `/track/${trackIdFromUri(operation.uri)}` : album ? `/album/${albumIdFromUri(operation.uri)}` : `/playlist/${playlistIdFromUri(operation.uri)}`} />}
    {result?.state === 'different' && <Action label="Keep existing item" disabled={busy} onPress={() => dismiss(true)} />}
    {accepted && <Action label={kind === 'track' && !operation.archived ? 'Upload another' : 'Done'} disabled={busy} onPress={() => dismiss()} />}
  </>;
}
