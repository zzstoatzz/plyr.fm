import Slider from '@react-native-community/slider';
import { Link, router } from 'expo-router';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import Info from 'lucide-react-native/icons/info';
import ListMusic from 'lucide-react-native/icons/list-music';
import Pause from 'lucide-react-native/icons/pause';
import Play from 'lucide-react-native/icons/play';
import SkipBack from 'lucide-react-native/icons/skip-back';
import SkipForward from 'lucide-react-native/icons/skip-forward';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Track } from './api';
import { useAppearance } from './appearance';
import { Cover, artistName } from './CatalogPieces';
import { PlayerControl } from './PlayerControl';
import { usePlayback } from './playback';

function time(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function NowPlaying({ track, close }: { track: Track; close: () => void }) {
  const player = usePlayback();
  const theme = useAppearance();
  const { width, height } = useWindowDimensions();
  const [scrub, setScrub] = useState<{ id: string; seconds: number } | null>(null);
  const compact = width < 600;
  const artwork = Math.min(width - 48, 340, Math.max(128, height - 400));
  const duration = player.status.duration || track.metadata.duration_seconds || 0;
  const position = Math.max(0, Math.min(duration, scrub?.id === track.id ? scrub.seconds : player.status.currentTime));
  const updateScrub = (seconds: number) => setScrub({ id: track.id, seconds });
  const playing = player.status.playing;
  const error = player.error || player.status.error;
  const titleLineHeight = 29 * theme.scale;
  const caption = { color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale };

  return <Modal visible transparent={!compact} animationType="fade" onRequestClose={close}>
    <View style={[styles.backdrop, compact && { backgroundColor: theme.background }]}>
      {!compact && <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Dismiss now playing" onPress={close} />}
      <SafeAreaView accessibilityViewIsModal edges={compact ? ['top', 'bottom'] : []}
        style={[styles.panel, compact ? styles.full : styles.floating, { backgroundColor: theme.background }]}>
        <View style={styles.header}>
          <PlayerControl icon={ChevronDown} label="Close" onPress={close} />
          <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 15 * theme.scale, fontFamily: theme.fontFamily, fontWeight: '700' }}>Now playing</Text>
          <View style={styles.headerSpacer} />
        </View>
        <ScrollView contentContainerStyle={styles.content} alwaysBounceVertical={false}>
          <View style={styles.art}><Cover uri={track.media.artwork?.url} size={artwork} /></View>
          <View style={styles.meta}>
            <Text accessibilityRole="header" accessibilityLabel={track.metadata.title} numberOfLines={2}
              style={{ height: titleLineHeight * 2, lineHeight: titleLineHeight, color: theme.text,
                fontFamily: theme.fontFamily, fontSize: 24 * theme.scale, fontWeight: '700' }}>
              {track.metadata.title}
            </Text>
            <Link href={{ pathname: '/u/[handle]', params: { handle: track.artist.profile.handle || track.artist.did } }} onPress={close}>
              <Text numberOfLines={1} style={{ ...caption, fontSize: 15 * theme.scale, color: theme.accent }}>{artistName(track)}</Text>
            </Link>
          </View>
          <View>
            <Slider accessibilityLabel="Playback position" minimumValue={0} maximumValue={duration || 1}
              value={position} minimumTrackTintColor={theme.accent} disabled={!duration || !!error}
              onSlidingStart={updateScrub} onValueChange={updateScrub}
              onSlidingComplete={(seconds) => { player.seek(seconds); setScrub(null); }} />
            <View style={styles.time}>
              <Text style={[caption, styles.numeric]}>{time(position)}</Text>
              <Text accessibilityLiveRegion="polite" style={caption}>
                {error ? 'Couldn’t play this track' : player.loading ? 'Loading…' : ''}
              </Text>
              <Text style={[caption, styles.numeric]}>{time(duration)}</Text>
            </View>
          </View>
          <View style={styles.transport}>
            <PlayerControl icon={SkipBack} label="Previous" onPress={player.previous} />
            <PlayerControl icon={playing ? Pause : Play} label={playing ? 'Pause' : 'Play'}
              onPress={player.toggle} primary large busy={player.loading} />
            <PlayerControl icon={SkipForward} label="Next" onPress={() => void player.next()} />
          </View>
          <View style={styles.utilities}>
            <Pressable accessibilityRole="button" accessibilityLabel="Queue" style={styles.utility}
              onPress={() => { close(); router.push('/queue'); }}>
              <ListMusic size={20} color={theme.muted} /><Text style={caption}>Queue</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Track details" style={styles.utility}
              onPress={() => { close(); router.push(`/track/${track.id}`); }}>
              <Info size={20} color={theme.muted} /><Text style={caption}>Track</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0009' },
  panel: { width: '100%' },
  full: { flex: 1 },
  floating: { maxWidth: 440, maxHeight: '94%', borderRadius: 20, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  headerSpacer: { width: 44 },
  content: { paddingHorizontal: 24, paddingTop: 14, paddingBottom: 12, gap: 16 },
  art: { alignItems: 'center' },
  meta: { gap: 2 },
  time: { minHeight: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  numeric: { fontVariant: ['tabular-nums'] },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' },
  utilities: { flexDirection: 'row', justifyContent: 'center', gap: 24 },
  utility: { minWidth: 84, minHeight: 44, gap: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }
});
