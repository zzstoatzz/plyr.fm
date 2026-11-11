import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import type { NetworkArtist } from './home-api';
import { Cover, Heading, useColors } from './CatalogPieces';
import { Text } from './Text';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { PlayerControl } from './PlayerControl';

const placeholders = [0, 1, 2, 3, 4, 5, 6, 7];

export function HomeArtists({ artists, loading }: { artists: NetworkArtist[]; loading: boolean }) {
  const colors = useColors();
  const scroller = useRef<ScrollViewInstance>(null);
  const [view, setView] = useState({ width: 0, content: 0, offset: 0 });
  const item = 96 * colors.scale;
  const overflow = view.content > view.width + 1;
  const page = (direction: 1 | -1) => scroller.current?.scrollTo({ x: Math.max(0, view.offset + direction * view.width * 0.8), animated: !colors.reduceMotion });
  return <View testID="home-artists" style={styles.section}>
    <View style={styles.header}>
      <View style={{ flex: 1, minWidth: 0 }}><Heading>artists you know</Heading></View>
      {overflow && view.width >= 600 && <View style={{ flexDirection: 'row' }}>
        <PlayerControl icon={ChevronLeft} label="Previous artists you know" disabled={view.offset <= 0} onPress={() => page(-1)} />
        <PlayerControl icon={ChevronRight} label="Next artists you know" disabled={view.offset + view.width >= view.content - 1} onPress={() => page(1)} />
      </View>}
    </View>
    <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} scrollEnabled={!loading} contentContainerStyle={styles.artists}
      accessibilityState={{ busy: loading }} scrollEventThrottle={32}
      onLayout={event => { const { width } = event.nativeEvent.layout; setView(previous => ({ ...previous, width })); }}
      onContentSizeChange={content => setView(previous => ({ ...previous, content }))}
      onScroll={event => { const offset = event.nativeEvent.contentOffset.x; setView(previous => ({ ...previous, offset })); }}>
      {loading ? placeholders.map(index => <View key={index} style={[styles.artist, { width: item }]}>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.raised }} />
        <View style={{ width: item * 0.7, height: 10 * colors.scale, borderRadius: 5, backgroundColor: colors.raised }} />
      </View>) : artists.map(artist => <Link key={artist.did} href={{ pathname: '/u/[handle]', params: { handle: artist.handle || artist.did } }} asChild>
        <Pressable accessibilityRole="link" accessibilityLabel={artist.display_name || artist.handle} style={StyleSheet.flatten([styles.artist, { width: item }])}>
          <Cover uri={artist.avatar_url} size={48} round />
          <View style={{ minWidth: 0, maxWidth: '100%', alignItems: 'center', gap: 2 }}>
            <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13 * colors.scale }}>{artist.display_name || artist.handle}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 * colors.scale }}>{artist.track_count} {artist.track_count === 1 ? 'track' : 'tracks'}</Text>
          </View>
        </Pressable>
      </Link>)}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12 }, header: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }, artists: { gap: 16 },
  artist: { alignItems: 'center', gap: 8, minHeight: 96, minWidth: 44 },
});
