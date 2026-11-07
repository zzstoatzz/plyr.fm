import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { NetworkArtist } from './home-api';
import { Cover, Heading, useColors } from './CatalogPieces';
import { Text } from './Text';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { PlayerControl } from './PlayerControl';

export function HomeArtists({ artists }: { artists: NetworkArtist[] }) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const gap = 16;
  const columns = Math.max(1, Math.min(6, Math.floor((width + gap) / (96 * colors.scale + gap))));
  const size = Math.max(1, (width - gap * (columns - 1)) / columns);
  const pageSize = columns * (width < 600 ? 2 : 1);
  const pages = Math.max(1, Math.ceil(artists.length / pageSize));
  const visiblePage = Math.min(page, pages - 1);
  useEffect(() => setPage(0), [columns]);
  return <View style={styles.section} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <View style={styles.header}>
      <View style={{ flex: 1, minWidth: 0 }}><Heading>artists you know</Heading></View>
      {pages > 1 && <View style={{ flexDirection: 'row' }}>
        <PlayerControl icon={ChevronLeft} label="Previous artists you know" disabled={visiblePage === 0} onPress={() => setPage(Math.max(0, visiblePage - 1))} />
        <PlayerControl icon={ChevronRight} label="Next artists you know" disabled={visiblePage === pages - 1} onPress={() => setPage(Math.min(pages - 1, visiblePage + 1))} />
      </View>}
    </View>
    {width > 0 && <View style={[styles.artists, { gap }]}>
      {artists.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize).map(artist => <Link key={artist.did} href={{ pathname: '/u/[handle]', params: { handle: artist.handle || artist.did } }} asChild>
        <Pressable accessibilityRole="link" accessibilityLabel={artist.display_name || artist.handle} style={[styles.artist, { width: size }]}>
          <Cover uri={artist.avatar_url} size={48} round />
          <View style={{ minWidth: 0, maxWidth: '100%', alignItems: 'center', gap: 2 }}>
            <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13 * colors.scale }}>{artist.display_name || artist.handle}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 * colors.scale }}>{artist.track_count} {artist.track_count === 1 ? 'track' : 'tracks'}</Text>
          </View>
        </Pressable>
      </Link>)}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12 }, header: { flexDirection: 'row', alignItems: 'center', gap: 8 }, artists: { flexDirection: 'row', flexWrap: 'wrap' },
  artist: { alignItems: 'center', gap: 8, minHeight: 88, minWidth: 44 },
});
