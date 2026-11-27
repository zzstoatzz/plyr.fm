import { trackArtwork } from '@plyr/next-core/artwork';
import { ChatCircle, CaretDown as ChevronDown, Playlist as ListMusic, Radio as RadioTower } from './icons';
import { Text } from './Text';
import Slider from './Slider';
import { usePathname, type Href } from 'expo-router';
import { NextGlyph as SkipForward, PauseGlyph as Pause, PlayGlyph as Play, PreviousGlyph as SkipBack } from './PlayerGlyph';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View, useWindowDimensions, type ViewInstance } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Track } from '@plyr/next-core/api';
import { useAppearance } from './appearance';
import { Cover, artistName } from './CatalogPieces';
import { ShareLink } from './ShareLink';
import { TrackLikes } from './TrackLikes';
import { isBroadcast, radioStationPath } from '@plyr/next-core/radio';
import { usePlayCount } from './use-play-count';
import { PlayerControl } from './PlayerControl';
import { usePlayback } from './playback';
import { usePlayerDismiss } from './use-player-dismiss';
import { PullDetector, PullRoot, usePlayerPull } from './player-pull';
import { PlayerFlight } from './PlayerFlight';
import { AlbumLink, NowPlayingDetails } from './NowPlayingDetails';
import { currentChapter, parseChapters } from '@plyr/next-core/chapters';
import { ChapterWheel, type WheelOutside } from './ChapterWheel';
import { Coachmark } from './Coachmark';
import { markHintSeen, useHintPending } from './hints';
import { measure, playerSheet, setFlying, type Rect } from './player-sheet';
import { artLeft, flightSteps, titleLeft } from './player-flight-path';
import { CommentsView, CoverComments } from './TimedComments';
import { CommentComposer } from './CommentComposer';
import { listenBlock, signInLabel } from '@plyr/next-core/listen-blocked';
import { useTrackComments } from './track-comments';

const AnimatedSafeAreaView = Animated.createAnimatedComponent(SafeAreaView);
const titleOriginFade = [0.05, 0.25] as const;
const titleFade = [0.6, 0.8] as const;

function time(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function NowPlaying({ track, close: leave, navigate: go }: {
  track: Track; close: () => void; navigate: (target: Href) => void;
}) {
  const player = usePlayback();
  const returnTo = usePathname();
  const theme = useAppearance();
  const { width, height } = useWindowDimensions();
  const [scrub, setScrub] = useState<{ id: string; seconds: number } | null>(null);
  const compact = width < 600;
  const morph = compact && !theme.reduceMotion && playerSheet.dockTop !== undefined;
  const rest = morph ? playerSheet.dockTop! : height;
  const depart = (then: () => void) => () => { setFlying(false); then(); };
  // The native Modal lays its views out a moment after this renders (safe-area insets included). The open waits until it is
  // on screen and the morph has measured where the artwork and title land, so the flight starts at the dock.
  const [shown, setShown] = useState(false);
  const insets = useSafeAreaInsets();
  // Native pads with the provider's insets: a SafeAreaView inside the Modal applies its own only after layout, after the morph measures.
  const inset = { paddingTop: insets.top, paddingBottom: insets.bottom };
  // On a phone the player fills the first screen exactly; the details start below the fold instead of peeking up into it.
  const [viewport, setViewport] = useState(0);
  const [measured, setMeasured] = useState(!morph);
  const dismiss = usePlayerDismiss(compact, width, height, depart(leave), theme.reduceMotion, rest, shown && measured);
  const pull = usePlayerPull(compact && shown && measured, dismiss.pull);
  const close = () => dismiss.exit(depart(leave));
  const navigate = (target: Href) => { setFlying(false); go(target); };
  const backdrop = useRef<ViewInstance | null>(null);
  const panelRef = useRef<ViewInstance>(null);
  const artRef = useRef<ViewInstance>(null);
  const titleRef = useRef<ViewInstance>(null);
  const art = trackArtwork(track);
  const [settledArt, setSettledArt] = useState<string>();
  const [rects, setRects] = useState<Record<'art' | 'title', { from: Rect; to: Rect }>>();
  const commentable = !player.live && !player.privatePlayback;
  const comments = useTrackComments(commentable ? track.id : undefined);
  // The first open after install makes room for the "more below" hint under the controls, so it never covers like/share/queue.
  // The room stays until close, so dismissing never shifts layout.
  const hintPending = useHintPending('now-playing.more-below');
  const [hintRoom, setHintRoom] = useState(false);
  useEffect(() => { if (hintPending && compact) setHintRoom(true); }, [hintPending, compact]);
  const hintSlot = 68 * theme.scale;
  const artwork = Math.max(1, Math.min(width - 40, 560));
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
  }, [morph, shown, track.id, track.metadata.title, width, height, theme.scale, artwork, viewport]);
  const flights = morph && rects && dismiss.atTop ? rects : undefined;
  const [condensed, setCondensed] = useState(false);
  const titleEnd = useRef({ hero: 0, body: 0, meta: 0 });
  const condense = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(condense, { toValue: condensed ? 1 : 0, duration: theme.reduceMotion ? 0 : 160, useNativeDriver: true }).start();
  }, [condensed, condense, theme.reduceMotion]);
  useLayoutEffect(() => {
    playerSheet.modal = true;
    return () => { playerSheet.modal = false; };
  }, []);
  useEffect(() => { setFlying(!!flights); }, [!!flights]);
  useEffect(() => () => setFlying(false), []);
  // The flights and the resting art/title swap on the native thread as the sheet leaves its open position; both stay mounted so no image reloads mid-morph.
  // Once open and still, the open state is plain styles: the flight hides and the resting art and title show in one commit,
  // instead of crossfading through the spring's last point of travel. Motion resumes in the same commit.
  const still = dismiss.resting;
  // Every node reading the sheet's translation is built once per shape, so a playback tick re-rendering mid-spring keeps them attached.
  const motion = useMemo(() => {
    const translation = playerSheet.translation;
    const departed = (open: number, away: number) => still ? open
      : translation.interpolate({ inputRange: [0, 1], outputRange: [open, away], extrapolate: 'clamp' });
    const swap = (open: number, away: number) => translation.interpolate({ inputRange: [0, 0.02], outputRange: [open, away], extrapolate: 'clamp' });
    const fade = (open: number, docked: number, from: number, to: number) => morph && !still
      ? translation.interpolate({ inputRange: [rest * from, rest * to], outputRange: [open, docked], extrapolate: 'clamp' }) : open;
    return { titleRests: departed(1, 0), titleFlies: departed(0, 1), artRests: swap(1, 0), artFlies: swap(0, 1),
      backdrop: fade(1, 0, 0.85, 1), content: fade(1, 0, 0, 0.5), lift: morph ? fade(0, -0.6 * rest, 0, 1) : 0 };
  }, [still, morph, rest]);
  const headerTitle = useMemo(() => condense.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), [condense]);
  const carried = flights ? { opacity: motion.titleRests } : undefined;
  // The resting art loads its own large rendition and fades in. The art flight draws the same image above it and stays opaque
  // until that art has settled and the sheet is still, then swaps in one commit: a crossfade of two copies dims for a few frames.
  // If the large cover never reports in (a stalled or cached load), hand over anyway so the flying copy can't stay on screen.
  useEffect(() => {
    if (!art || settledArt === art) return;
    const timer = setTimeout(() => setSettledArt(art), 1500);
    return () => clearTimeout(timer);
  }, [art, settledArt]);
  const artShown = !art || settledArt === art;
  // The art flight and the resting art swap hard right at the open position, so at rest only the resting art can show,
  // even if the page moved after the flight was measured (Safari's toolbar, comments arriving).
  const artCarried = flights ? { opacity: artShown ? motion.artRests : 0 } : undefined;
  const paths = useMemo(() => flights && {
    art: flightSteps.map(progress => artLeft(flights.art, width, progress)),
    title: flightSteps.map(progress => titleLeft(flights.title, flights.art, width, progress)),
  }, [flights, width]);
  const titleStyle = { lineHeight: 30 * theme.scale, color: theme.text, fontFamily: theme.fontFamily, fontSize: 25 * theme.scale, fontWeight: '800', letterSpacing: -0.4 } as const;
  const error = player.error || player.status.error;
  // a closed track the listener can't hear says exactly why, with the sign-in that fixes it when one does
  const block = listenBlock(error);
  const signIn = signInLabel(block);
  const caption = { color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale };
  const plays = usePlayCount(track.id, track.metrics.play_count);

  const seek = player.canSeek && !player.live && !error ? player.seek : undefined;
  const [commentsOpen, setCommentsOpen] = useState(false);
  // While a finger is on the comments list, the list scrolls and the page holds still.
  const [inComments, setInComments] = useState(false);
  useEffect(() => { setCommentsOpen(false); }, [track.id]);
  const showComments = commentable && comments.enabled;
  const composer = <View><CommentComposer track={track} positionMs={position * 1000} returnTo={returnTo} /></View>;
  const details = <NowPlayingDetails track={track} plays={plays} navigate={navigate} position={position} playing={playing} seek={seek} />;
  const chapters = useMemo(() => parseChapters(track.metadata.description, track.metadata.duration_seconds ?? undefined).chapters, [track.metadata.description, track.metadata.duration_seconds]);
  const chapterIndex = player.live ? -1 : currentChapter(chapters, position);
  const [wheelPreview, setWheelPreview] = useState<number>();
  const [wheelActive, setWheelActive] = useState(false);
  const wheelBlocks = useMemo(() => [pull.pan, pull.scroll], [pull.pan, pull.scroll]);
  const wheelOutside = useRef<WheelOutside>({ inside: false });
  // A touch anywhere else on the page closes an open chapter wheel; touches inside it mark themselves first as they bubble.
  const closeWheelOutside = () => {
    const wheel = wheelOutside.current;
    if (!wheel.inside && Date.now() - (wheel.openedAt ?? 0) > 400) wheel.close?.();
    wheel.inside = false;
  };

  dismiss.scrolled.current = event => {
    if (event.nativeEvent.contentOffset.y > 24) markHintSeen('now-playing.more-below');
    const past = titleEnd.current.meta > 0 && event.nativeEvent.contentOffset.y > titleEnd.current.hero + titleEnd.current.body + titleEnd.current.meta;
    if (past !== condensed) setCondensed(past);
  };
  const sheet = <View ref={backdrop} style={styles.backdrop}>
      <PullDetector gesture={pull.pan}><AnimatedSafeAreaView {...dismiss.panelStartHandlers} onTouchStart={closeWheelOutside} accessibilityViewIsModal edges={[]}
        style={[{ transform: [{ translateY: dismiss.translation }] }, styles.panel, styles.full, inset]}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: theme.background, opacity: motion.backdrop }]} />
        <Animated.View style={[styles.full, { opacity: motion.content }]}>
        <View style={[styles.header, condensed && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.line }]}>
          {compact && <View><PlayerControl icon={ChevronDown} label="Close" onPress={close} /></View>}
          <View testID="now-playing-dismiss-region" style={styles.dismissRegion}>
          <Animated.View style={{ opacity: headerTitle }}><Text accessibilityRole="header"
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
          {compact ? <Animated.View  pointerEvents={condensed ? 'auto' : 'none'} aria-hidden={!condensed} style={{ opacity: condense }}>
            <PlayerControl primary icon={playing ? Pause : Play} label={playing ? 'Pause' : 'Play'} onPress={() => player.setPlaying(!playing)} busy={player.loading} />
          </Animated.View> : <View><PlayerControl icon={ChevronDown} label="Close" onPress={close} /></View>}
        </View>
        <Animated.View {...dismiss.contentStartHandlers} onLayout={event => setViewport(event.nativeEvent.layout.height)} style={[styles.scrollRegion, { transform: [{ translateY: motion.lift }] }]}>
          <PullDetector gesture={pull.scroll}><Animated.ScrollView testID="now-playing-scroll" {...dismiss.scrollProps} scrollEventThrottle={16} scrollEnabled={!dismiss.dragging && !wheelActive && !inComments} showsVerticalScrollIndicator={!dismiss.dragging}
            contentContainerStyle={styles.content}>
            <View testID="now-playing-hero" onLayout={event => { titleEnd.current.hero = event.nativeEvent.layout.y; }}
              style={[styles.hero, viewport > 0 && { minHeight: viewport - 36 }]}>
            <Animated.View testID="now-playing-artwork" style={[styles.art, artCarried]}>
              <View ref={artRef}><Cover uri={art} size={artwork} radius={16} onSettle={() => setSettledArt(art)} />
                {showComments && (commentsOpen ? <View style={StyleSheet.absoluteFill} onTouchStart={() => setInComments(true)} onTouchEnd={() => setInComments(false)} onTouchCancel={() => setInComments(false)}><CommentsView track={track} comments={comments.comments} art={art} positionMs={position * 1000} size={artwork}
                  seek={seek} close={() => setCommentsOpen(false)} returnTo={returnTo} /></View>
                  : playing && !scrub && <CoverComments comments={comments.comments} positionMs={position * 1000} size={artwork} open={() => setCommentsOpen(true)} />)}
              </View>
            </Animated.View>
            <View onLayout={event => {
              titleEnd.current.body = event.nativeEvent.layout.y;
            }} style={[styles.body, { width: artwork }]}>
              <View onLayout={event => { titleEnd.current.meta = event.nativeEvent.layout.y + event.nativeEvent.layout.height; }} style={styles.meta}>
                <Animated.View ref={titleRef} style={carried}><Text testID="now-playing-title" accessibilityRole="header" accessibilityLabel={track.metadata.title} style={titleStyle}>
                  {track.metadata.title}
                </Text></Animated.View>
                {isBroadcast(track) ? <Text numberOfLines={1} style={{ ...caption, fontSize: 15 * theme.scale, color: theme.muted }}>{artistName(track)}</Text>
                : <View  style={{ alignSelf: 'flex-start', maxWidth: '100%' }}><Pressable accessibilityRole="link" accessibilityLabel={`Artist: ${artistName(track)}`} style={styles.artist} onPress={() => {
                  navigate(`/u/${encodeURIComponent(track.artist.profile.handle || track.artist.did)}`);
                }}>
                  {({ hovered }: { pressed: boolean; hovered?: boolean }) => <>
                    <Text numberOfLines={1} style={{ ...caption, fontSize: 15 * theme.scale, color: hovered ? theme.text : theme.muted, textDecorationLine: hovered ? 'underline' : 'none' }}>{artistName(track)}</Text>
                  </>}
                </Pressable></View>}
                {!!track.metadata.album && <View  style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
                  <AlbumLink track={track} navigate={navigate} />
                </View>}
              </View>
              <View style={styles.playhead}>
                {player.live ? <View testID="now-playing-live-progress" accessibilityRole="progressbar" accessibilityLabel="Song progress"
                  aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(position)} style={[styles.liveTrack, { backgroundColor: theme.line }]}>
                  <View style={[styles.liveFill, { backgroundColor: theme.accent, width: `${duration ? Math.min(100, position / duration * 100) : 0}%` }]} />
                </View> : <View style={styles.scrubber}><View {...dismiss.protectSlider}><Slider accessibilityLabel="Playback position" minimumValue={0} maximumValue={duration || 1}
                  value={position} minimumTrackTintColor={theme.accent} maximumTrackTintColor={theme.border}
                  thumbTintColor={theme.accent} disabled={!player.canSeek || !duration || !!error}
                  onSlidingStart={updateScrub} onValueChange={updateScrub}
                  onSlidingComplete={(seconds) => { player.seek(seconds); setScrub(null); }} /></View>
                  {wheelPreview !== undefined && duration > 0 && <View pointerEvents="none" style={[styles.ghost, { left: `${Math.min(100, wheelPreview / duration * 100)}%`, backgroundColor: theme.text }]} />}</View>}
                <View testID="now-playing-time" style={styles.time}>
                  <Text style={[caption, styles.numeric]}>{time(position)}</Text>
                  {!error && chapterIndex >= 0 ? <ChapterWheel chapters={chapters} current={chapterIndex} seek={seek} onPreview={setWheelPreview} onActive={setWheelActive} guard={dismiss.protectSlider} blocks={wheelBlocks} outside={wheelOutside} />
                    : <Text accessibilityLiveRegion="polite" style={[caption, styles.status]}>{error && !block ? 'couldn’t play this track' : player.preparing ? 'preparing…' : ''}</Text>}
                  <Text style={[caption, styles.numeric]}>{time(duration)}</Text>
                </View>
                {block && (signIn ? <Pressable testID="now-playing-sign-in" accessibilityRole="link" hitSlop={8} style={styles.block}
                  onPress={() => navigate({ pathname: '/login', params: { return_to: `/track/${track.id}` } })}>
                  <Text style={[caption, styles.blockText]}><Text style={{ color: theme.accent, fontWeight: '700', textDecorationLine: 'underline' }}>{signIn}</Text>{error?.slice(signIn.length)}</Text>
                </Pressable> : <Text accessibilityLiveRegion="polite" style={[caption, styles.block, styles.blockText]}>{error}</Text>)}
              </View>
              <View style={styles.transport}>
                {!player.live && <View><PlayerControl large icon={SkipBack} label="Previous" onPress={player.previous} /></View>}
                <View><PlayerControl icon={playing ? Pause : Play} label={playing ? 'Pause' : 'Play'}
                  onPress={() => player.setPlaying(!playing)} primary large busy={player.loading} /></View>
                {!player.live && <View><PlayerControl large icon={SkipForward} label="Next" onPress={() => void player.next()} /></View>}
              </View>
              <View style={styles.utilities}>
                {!player.privatePlayback && !isBroadcast(track) && <View><TrackLikes key={track.id} track={track} iconOnly returnTo={returnTo} /></View>}
                {!player.privatePlayback && <View><ShareLink compact path={player.live ? radioStationPath(player.live.station) : `/track/${encodeURIComponent(track.id)}`} /></View>}
                {showComments && <View><Pressable testID="comments-toggle" accessibilityRole="button" accessibilityState={{ selected: commentsOpen }}
                  accessibilityLabel={commentsOpen ? 'Show the cover' : `Show comments (${comments.comments.length})`} onPress={() => setCommentsOpen(open => !open)} style={styles.commentCount}>
                  {({ hovered }: { pressed: boolean; hovered?: boolean }) => {
                    const tint = commentsOpen ? theme.accent : hovered ? theme.text : theme.muted;
                    return <>
                      <ChatCircle size={22} color={tint} weight={commentsOpen ? 'fill' : undefined} />
                      {comments.comments.length > 0 && <Text style={[caption, styles.numeric, { color: tint }]}>{comments.comments.length}</Text>}
                    </>;
                  }}
                </Pressable></View>}
                <View>{player.live ? <PlayerControl icon={RadioTower} label="Stations" onPress={() => navigate('/radio')} />
                  : <PlayerControl icon={ListMusic} label="Queue" onPress={() => navigate('/queue')} />}</View>
              </View>
            </View>
            {hintRoom && <View style={{ width: Math.min(width - 32, 440), height: hintSlot, justifyContent: 'flex-end' }}>
              <Coachmark hint="now-playing.more-below" ready={measured && dismiss.atTop && !dismiss.dragging} />
            </View>}
            </View>
            <View style={{ width: artwork, gap: 20 }}>{showComments && !commentsOpen && composer}{details}</View>
          </Animated.ScrollView></PullDetector>
        </Animated.View>
        </Animated.View>
        <View ref={panelRef} pointerEvents="none" aria-hidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
          {flights && <View testID="now-playing-flights" style={StyleSheet.absoluteFill}>
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: artShown ? motion.artFlies : 1 }]}>
              <PlayerFlight testID="now-playing-flight-art" {...flights.art} rest={rest} left={paths?.art} origin={<Cover instant uri={art} size={flights.art.from.width} radius={6} />}>
                <Cover instant uri={art} size={flights.art.to.width} radius={16} />
              </PlayerFlight>
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: motion.titleFlies }]}><PlayerFlight testID="now-playing-flight-title" {...flights.title} rest={rest} left={paths?.title} originFade={titleOriginFade} fade={titleFade}
              origin={<Text numberOfLines={1} style={{ color: theme.text, fontSize: 14 * theme.scale, fontWeight: '700' }}>{track.metadata.title}</Text>}>
              <Text style={titleStyle}>{track.metadata.title}</Text>
            </PlayerFlight></Animated.View>
          </View>}
        </View>
      </AnimatedSafeAreaView></PullDetector>
    </View>;
  return <Modal visible transparent accessibilityLabel="Now playing" animationType="none" onShow={() => { requestAnimationFrame(() => setShown(true)); }} onRequestClose={close}><PullRoot>{sheet}</PullRoot></Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  panel: { width: '100%' },
  full: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 50, paddingHorizontal: 20 },
  dismissRegion: { flex: 1, minHeight: 50, justifyContent: 'center' },
  headerTitle: { fontWeight: '600', textTransform: 'lowercase' },
  centerTitle: { textAlign: 'center' },
  condensed: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  scrollRegion: { flex: 1, minHeight: 0 },
  content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, gap: 20, alignItems: 'center' },
  hero: { gap: 20, alignItems: 'center', justifyContent: 'center' },
  art: { alignItems: 'center' },
  body: { gap: 16, minWidth: 0 },
  meta: { gap: 2 },
  artist: { alignSelf: 'flex-start', maxWidth: '100%', minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 8 },
  time: { minHeight: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
  status: { flex: 1, textAlign: 'center' },
  block: { marginTop: 6, alignSelf: 'center', maxWidth: 360 },
  blockText: { textAlign: 'center' },
  // Above the transport, so the chapter wheel opens over it.
  playhead: { zIndex: 2 },
  scrubber: { position: 'relative' },
  ghost: { position: 'absolute', bottom: 6, width: 2, height: 18, marginLeft: -1, borderRadius: 1, opacity: 0.75 },
  numeric: { fontVariant: ['tabular-nums'] },
  liveTrack: { height: 4, borderRadius: 2, overflow: 'hidden', marginVertical: 18 },
  liveFill: { height: 4, borderRadius: 2 },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' },
  utilities: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  commentCount: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, minWidth: 44, paddingHorizontal: 10 },
});
