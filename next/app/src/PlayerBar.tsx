import { displayUrl, trackArtwork } from './artwork';
import { Text } from './Text';
import { router, usePathname, type Href } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BodyPortal } from './BodyPortal';
import { Animated, Image, PanResponder, PixelRatio, Platform, Pressable, View, useWindowDimensions, type ViewInstance } from 'react-native';
import { playerSheet, useFlying, useSheetPresent } from './player-sheet';
import { PlaybackFreeze } from './playback';
import ListMusic from 'lucide-react-native/icons/list-music';
import Slider from './Slider';
import { PlayerVolume } from './PlayerVolume';
import { NextGlyph as SkipForward, PauseGlyph as Pause, PlayGlyph as Play, PreviousGlyph as SkipBack } from './PlayerGlyph';
import { useAppearance } from './appearance';
import { usePlayback } from './playback';
import { Cover, artistName } from './CatalogPieces';
import { glassSurface } from './materials';
import { TrackLikes } from './TrackLikes';
import { NowPlaying } from './NowPlaying';
import { PlayerSeek } from './PlayerSeek';
import { PlayerControl } from './PlayerControl';
import { useRadio } from './radio-session';
import X from 'lucide-react-native/icons/x';

const liftTouch = { touchAction: 'none', cursor: 'auto' } as const;

export function PlayerBar() {
  const player = usePlayback();
  const radio = useRadio();
  const theme = useAppearance();
  const path = usePathname();
  const previousPath = useRef(path);
  const openedFrom = useRef<string | undefined>(undefined);
  const trigger = useRef<ViewInstance>(null);
  useEffect(() => {
    const restore = previousPath.current === '/now-playing' && openedFrom.current === path;
    previousPath.current = path;
    if (!restore) return;
    const frame = requestAnimationFrame(() => trigger.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [path]);
  const { width, height } = useWindowDimensions();
  const desktop = Platform.OS === 'web' && width >= 800;
  const [expanded, setExpanded] = useState(false);
  const flying = useFlying();
  const dock = useRef<ViewInstance>(null);
  const launch = useRef(() => {});
  const lead = useRef(0);
  const present = !!player.current;
  const shown = useSheetPresent();
  const hosted = Platform.OS === 'web' && width < 600;
  const [dockTop, setDockTop] = useState<number>();
  const route = useRef(path);
  route.current = path;
  useEffect(() => {
    if (!present || width >= 600) { playerSheet.dockTop = undefined; setDockTop(undefined); return; }
    const frame = requestAnimationFrame(() => dock.current?.measureInWindow((_x, y, _width, tall) => {
      if (tall <= 0) return;
      playerSheet.dockTop = y;
      setDockTop(y);
      if (!playerSheet.present && !playerSheet.modal) playerSheet.translation.setValue(y);
    }));
    return () => cancelAnimationFrame(frame);
  }, [present, width, height, theme.scale, path]);
  useEffect(() => {
    if (!hosted) return;
    playerSheet.opened = () => { if (route.current !== '/now-playing') router.navigate('/now-playing'); };
    return () => { playerSheet.opened = undefined; playerSheet.hide(); };
  }, [hosted]);
  const leave = useRef((_target?: Href) => {});
  leave.current = target => {
    const origin = openedFrom.current ?? '/';
    const elsewhere = target !== undefined && !(typeof target === 'string' && target === origin);
    const routed = route.current === '/now-playing';
    if (target === undefined) playerSheet.hide();
    else playerSheet.leaving = true;
    if (elsewhere) { if (routed) router.replace(target); else router.push(target); }
    else if (!routed) return;
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  const trackId = player.current?.id;
  const art = player.current ? trackArtwork(player.current) : undefined;
  useEffect(() => {
    // Native mounts now playing on open; warm the size it draws the cover at.
    if (Platform.OS !== 'web' && art) Image.prefetch(displayUrl(art, Math.min(width - 40, 372), PixelRatio.get())).catch(() => {});
  }, [art, width]);
  const sheet = useMemo(() => hosted && player.current ? <NowPlaying overlay present={shown} track={player.current} close={() => leave.current()} navigate={target => leave.current(target)} /> : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hosted, shown, trackId]);
  const lift = useRef(PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, gesture) => {
      const acquire = playerSheet.dockTop !== undefined && !playerSheet.present && gesture.numberActiveTouches <= 1
        && gesture.dy < -8 && -gesture.dy > Math.abs(gesture.dx) * 1.5;
      if (acquire) lead.current = gesture.dy;
      return acquire;
    },
    onPanResponderGrant: () => {
      playerSheet.dragging = true;
      playerSheet.release = undefined;
      playerSheet.translation.setValue(playerSheet.dockTop ?? 0);
      launch.current();
    },
    onPanResponderMove: (_, gesture) => {
      const top = playerSheet.dockTop ?? 0;
      playerSheet.translation.setValue(Math.max(0, Math.min(top, top + gesture.dy + lead.current)));
    },
    onPanResponderRelease: (_, gesture) => finish(-(gesture.dy + lead.current) > 80 || gesture.vy < -0.5, gesture.vy * 1000),
    onPanResponderTerminate: () => finish(false, 0),
    onPanResponderTerminationRequest: () => false,
  })).current;
  function finish(open: boolean, velocity: number) {
    playerSheet.dragging = false;
    if (playerSheet.settle) playerSheet.settle(open, velocity);
    else playerSheet.release = { open, velocity };
  }
  const [expandRequested, setExpandRequested] = useState(false);
  useEffect(() => {
    playerSheet.expand = () => setExpandRequested(true);
    return () => { playerSheet.expand = undefined; };
  }, []);
  useEffect(() => {
    // A request from outside the dock can land in the same commit that first shows the track; open once the dock has a place.
    if (!expandRequested || !present || hosted && dockTop === undefined) return;
    setExpandRequested(false);
    launch.current();
  }, [expandRequested, present, hosted, dockTop]);
  const carried = flying ? { opacity: 0 } : undefined;
  const [scrub, setScrub] = useState<{ id: string; seconds: number }>();
  if (!player.current) return null;
  const track = player.current;
  const playing = player.status.playing;
  const duration = player.status.duration || track.metadata.duration_seconds || 0;
  const play = <PlayerControl primary label={playing ? 'Pause' : 'Play'} icon={playing ? Pause : Play}
    onPress={() => player.setPlaying(!playing)} busy={player.loading} />;
  const error = player.error ?? player.status.error;
  const stopRadio = <PlayerControl label="Stop radio" icon={X} onPress={radio.stop} />;
  const open = () => { openedFrom.current = path; if (hosted) playerSheet.show(); else if (Platform.OS === 'web') router.navigate('/now-playing'); else setExpanded(true); };
  launch.current = open;
  const identity = <Pressable ref={trigger} accessibilityRole="button" accessibilityLabel="Open now playing" onPress={open}
    style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: desktop ? 12 : 10, minHeight: desktop ? 52 : 44 }}>
    <View ref={node => { playerSheet.dock.art = node; }} style={carried}><Cover uri={trackArtwork(track)} size={desktop ? 52 : 40} radius={6} /></View>
    <View style={{ flex: 1, minWidth: 0 }}>
      <View ref={node => { playerSheet.dock.title = node; }} style={carried}><Text numberOfLines={1} style={{ color: theme.text, fontSize: 14 * theme.scale, fontWeight: '700' }}>{track.metadata.title}</Text></View>
      <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 12 * theme.scale }}>{error ? "couldn’t play this track" : player.outputElsewhere ? "playing on another device" : player.live ? `${artistName(track)} · ${player.live.station.label} radio` : artistName(track)}</Text>
    </View>
  </Pressable>;
  return <>
    <Animated.View ref={dock} testID="player-dock" {...(desktop || theme.reduceMotion ? {} : lift.panHandlers)} style={[glassSurface(theme), !desktop && Platform.OS === 'web' && liftTouch, { width: desktop ? '100%' : undefined, alignSelf: desktop ? 'center' : undefined,
      borderWidth: 0, borderTopWidth: 1, paddingHorizontal: desktop ? 20 : 12, paddingTop: desktop ? 12 : 4, paddingBottom: desktop ? 9 : 4, overflow: 'hidden' },
      hosted && dockTop !== undefined && !theme.reduceMotion && { opacity: playerSheet.translation.interpolate({ inputRange: [dockTop * 0.75, dockTop], outputRange: [0, 1], extrapolate: 'clamp' }) }]}>
      <View pointerEvents="none" accessible={false} testID="playback-status-inlay" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        opacity: playing ? 0.65 : 0.16, backgroundColor: theme.accent,
        boxShadow: `0px 0px 5px ${theme.accent}66`,
        ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(180deg, #ffffff80, #ffffff00)' } : {}) }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: desktop ? 24 : 2 }}>
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: desktop ? 6 : 0 }}>{identity}{!player.privatePlayback && <TrackLikes key={track.id} track={track} iconOnly returnTo={path} />}</View>
        {desktop ? <>
          <View style={{ flex: 1.4, minWidth: 224, maxWidth: 600 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
              {player.live ? play : <>
                <PlayerControl label="Previous" icon={SkipBack} onPress={player.previous} /><PlayerSeek />{play}<PlayerSeek forward />
                <PlayerControl label="Next" icon={SkipForward} onPress={() => void player.next()} />
              </>}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: theme.muted, fontSize: 11, fontVariant: ['tabular-nums'] }}>{clock(player.seekPreview ?? player.status.currentTime)}</Text>
              <View style={{ flex: 1 }}><Slider accessibilityLabel="Playback position" minimumValue={0} maximumValue={duration || 1} value={scrub?.id === track.id ? scrub.seconds : player.seekPreview ?? player.status.currentTime}
                disabled={!player.canSeek || !duration || !!error} onSlidingStart={seconds => setScrub({ id: track.id, seconds })} onValueChange={seconds => setScrub({ id: track.id, seconds })} onSlidingComplete={seconds => { player.seek(seconds); setScrub(undefined); }} /></View>
              <Text style={{ color: theme.muted, fontSize: 11, fontVariant: ['tabular-nums'] }}>{clock(duration)}</Text>
            </View>
          </View>
          <View style={{ flex: 1, minWidth: 188, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }}>
            {player.live ? stopRadio : <PlayerControl label="Queue" icon={ListMusic} onPress={() => router.navigate('/queue')} />}<PlayerVolume />
          </View>
        </> : <>{play}{player.live ? stopRadio : <PlayerControl label="Next" icon={SkipForward} onPress={() => void player.next()} />}</>}
      </View>
    </Animated.View>
    {sheet && <BodyPortal><PlaybackFreeze frozen={!shown}>{sheet}</PlaybackFreeze></BodyPortal>}
    {Platform.OS !== 'web' && expanded && <NowPlaying track={track} close={() => setExpanded(false)} navigate={target => { setExpanded(false); router.push(target); }} />}
  </>;
}

function clock(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
