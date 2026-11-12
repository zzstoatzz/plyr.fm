import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { getAuth, type Auth } from '../auth-state';
import { playlistIdFromUri, trackIdFromUri } from '../api';
import { Action, Copy } from '../controls';
import { createPds } from '../pds';
import { WaveLoading } from '../WaveLoading';
import type { CreateOperation } from './create-operation';

export function useCreateRecovery(auth: Auth, kind: 'track' | 'playlist') {
  const pds = useMemo(() => createPds(auth), [auth.did, auth.rpc]);
  const [operations, setOperations] = useState<CreateOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const refresh = useCallback(async () => {
    try {
      const pending = await pds.pendingCreates(kind);
      if (live.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc) { setOperations(pending); setError(undefined); }
      return pending;
    } catch {
      if (live.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc) setError('could not load creation recovery. try again before publishing.');
      return [];
    } finally { if (live.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc) setLoading(false); }
  }, [pds, kind, auth.did, auth.rpc]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  return { pds, operations, loading, error, refresh };
}

type Recovery = ReturnType<typeof useCreateRecovery>;
export function CreateRecovery({ recovery, auth, kind, onDismiss }: { recovery: Recovery; auth: Auth; kind: 'track' | 'playlist'; onDismiss: () => void }) {
  return <>
    {recovery.loading && <WaveLoading label="Loading creation recovery" />}
    {recovery.error && <><Copy live>{recovery.error}</Copy><Action label="Retry loading recovery" onPress={() => void recovery.refresh()} /></>}
    {recovery.operations.map(operation => <PendingCreate key={operation.rkey} operation={operation} auth={auth} kind={kind} recovery={recovery} onDismiss={onDismiss} />)}
  </>;
}

function PendingCreate({ operation, auth, kind, recovery, onDismiss }: { operation: CreateOperation; auth: Auth; kind: 'track' | 'playlist'; recovery: Recovery; onDismiss: () => void }) {
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
      if (current()) { await recovery.refresh(); if (current()) onDismiss(); }
    }).catch(() => { if (current()) { setError('could not clear recovery. try again.'); setBusy(false); } }).finally(() => { locked.current = false; });
  }
  const accepted = result?.state === 'accepted';
  const name = typeof operation.record.title === 'string' ? operation.record.title : typeof operation.record.name === 'string' ? operation.record.name : kind;
  return <>
    <Copy>{name}</Copy>
    <Copy live>{accepted ? result.status === 'indexed' ? 'saved to your PDS.' : result.status === 'rejected' ? 'saved to your PDS. the catalog rejected the change.' : 'saved to your PDS. the catalog is catching up.'
      : result?.state === 'different' ? 'a different record exists at this address. review it before continuing.'
        : result?.state === 'missing' ? 'this creation is not visible yet. retrying uses the same record address.' : busy ? 'checking whether your creation was saved…' : 'creation status is unknown.'}</Copy>
    {error && <Copy live>{error}</Copy>}
    {!accepted && <Action label={busy ? 'Checking…' : 'Check status'} disabled={busy} onPress={() => void check()} />}
    {result?.state === 'missing' && <Action label="Retry same creation" disabled={busy} onPress={() => void check(true)} />}
    {(accepted || result?.state === 'different') && <Action label={kind === 'track' ? 'View track' : accepted ? 'Open created playlist' : 'View existing playlist'} href={kind === 'track' ? `/track/${trackIdFromUri(operation.uri)}` : `/playlist/${playlistIdFromUri(operation.uri)}`} />}
    {result?.state === 'different' && <Action label="Keep existing record" disabled={busy} onPress={() => dismiss(true)} />}
    {accepted && <Action label={kind === 'track' ? 'Upload another' : 'Done'} disabled={busy} onPress={() => dismiss()} />}
  </>;
}
