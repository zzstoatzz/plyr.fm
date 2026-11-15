import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAppearance } from './appearance';
import { Heading, type Play } from './CatalogPieces';
import { FollowingTrack, PlayOneFromEach, useFollowingLatest } from './FollowingLatest';
import type { NetworkArtist } from './home-api';
import { HomeShelf } from './HomeShelf';
import { cardSurface } from './materials';

const placeholders = [0, 1, 2];

export function HomeArtists({ artists, loading, onPlay }: { artists: NetworkArtist[]; loading: boolean; onPlay: Play }) {
  const colors = useAppearance();
  const latest = useFollowingLatest(artists);
  const [now] = useState(() => Date.now());
  const busy = loading || latest.loading;
  if (!busy && !latest.tracks.length) return null;
  const width = 300 * colors.scale;
  return <HomeShelf testID="home-artists" label="new from people you follow" busy={busy}
    heading={<><Heading>new from people you follow</Heading><PlayOneFromEach tracks={latest.tracks} onPlay={onPlay} /></>}>
    {busy ? placeholders.map(index => <View key={index} style={[cardSurface(colors), styles.placeholder, { width }]}>
      <View style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: colors.raised }} />
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ width: '50%', height: 10, borderRadius: 5, backgroundColor: colors.raised }} />
        <View style={{ width: '80%', height: 12, borderRadius: 6, backgroundColor: colors.raised }} />
      </View>
    </View>) : latest.tracks.map(track => <FollowingTrack key={track.id} track={track} tracks={latest.tracks} onPlay={onPlay} now={now} width={width} />)}
  </HomeShelf>;
}

const styles = StyleSheet.create({
  placeholder: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14, height: 82 },
});
