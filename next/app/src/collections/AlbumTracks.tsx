import { useCallback } from 'react';
import { ArrowUp, ArrowDown, X } from '../icons';
import { View } from 'react-native';
import { api, type Track } from '../api';
import { Action, Copy } from '../controls';
import { Heading, Status, usePages } from '../CatalogPieces';
import { PlayerControl } from '../PlayerControl';
import { useAppearance } from '../appearance';

export function AlbumTracks({ entries, disabled, move, remove }: {
  entries: { key: string; title: string }[];
  disabled: boolean;
  move: (index: number, target: number) => void;
  remove: (index: number) => void;
}) {
  const theme = useAppearance();
  return <View style={{ gap: 8 }}>{entries.map((entry, index) => <View key={entry.key} testID={`album-entry-${index}`}
    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line }}>
    <View style={{ flex: 1, minWidth: 0 }}><Copy>{index + 1}. {entry.title}</Copy></View>
    <View>
      <PlayerControl icon={ArrowUp} label={`Move track ${index + 1} up`} disabled={disabled || index === 0} onPress={() => move(index, index - 1)} />
      <PlayerControl icon={ArrowDown} label={`Move track ${index + 1} down`} disabled={disabled || index === entries.length - 1} onPress={() => move(index, index + 1)} />
    </View>
    <PlayerControl icon={X} label={`Remove track ${index + 1}`} disabled={disabled} onPress={() => remove(index)} />
  </View>)}</View>;
}

export function OwnAlbumTracks({ did, selected, disabled, add }: { did: string; selected: string[]; disabled: boolean; add: (track: Track) => void }) {
  const load = useCallback((cursor?: string) => api.tracks({ artist_did: did, limit: 30, cursor }), [did]);
  const tracks = usePages(load);
  return <View style={{ gap: 8 }}>
    <Heading>add your tracks</Heading>
    {tracks.data.filter(track => track.artist.did === did).map(track => <Action key={track.record.uri}
      label={`${selected.includes(track.record.uri) ? 'Added' : 'Add'} ${track.metadata.title}`}
      disabled={disabled || !track.record.cid || selected.includes(track.record.uri)} onPress={() => add(track)} />)}
    <Status loading={tracks.loading} error={tracks.error} retry={tracks.more} empty={!tracks.data.length ? 'no published tracks yet.' : undefined} />
    {!tracks.loading && <Action label="Reload your tracks" disabled={disabled} onPress={tracks.reload} />}
    {tracks.cursor && !tracks.loading && !tracks.error && <Action label="More tracks" disabled={disabled} onPress={tracks.more} />}
  </View>;
}
