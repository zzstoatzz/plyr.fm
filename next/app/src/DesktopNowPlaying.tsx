import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import X from 'lucide-react-native/icons/x';
import Play from 'lucide-react-native/icons/play';
import Pause from 'lucide-react-native/icons/pause';
import SkipBack from 'lucide-react-native/icons/skip-back';
import SkipForward from 'lucide-react-native/icons/skip-forward';
import Info from 'lucide-react-native/icons/info';
import UserRound from 'lucide-react-native/icons/user-round';
import ListMusic from 'lucide-react-native/icons/list-music';
import { useAppearance } from './appearance';
import { usePlayback } from './playback';
import { usePlayerPanel } from './player-panel';
import { Text } from './Text';
import { Cover, artistName } from './CatalogPieces';
import { PlayerControl } from './PlayerControl';
import { ActionRow } from './ActionRow';
import { ShareLink } from './ShareLink';
import Slider from './Slider';

function time(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function DesktopNowPlaying() {
  const player = usePlayback();
  const panel = usePlayerPanel();
  const theme = useAppearance();
  const { width } = useWindowDimensions();
  const track = player.current;
  const [scrub, setScrub] = useState<{ id: string; seconds: number }>();
  const close = useCallback(() => { panel.setExpanded(false); panel.trigger.current?.focus(); }, [panel.setExpanded, panel.trigger]);
  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"]')) { event.preventDefault(); close(); }
    }
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [close]);
  if (!track) return null;
  const size = width >= 1100 ? 340 : 280;
  const duration = player.status.duration || track.metadata.duration_seconds || 0;
  const upcoming = player.queue.slice(player.index + 1, player.index + 6);
  return <View role="complementary" accessibilityLabel="Now playing" testID="desktop-now-playing" style={{ width: size, borderLeftWidth: 1, borderColor: theme.surface, backgroundColor: theme.background }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 20, paddingRight: 8, minHeight: 60 }}>
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 17 * theme.scale, fontWeight: '700' }}>now playing</Text>
      <PlayerControl label="Close now playing panel" icon={X} onPress={close} />
    </View>
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 14 }}>
      <Cover uri={track.media.artwork?.url} size={size - 40} radius={10} />
      <View style={{ gap: 4 }}>
        <Text numberOfLines={3} accessibilityRole="header" style={{ color: theme.text, fontSize: 21 * theme.scale, fontWeight: '700' }}>{track.metadata.title}</Text>
        <ActionRow label={artistName(track)} icon={UserRound} href={`/u/${encodeURIComponent(track.artist.profile.handle || track.artist.did)}`} />
      </View>
      <View>
        <Slider accessibilityLabel="Seek" minimumValue={0} maximumValue={duration || 1} value={Math.min(scrub?.id === track.id ? scrub.seconds : player.status.currentTime, duration)} disabled={!duration || !!player.error || !!player.status.error} onSlidingStart={seconds => setScrub({ id: track.id, seconds })} onValueChange={seconds => setScrub({ id: track.id, seconds })} onSlidingComplete={seconds => { player.seek(seconds); setScrub(undefined); }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: theme.muted, fontSize: 12 * theme.scale }}>{time(player.status.currentTime)}</Text>
          <Text style={{ color: theme.muted, fontSize: 12 * theme.scale }}>{time(duration)}</Text>
        </View>
        {(player.error || player.status.error) && <Text accessibilityLiveRegion="polite" style={{ color: theme.danger }}>couldn’t play this track</Text>}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' }}>
        <PlayerControl label="Previous" icon={SkipBack} onPress={player.previous} />
        <PlayerControl primary large label={player.status.playing ? 'Pause' : 'Play'} icon={player.status.playing ? Pause : Play} busy={player.loading} onPress={player.toggle} />
        <PlayerControl label="Next" icon={SkipForward} onPress={() => void player.next()} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><PlayerControl label="Track details" icon={Info} onPress={() => router.navigate(`/track/${track.id}`)} /><ShareLink compact path={`/track/${track.id}`} /></View>
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 16 * theme.scale, fontWeight: '700' }}>up next</Text>
          <PlayerControl label="Open queue" icon={ListMusic} onPress={() => router.navigate('/queue')} />
        </View>
        {upcoming.map((item, index) => <ActionRow key={`${player.index + index + 1}:${item.id}`} label={item.metadata.title} icon={Play} onPress={() => player.jump(player.index + index + 1)} />)}
        {!upcoming.length && <Text style={{ color: theme.muted, fontSize: 13 * theme.scale }}>nothing queued</Text>}
      </View>
    </ScrollView>
  </View>;
}
