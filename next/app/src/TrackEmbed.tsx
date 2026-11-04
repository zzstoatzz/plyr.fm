import Slider from '@react-native-community/slider';
import { Link } from 'expo-router';
import Music from 'lucide-react-native/icons/eighth-note';
import Pause from 'lucide-react-native/icons/pause';
import Play from 'lucide-react-native/icons/play';
import RotateCcw from 'lucide-react-native/icons/rotate-ccw';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
  const started = active;
  const compact = height < 200;
  const artworkWidth = compact ? Math.min(height, width * 0.38) : width;
  const duration = (active && player.status.duration) || track.metadata.duration_seconds || 0;
  const position = active ? player.status.currentTime : 0;
  const busy = active && player.loading;
  const error = active && (player.error || player.status.error);
  const playing = active && player.status.playing;
  const Icon = error ? RotateCcw : playing ? Pause : Play;
  const title = { color: compact ? theme.text : '#fff', fontSize: 15, fontWeight: '700' as const };
  const secondary = { color: compact ? theme.muted : '#e4e5e9', fontSize: 12 };
  return <View style={{ width: '100%', height: '100%', minHeight: 88, overflow: 'hidden', backgroundColor: theme.background }}>
    <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: artworkWidth, backgroundColor: theme.surface }}>
      {!adult && track.media.artwork?.url
        ? <Image source={{ uri: track.media.artwork.url }} resizeMode="cover" style={StyleSheet.absoluteFill} />
        : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Music size={Math.min(64, artworkWidth / 3)} color={theme.muted} /></View>}
    </View>
    {started && <View style={{ position: 'absolute', top: 0, right: 0, left: compact ? artworkWidth : 0,
      paddingHorizontal: 12, paddingTop: 8, paddingBottom: 5, backgroundColor: theme.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Slider accessibilityLabel="Seek" style={{ flex: 1, height: 32 }} minimumValue={0} maximumValue={duration || 1}
          value={scrub ?? position} disabled={!duration || busy || !!error}
          minimumTrackTintColor={theme.accent} maximumTrackTintColor={theme.surface} thumbTintColor={theme.accent}
          onValueChange={setScrub} onSlidingComplete={seconds => { player.seek(seconds); setScrub(null); }} />
        {width >= 280 && <Text style={{ color: theme.muted, fontSize: 11, fontVariant: ['tabular-nums'] }}>{time(scrub ?? position)} / {time(duration)}</Text>}
      </View>
    </View>}
    <View style={{ position: 'absolute', left: 0, bottom: 0, right: 0, minHeight: compact ? 60 : 72,
      flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12,
      backgroundColor: compact ? 'transparent' : 'rgba(10, 13, 20, 0.78)' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={adult ? 'Adult content hidden' : error ? 'Retry playback' : playing ? 'Pause' : 'Play'}
        accessibilityState={{ busy, disabled: adult || busy }} disabled={adult || busy}
        onPress={() => active ? player.toggle() : player.play(track)}
        style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 10, backgroundColor: 'rgba(10, 13, 20, 0.90)',
          alignItems: 'center', justifyContent: 'center', opacity: pressed || adult ? 0.65 : 1 })}>
        {busy ? <ActivityIndicator color="#fff" /> : <Icon color="#fff" size={26} fill={playing || error ? 'none' : '#fff'} />}
      </Pressable>
      <View style={{ flex: 1, minWidth: 0, marginLeft: compact ? Math.max(0, artworkWidth - 72) : 0 }}>
        <Link href={('/track/' + encodeURIComponent(track.id))} target="_blank" asChild>
          <Text numberOfLines={1} style={title}>{track.metadata.title}</Text>
        </Link>
        <Text numberOfLines={1} style={secondary}>{adult ? 'Adult content hidden' : error ? 'Couldn’t play this track. Try again.' : artistName(track)}</Text>
      </View>
      {width >= 340 && !compact && <Link href="/" target="_blank" style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>plyr.fm</Link>}
    </View>
  </View>;
}
