import { Link, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { MagnifyingGlass as SearchIcon, X, CaretRight as ChevronRight } from './icons';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { api, type SearchHit } from './api';
import { Cover, Heading, Status, errorMessage, useResource, type Play } from './CatalogPieces';
import { Text } from './Text';
import { useAppearance } from './appearance';
import { usePlayback } from './playback';
import { HomeTrackRow } from './HomeTrackRow';
import { WaveLoading } from './WaveLoading';
import { useSearch } from './use-search';
import { Action, Copy } from './controls';
import { PlayGlyph } from './PlayerGlyph';
import { glassSurface } from './materials';

const filters = [['all', 'all'], ['track', 'tracks'], ['artist', 'artists'], ['album', 'albums'], ['playlist', 'playlists']] as const;
const loadChart = () => api.chart('month').then(page => page.data.slice(0, 8).map(entry => entry.track));

function destination(hit: SearchHit): Href {
  if (hit.type === 'artist') return { pathname: '/u/[handle]', params: { handle: hit.owner.handle || hit.owner.did } };
  if (hit.type === 'track') return { pathname: '/track/[id]', params: { id: hit.id } };
  if (hit.type === 'album') return { pathname: '/album/[id]', params: { id: hit.id } };
  return { pathname: '/playlist/[id]', params: { id: hit.id } };
}

export function Search({ onPlay }: { onPlay: Play }) {
  const theme = useAppearance();
  const player = usePlayback();
  const { q, focus } = useLocalSearchParams<{ q?: string | string[]; focus?: string }>();
  const routeQuery = typeof q === 'string' ? Array.from(q).slice(0, 100).join('') : '';
  const [query, setQuery] = useState(routeQuery);
  const [filter, setFilter] = useState<typeof filters[number][0]>('all');
  const [expanded, setExpanded] = useState<string>();
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState<string>();
  const [playing, setPlaying] = useState<string>();
  const [failure, setFailure] = useState<{ id: string; message: string }>();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const request = useRef(0);
  const term = query.trim();
  const key = JSON.stringify([term, filter]);
  const limit = expanded === key ? 50 : 20;
  const results = useSearch(term, filter === 'all' ? undefined : filter, limit);
  useEffect(() => { request.current++; setQuery(routeQuery); setPlaying(undefined); setFailure(undefined); }, [routeQuery]);
  useFocusEffect(useCallback(() => {
    if (focus) input.current?.focus();
    return () => { request.current++; setPlaying(undefined); };
  }, [focus]));
  function change(value: string) {
    request.current++; setPlaying(undefined); setFailure(undefined); setExpanded(undefined); setQuery(Array.from(value).slice(0, 100).join(''));
  }
  async function play(hit: SearchHit) {
    const attempt = ++request.current;
    setPlaying(hit.id); setFailure(undefined);
    try { const track = await api.track(hit.id); if (attempt === request.current) onPlay(track); }
    catch (error) { if (attempt === request.current) setFailure({ id: hit.id, message: errorMessage(error) }); }
    finally { if (attempt === request.current) setPlaying(undefined); }
  }
  return <>
    <View style={[glassSurface(theme), styles.field, { borderColor: focused ? theme.accent : theme.line }]}>
      <SearchIcon size={19} color={theme.muted} />
      <TextInput ref={input} accessibilityLabel="Search tracks, artists, albums and playlists" placeholder="tracks, artists, albums, playlists" placeholderTextColor={theme.muted}
        value={query} onChangeText={change} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} autoCapitalize="none" autoCorrect={false} returnKeyType="search"
        style={{ flex: 1, minWidth: 0, paddingVertical: 12, color: theme.text, fontFamily: theme.fontFamily, fontSize: 16 * theme.scale, outlineWidth: 0 }} />
      {query.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" style={styles.clear} onPress={() => { change(''); input.current?.focus(); }}><X size={18} color={theme.muted} /></Pressable>}
    </View>
    {Array.from(term).length < 2 ? <Suggestions onPlay={onPlay} /> : <>
      <ScrollView horizontal accessibilityLabel="Result types" showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
        {filters.map(([value, label]) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={label} aria-pressed={filter === value} accessibilityState={{ selected: filter === value }} onPress={() => { request.current++; setPlaying(undefined); setFailure(undefined); setExpanded(undefined); setFilter(value); }}
          style={({ pressed }) => ({ minWidth: 44, minHeight: 44, paddingHorizontal: 12, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: filter === value || pressed ? theme.surface : 'transparent' })}><Text style={{ color: filter === value ? theme.text : theme.muted, fontSize: 13 * theme.scale, fontWeight: filter === value ? '700' : '400' }}>{label}</Text></Pressable>)}
      </ScrollView>
      {results.loading && !results.data && <WaveLoading label="searching…" />}
      <Status error={results.error} retry={results.retry} empty={results.data?.length === 0 ? `no results for “${term}”` : undefined} />
      <View testID="search-results">
        {results.data?.map(hit => {
          const content = <>
            <Cover uri={hit.image_url} size={48} round={hit.type === 'artist'} />
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Text numberOfLines={1} style={{ color: player.current?.id === hit.id ? theme.accent : theme.text, fontSize: 15 * theme.scale, fontWeight: '600' }}>{hit.title}</Text>
              <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 13 * theme.scale }}>{hit.type} · {hit.type === 'artist' ? hit.owner.handle : hit.owner.display_name || hit.owner.handle}</Text>
            </View>
            {playing === hit.id ? <Text accessibilityLiveRegion="polite" style={{ color: theme.muted, fontSize: 12 * theme.scale }}>loading…</Text> :
              <View pointerEvents="none" style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: hit.type === 'track' ? theme.surface : 'transparent' }}>
                {hit.type === 'track' ? <PlayGlyph size={20} color={theme.text} /> : <ChevronRight size={20} color={theme.muted} />}
              </View>}
          </>;
          const control = <Pressable testID={hit.type === 'track' ? 'track-play-control' : undefined} accessibilityRole={hit.type === 'track' ? 'button' : 'link'} accessibilityLabel={`${hit.type}: ${hit.title}, ${hit.owner.display_name || hit.owner.handle}`}
            accessibilityHint={hit.type === 'track' ? 'Play this track' : undefined}
            disabled={playing === hit.id} accessibilityState={{ disabled: playing === hit.id, busy: playing === hit.id, selected: player.current?.id === hit.id }} onPress={hit.type === 'track' ? () => void play(hit) : undefined} onPressIn={() => setPressed(hit.id)} onPressOut={() => setPressed(undefined)}
            style={{ ...styles.result, backgroundColor: pressed === hit.id ? theme.hover : player.current?.id === hit.id ? theme.surface : 'transparent' }}>{content}</Pressable>;
          return <View key={`${hit.type}:${hit.id}`}>{hit.type === 'track' ? control : <Link href={destination(hit)} asChild>{control}</Link>}
            {failure?.id === hit.id && <View style={{ paddingVertical: 8, gap: 8 }}><Copy>{failure.message}</Copy><Action label="retry playback" onPress={() => void play(hit)} /></View>}
          </View>;
        })}
      </View>
      {results.loading && results.data && <WaveLoading label="loading more…" />}
      {!results.loading && results.data?.length === 20 && limit === 20 && <Action label="show more results" onPress={() => setExpanded(key)} />}
      {!results.loading && results.data?.length === 50 && <Copy>showing the first 50 results. try a more specific search.</Copy>}
    </>}
  </>;
}

function Suggestions({ onPlay }: { onPlay: Play }) {
  const chart = useResource(loadChart);
  return <View style={{ gap: 16 }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}><Heading>top tracks</Heading><Copy>past month</Copy></View>
    <View>{chart.data?.map(track => <HomeTrackRow key={track.id} track={track} tracks={chart.data ?? []} onPlay={onPlay} returnTo="/search" />)}</View>
    <Status loading={!chart.data && !chart.error} error={chart.error} retry={chart.retry} empty={chart.data?.length === 0 ? 'nothing liked this month yet' : undefined} />
  </View>;
}

const styles = StyleSheet.create({
  field: { minHeight: 48, borderRadius: 24, borderWidth: 2, paddingLeft: 14, paddingRight: 4, flexDirection: 'row', alignItems: 'center', gap: 8 },
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  result: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 10 }
});
