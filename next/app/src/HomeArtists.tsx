import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useAppearance } from './appearance';
import { Heading, type Play } from './CatalogPieces';
import { FollowingTrack, followingLabel, PlayOneFromEach, useFollowingLatest } from './FollowingLatest';
import type { NetworkArtist } from './home-api';
import { HomeShelf } from './HomeShelf';
import { cardSurface } from './materials';

const placeholders = [0, 1, 2];

export function HomeArtists({ artists, loading, onPlay }: { artists: NetworkArtist[]; loading: boolean; onPlay: Play }) {
  const colors = useAppearance();
  const { width: screen } = useWindowDimensions();
  const latest = useFollowingLatest(artists);
  const [now] = useState(() => Date.now());
  const busy = loading || latest.loading;
  if (!busy && !latest.tracks.length) return null;
  // most of a phone's width, so the next card peeks in and says the row scrolls
  const width = Math.min(280 * colors.scale, Math.round((screen - 40) * 0.84));
  const line = Math.ceil(14 * colors.scale * 1.3) + Math.ceil(12 * colors.scale * 1.3) + 1;
  return <HomeShelf testID="home-artists" label={followingLabel} busy={busy} snap={width + 8}
    heading={<><View style={styles.title}><Heading>{followingLabel}</Heading></View><PlayOneFromEach tracks={latest.tracks} onPlay={onPlay} compact={screen < 600} /></>}>
    {busy ? placeholders.map(index => <View key={index} accessibilityRole={index ? undefined : 'progressbar'} accessibilityLabel={index ? undefined : `loading ${followingLabel}`}
      style={[cardSurface(colors), styles.placeholder, { width }]}>
      <View style={{ width: 48, height: 48, borderRadius: 6, backgroundColor: colors.raised }} />
      <View style={{ flex: 1, height: line, justifyContent: 'center', gap: 6 }}>
        <View style={{ width: '75%', height: 10 * colors.scale, borderRadius: 5, backgroundColor: colors.raised }} />
        <View style={{ width: '45%', height: 8 * colors.scale, borderRadius: 4, backgroundColor: colors.raised }} />
      </View>
    </View>) : latest.tracks.map(track => <FollowingTrack key={track.id} track={track} tracks={latest.tracks} onPlay={onPlay} now={now} width={width} />)}
  </HomeShelf>;
}

const styles = StyleSheet.create({
  title: { flex: 1, minWidth: 0 },
  placeholder: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8 },
});
