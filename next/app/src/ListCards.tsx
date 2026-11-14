import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ListSummary } from './api';
import { useAppearance } from './appearance';
import { collectionArtwork } from './artwork';
import { Cover, trackCount } from './CatalogPieces';
import { Text } from './Text';

/** Albums and playlists as a wrapping grid of covers, for wide screens. */
export function ListCards({ lists, includeEmpty = false, size = 176 }: { lists: ListSummary[]; includeEmpty?: boolean; size?: number }) {
  const theme = useAppearance();
  const shown = includeEmpty ? lists : lists.filter(list => list.metrics.available_count > 0);
  return <View style={styles.grid}>{shown.map(list => <Link key={list.id} asChild href={{ pathname: list.object === 'album' ? '/album/[id]' : '/playlist/[id]', params: { id: list.id } }}>
    <Pressable accessibilityRole="link" accessibilityLabel={list.metadata.name ?? 'untitled'} style={StyleSheet.flatten([styles.card, { width: size }])}>
      <Cover uri={collectionArtwork(list)} size={size} radius={10} />
      <Text numberOfLines={1} style={{ marginTop: 6, color: theme.text, fontFamily: theme.fontFamily, fontSize: 14.5 * theme.scale, fontWeight: '600' }}>{list.metadata.name ?? 'untitled'}</Text>
      <Text numberOfLines={1} style={{ color: theme.faint, fontFamily: theme.fontFamily, fontSize: 12.5 * theme.scale }}>{list.metrics.available_count > 0 ? trackCount(list.metrics.available_count) : 'no playable tracks'}</Text>
    </Pressable>
  </Link>)}</View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  card: { gap: 2 },
});
