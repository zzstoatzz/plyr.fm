import { trackArtwork } from './artwork';
import { Text } from './Text';
import Slider from './Slider';
import { Link } from 'expo-router';
import Music from 'lucide-react-native/icons/eighth-note';
import Pause from 'lucide-react-native/icons/pause';
import Play from 'lucide-react-native/icons/play';
import RotateCcw from 'lucide-react-native/icons/rotate-ccw';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { Track } from './api';
import { useAppearance } from './appearance';
import { artistName } from './CatalogPieces';
import { usePlayback } from './playback';

function time(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

export function TrackEmbed({ track, adult }: { track: Track; adult: boolean }) {
  const player = usePlayback();
  const theme = useAppearance();
  const { width, height } = useWindowDimensions();
  const [scrub, setScrub] = useState<number | null>(null);
  const active = track.id === player.current?.id;
  const horizontal = height < 200 || width >= height * 1.7;
  const artworkWidth = height < 200 ? Math.min(height, width * 0.4) : height;
  const panelWidth = horizontal ? width - artworkWidth : width;
  const duration = (active && player.status.duration) || track.metadata.duration_seconds || 0;
  const position = active ? player.status.currentTime : 0;
  const busy = active && player.loading;
  const error = active && (player.error || player.status.error);
  const playing = active && player.status.playing;
  const Icon = error ? RotateCcw : playing ? Pause : Play;
  const foreground = horizontal ? theme.text : '#fff';
  const muted = horizontal ? theme.muted : '#e4e5e9';

  const play = <Pressable accessibilityRole="button"
    accessibilityLabel={adult ? 'Adult content hidden' : error ? 'Retry playback' : playing ? 'Pause' : 'Play'}
    accessibilityState={{ busy, disabled: adult || busy }} disabled={adult || busy}
    onPress={() => active ? player.setPlaying(!player.status.playing) : player.play(track)}
    style={({ pressed }) => ({ width: 48, height: 48, flexShrink: 0, borderRadius: 10,
      backgroundColor: 'rgba(10, 13, 20, 0.90)', alignItems: 'center', justifyContent: 'center',
      opacity: pressed || adult ? 0.65 : 1 })}>
    {busy ? <ActivityIndicator accessibilityLabel="Loading playback" color="#fff" /> : <Icon color="#fff" size={26} fill={playing || error ? 'none' : '#fff'} />}
  </Pressable>;

  const metadata = <View style={{ flex: 1, minWidth: 0, overflow: 'hidden', justifyContent: 'center', gap: 3 }}>
    <Link href={('/track/' + encodeURIComponent(track.id))} target="_blank" asChild>
      <Text numberOfLines={horizontal && height >= 160 ? 2 : 1}
        style={{ width: '100%', color: foreground, fontSize: horizontal && height >= 200 ? 21 : 15,
          lineHeight: horizontal && height >= 200 ? 27 : 20, fontWeight: '700' }}>{track.metadata.title}</Text>
    </Link>
    <Text numberOfLines={1} style={{ width: '100%', color: muted, fontSize: 12, lineHeight: 17 }}>
      {adult ? 'Adult content hidden' : error ? 'Couldn’t play this track. Try again.' : artistName(track)}
    </Text>
  </View>;

  const brand = <View style={{ width: 48, flexShrink: 0, overflow: 'hidden' }}>
    <Link href="/" target="_blank" asChild>
      <Text numberOfLines={1} style={{ color: foreground, fontSize: 11, lineHeight: 16, fontWeight: '700', textAlign: 'right' }}>plyr.fm</Text>
    </Link>
  </View>;

  const progress = active && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8,
    minHeight: 36, backgroundColor: theme.background }}>
    <Slider accessibilityLabel="Seek" style={{ flex: 1, width: 0, minWidth: 0, height: 32 }}
      minimumValue={0} maximumValue={duration || 1} value={scrub ?? player.seekPreview ?? position} disabled={!player.canSeek || !duration || busy || !!error}
      minimumTrackTintColor={theme.accent} maximumTrackTintColor={theme.border} thumbTintColor={theme.accent}
      onValueChange={setScrub} onSlidingComplete={seconds => { player.seek(seconds); setScrub(null); }} />
    {panelWidth >= 260 && <Text numberOfLines={1} style={{ flexShrink: 0, color: theme.muted, fontSize: 11,
      fontVariant: ['tabular-nums'] }}>{time(scrub ?? player.seekPreview ?? position)} / {time(duration)}</Text>}
  </View>;

  const artworkUrl = adult ? undefined : trackArtwork(track);
  const artwork = artworkUrl
    ? <Image source={{ uri: artworkUrl }} resizeMode="cover" style={StyleSheet.absoluteFill} />
    : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Music size={Math.min(64, width / 4)} color={theme.muted} />
    </View>;

  if (horizontal) return <View style={[styles.root, { backgroundColor: theme.background, flexDirection: 'row' }]}>
    <View style={{ width: artworkWidth, flexShrink: 0, backgroundColor: theme.surface, overflow: 'hidden' }}>
      {artwork}
      <View style={{ position: 'absolute', bottom: 8, left: 8 }}>{play}</View>
    </View>
    <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 12, paddingVertical: 8, gap: 4, overflow: 'hidden' }}>
      {progress}
      {metadata}
      {height >= 140 && <View style={{ alignItems: 'flex-end', paddingTop: 4 }}>{brand}</View>}
    </View>
  </View>;

  return <View style={[styles.root, { backgroundColor: theme.surface }]}>
    {artwork}
    {active && <View style={{ position: 'absolute', top: 0, right: 0, left: 0,
      paddingHorizontal: 12, paddingVertical: 4, backgroundColor: theme.background }}>{progress}</View>}
    <View style={{ position: 'absolute', left: 0, bottom: 0, right: 0, height: 72, flexDirection: 'row',
      alignItems: 'center', gap: 12, padding: 12, backgroundColor: 'rgba(10, 13, 20, 0.78)' }}>
      {play}
      {metadata}
      {width >= 340 && brand}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { width: '100%', height: '100%', minHeight: 88, overflow: 'hidden' },
});
