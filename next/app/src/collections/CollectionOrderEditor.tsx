import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import ArrowUp from 'lucide-react-native/icons/arrow-up';
import ArrowDown from 'lucide-react-native/icons/arrow-down';
import type { ListDetail } from '../api';
import { useAppearance } from '../appearance';
import { artistName, errorMessage, Heading, Status } from '../CatalogPieces';
import { Action, Copy, row } from '../controls';
import { PlayerControl } from '../PlayerControl';
import { Text } from '../Text';
import type { createPds } from '../pds';
import { CollectionOrderConflict, CollectionOrderUnconfirmed, type CollectionRevision } from './collection-order';

export function CollectionOrderEditor({ list, ordering, close, saved }: {
  list: ListDetail;
  ordering: ReturnType<ReturnType<typeof createPds>['collectionOrder']>;
  close: () => void;
  saved: (revision: CollectionRevision) => void;
}) {
  const theme = useAppearance();
  const [revision, setRevision] = useState<CollectionRevision>();
  const [order, setOrder] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState('');
  const active = useRef(true);
  const locked = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  const load = useCallback(async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(undefined);
    try {
      const latest = await ordering.read(list.record.uri);
      if (!active.current) return;
      setRevision(latest); setOrder(latest.value.items.map((_, index) => index));
      setBlocked(false); setMessage('');
    } catch (error) { if (active.current) setError(errorMessage(error)); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  }, [ordering, list.record.uri]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!revision || locked.current || blocked) return;
    locked.current = true; setBusy(true); setError(undefined);
    try {
      const result = await ordering.save(revision, order);
      if (!active.current) return;
      setRevision(result.revision); setOrder(order.map((_, index) => index));
      saved(result.revision);
      setMessage(result.status === 'indexed' ? 'order saved.' : result.status === 'rejected'
        ? 'order saved to your PDS, but the catalog rejected the change.'
        : 'order saved to your PDS. the catalog is catching up.');
    } catch (error) {
      if (active.current) {
        setError(errorMessage(error));
        setBlocked(error instanceof CollectionOrderConflict || error instanceof CollectionOrderUnconfirmed);
      }
    } finally { locked.current = false; if (active.current) setBusy(false); }
  }

  function move(index: number, target: number) {
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next); setError(undefined);
    setMessage(`moved track ${index + 1} to position ${target + 1} of ${order.length}.`);
  }
  const changed = order.some((entry, index) => entry !== index);
  return <View style={{ gap: 16 }}>
    <Heading>reorder tracks</Heading>
    <Copy>move tracks up or down, then save your order.</Copy>
    <Status loading={busy} error={error} />
    {!!message && <Copy live>{message}</Copy>}
    {blocked && <Action label="Reload latest order" disabled={busy} onPress={() => void load()} />}
    {!revision && !busy && <Action label="Retry playlist" onPress={() => void load()} />}
    {revision && <View style={{ gap: 8 }}>{order.map((entry, index) => {
      const item = revision.value.items[entry];
      const track = list.members.find(member => member.subject.uri === item.subject.uri)?.track;
      const title = track?.metadata.title ?? 'unavailable track';
      return <View key={entry} testID={`playlist-occurrence-${entry}`} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12, borderRadius: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line }}>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text style={{ color: theme.text, fontSize: 15 * theme.scale, fontWeight: '600' }}>{index + 1}. {title}</Text>
          <Text style={{ color: theme.muted, fontSize: 13 * theme.scale }}>{track ? artistName(track) : 'kept in this playlist'}</Text>
        </View>
        <View>
          <PlayerControl icon={ArrowUp} label={`Move track ${index + 1} up`} disabled={busy || blocked || index === 0} onPress={() => move(index, index - 1)} />
          <PlayerControl icon={ArrowDown} label={`Move track ${index + 1} down`} disabled={busy || blocked || index === order.length - 1} onPress={() => move(index, index + 1)} />
        </View>
      </View>;
    })}</View>}
    <View style={row}>
      <Action primary label="Save order" disabled={busy || blocked || !changed} onPress={() => void save()} />
      <Action label={changed ? 'Cancel reordering' : 'Done reordering'} disabled={busy} onPress={close} />
    </View>
  </View>;
}
