import { useAppearance } from './appearance';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Animated, FlatList, Pressable, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { HomeTrackRow } from './HomeTrackRow';
import { HomeChart } from './HomeChart';
import { HomeArtists } from './HomeArtists';
import type { Track } from '@plyr/next-core/api';
import { useAuth } from './auth';
import { Heading, Status, type Play } from './CatalogPieces';
import { Text } from './Text';
import { useNetworkArtists } from './use-network-artists';
import { pageFrame } from './controls';
import { WaveLoading } from './WaveLoading';
import { useAppPreferences } from './preference-context';
import { useLatestFeed } from './use-latest-feed';
import { HomeTagBar } from './HomeTagBar';
import { usePullRefresh } from './PullRefresh';
import { newAtTop, type RefreshResult } from '@plyr/next-core/behaviors/pull-refresh';

export function Home({ onPlay }: { onPlay: Play }) {
  const { preferences } = useAppPreferences();
  return <HomeFeed key={JSON.stringify(preferences.hiddenTags)} hiddenTags={preferences.hiddenTags} onPlay={onPlay} />;
}

function HomeFeed({ onPlay, hiddenTags }: { onPlay: Play; hiddenTags: string[] }) {
  const colors = useAppearance();
  const list = useRef<FlatList<Track>>(null);
  const { did, ready } = useAuth();
  const feed = useLatestFeed(hiddenTags);
  const { latest, tracks, pending, selected } = feed;
  const { tag } = useLocalSearchParams<{ tag?: string }>();
  const [latestTop, setLatestTop] = useState(0);
  useEffect(() => {
    if (!tag) return;
    feed.changeTags([tag]);
    router.setParams({ tag: undefined });
    list.current?.scrollToOffset({ offset: latestTop, animated: false });
  }, [tag]);
  const [headerHeight, setHeaderHeight] = useState(0);
  const rowHeight = Math.max(96, Math.ceil(64 * colors.scale + 32));
  const viewport = useRef({ height: 0, content: 0, offset: 0 });
  const fillViewport = useCallback(() => {
    const { height, content, offset } = viewport.current;
    if (height > 0 && content > 0 && content - offset - height <= height * 1.5 && latest.cursor && !latest.loading && !latest.error) latest.more();
  }, [latest.cursor, latest.loading, latest.error, latest.more]);
  const [listHeight, setListHeight] = useState(0);
  const network = useNetworkArtists(did, ready);
  const [chartKey, setChartKey] = useState(0);
  const pull = usePullRefresh(useCallback(async (): Promise<RefreshResult> => {
    const before = tracks;
    setChartKey(key => key + 1);
    const page = await latest.refresh();
    return page ? { ok: true, fresh: newAtTop(before, page) } : { ok: false };
  }, [tracks, latest.refresh]), useCallback((offset: number) => list.current?.scrollToOffset({ offset, animated: true }), []), useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    viewport.current.offset = event.nativeEvent.contentOffset.y;
    fillViewport();
  }, [fillViewport]));
  const header = useMemo(() => <View style={styles.home} onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}>
    <HomeChart onPlay={onPlay} refreshKey={chartKey} />
    {(network.loading || network.artists.length > 0) && <HomeArtists artists={network.artists} loading={network.loading} onPlay={onPlay} />}
    <Status error={network.error} retry={network.retry} />
    <View style={styles.section} onLayout={event => setLatestTop(event.nativeEvent.layout.y)}>
      <View style={styles.headingRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh tracks" onPress={() => { list.current?.scrollToOffset({ offset: 0, animated: false }); latest.reload(); }} style={{ minHeight: 44, justifyContent: 'center' }}><Heading>latest tracks</Heading></Pressable>
      </View>
      <HomeTagBar feed={feed} hiddenTags={hiddenTags} />
    </View>
  </View>, [onPlay, chartKey, network, feed, hiddenTags, latest.reload]);
  const renderItem = useCallback(({ item }: { item: Track }) => <View style={{ opacity: pending ? 0.5 : 1 }}><HomeTrackRow height={rowHeight} track={item} tracks={tracks} onPlay={onPlay} /></View>, [pending, rowHeight, tracks, onPlay]);
  return <View style={{ flex: 1, backgroundColor: colors.background }}><Animated.FlatList ref={list} contentInset={{ top: pull.contentInset }}
    onScrollBeginDrag={pull.onScrollBeginDrag} onScrollEndDrag={pull.onScrollEndDrag} testID="home-feed" data={tracks} keyExtractor={track => track.id} contentInsetAdjustmentBehavior="automatic"
    style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ ...pageFrame, paddingTop: 16, paddingBottom: 24 }}
    onLayout={event => { setListHeight(event.nativeEvent.layout.height); viewport.current.height = event.nativeEvent.layout.height; fillViewport(); }}
    onContentSizeChange={(_, height) => { viewport.current.content = height; fillViewport(); }}
    onScroll={pull.onScroll} scrollEventThrottle={16}
    accessibilityState={{ busy: latest.loading }} keyboardShouldPersistTaps="handled" ListHeaderComponent={header} onEndReachedThreshold={1.5}
    onEndReached={() => { if (latest.cursor && !latest.loading && !latest.error) latest.more(); }}
    getItemLayout={(_, index) => ({ length: rowHeight, offset: 16 + headerHeight + index * rowHeight, index })}
    initialNumToRender={24} maxToRenderPerBatch={24} updateCellsBatchingPeriod={16} windowSize={11}
    renderItem={renderItem}
    ListFooterComponent={<View style={{ minHeight: listHeight - tracks.length * rowHeight }}><View testID="home-feed-footer" style={{ height: 112, justifyContent: 'center' }}>
      {latest.loading ? <WaveLoading label={tracks.length ? 'loading more...' : 'loading tracks...'} /> :
        <Status error={latest.error} retry={tracks.length ? undefined : latest.more} empty={!tracks.length ? selected.length ? 'no tracks match these tags' : 'no tracks yet' : undefined} />}
      {tracks.length > 0 && latest.error && <Pressable accessibilityRole="button" onPress={latest.more} style={styles.more}><Text style={{ color: colors.accent }}>retry loading tracks</Text></Pressable>}
      <Text accessibilityLiveRegion="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', color: 'transparent' }}>{tracks.length} tracks loaded</Text>
    </View></View>} />{pull.indicator}</View>;
}

const styles = StyleSheet.create({
  home: { gap: 18 }, section: { gap: 12 }, headingRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 4 },
  more: { alignSelf: 'center', padding: 14 },
});
