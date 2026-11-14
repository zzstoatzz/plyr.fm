import { Pressable, StyleSheet, View } from 'react-native';
import { useAppearance } from './appearance';
import { Status } from './CatalogPieces';
import { tagColors } from './tag-colors';
import { TagScroller } from './TagScroller';
import { Text } from './Text';
import type { LatestFeed } from './use-latest-feed';

export function HomeTagBar({ feed, hiddenTags }: { feed: LatestFeed; hiddenTags: string[] }) {
  const colors = useAppearance();
  const { selected, changeTags, tagPages } = feed;
  const tags = tagPages.tags;
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
  return <>
    {(selected.length > 0 || tags.length > 0 || !tagPages.error) && <View style={styles.tags}>
      <TagScroller hasMore={tagPages.hasMore} onNearEnd={() => void tagPages.more()} lead={selected.length}>
        {selected.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Clear tag filters" onPress={() => changeTags([])} style={styles.tagTarget}>
          <View style={[styles.tag, { borderStyle: 'dashed', borderColor: colors.line }]}><Text style={{ color: colors.faint, fontSize: 12 * colors.scale }}>clear</Text></View>
        </Pressable>}
        {selected.map((name) => tag(name, true, tags.find((item) => item.name === name)?.track_count))}
        {selected.length > 0 && <View testID="home-tags-divider" style={[styles.divider, { backgroundColor: colors.line }]} />}
        {tags.filter(({ name }) => !selected.includes(name) && !hiddenTags.includes(name)).map(({ name, track_count }) => tag(name, false, track_count))}
        {tagPages.hasMore && <Pressable accessibilityRole="button" accessibilityLabel="More tags" accessibilityState={{ busy: tagPages.loading, disabled: tagPages.loading }} disabled={tagPages.loading} onPress={() => void tagPages.more(true)} style={styles.tagTarget}>
          <Text style={{ color: colors.muted, fontSize: 12 * colors.scale }}>{tagPages.loading ? 'loading…' : 'more'}</Text>
        </Pressable>}
      </TagScroller>
    </View>}
    <Status error={tagPages.error} retry={tagPages.retry} />
  </>;
}

const styles = StyleSheet.create({
  tags: { minHeight: 44 },
  divider: { width: 1, height: 20, marginHorizontal: 4 },
  tagTarget: { minWidth: 44, minHeight: 44, maxWidth: '100%', justifyContent: 'center' },
  tag: { flexDirection: 'row', alignItems: 'center', minHeight: 28, borderRadius: 16, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 4 },
});
