import { trackArtwork } from './artwork';
import { Text } from './Text';
import { router, usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, View, useWindowDimensions, type ViewInstance } from 'react-native';
import Pause from 'lucide-react-native/icons/pause';
import Play from 'lucide-react-native/icons/play';
import SkipBack from 'lucide-react-native/icons/skip-back';
import ListMusic from 'lucide-react-native/icons/list-music';
import Slider from './Slider';
import { PlayerVolume } from './PlayerVolume';
import SkipForward from 'lucide-react-native/icons/skip-forward';
import { useAppearance } from './appearance';
import { usePlayback } from './playback';
import { Cover, artistName } from './CatalogPieces';
import { glassSurface } from './materials';
import { TrackLikes } from './TrackLikes';
import { NowPlaying } from './NowPlaying';
import { PlayerSeek } from './PlayerSeek';
import { PlayerControl } from './PlayerControl';

export function PlayerBar() {
  const player = usePlayback();
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
  const { width } = useWindowDimensions();
  const desktop = Platform.OS === 'web' && width >= 800;
  const [expanded, setExpanded] = useState(false);
  const [scrub, setScrub] = useState<{ id: string; seconds: number }>();
  if (!player.current) return null;
  const track = player.current;
  const playing = player.status.playing;
  const duration = player.status.duration || track.metadata.duration_seconds || 0;
  const play = <PlayerControl primary label={playing ? 'Pause' : 'Play'} icon={playing ? Pause : Play}
    onPress={() => player.setPlaying(!playing)} busy={player.loading} />;
  const error = player.error ?? player.status.error;
  const open = () => { openedFrom.current = path; if (Platform.OS === 'web') router.navigate('/now-playing'); else setExpanded(true); };
  const identity = <Pressable ref={trigger} accessibilityRole="button" accessibilityLabel="Open now playing" onPress={open}
    style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 }}>
    <Cover uri={trackArtwork(track)} size={desktop ? 52 : 42} />
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text numberOfLines={1} style={{ color: theme.text, fontSize: 14 * theme.scale, fontWeight: '700' }}>{track.metadata.title}</Text>
      <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 12 * theme.scale }}>{error ? "Couldn’t play this track" : player.outputElsewhere ? "Playing on another device" : artistName(track)}</Text>
    </View>
  </Pressable>;
  return <>
    <View testID="player-dock" style={[glassSurface(theme), { width: desktop ? '100%' : undefined, alignSelf: desktop ? 'center' : undefined,
      borderRadius: desktop ? 0 : 16, margin: desktop ? 0 : 6, marginTop: desktop ? 0 : 6, paddingHorizontal: desktop ? 20 : 6, paddingTop: desktop ? 12 : 6, paddingBottom: desktop ? 9 : 5, overflow: 'hidden' }]}>
      <View pointerEvents="none" accessible={false} testID="playback-status-inlay" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        opacity: playing ? 0.65 : 0.16, backgroundColor: theme.accent,
        boxShadow: `0px 0px 5px ${theme.accent}66`,
        ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(180deg, #ffffff80, #ffffff00)' } : {}) }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: desktop ? 0 : 5, gap: desktop ? 24 : 4 }}>
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: desktop ? 6 : 0 }}>{identity}<TrackLikes key={track.id} track={track} iconOnly returnTo={path} /></View>
        {desktop ? <>
          <View style={{ flex: 1.4, minWidth: 224, maxWidth: 600 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
              <PlayerControl label="Previous" icon={SkipBack} onPress={player.previous} /><PlayerSeek />{play}<PlayerSeek forward />
              <PlayerControl label="Next" icon={SkipForward} onPress={() => void player.next()} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: theme.muted, fontSize: 11, fontVariant: ['tabular-nums'] }}>{clock(player.seekPreview ?? player.status.currentTime)}</Text>
              <View style={{ flex: 1 }}><Slider accessibilityLabel="Playback position" minimumValue={0} maximumValue={duration || 1} value={scrub?.id === track.id ? scrub.seconds : player.seekPreview ?? player.status.currentTime}
                disabled={!player.canSeek || !duration || !!error} onSlidingStart={seconds => setScrub({ id: track.id, seconds })} onValueChange={seconds => setScrub({ id: track.id, seconds })} onSlidingComplete={seconds => { player.seek(seconds); setScrub(undefined); }} /></View>
              <Text style={{ color: theme.muted, fontSize: 11, fontVariant: ['tabular-nums'] }}>{clock(duration)}</Text>
            </View>
          </View>
          <View style={{ flex: 1, minWidth: 188, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }}>
            <PlayerControl label="Queue" icon={ListMusic} onPress={() => router.navigate('/queue')} /><PlayerVolume />
          </View>
        </> : <>{play}<PlayerControl label="Next" icon={SkipForward} onPress={() => void player.next()} /></>}
      </View>
    </View>
    {Platform.OS !== 'web' && expanded && <NowPlaying track={track} close={() => setExpanded(false)} navigate={target => { setExpanded(false); router.push(target); }} />}
  </>;
}

function clock(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
