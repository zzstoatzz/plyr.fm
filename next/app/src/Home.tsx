import { Link } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { HomeTrackActions, HomeTrackRow } from './HomeTrackRow';
import X from 'lucide-react-native/icons/x';
import { api, type Track } from './api';
import { useAuth } from './auth';
import { Cover, Detail, Heading, Status, artistName, errorMessage, useColors, usePages, type Play } from './CatalogPieces';
import { homeTags, type HomeTag } from './home-api';
import { nextPopulatedChart, parseSelectedTags, periodLabels, selectedTagsKey, type ChartPeriod } from './home-state';
import { readLocal, writeLocal } from './storage';
import { Text } from './Text';
import { useNetworkArtists } from './use-network-artists';
import { pageFrame } from './controls';
import { tagColors } from './tag-colors';
import { WaveLoading } from './WaveLoading';

export function Home({ onPlay }: { onPlay: Play }) {
  const colors = useColors();
  const list = useRef<FlatList<Track>>(null);
  const { did } = useAuth();
  const key = selectedTagsKey(did);
  const [selection, setSelection] = useState(() => ({ key, tags: parseSelectedTags(readLocal(key)) }));
  const selected = selection.key === key ? selection.tags : parseSelectedTags(readLocal(key));
  const tagKey = JSON.stringify(selected);
  const loadLatest = useCallback((cursor?: string) => api.tracks({ limit: 30, cursor, tag: parseSelectedTags(tagKey) }), [tagKey]);
  const latest = usePages(loadLatest);
  const viewport = useRef({ height: 0, content: 0, offset: 0 });
  const fillViewport = useCallback(() => {
    const { height, content, offset } = viewport.current;
    if (height > 0 && content > 0 && content - offset - height <= height * 0.6 && latest.cursor && !latest.loading && !latest.error) latest.more();
  }, [latest.cursor, latest.loading, latest.error, latest.more]);
  useEffect(() => {
    const frame = requestAnimationFrame(fillViewport);
    return () => cancelAnimationFrame(frame);
  }, [fillViewport]);
  const tracks = useMemo(() => [...new Map(latest.data.map(track => [track.id, track])).values()], [latest.data]);
  const [tags, setTags] = useState<HomeTag[]>([]);
  const [tagError, setTagError] = useState<string>();
  const [tagAttempt, setTagAttempt] = useState(0);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [period, setPeriod] = useState<ChartPeriod>('month');
  const [chart, setChart] = useState<Track[]>([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [chartError, setChartError] = useState<string>();
  const chartGeneration = useRef(0);
  const network = useNetworkArtists(did);
  const loadChart = useCallback(async (cycle = false) => {
    const generation = ++chartGeneration.current;
    setChartLoading(true);
    setChartError(undefined);
    try {
      const load = async (candidate: ChartPeriod) => (await api.chart(candidate)).data.slice(0, 10).map(({ track }) => track);
      const result = cycle ? await nextPopulatedChart(period, load) : { period, tracks: await load(period) };
      if (generation === chartGeneration.current) { setChart(result.tracks); setPeriod(result.period); }
    } catch (error) {
      if (generation === chartGeneration.current) setChartError(errorMessage(error));
    } finally {
      if (generation === chartGeneration.current) setChartLoading(false);
    }
  }, [period]);
  useEffect(() => {
    void loadChart();
    return () => { chartGeneration.current += 1; };
  }, []);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setTagError(undefined);
    setTagsLoading(true);
    const timer = setTimeout(() => { setTagError('could not load tags'); controller.abort(); }, 15_000);
    void homeTags(controller.signal).then((items) => {
      if (current && !controller.signal.aborted) setTags(items.sort((left, right) => right.total_plays - left.total_plays));
    }, (error: unknown) => {
      if (current && !controller.signal.aborted) setTagError(errorMessage(error));
    }).finally(() => { clearTimeout(timer); if (current) setTagsLoading(false); });
    return () => { current = false; controller.abort(); clearTimeout(timer); };
  }, [tagAttempt]);
  function changeTags(next: string[]) {
    list.current?.scrollToOffset({ offset: 0, animated: false });
    setSelection({ key, tags: next });
    writeLocal(key, JSON.stringify(next));
  }
  function tag(name: string, active: boolean, count?: number) {
    const palette = tagColors(name, colors.background, active);
    return <Pressable key={name} accessibilityRole="button" hitSlop={4} accessibilityLabel={`${active ? 'Remove' : 'Filter by'} ${name}`}
      disabled={!active && selected.length >= 10} accessibilityState={{ selected: active, disabled: !active && selected.length >= 10 }} onPress={() => changeTags(active ? selected.filter((value) => value !== name) : [...selected, name])}
      style={styles.tagTarget}>
      <View style={[styles.tag, { backgroundColor: palette.backgroundColor, borderColor: active ? colors.accent : palette.borderColor }]}>
        <Text numberOfLines={1} style={{ color: palette.color, fontSize: 12 * colors.scale, flexShrink: 1 }}>{name}{count === undefined ? '' : ` (${count})`}</Text>
        {active && <X size={12} color={colors.muted} />}
      </View>
    </Pressable>;
  }
  const header = <View style={styles.home}>
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <Heading>top tracks</Heading>
        <Pressable accessibilityRole="button" accessibilityLabel={`Top tracks period: ${periodLabels[period]}`} disabled={chartLoading}
          onPress={() => void loadChart(true)} style={styles.period}>
          <Text style={{ color: colors.muted, fontSize: 13 * colors.scale }}>{periodLabels[period]} ▾</Text>
        </Pressable>
      </View>
      {chart.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards}>
        {chart.map((track) => <View key={track.id} style={styles.card}>
          <Pressable testID="track-play-control" accessibilityRole="button" accessibilityLabel={`Play ${track.metadata.title}`} onPress={() => onPlay(track, chart)}>
            <Cover uri={track.media.artwork?.url ?? track.artist.profile.avatar_url} size={136} radius={8} />
          </Pressable>
          <Link href={{ pathname: '/track/[id]', params: { id: track.id } }} asChild>
            <Pressable accessibilityRole="link" style={{ minHeight: 28, justifyContent: 'center' }}><Text numberOfLines={1} style={[styles.cardTitle, { color: colors.text, fontSize: 13 * colors.scale }]}>{track.metadata.title}</Text></Pressable>
          </Link>
          <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 * colors.scale }}>{artistName(track)}</Text>
          <HomeTrackActions track={track} />
        </View>)}
      </ScrollView>}
      {chartLoading && !chart.length ? <WaveLoading label="loading..." /> : <Status error={chartError} retry={() => void loadChart()}
        empty={!chart.length ? period === 'all_time' ? 'nothing liked yet' : `nothing liked in the ${periodLabels[period]}` : undefined} />}
    </View>
    {network.artists.length > 0 && <View style={styles.section}>
      <Heading>artists you know</Heading>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards}>
        {network.artists.map((artist) => <Link key={artist.did} href={{ pathname: '/u/[handle]', params: { handle: artist.handle || artist.did } }} asChild>
          <Pressable accessibilityRole="link" style={styles.artist}>
            <Cover uri={artist.avatar_url} size={72} round />
            <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13 * colors.scale }}>{artist.display_name || artist.handle}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 * colors.scale }}>{artist.track_count} {artist.track_count === 1 ? 'track' : 'tracks'}</Text>
          </Pressable>
        </Link>)}
      </ScrollView>
    </View>}
    {network.error && <Detail>{network.error}</Detail>}
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh tracks" onPress={() => { list.current?.scrollToOffset({ offset: 0, animated: false }); latest.reload(); }} style={{ minHeight: 44, justifyContent: 'center' }}><Heading>tracks</Heading></Pressable>
        <Text style={{ color: colors.muted, fontSize: 13 * colors.scale }}>latest</Text>
      </View>
      {(selected.length > 0 || tags.length > 0) && <View style={styles.tags}>
        {selected.length > 0 && <View style={styles.pinned}>
          <Pressable accessibilityRole="button" accessibilityLabel="Clear tag filters" onPress={() => changeTags([])} style={styles.clear}><Text style={{ color: colors.muted, fontSize: 12 * colors.scale }}>clear</Text></Pressable>
          {selected.map((name) => tag(name, true, tags.find((item) => item.name === name)?.track_count))}
        </View>}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tagScroller}>
          {tags.filter(({ name }) => !selected.includes(name)).map(({ name, track_count }) => tag(name, false, track_count))}
        </ScrollView>
      </View>}
      {tagsLoading && tagAttempt > 0 && <WaveLoading label="loading tags..." />}
      <Status error={tagError} retry={() => setTagAttempt((attempt) => attempt + 1)} />
    </View>
  </View>;
  return <FlatList ref={list} testID="home-feed" data={tracks} keyExtractor={track => track.id}
    style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ ...pageFrame, paddingTop: 8, paddingBottom: 24 }}
    onLayout={event => { viewport.current.height = event.nativeEvent.layout.height; fillViewport(); }}
    onContentSizeChange={(_, height) => { viewport.current.content = height; fillViewport(); }}
    onScroll={event => { viewport.current.offset = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={32}
    accessibilityState={{ busy: latest.loading }} keyboardShouldPersistTaps="handled" ListHeaderComponent={header} onEndReachedThreshold={0.6}
    onEndReached={() => { if (latest.cursor && !latest.loading && !latest.error) latest.more(); }}
    initialNumToRender={12} maxToRenderPerBatch={10} windowSize={7}
    renderItem={({ item }) => <HomeTrackRow track={item} tracks={tracks} onPlay={onPlay} />}
    ListFooterComponent={<View style={{ paddingVertical: 12, gap: 8 }}>
      {latest.loading ? <WaveLoading label={tracks.length ? 'loading more...' : 'loading tracks...'} /> :
        <Status error={latest.error} retry={tracks.length ? undefined : latest.more} empty={!tracks.length ? selected.length ? 'no tracks match these tags' : 'no tracks yet' : undefined} />}
      {tracks.length > 0 && <Pressable accessibilityRole="button" accessibilityState={{ disabled: latest.loading || !latest.cursor }} onPress={() => { if (!latest.loading && latest.cursor) latest.more(); }} style={styles.more}><Text style={{ color: latest.cursor ? colors.accent : colors.muted }}>{latest.error ? 'retry loading tracks' : latest.cursor ? 'more tracks' : 'all tracks loaded'}</Text></Pressable>}
      <Text accessibilityLiveRegion="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', color: 'transparent' }}>{tracks.length} tracks loaded</Text>
    </View>} />;
}

const styles = StyleSheet.create({
  home: { gap: 18 }, section: { gap: 10 }, headingRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 4 },
  period: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 2 }, cards: { gap: 16, paddingBottom: 4 }, card: { width: 136, gap: 4 },
  cardTitle: { fontWeight: '600', marginTop: 4 },
  artist: { width: 104, alignItems: 'center', gap: 6 }, tags: { gap: 8 }, pinned: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  tagScroller: { gap: 6, alignItems: 'center' }, tagTarget: { minWidth: 44, minHeight: 44, maxWidth: '100%', justifyContent: 'center' },
  tag: { flexDirection: 'row', gap: 6, alignItems: 'center', minHeight: 36, borderRadius: 8, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 6 },
  clear: { minWidth: 44, minHeight: 44, justifyContent: 'center', paddingVertical: 8, paddingRight: 4 }, more: { alignSelf: 'center', padding: 14 },
});
