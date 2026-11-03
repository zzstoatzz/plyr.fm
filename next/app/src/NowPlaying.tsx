import Slider from '@react-native-community/slider';
import { router } from 'expo-router';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import Info from 'lucide-react-native/icons/info';
import ListMusic from 'lucide-react-native/icons/list-music';
import Pause from 'lucide-react-native/icons/pause';
import Play from 'lucide-react-native/icons/play';
import SkipBack from 'lucide-react-native/icons/skip-back';
import SkipForward from 'lucide-react-native/icons/skip-forward';
import X from 'lucide-react-native/icons/x';
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
  const sideBySide = width >= 800;
  const panelWidth = sideBySide ? Math.min(width - 80, 748) : 420;
  const controlRoom = 370 + 64 * (theme.scale - 1);
  const artwork = sideBySide ? Math.min(310, Math.floor((panelWidth - 76) / 2))
    : Math.max(1, Math.min(width - 40, 372, Math.max(128, height - controlRoom)));
  const duration = player.status.duration || track.metadata.duration_seconds || 0;
  const position = Math.max(0, Math.min(duration, scrub?.id === track.id ? scrub.seconds : player.status.currentTime));
  const updateScrub = (seconds: number) => setScrub({ id: track.id, seconds });
  const playing = player.status.playing;
  const error = player.error || player.status.error;
  const caption = { color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale };

  return <Modal visible transparent={!compact} animationType="fade" onRequestClose={close}>
    <View style={[styles.backdrop, compact && { backgroundColor: theme.background }]}>
      {!compact && <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Dismiss now playing" onPress={close} />}
      <SafeAreaView accessibilityViewIsModal edges={compact ? ['top', 'bottom'] : []}
        style={[styles.panel, compact ? styles.full : [styles.floating, { maxWidth: panelWidth }], { backgroundColor: theme.background }]}>
        <View style={[styles.header, { borderColor: theme.surface }]}>
          {compact && <PlayerControl icon={ChevronDown} label="Close" onPress={close} />}
          <Text accessibilityRole="header"
            style={[styles.headerTitle, compact && styles.centerTitle,
              { color: theme.text, fontSize: 16 * theme.scale, fontFamily: theme.fontFamily }]}>Now playing</Text>
          {compact ? <View style={styles.headerSpacer} /> : <PlayerControl icon={X} label="Close" onPress={close} />}
        </View>
        <ScrollView contentContainerStyle={[styles.content, sideBySide && styles.desktopContent]} alwaysBounceVertical={false}>
          <View style={styles.art}>
            <Cover uri={track.media.artwork?.url} size={artwork} radius={16} />
          </View>
          <View style={[styles.body, sideBySide ? styles.desktopBody : { width: artwork }]}>
            <View style={styles.meta}>
              <Text accessibilityRole="header" accessibilityLabel={track.metadata.title} numberOfLines={2}
                style={{ lineHeight: 30 * theme.scale, color: theme.text, fontFamily: theme.fontFamily,
                  fontSize: 25 * theme.scale, fontWeight: '800', letterSpacing: -0.4 }}>
                {track.metadata.title}
              </Text>
              <Pressable accessibilityRole="link" style={styles.artist} onPress={() => {
                close();
                router.push({ pathname: '/u/[handle]', params: { handle: track.artist.profile.handle || track.artist.did } });
              }}>
                <Text numberOfLines={1} style={{ ...caption, fontSize: 15 * theme.scale }}>{artistName(track)}</Text>
              </Pressable>
            </View>
            <View>
              <Slider accessibilityLabel="Playback position" minimumValue={0} maximumValue={duration || 1}
                value={position} minimumTrackTintColor={theme.accent} maximumTrackTintColor={theme.surface}
                thumbTintColor={theme.accent} disabled={!duration || !!error}
                onSlidingStart={updateScrub} onValueChange={updateScrub}
                onSlidingComplete={(seconds) => { player.seek(seconds); setScrub(null); }} />
              <View style={styles.time}>
                <Text style={[caption, styles.numeric]}>{time(position)}</Text>
                <Text accessibilityLiveRegion="polite" style={[caption, styles.status]}>
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
            <View style={[styles.utilities, { borderColor: theme.surface }]}>
              <Pressable accessibilityRole="button" accessibilityLabel="Queue" style={styles.utility}
                onPress={() => { close(); router.push('/queue'); }}>
                <ListMusic size={18} color={theme.muted} /><Text style={caption}>Queue</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Track details" style={styles.utility}
                onPress={() => { close(); router.push(`/track/${track.id}`); }}>
                <Info size={18} color={theme.muted} /><Text style={caption}>Track details</Text>
              </Pressable>
            </View>
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
  floating: { maxHeight: '94%', borderRadius: 20, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 50, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { flex: 1, fontWeight: '700' },
  centerTitle: { textAlign: 'center' },
  headerSpacer: { width: 44 },
  content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, gap: 20, alignItems: 'center' },
  desktopContent: { flexDirection: 'row', alignItems: 'center', padding: 24, gap: 28 },
  art: { alignItems: 'center' },
  body: { gap: 16, minWidth: 0 },
  desktopBody: { flex: 1 },
  meta: { gap: 2 },
  artist: { alignSelf: 'flex-start', maxWidth: '100%', minHeight: 28, justifyContent: 'center' },
  time: { minHeight: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
  status: { flex: 1, textAlign: 'center' },
  numeric: { fontVariant: ['tabular-nums'] },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' },
  utilities: { flexDirection: 'row', justifyContent: 'space-around', gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  utility: { minHeight: 44, gap: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }
});
