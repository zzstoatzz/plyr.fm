import { trackArtwork } from './artwork';
import { Text } from './Text';
import Slider from './Slider';
import type { Href } from 'expo-router';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ListMusic from 'lucide-react-native/icons/list-music';
import RadioTower from 'lucide-react-native/icons/radio';
import { NextGlyph as SkipForward, PauseGlyph as Pause, PlayGlyph as Play, PreviousGlyph as SkipBack } from './PlayerGlyph';
import X from 'lucide-react-native/icons/x';
import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions, type ScrollViewInstance, type ViewInstance } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Track } from './api';
import { useAppearance } from './appearance';
import { Cover, artistName } from './CatalogPieces';
import { ShareLink } from './ShareLink';
import { TrackLikes } from './TrackLikes';
import { usePlayCount } from './use-play-count';
import { PlayerVolume } from './PlayerVolume';
import { PlayerSeek } from './PlayerSeek';
import { PlayerControl } from './PlayerControl';
import { usePlayback } from './playback';
import { usePlayerDismiss } from './use-player-dismiss';
import { PullDetector, PullRoot, usePlayerPull } from './player-pull';
import { PlayerFlight } from './PlayerFlight';
import { NowPlayingDetails } from './NowPlayingDetails';
import { measure, playerSheet, setFlying, type Rect } from './player-sheet';

const AnimatedSafeAreaView = Animated.createAnimatedComponent(SafeAreaView);
const touchHeader = { touchAction: 'none', cursor: 'auto' } as const;

function time(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function NowPlaying({ track, close: leave, navigate: go, overlay = false, present = true }: {
  track: Track; close: () => void; navigate: (target: Href) => void; overlay?: boolean; present?: boolean;
}) {
  const player = usePlayback();
  const theme = useAppearance();
  const { width, height } = useWindowDimensions();
  const [scrub, setScrub] = useState<{ id: string; seconds: number } | null>(null);
  const compact = width < 600;
  const morph = compact && !theme.reduceMotion && playerSheet.dockTop !== undefined;
  const rest = morph ? playerSheet.dockTop! : height;
  const depart = (then: () => void) => () => { setFlying(false); then(); };
  // The native Modal lays its views out a moment after this renders (safe-area insets included). The open waits until it is
  // on screen and the morph has measured where the artwork and title land, so the flight starts at the dock.
  const [shown, setShown] = useState(overlay);
  const insets = useSafeAreaInsets();
  // Native pads with the provider's insets: a SafeAreaView inside the Modal applies its own only after layout, after the morph measures.
  const inset = Platform.OS === 'web' ? undefined : { paddingTop: insets.top, paddingBottom: insets.bottom };
  const [measured, setMeasured] = useState(overlay || !morph);
  const dismiss = usePlayerDismiss(compact, width, height, depart(leave), theme.reduceMotion, rest, present && shown && measured);
  const pull = usePlayerPull(compact && shown && measured, dismiss.pull);
  const close = () => dismiss.exit(depart(leave));
  const navigate = (target: Href) => {
    if (!overlay) { setFlying(false); go(target); return; }
    go(target);
    dismiss.exit(depart(() => playerSheet.hide()));
  };
  const backdrop = useRef<ViewInstance | null>(null);
  const panelRef = useRef<ViewInstance>(null);
  const artRef = useRef<ViewInstance>(null);
  const titleRef = useRef<ViewInstance>(null);
  const art = trackArtwork(track);
  const [settledArt, setSettledArt] = useState<string>();
  const [rects, setRects] = useState<Record<'art' | 'title', { from: Rect; to: Rect }>>();
  const scrollTouch = { touchAction: dismiss.directionalTouch && dismiss.atTop ? 'pan-x pan-down' : 'pan-x pan-y', cursor: 'auto' } as const;
  const sideBySide = width >= 800;
  const controlRoom = 370 + 64 * (theme.scale - 1);
  const artwork = sideBySide ? Math.max(160, Math.min(660, width * 0.48 - 56, height - 144))
    : Math.max(1, Math.min(width - 40, 372, Math.max(128, height - controlRoom)));
  const duration = player.status.duration || track.metadata.duration_seconds || 0;
  const position = Math.max(0, Math.min(duration, scrub?.id === track.id ? scrub.seconds : player.seekPreview ?? player.status.currentTime));
  const updateScrub = (seconds: number) => setScrub({ id: track.id, seconds });
  const playing = player.status.playing;
  useEffect(() => {
    if (!morph) { setRects(undefined); setMeasured(true); return; }
    if (!shown) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => void (async () => {
      const [base, panel, art, title, dockArt, dockTitle] = await Promise.all([measure(backdrop.current), measure(panelRef.current), measure(artRef.current),
        measure(titleRef.current), measure(playerSheet.dock.art), measure(playerSheet.dock.title)]);
      if (cancelled) return;
      setMeasured(true);
      if (!base || !panel || !art || !title || !dockArt || !dockTitle) return;
      const lifted = 0.6 * Math.min(rest, playerSheet.value);
      const open = (rect: Rect) => ({ ...rect, x: rect.x - panel.x, y: rect.y - panel.y + lifted });
      const docked = (rect: Rect) => ({ ...rect, x: rect.x - base.x, y: rect.y - base.y - rest });
      setRects({ art: { from: docked(dockArt), to: open(art) }, title: { from: docked(dockTitle), to: open(title) } });
    })());
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [morph, present, shown, track.id, track.metadata.title, width, height, theme.scale, artwork]);
  const flights = morph && present && rects && dismiss.atTop ? rects : undefined;
  const scroller = useRef<ScrollViewInstance>(null);
  useEffect(() => { if (overlay && present) scroller.current?.scrollTo({ y: 0, animated: false }); }, [overlay, present]);
  const [condensed, setCondensed] = useState(false);
  const titleEnd = useRef({ body: 0, meta: 0 });
  const condense = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(condense, { toValue: condensed ? 1 : 0, duration: theme.reduceMotion ? 0 : 160, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [condensed, condense, theme.reduceMotion]);
  useEffect(() => { if (!present) setCondensed(false); }, [present]);
  const closeRef = useRef(() => {});
  useEffect(() => {
    if (!overlay || !present || Platform.OS !== 'web') return;
    const dialog = backdrop.current as unknown as HTMLElement | null;
    const root = document.getElementById('root');
    const focusable = () => dialog ? [...dialog.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])')]
      .filter(node => !node.hasAttribute('disabled') && node.getAttribute('aria-disabled') !== 'true' && !node.closest('[aria-hidden="true"]') && node.getClientRects().length > 0) : [];
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { closeRef.current(); return; }
      if (event.key !== 'Tab' || !dialog) return;
      const items = focusable();
      if (!items.length) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      if (at === -1 || event.shiftKey && at === 0 || !event.shiftKey && at === items.length - 1) {
        event.preventDefault();
        items[event.shiftKey ? items.length - 1 : 0].focus();
      }
    };
    window.addEventListener('keydown', keys);
    root?.setAttribute('aria-hidden', 'true');
    if (dialog && !dialog.contains(document.activeElement)) (document.activeElement as HTMLElement | null)?.blur();
    return () => { window.removeEventListener('keydown', keys); root?.removeAttribute('aria-hidden'); };
  }, [overlay, present]);
  useEffect(() => { setFlying(!!flights); }, [!!flights]);
  useEffect(() => () => setFlying(false), []);
  // The flights and the resting art/title swap on the native thread as the sheet leaves its open position; both stay mounted so no image reloads mid-morph.
  // Once open and still, the open state is plain styles: the flight hides and the resting art and title show in one commit,
  // instead of crossfading through the spring's last point of travel. Motion resumes in the same commit.
  const still = dismiss.resting;
  const departed = (open: number, away: number) => still ? open
    : playerSheet.translation.interpolate({ inputRange: [0, 1], outputRange: [open, away], extrapolate: 'clamp' });
  const carried = flights ? { opacity: departed(1, 0) } : undefined;
  // The resting art loads its own large rendition and fades in; until it has, the flight keeps covering it at the open position.
  // Handing off earlier showed the empty frame for a beat right after the morph landed, on any track whose large art was not cached.
  const artShown = !art || settledArt === art;
  const artCarried = flights ? { opacity: artShown ? departed(1, 0) : 0 } : undefined;
  const fade = (open: number, docked: number, from: number, to: number) => morph && !still
    ? playerSheet.translation.interpolate({ inputRange: [rest * from, rest * to], outputRange: [open, docked], extrapolate: 'clamp' }) : open;
  const settle = (progress: number) => { const k = Math.min(1, progress / 0.4); return k * k * (3 - 2 * k); };
  const artLeft = (progress: number) => {
    if (!flights) return 0;
    const { from, to } = flights.art;
    const small = from.height / to.height;
    const centered = (width - to.width * (small + (1 - small) * progress)) / 2;
    return from.x + (centered - from.x) * settle(progress);
  };
  const titleLeft = (progress: number) => {
    if (!flights) return 0;
    const { from, to } = flights.title;
    return from.x + (artLeft(progress) + to.x - flights.art.to.x - from.x) * settle(progress);
  };
  const titleStyle = { lineHeight: 30 * theme.scale, color: theme.text, fontFamily: theme.fontFamily, fontSize: 25 * theme.scale, fontWeight: '800', letterSpacing: -0.4 } as const;
  const error = player.error || player.status.error;
  const caption = { color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale };
  const plays = usePlayCount(track.id, track.metrics.play_count);

  closeRef.current = close;
  dismiss.scrolled.current = event => {
    const past = titleEnd.current.meta > 0 && event.nativeEvent.contentOffset.y > titleEnd.current.body + titleEnd.current.meta;
    if (past !== condensed) setCondensed(past);
  };
  const sheet = <View ref={node => { backdrop.current = node; dismiss.panelRef(node); }} style={overlay ? [styles.backdrop, styles.overlay, !present && styles.hidden] : styles.backdrop}
      {...(overlay ? { role: 'dialog' as const, 'aria-modal': true, 'aria-label': 'Now playing' } : {})}>
      <PullDetector gesture={pull.pan}><AnimatedSafeAreaView {...dismiss.panHandlers} {...dismiss.panelStartHandlers} accessibilityViewIsModal={Platform.OS === 'web' ? undefined : true} edges={Platform.OS === 'web' ? ['top', 'bottom'] : []}
        style={[{ transform: [{ translateY: dismiss.translation }] }, styles.panel, styles.full, inset]}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: theme.background, opacity: fade(1, 0, 0.85, 1) }]} />
        <Animated.View style={[styles.full, { opacity: fade(1, 0, 0, 0.5) }]}>
        <View style={[styles.header, condensed && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.line }]}>
          {compact && <View {...dismiss.protect}><PlayerControl icon={ChevronDown} label="Close" onPress={close} /></View>}
          <View testID="now-playing-dismiss-region" style={[styles.dismissRegion, Platform.OS === 'web' && compact && touchHeader]}>
          <Animated.View style={{ opacity: condense.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}><Text accessibilityRole="header"
            style={[styles.headerTitle, compact && styles.centerTitle,
              { color: theme.muted, fontSize: 14 * theme.scale, fontFamily: theme.fontFamily }]}>{player.live ? `${player.live.station.label} radio · live` : 'now playing'}</Text></Animated.View>
          <Animated.View testID="now-playing-condensed" pointerEvents="none" aria-hidden={!condensed} style={[StyleSheet.absoluteFill, styles.condensed, { opacity: condense }]}>
            <Cover instant uri={art} size={36} radius={6} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, fontWeight: '700' }}>{track.metadata.title}</Text>
              <Text numberOfLines={1} style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 12 * theme.scale }}>{artistName(track)}</Text>
            </View>
          </Animated.View>
          </View>
          {compact ? <Animated.View {...dismiss.protect} pointerEvents={condensed ? 'auto' : 'none'} aria-hidden={!condensed} style={{ opacity: condense }}>
            <PlayerControl primary icon={playing ? Pause : Play} label={playing ? 'Pause' : 'Play'} onPress={() => player.setPlaying(!playing)} busy={player.loading} />
          </Animated.View> : <View {...dismiss.protect}><PlayerControl icon={X} label="Close" onPress={close} /></View>}
        </View>
        <Animated.View {...dismiss.contentStartHandlers} style={[styles.scrollRegion, { transform: [{ translateY: morph ? fade(0, -0.6 * rest, 0, 1) : 0 }] }]}>
          <PullDetector gesture={pull.scroll}><Animated.ScrollView ref={scroller} testID="now-playing-scroll" {...dismiss.scrollProps} scrollEventThrottle={16} scrollEnabled={!dismiss.dragging}
            style={Platform.OS === 'web' && compact ? scrollTouch : undefined} contentContainerStyle={[styles.content, sideBySide && styles.desktopContent]}>
            <Animated.View testID="now-playing-artwork" style={[styles.art, artCarried]}>
              <View ref={artRef}><Cover uri={art} size={artwork} radius={16} onSettle={() => setSettledArt(art)} /></View>
            </Animated.View>
            <View onLayout={event => { titleEnd.current.body = sideBySide ? 0 : event.nativeEvent.layout.y; }} style={[styles.body, sideBySide ? [styles.desktopBody, { maxWidth: 440 }] : { width: artwork }]}>
              <View onLayout={event => { titleEnd.current.meta = event.nativeEvent.layout.y + event.nativeEvent.layout.height; }} style={styles.meta}>
                <Animated.View ref={titleRef} style={carried}><Text testID="now-playing-title" accessibilityRole="header" accessibilityLabel={track.metadata.title} numberOfLines={2} style={titleStyle}>
                  {track.metadata.title}
                </Text></Animated.View>
                <View {...dismiss.protect} style={{ alignSelf: 'flex-start', maxWidth: '100%' }}><Pressable accessibilityRole="link" style={styles.artist} onPress={() => {
                  navigate(`/u/${encodeURIComponent(track.artist.profile.handle || track.artist.did)}`);
                }}>
                  <Text numberOfLines={1} style={{ ...caption, fontSize: 15 * theme.scale }}>{artistName(track)}</Text>
                </Pressable></View>
              </View>
              <View>
                {player.live ? <View testID="now-playing-live-progress" accessibilityRole="progressbar" accessibilityLabel="Song progress"
                  aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(position)} style={[styles.liveTrack, { backgroundColor: theme.line }]}>
                  <View style={[styles.liveFill, { backgroundColor: theme.accent, width: `${duration ? Math.min(100, position / duration * 100) : 0}%` }]} />
                </View> : <View {...dismiss.protectSlider}><Slider accessibilityLabel="Playback position" minimumValue={0} maximumValue={duration || 1}
                  value={position} minimumTrackTintColor={theme.accent} maximumTrackTintColor={theme.border}
                  thumbTintColor={theme.accent} disabled={!player.canSeek || !duration || !!error}
                  onSlidingStart={updateScrub} onValueChange={updateScrub}
                  onSlidingComplete={(seconds) => { player.seek(seconds); setScrub(null); }} /></View>}
                <View testID="now-playing-time" style={styles.time}>
                  <Text style={[caption, styles.numeric]}>{time(position)}</Text>
                  <Text accessibilityLiveRegion="polite" style={[caption, styles.status]}>
                    {error ? 'couldn’t play this track' : ''}
                  </Text>
                  <Text style={[caption, styles.numeric]}>{time(duration)}</Text>
                </View>
              </View>
              <View style={styles.transport}>
                {!player.live && <View {...dismiss.protect}><PlayerControl large icon={SkipBack} label="Previous" onPress={player.previous} /></View>}
                {sideBySide && !player.live && <PlayerSeek />}
                <View {...dismiss.protect}><PlayerControl icon={playing ? Pause : Play} label={playing ? 'Pause' : 'Play'}
                  onPress={() => player.setPlaying(!playing)} primary large busy={player.loading} /></View>
                {sideBySide && !player.live && <PlayerSeek forward />}
                {!player.live && <View {...dismiss.protect}><PlayerControl large icon={SkipForward} label="Next" onPress={() => void player.next()} /></View>}
              </View>
              <View style={styles.utilities}>
                {!player.privatePlayback && <View {...dismiss.protect}><TrackLikes key={track.id} track={track} iconOnly returnTo="/now-playing" /></View>}
                {!player.privatePlayback && <View {...dismiss.protect}><ShareLink compact path={`/track/${encodeURIComponent(track.id)}`} /></View>}
                <View {...dismiss.protect}>{player.live ? <PlayerControl icon={RadioTower} label="Stations" onPress={() => navigate('/radio')} />
                  : <PlayerControl icon={ListMusic} label="Queue" onPress={() => navigate('/queue')} />}</View>
              </View>
              {sideBySide && <View style={{ alignItems: 'center' }}><PlayerVolume /></View>}
              <NowPlayingDetails track={track} plays={plays} protect={dismiss.protect} navigate={navigate} />
            </View>
          </Animated.ScrollView></PullDetector>
        </Animated.View>
        </Animated.View>
        <View ref={panelRef} pointerEvents="none" aria-hidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
          {flights && <View testID="now-playing-flights" style={StyleSheet.absoluteFill}>
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: artShown ? departed(0, 1) : 1 }]}>
              <PlayerFlight testID="now-playing-flight-art" {...flights.art} rest={rest} left={artLeft} origin={<Cover instant uri={art} size={flights.art.from.width} radius={6} />}>
                <Cover instant uri={art} size={flights.art.to.width} radius={16} />
              </PlayerFlight>
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: departed(0, 1) }]}><PlayerFlight testID="now-playing-flight-title" {...flights.title} rest={rest} left={titleLeft} originFade={[0.05, 0.25]} fade={[0.6, 0.8]}
              origin={<Text numberOfLines={1} style={{ color: theme.text, fontSize: 14 * theme.scale, fontWeight: '700' }}>{track.metadata.title}</Text>}>
              <Text numberOfLines={2} style={titleStyle}>{track.metadata.title}</Text>
            </PlayerFlight></Animated.View>
          </View>}
        </View>
      </AnimatedSafeAreaView></PullDetector>
    </View>;
  return overlay ? sheet : <Modal visible transparent accessibilityLabel="Now playing" animationType="none" onShow={() => { requestAnimationFrame(() => setShown(true)); }} onRequestClose={close}><PullRoot>{sheet}</PullRoot></Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  overlay: { position: 'fixed' as 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 9999 },
  hidden: { display: 'none' },
  panel: { width: '100%' },
  full: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 50, paddingHorizontal: 20 },
  dismissRegion: { flex: 1, minHeight: 50, justifyContent: 'center' },
  headerTitle: { fontWeight: '600', textTransform: 'lowercase' },
  centerTitle: { textAlign: 'center' },
  condensed: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
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
  liveTrack: { height: 4, borderRadius: 2, overflow: 'hidden', marginVertical: 18 },
  liveFill: { height: 4, borderRadius: 2 },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' },
  utilities: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
