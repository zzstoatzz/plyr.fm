import { useAppearance } from './appearance';
import { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { HomeTrackRow } from './HomeTrackRow';
import { HomeChart } from './HomeChart';
import { HomeArtists } from './HomeArtists';
import type { Track } from './api';
import { useAuth } from './auth';
import { Heading, Status, type Play } from './CatalogPieces';
import { Text } from './Text';
import { useNetworkArtists } from './use-network-artists';
import { pageFrame } from './controls';
import { WaveLoading } from './WaveLoading';
import { useAppPreferences } from './preference-context';
import { useLatestFeed } from './use-latest-feed';
import { HomeTagBar } from './HomeTagBar';
import { DesktopHome, DESKTOP_HOME_WIDTH } from './DesktopHome';

export function Home({ onPlay }: { onPlay: Play }) {
  const { preferences } = useAppPreferences();
  const { width } = useWindowDimensions();
  const Feed = width >= DESKTOP_HOME_WIDTH ? DesktopHome : HomeFeed;
  return <Feed key={JSON.stringify(preferences.hiddenTags)} hiddenTags={preferences.hiddenTags} onPlay={onPlay} />;
}

function HomeFeed({ onPlay, hiddenTags }: { onPlay: Play; hiddenTags: string[] }) {
  const colors = useAppearance();
  const list = useRef<FlatList<Track>>(null);
  const { did, ready } = useAuth();
  const feed = useLatestFeed(hiddenTags);
  const { latest, tracks, pending, selected } = feed;
  const [headerHeight, setHeaderHeight] = useState(0);
  const rowHeight = Math.max(96, Math.ceil(64 * colors.scale + 32));
  const viewport = useRef({ height: 0, content: 0, offset: 0 });
  const fillViewport = useCallback(() => {
    const { height, content, offset } = viewport.current;
    if (height > 0 && content > 0 && content - offset - height <= height * 1.5 && latest.cursor && !latest.loading && !latest.error) latest.more();
  }, [latest.cursor, latest.loading, latest.error, latest.more]);
  const [listHeight, setListHeight] = useState(0);
  const network = useNetworkArtists(did, ready);
  const header = <View style={styles.home} onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}>
    <HomeChart onPlay={onPlay} />
    {(network.loading || network.artists.length > 0) && <HomeArtists artists={network.artists} loading={network.loading} onPlay={onPlay} />}
    <Status error={network.error} retry={network.retry} />
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh tracks" onPress={() => { list.current?.scrollToOffset({ offset: 0, animated: false }); latest.reload(); }} style={{ minHeight: 44, justifyContent: 'center' }}><Heading>latest tracks</Heading></Pressable>
      </View>
      <HomeTagBar feed={feed} hiddenTags={hiddenTags} />
    </View>
  </View>;
  return <FlatList ref={list} testID="home-feed" data={tracks} keyExtractor={track => track.id}
    style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ ...pageFrame, paddingTop: 16, paddingBottom: 24 }}
    onLayout={event => { setListHeight(event.nativeEvent.layout.height); viewport.current.height = event.nativeEvent.layout.height; fillViewport(); }}
    onContentSizeChange={(_, height) => { viewport.current.content = height; fillViewport(); }}
    onScroll={event => { viewport.current.offset = event.nativeEvent.contentOffset.y; fillViewport(); }} scrollEventThrottle={32}
    accessibilityState={{ busy: latest.loading }} keyboardShouldPersistTaps="handled" ListHeaderComponent={header} onEndReachedThreshold={1.5}
    onEndReached={() => { if (latest.cursor && !latest.loading && !latest.error) latest.more(); }}
    getItemLayout={(_, index) => ({ length: rowHeight, offset: 16 + headerHeight + index * rowHeight, index })}
    initialNumToRender={24} maxToRenderPerBatch={24} updateCellsBatchingPeriod={16} windowSize={11}
    renderItem={({ item }) => <View style={{ opacity: pending ? 0.5 : 1 }}><HomeTrackRow height={rowHeight} track={item} tracks={tracks} onPlay={onPlay} /></View>}
    ListFooterComponent={<View style={{ minHeight: listHeight - tracks.length * rowHeight }}><View testID="home-feed-footer" style={{ height: 112, justifyContent: 'center' }}>
      {latest.loading ? <WaveLoading label={tracks.length ? 'loading more...' : 'loading tracks...'} /> :
        <Status error={latest.error} retry={tracks.length ? undefined : latest.more} empty={!tracks.length ? selected.length ? 'no tracks match these tags' : 'no tracks yet' : undefined} />}
      {tracks.length > 0 && latest.error && <Pressable accessibilityRole="button" onPress={latest.more} style={styles.more}><Text style={{ color: colors.accent }}>retry loading tracks</Text></Pressable>}
      <Text accessibilityLiveRegion="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', color: 'transparent' }}>{tracks.length} tracks loaded</Text>
    </View></View>} />;
}

const styles = StyleSheet.create({
  home: { gap: 18 }, section: { gap: 12 }, headingRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 4 },
  more: { alignSelf: 'center', padding: 14 },
});
