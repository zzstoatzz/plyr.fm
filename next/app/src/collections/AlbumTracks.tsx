import { useEffect, useState } from 'react';
import { ArrowUp, ArrowDown, X } from '../icons';
import { Pressable, TextInput, View } from 'react-native';
import { api } from '../api-client';
import { type Track } from '@plyr/next-core/api';
import { facets, filterTracks, loadAll } from '@plyr/next-core/catalog/owned';
import { Action, Copy, inputFontSize } from '../controls';
import { Heading, Status } from '../CatalogPieces';
import { PlayerControl } from '../PlayerControl';
import { useAppearance } from '../appearance';
import { Text } from '../Text';

export function AlbumTracks({ entries, disabled, move, remove, rename, explicit, toggleExplicit }: {
  entries: { key: string; title: string }[];
  disabled: boolean;
  move: (index: number, target: number) => void;
  remove: (index: number) => void;
  rename?: (index: number, title: string) => void;
  explicit?: boolean[];
  toggleExplicit?: (index: number) => void;
}) {
  const theme = useAppearance();
  return <View style={{ gap: 8 }}>{entries.map((entry, index) => <View key={entry.key} testID={`album-entry-${index}`}
    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line }}>
    <Text style={{ width: 22, color: theme.faint, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale, textAlign: 'right' }}>{index + 1}</Text>
    <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
      {rename ? <TextInput value={entry.title} onChangeText={text => rename(index, text)} maxLength={256} editable={!disabled} accessibilityLabel={`Title for track ${index + 1}`}
        style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: inputFontSize(theme.scale), fontWeight: '700', paddingVertical: 2, borderBottomWidth: 1, borderColor: theme.line }} />
        : <Copy>{entry.title}</Copy>}
      {toggleExplicit && <Pressable accessibilityRole="button" accessibilityState={{ selected: !!explicit?.[index] }} accessibilityLabel={`Explicit, track ${index + 1}`}
        disabled={disabled} onPress={() => toggleExplicit(index)} hitSlop={6}
        style={{ alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1,
          borderColor: explicit?.[index] ? theme.text : theme.line, backgroundColor: explicit?.[index] ? theme.text : 'transparent' }}>
        <Text style={{ color: explicit?.[index] ? theme.background : theme.muted, fontFamily: theme.fontFamily, fontSize: 12 * theme.scale }}>explicit</Text>
      </Pressable>}
    </View>
    <View>
      <PlayerControl icon={ArrowUp} label={`Move track ${index + 1} up`} disabled={disabled || index === 0} onPress={() => move(index, index - 1)} />
      <PlayerControl icon={ArrowDown} label={`Move track ${index + 1} down`} disabled={disabled || index === entries.length - 1} onPress={() => move(index, index + 1)} />
    </View>
    <PlayerControl icon={X} label={`Remove track ${index + 1}`} disabled={disabled} onPress={() => remove(index)} />
  </View>)}</View>;
}

const noLabel = () => '';

/** Your posted tracks by search or tag, never as one long list to scroll. */
export function OwnTrackSearch({ did, selected, disabled, add }: { did: string; selected: string[]; disabled: boolean; add: (track: Track) => void }) {
  const theme = useAppearance();
  const [all, setAll] = useState<Track[]>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string>();
  useEffect(() => {
    let live = true;
    loadAll(cursor => api.tracks({ artist_did: did, limit: 100, cursor }))
      .then(tracks => { if (live) setAll(tracks.filter(track => track.artist.did === did)); }, () => { if (live) setError('could not load your tracks.'); });
    return () => { live = false; };
  }, [did]);
  const tags = all ? facets(all, noLabel).tags.slice(0, 8) : [];
  const searching = !!query.trim() || !!tag;
  const found = all && searching ? filterTracks(all, { query, sort: 'recent', tag }, noLabel).slice(0, 30) : [];
  return <View style={{ gap: 10 }}>
    <Heading>add tracks you've posted</Heading>
    <TextInput value={query} onChangeText={setQuery} placeholder="find your tracks" placeholderTextColor={theme.faint} accessibilityLabel="Find your tracks"
      autoCorrect={false} autoCapitalize="none" returnKeyType="search" editable={!disabled}
      style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line, color: theme.text, fontFamily: theme.fontFamily, fontSize: inputFontSize(theme.scale) }} />
    {!!tags.length && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{tags.map(item => <Pressable key={item.name} accessibilityRole="button"
      accessibilityState={{ selected: tag === item.name }} onPress={() => setTag(tag === item.name ? undefined : item.name)}
      style={{ minHeight: 32, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: tag === item.name ? theme.text : theme.line, backgroundColor: tag === item.name ? theme.text : 'transparent' }}>
      <Text style={{ color: tag === item.name ? theme.background : theme.text, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale }}>{item.name} · {item.count}</Text>
    </Pressable>)}</View>}
    <Status loading={!all && !error} error={error} />
    {found.map(track => <Action key={track.record.uri}
      label={`${selected.includes(track.record.uri) ? 'Added' : 'Add'} ${track.metadata.title}`}
      disabled={disabled || !track.record.cid || selected.includes(track.record.uri)} onPress={() => add(track)} />)}
    {all && searching && !found.length && <Copy>nothing matches.</Copy>}
  </View>;
}
