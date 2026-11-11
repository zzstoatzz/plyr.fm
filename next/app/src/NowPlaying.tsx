import { trackArtwork } from './artwork';
import { Text } from './Text';
import Slider from './Slider';
import type { Href } from 'expo-router';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ListMusic from 'lucide-react-native/icons/list-music';
import Pause from 'lucide-react-native/icons/pause';
import Play from 'lucide-react-native/icons/play';
import SkipBack from 'lucide-react-native/icons/skip-back';
import SkipForward from 'lucide-react-native/icons/skip-forward';
import X from 'lucide-react-native/icons/x';
import { useState } from 'react';
import { Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Track } from './api';
import { useAppearance } from './appearance';
import { Cover, artistName } from './CatalogPieces';
import { cardSurface } from './materials';
import { ShareLink } from './ShareLink';
import { TrackLikes } from './TrackLikes';
import { usePlayCount } from './use-play-count';
import { PlayerVolume } from './PlayerVolume';
import { PlayerSeek } from './PlayerSeek';
import { PlayerControl } from './PlayerControl';
import { usePlayback } from './playback';
import { usePlayerDismiss } from './use-player-dismiss';

const AnimatedSafeAreaView = Animated.createAnimatedComponent(SafeAreaView);
const touchHeader = { touchAction: 'none', cursor: 'auto' } as const;

function time(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function NowPlaying({ track, close: leave, navigate: go }: { track: Track; close: () => void; navigate: (target: Href) => void }) {
  const player = usePlayback();
  const theme = useAppearance();
  const { width, height } = useWindowDimensions();
  const [scrub, setScrub] = useState<{ id: string; seconds: number } | null>(null);
  const compact = width < 600;
  const dismiss = usePlayerDismiss(compact, width, height, leave, theme.reduceMotion);
  const close = () => dismiss.exit(leave);
  const navigate = (target: Href) => dismiss.exit(() => go(target));
  const scrollTouch = { touchAction: dismiss.directionalTouch && dismiss.atTop ? 'pan-x pan-down' : 'pan-x pan-y', cursor: 'auto' } as const;
  const sideBySide = width >= 800;
  const controlRoom = 370 + 64 * (theme.scale - 1);
  const artwork = sideBySide ? Math.max(160, Math.min(660, width * 0.48 - 56, height - 144))
    : Math.max(1, Math.min(width - 40, 372, Math.max(128, height - controlRoom)));
  const duration = player.status.duration || track.metadata.duration_seconds || 0;
  const position = Math.max(0, Math.min(duration, scrub?.id === track.id ? scrub.seconds : player.seekPreview ?? player.status.currentTime));
  const updateScrub = (seconds: number) => setScrub({ id: track.id, seconds });
  const playing = player.status.playing;
  const error = player.error || player.status.error;
  const caption = { color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale };
  const label = { color: theme.faint, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale, fontWeight: '600' } as const;
  const upcoming = player.queue.slice(player.index + 1, player.index + 4);
  const plays = usePlayCount(track.id, track.metrics.play_count);
  const likes = track.metrics.like_count;
  const added = new Date(track.metadata.created_at);
  const facts = [`${plays} ${plays === 1 ? 'play' : 'plays'}`, likes > 0 && `${likes} ${likes === 1 ? 'like' : 'likes'}`,
    !Number.isNaN(added.getTime()) && `added ${added.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).toLowerCase()}`].filter(Boolean).join(' · ');

  return <Modal visible transparent accessibilityLabel="Now playing" animationType="none" onRequestClose={close}>
    <View ref={dismiss.panelRef} style={styles.backdrop}>
      <AnimatedSafeAreaView {...dismiss.panHandlers} accessibilityViewIsModal={Platform.OS === 'web' ? undefined : true} edges={['top', 'bottom']}
        style={[{ transform: [{ translateY: dismiss.translation }] }, styles.panel, styles.full, { backgroundColor: theme.background }]}>
        <View style={styles.header}>
          {compact && <View {...dismiss.protect}><PlayerControl icon={ChevronDown} label="Close" onPress={close} /></View>}
          <View testID="now-playing-dismiss-region" style={[styles.dismissRegion, Platform.OS === 'web' && compact && touchHeader]}>
          <Text accessibilityRole="header"
            style={[styles.headerTitle, compact && styles.centerTitle,
              { color: theme.muted, fontSize: 14 * theme.scale, fontFamily: theme.fontFamily }]}>now playing</Text>
          </View>
          {compact ? <View style={styles.headerSpacer} /> : <View {...dismiss.protect}><PlayerControl icon={X} label="Close" onPress={close} /></View>}
        </View>
        <View {...dismiss.contentStartHandlers} style={styles.scrollRegion}>
          <ScrollView testID="now-playing-scroll" onScroll={dismiss.onScroll} scrollEventThrottle={16} scrollEnabled={!dismiss.dragging}
            style={Platform.OS === 'web' && compact ? scrollTouch : undefined} contentContainerStyle={[styles.content, sideBySide && styles.desktopContent]} alwaysBounceVertical={false}>
            <View testID="now-playing-artwork" style={styles.art}>
              <Cover uri={trackArtwork(track)} size={artwork} radius={16} />
            </View>
            <View style={[styles.body, sideBySide ? [styles.desktopBody, { maxWidth: 440 }] : { width: artwork }]}>
              <View style={styles.meta}>
                <Text testID="now-playing-title" accessibilityRole="header" accessibilityLabel={track.metadata.title} numberOfLines={2}
                  style={{ lineHeight: 30 * theme.scale, color: theme.text, fontFamily: theme.fontFamily,
                    fontSize: 25 * theme.scale, fontWeight: '800', letterSpacing: -0.4 }}>
                  {track.metadata.title}
                </Text>
                <View {...dismiss.protect} style={{ alignSelf: 'flex-start', maxWidth: '100%' }}><Pressable accessibilityRole="link" style={styles.artist} onPress={() => {
                  navigate(`/u/${encodeURIComponent(track.artist.profile.handle || track.artist.did)}`);
                }}>
                  <Text numberOfLines={1} style={{ ...caption, fontSize: 15 * theme.scale }}>{artistName(track)}</Text>
                </Pressable></View>
              </View>
              <View>
                <View {...dismiss.protect}><Slider accessibilityLabel="Playback position" minimumValue={0} maximumValue={duration || 1}
                  value={position} minimumTrackTintColor={theme.accent} maximumTrackTintColor={theme.border}
                  thumbTintColor={theme.accent} disabled={!player.canSeek || !duration || !!error}
                  onSlidingStart={updateScrub} onValueChange={updateScrub}
                  onSlidingComplete={(seconds) => { player.seek(seconds); setScrub(null); }} /></View>
                <View testID="now-playing-time" style={styles.time}>
                  <Text style={[caption, styles.numeric]}>{time(position)}</Text>
                  <Text accessibilityLiveRegion="polite" style={[caption, styles.status]}>
                    {error ? 'couldn’t play this track' : ''}
                  </Text>
                  <Text style={[caption, styles.numeric]}>{time(duration)}</Text>
                </View>
              </View>
              <View style={styles.transport}>
                <View {...dismiss.protect}><PlayerControl icon={SkipBack} label="Previous" onPress={player.previous} /></View>
                {sideBySide && <PlayerSeek />}
                <View {...dismiss.protect}><PlayerControl icon={playing ? Pause : Play} label={playing ? 'Pause' : 'Play'}
                  onPress={() => player.setPlaying(!playing)} primary large busy={player.loading} /></View>
                {sideBySide && <PlayerSeek forward />}
                <View {...dismiss.protect}><PlayerControl icon={SkipForward} label="Next" onPress={() => void player.next()} /></View>
              </View>
              <View style={styles.utilities}>
                <View {...dismiss.protect}><TrackLikes key={track.id} track={track} iconOnly returnTo="/now-playing" /></View>
                <View {...dismiss.protect}><ShareLink compact path={`/track/${encodeURIComponent(track.id)}`} /></View>
                <View {...dismiss.protect}><PlayerControl icon={ListMusic} label="Queue" onPress={() => navigate('/queue')} /></View>
              </View>
              {sideBySide && <View style={{ alignItems: 'center' }}><PlayerVolume /></View>}
              {upcoming.length > 0 && <View testID="now-playing-up-next" style={[styles.card, cardSurface(theme)]}>
                <View style={styles.cardHeader}>
                  <Text accessibilityRole="header" aria-level={2} style={label}>up next</Text>
                  <View {...dismiss.protect}><Pressable accessibilityRole="button" accessibilityLabel="Open queue" style={styles.cardLink} onPress={() => navigate('/queue')}>
                    <Text style={{ ...caption, color: theme.accent }}>open queue</Text>
                  </Pressable></View>
                </View>
                {upcoming.map((next, offset) => <View key={`${next.id}:${offset}`} {...dismiss.protect}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Play ${next.metadata.title} by ${artistName(next)}`}
                    onPress={() => player.jump(player.index + 1 + offset)} style={({ pressed }) => [styles.next, { opacity: pressed ? 0.65 : 1 }]}>
                    <Cover uri={trackArtwork(next)} size={40} />
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Text numberOfLines={1} style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale, fontWeight: '600' }}>{next.metadata.title}</Text>
                      <Text numberOfLines={1} style={caption}>{artistName(next)}</Text>
                    </View>
                  </Pressable>
                </View>)}
              </View>}
              <View testID="now-playing-about" style={[styles.card, cardSurface(theme)]}>
                <Text accessibilityRole="header" aria-level={2} style={label}>about this track</Text>
                {track.metadata.description ? <Text style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, lineHeight: 22 * theme.scale }}>{track.metadata.description}</Text> : null}
                {track.metadata.album ? <Text style={caption}>from {track.metadata.album}</Text> : null}
                <Text style={caption}>{facts}</Text>
                <View {...dismiss.protect} style={{ alignSelf: 'flex-start' }}><Pressable accessibilityRole="button" accessibilityLabel="Open track page" style={styles.cardLink}
                  onPress={() => navigate(`/track/${track.id}`)}>
                  <Text style={{ ...caption, color: theme.accent }}>open track page</Text>
                </Pressable></View>
              </View>
            </View>
          </ScrollView>
        </View>
      </AnimatedSafeAreaView>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  panel: { width: '100%' },
  full: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 50, paddingHorizontal: 20 },
  dismissRegion: { flex: 1, minHeight: 50, justifyContent: 'center' },
  headerTitle: { fontWeight: '600', textTransform: 'lowercase' },
  centerTitle: { textAlign: 'center' },
  headerSpacer: { width: 44 },
  scrollRegion: { flex: 1, minHeight: 0 },
  content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, gap: 20, alignItems: 'center' },
  desktopContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexGrow: 1, width: '100%', maxWidth: 1440, alignSelf: 'center', padding: 40, gap: 56 },
  art: { alignItems: 'center' },
  body: { gap: 16, minWidth: 0 },
  desktopBody: { flex: 1 },
  meta: { gap: 2 },
  artist: { alignSelf: 'flex-start', maxWidth: '100%', minHeight: 28, justifyContent: 'center' },
  time: { minHeight: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
  status: { flex: 1, textAlign: 'center' },
  numeric: { fontVariant: ['tabular-nums'] },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' },
  utilities: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  card: { padding: 16, gap: 10, borderRadius: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 24 },
  cardLink: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  next: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }
});
