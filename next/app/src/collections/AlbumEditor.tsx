import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import type { ListDetail, Track } from '../api';
import { useAuth } from '../auth';
import { createPds } from '../pds';
import { Action, Copy, row } from '../controls';
import { errorMessage, Heading, Status } from '../CatalogPieces';
import { resolveAlbumTracks } from './album-tracks';
import { AlbumTracks, OwnAlbumTracks } from './AlbumTracks';
import type { AlbumEntry } from './album-membership';
import { CollectionOrderConflict, CollectionOrderUnconfirmed, type CollectionRevision } from './collection-order';

export function AlbumEditor({ list, close, saved }: { list: ListDetail; close: () => void; saved: (revision: CollectionRevision, tracks: Track[]) => void }) {
  const { did, rpc } = useAuth();
  const albums = useMemo(() => createPds({ did, rpc }).albumOrganization(), [did, rpc]);
  const [revision, setRevision] = useState<CollectionRevision>();
  const [entries, setEntries] = useState<AlbumEntry[]>([]);
  const [known, setKnown] = useState<Track[]>([]);
  const [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string>(), [message, setMessage] = useState('');
  const live = useRef(true), locked = useRef(false), resolving = useRef<AbortController | undefined>(undefined);
  useEffect(() => { live.current = true; return () => { live.current = false; resolving.current?.abort(); }; }, []);
  const load = useCallback(async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(undefined);
    try {
      const latest = await albums.read(list.record.uri);
      if (!live.current) return;
      const controller = new AbortController(); resolving.current = controller;
      const tracks = await resolveAlbumTracks(latest, list.members.flatMap(member => member.track ? [member.track] : []), controller.signal);
      if (live.current) { setKnown(tracks); setRevision(latest); setEntries(latest.value.items.map((_, i) => i)); setBlocked(false); setMessage(''); }
    } catch (error) { if (live.current) setError(errorMessage(error)); }
    finally { locked.current = false; if (live.current) setBusy(false); }
  }, [albums, list.record.uri]);
  useEffect(() => { void load(); }, [load]);
  async function save() {
    if (!revision || locked.current || blocked) return;
    locked.current = true; setBusy(true); setError(undefined); setMessage('');
    try {
      const result = await albums.save(revision, entries);
      if (!live.current) return;
      saved(result.revision, known); setRevision(result.revision); setEntries(result.revision.value.items.map((_, i) => i));
      setMessage(result.status === 'indexed' ? 'album saved.' : result.status === 'rejected' ? 'saved to your PDS, but the catalog rejected the change.' : 'album saved to your PDS. the catalog is catching up.');
    } catch (error) {
      if (live.current) { setError(errorMessage(error)); setBlocked(error instanceof CollectionOrderConflict || error instanceof CollectionOrderUnconfirmed); }
    } finally { locked.current = false; if (live.current) setBusy(false); }
  }
  function change(update: (entries: AlbumEntry[]) => AlbumEntry[]) {
    setEntries(update); setMessage(''); setError(undefined);
  }
  const changed = !!revision && (entries.length !== revision.value.items.length || entries.some((entry, index) => entry !== index));
  const uriFor = (entry: AlbumEntry) => typeof entry === 'number' ? revision?.value.items[entry].subject.uri : entry.record.uri;
  const rows = entries.map(entry => {
    const uri = uriFor(entry);
    const track = typeof entry !== 'number' ? entry : known.find(track => track.record.uri === uri) ?? list.members.find(member => member.subject.uri === uri)?.track;
    return { key: typeof entry === 'number' ? `existing:${entry}` : `added:${uri}`, title: track?.metadata.title ?? 'unavailable track (kept in this album)' };
  });
  return <View style={{ gap: 16 }}>
    <Heading>organize album</Heading>
    <Copy>add, remove or move tracks, then save the album.</Copy>
    {!revision && <Status loading={busy} error={error} />}
    {!revision && !busy && <Action label="Reload latest album" onPress={() => void load()} />}
    <AlbumTracks entries={rows} disabled={busy || blocked}
      move={(index, target) => change(value => { const next = [...value]; [next[index], next[target]] = [next[target], next[index]]; return next; })}
      remove={index => change(value => value.filter((_, position) => index !== position))} />
    {revision && <Status loading={busy} error={error} />}
    {!!message && <Copy live>{message}</Copy>}
    {blocked && <Action label="Reload latest album" disabled={busy} onPress={() => void load()} />}
    <View style={row}>
      <Action primary label="Save album tracks" disabled={busy || blocked || !changed} onPress={() => void save()} />
      <Action label={changed ? 'Cancel organizing' : 'Done organizing'} disabled={busy} onPress={close} />
    </View>
    {revision && did && <OwnAlbumTracks did={did} selected={entries.flatMap(entry => { const uri = uriFor(entry); return uri ? [uri] : []; })}
      disabled={busy || blocked || entries.length >= 500} add={track => { setKnown(value => [...value, track]); change(value => [...value, track]); }} />}
  </View>;
}
