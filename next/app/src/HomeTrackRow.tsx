import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ellipsis from 'lucide-react-native/icons/ellipsis';
import ListPlus from 'lucide-react-native/icons/list-plus';
import type { Track } from './api';
import { useAppearance } from './appearance';
import { artistName, Cover, type Play } from './CatalogPieces';
import { Text } from './Text';
import { TrackLikes } from './TrackLikes';
import { TrackMenu } from './TrackMenu';
import { PlayerControl } from './PlayerControl';
import { usePlayback } from './playback';

export function HomeTrackRow({ track, tracks, onPlay }: { track: Track; tracks: Track[]; onPlay: Play }) {
  const theme = useAppearance();
  return <View testID="home-track-row" style={[styles.row, { borderColor: theme.surface }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Play ${track.metadata.title}`} onPress={() => onPlay(track, tracks)}
      style={({ pressed }) => [StyleSheet.absoluteFill, { borderRadius: 10, backgroundColor: pressed ? theme.surface : 'transparent' }]} />
    <View pointerEvents="none"><Cover uri={track.media.artwork?.url} size={44} /></View>
    <View pointerEvents="box-none" style={styles.meta}>
      <Link href={`/track/${track.id}`} asChild><Pressable accessibilityRole="link" accessibilityLabel={`Track details: ${track.metadata.title}`} style={styles.link}><Text numberOfLines={1} style={{ color: theme.text, fontSize: 15 * theme.scale, fontWeight: '600' }}>{track.metadata.title}</Text></Pressable></Link>
      <Link href={`/u/${encodeURIComponent(track.artist.profile.handle || track.artist.did)}`} asChild><Pressable accessibilityRole="link" style={styles.link}><Text numberOfLines={1} style={{ color: theme.muted, fontSize: 13 * theme.scale }}>{artistName(track)}</Text></Pressable></Link>
    </View>
    <HomeTrackActions track={track} />
  </View>;
}

export function HomeTrackActions({ track }: { track: Track }) {
  const player = usePlayback();
  const [menu, setMenu] = useState(false);
  return <View style={styles.actions}>
    <TrackLikes track={track} buttonOnly returnTo="/" />
    <PlayerControl icon={ListPlus} label={`Add ${track.metadata.title} to queue`} onPress={() => player.enqueue(track)} />
    <PlayerControl icon={Ellipsis} label={`More options for ${track.metadata.title}`} onPress={() => setMenu(true)} />
    {menu && <TrackMenu track={track} close={() => setMenu(false)} />}
  </View>;
}

const styles = StyleSheet.create({
  row: { minHeight: 80, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  meta: { flex: 1, minWidth: 0 },
  link: { minHeight: 24, justifyContent: 'center', alignSelf: 'flex-start', maxWidth: '100%' },
  actions: { flexDirection: 'row', alignItems: 'center' }
});
