import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { HomeTrackRow } from './HomeTrackRow';
import { HomeChart } from './HomeChart';
import { HomeArtists } from './HomeArtists';
import { api, type Track } from './api';
import { useAuth } from './auth';
import { Detail, Heading, Status, useColors, usePages, type Play } from './CatalogPieces';
import { useHomeTags } from './use-home-tags';
import { parseSelectedTags, selectedTagsKey } from './home-state';
import { readLocal, writeLocal } from './storage';
import { Text } from './Text';
import { useNetworkArtists } from './use-network-artists';
import { pageFrame } from './controls';
import { tagColors } from './tag-colors';
import { WaveLoading } from './WaveLoading';
import { TagScroller } from './TagScroller';

export function Home({ onPlay }: { onPlay: Play }) {
  const colors = useColors();
  const list = useRef<FlatList<Track>>(null);
  const [layoutWidth, setLayoutWidth] = useState(0);
  const contentWidth = Math.max(0, layoutWidth - pageFrame.paddingHorizontal * 2);
  const columns = contentWidth >= 900 * colors.scale ? 2 : 1;
  const { did, ready } = useAuth();
  const key = selectedTagsKey(did);
  const [selection, setSelection] = useState(() => ({ key, tags: parseSelectedTags(readLocal(key)) }));
  const selected = selection.key === key ? selection.tags : parseSelectedTags(readLocal(key));
  const tagKey = JSON.stringify(selected);
  const loadLatest = useCallback((cursor?: string) => api.tracks({ limit: 24, cursor, tag: parseSelectedTags(tagKey) }), [tagKey]);
  const latest = usePages(loadLatest);
  const [headerHeight, setHeaderHeight] = useState(0);
  const rowHeight = Math.max(96, Math.ceil(64 * colors.scale + 32));
  const viewport = useRef({ height: 0, content: 0, offset: 0 });
  const fillViewport = useCallback(() => {
    const { height, content, offset } = viewport.current;
    if (height > 0 && content > 0 && content - offset - height <= height * 1.5 && latest.cursor && !latest.loading && !latest.error) latest.more();
  }, [latest.cursor, latest.loading, latest.error, latest.more]);
  const loaded = useMemo(() => [...new Map(latest.data.map(track => [track.id, track])).values()], [latest.data]);
  const pending = latest.loading && loaded.length === 0;
  const held = useRef(loaded);
  if (!pending) held.current = loaded;
  const tracks = pending ? held.current : loaded;
  const [listHeight, setListHeight] = useState(0);
  const tagPages = useHomeTags();
  const tags = tagPages.tags;
  const network = useNetworkArtists(did, ready);
  function changeTags(next: string[]) {
    setSelection({ key, tags: next });
    writeLocal(key, JSON.stringify(next));
  }
  function tag(name: string, active: boolean, count?: number) {
    const palette = tagColors(name, colors.background, active);
    return <Pressable key={name} accessibilityRole="button" hitSlop={4} accessibilityLabel={`${active ? 'Remove' : 'Filter by'} ${name}`}
      disabled={!active && selected.length >= 10} accessibilityState={{ selected: active, disabled: !active && selected.length >= 10 }} onPress={() => changeTags(active ? selected.filter((value) => value !== name) : [...selected, name])}
      style={styles.tagTarget}>
      <View style={[styles.tag, { backgroundColor: active ? palette.backgroundColor : 'transparent', borderColor: palette.borderColor }]}>
        <Text numberOfLines={1} style={{ color: palette.color, fontSize: 12 * colors.scale, fontWeight: active ? '600' : '400', flexShrink: 1 }}>{name}{count === undefined ? '' : <Text style={{ color: palette.color, fontSize: 10.5 * colors.scale }}> ({count})</Text>}</Text>
      </View>
    </Pressable>;
  }
  const header = <View style={styles.home} onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}>
    <HomeChart onPlay={onPlay} />
    {(network.loading || network.artists.length > 0) && <HomeArtists artists={network.artists} loading={network.loading} />}
    {network.error && <Detail>{network.error}</Detail>}
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh tracks" onPress={() => { list.current?.scrollToOffset({ offset: 0, animated: false }); latest.reload(); }} style={{ minHeight: 44, justifyContent: 'center' }}><Heading>latest tracks</Heading></Pressable>
      </View>
      {(selected.length > 0 || tags.length > 0 || !tagPages.error) && <View style={styles.tags}>
        <TagScroller hasMore={tagPages.hasMore} onNearEnd={() => void tagPages.more()} lead={selected.length}>
          {selected.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Clear tag filters" onPress={() => changeTags([])} style={styles.tagTarget}>
            <View style={[styles.tag, { borderStyle: 'dashed', borderColor: colors.line }]}><Text style={{ color: colors.faint, fontSize: 12 * colors.scale }}>clear</Text></View>
          </Pressable>}
          {selected.map((name) => tag(name, true, tags.find((item) => item.name === name)?.track_count))}
          {selected.length > 0 && <View testID="home-tags-divider" style={[styles.divider, { backgroundColor: colors.line }]} />}
          {tags.filter(({ name }) => !selected.includes(name)).map(({ name, track_count }) => tag(name, false, track_count))}
          {tagPages.hasMore && <Pressable accessibilityRole="button" accessibilityLabel="More tags" accessibilityState={{ busy: tagPages.loading, disabled: tagPages.loading }} disabled={tagPages.loading} onPress={() => void tagPages.more(true)} style={styles.tagTarget}>
            <Text style={{ color: colors.muted, fontSize: 12 * colors.scale }}>{tagPages.loading ? 'loading…' : 'more'}</Text>
          </Pressable>}
        </TagScroller>
      </View>}
      <Status error={tagPages.error} retry={tagPages.retry} />
    </View>
  </View>;
  return <FlatList key={columns} numColumns={columns} columnWrapperStyle={columns === 2 ? { gap: 24 } : undefined} ref={list} testID="home-feed" data={tracks} keyExtractor={track => track.id}
    style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ ...pageFrame, maxWidth: '100%', paddingTop: 16, paddingBottom: 24 }}
    onLayout={event => { setLayoutWidth(event.nativeEvent.layout.width); setListHeight(event.nativeEvent.layout.height); viewport.current.height = event.nativeEvent.layout.height; fillViewport(); }}
    onContentSizeChange={(_, height) => { viewport.current.content = height; fillViewport(); }}
    onScroll={event => { viewport.current.offset = event.nativeEvent.contentOffset.y; fillViewport(); }} scrollEventThrottle={32}
    accessibilityState={{ busy: latest.loading }} keyboardShouldPersistTaps="handled" ListHeaderComponent={header} onEndReachedThreshold={1.5}
    onEndReached={() => { if (latest.cursor && !latest.loading && !latest.error) latest.more(); }}
    getItemLayout={(_, index) => ({ length: rowHeight, offset: 16 + headerHeight + index * rowHeight, index })}
    initialNumToRender={24} maxToRenderPerBatch={24} updateCellsBatchingPeriod={16} windowSize={11}
    renderItem={({ item }) => columns === 2 ? <View style={{ width: (contentWidth - 24) / 2, opacity: pending ? 0.5 : 1 }}><HomeTrackRow height={rowHeight} track={item} tracks={tracks} onPlay={onPlay} /></View> : <View style={{ opacity: pending ? 0.5 : 1 }}><HomeTrackRow height={rowHeight} track={item} tracks={tracks} onPlay={onPlay} /></View>}
    ListFooterComponent={<View style={{ minHeight: listHeight - Math.ceil(tracks.length / columns) * rowHeight }}><View testID="home-feed-footer" style={{ height: 112, justifyContent: 'center' }}>
      {latest.loading ? <WaveLoading label={tracks.length ? 'loading more...' : 'loading tracks...'} /> :
        <Status error={latest.error} retry={tracks.length ? undefined : latest.more} empty={!tracks.length ? selected.length ? 'no tracks match these tags' : 'no tracks yet' : undefined} />}
      {tracks.length > 0 && latest.error && <Pressable accessibilityRole="button" onPress={latest.more} style={styles.more}><Text style={{ color: colors.accent }}>retry loading tracks</Text></Pressable>}
      <Text accessibilityLiveRegion="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', color: 'transparent' }}>{tracks.length} tracks loaded</Text>
    </View></View>} />;
}

const styles = StyleSheet.create({
  home: { gap: 18 }, section: { gap: 12 }, headingRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 4 },
  tags: { minHeight: 36 },
  divider: { width: 1, height: 20, marginHorizontal: 4 },
  tagTarget: { minWidth: 44, minHeight: 36, maxWidth: '100%', justifyContent: 'center' },
  tag: { flexDirection: 'row', alignItems: 'center', minHeight: 28, borderRadius: 16, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 4 },
  more: { alignSelf: 'center', padding: 14 },
});
