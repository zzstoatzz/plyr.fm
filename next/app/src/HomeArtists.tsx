import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import type { NetworkArtist } from './home-api';
import { Cover, Heading, useColors } from './CatalogPieces';
import { HomeShelf } from './HomeShelf';
import { cardSurface } from './materials';
import { Text } from './Text';

const placeholders = [0, 1, 2, 3];

export function HomeArtists({ artists, loading }: { artists: NetworkArtist[]; loading: boolean }) {
  const colors = useColors();
  const card = [cardSurface(colors), styles.card, { width: 176 * colors.scale }];
  const name = Math.ceil(14 * colors.scale * 1.3);
  const count = Math.ceil(12 * colors.scale * 1.3);
  return <HomeShelf testID="home-artists" label="artists you know" busy={loading} heading={<Heading>artists you know</Heading>}>
    {loading ? placeholders.map(index => <View key={index} style={card}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.raised }} />
      <View style={{ flex: 1, height: name + count + 1, justifyContent: 'center' }}><View style={{ width: '70%', height: 10 * colors.scale, borderRadius: 5, backgroundColor: colors.raised }} /></View>
    </View>) : artists.map(artist => <Link key={artist.did} href={{ pathname: '/u/[handle]', params: { handle: artist.handle || artist.did } }} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={artist.display_name || artist.handle} style={StyleSheet.flatten(card)}>
        <Cover uri={artist.avatar_url} size={40} round />
        <View style={styles.text}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14 * colors.scale, lineHeight: name, fontWeight: '600' }}>{artist.display_name || artist.handle}</Text>
          <Text numberOfLines={1} style={{ color: colors.faint, fontSize: 12 * colors.scale, lineHeight: count }}>{artist.track_count} {artist.track_count === 1 ? 'track' : 'tracks'}</Text>
        </View>
      </Pressable>
    </Link>)}
  </HomeShelf>;
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8 },
  text: { flex: 1, minWidth: 0, gap: 1 },
});
