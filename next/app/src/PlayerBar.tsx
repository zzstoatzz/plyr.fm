import { Text } from './Text';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import Pause from 'lucide-react-native/icons/pause';
import Play from 'lucide-react-native/icons/play';
import SkipForward from 'lucide-react-native/icons/skip-forward';
import { useAppearance } from './appearance';
import { usePlayback } from './playback';
import { Cover, artistName } from './CatalogPieces';
import { NowPlaying } from './NowPlaying';
import { PlayerControl } from './PlayerControl';

export function PlayerBar() {
  const player = usePlayback();
  const theme = useAppearance();
  const [expanded, setExpanded] = useState(false);
  if (!player.current) return null;
  const track = player.current;
  const playing = player.status.playing;
  const duration = player.status.duration || track.metadata.duration_seconds || 0;
  const progress = duration ? Math.min(1, player.status.currentTime / duration) : 0;
  const play = <PlayerControl primary label={playing ? 'Pause' : 'Play'} icon={playing ? Pause : Play}
    onPress={player.toggle} busy={player.loading} />;
  const error = player.error ?? player.status.error;
  return <>
    <View style={{ backgroundColor: theme.surface, borderRadius: 14, margin: 6, overflow: 'hidden' }}>
      <View style={{ height: 2, width: `${Math.max(0, progress) * 100}%`, backgroundColor: theme.accent }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 5, gap: 4 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Open now playing" onPress={() => Platform.OS === 'web' ? router.navigate('/now-playing') : setExpanded(true)}
          style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 5 }}>
          <Cover uri={track.media.artwork?.url} size={42} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: theme.text, fontWeight: '700' }}>{track.metadata.title}</Text>
            <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 12 }}>{error ? "Couldn’t play this track" : artistName(track)}</Text>
          </View>
        </Pressable>
        {play}
        <PlayerControl label="Next" icon={SkipForward} onPress={() => void player.next()} />
      </View>
    </View>
    {Platform.OS !== 'web' && expanded && <NowPlaying track={track} close={() => setExpanded(false)} navigate={target => { setExpanded(false); router.push(target); }} />}
  </>;
}
