import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { ListMusic, Pause, Play, SkipBack, SkipForward, type LucideIcon } from 'lucide-react-native';
import { Action, Copy, row } from './controls';
import { useAppearance } from './appearance';
import { usePlayback } from './playback';
import { Cover, Heading, artistName } from './CatalogPieces';
import { Sheet } from './Sheet';

function Time({ value }: { value: number }) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return <Copy>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</Copy>;
}

function Control({ icon: Icon, label, onPress, primary, disabled }: {
  icon: LucideIcon; label: string; onPress: () => void; primary?: boolean; disabled?: boolean;
}) {
  const theme = useAppearance();
  const color = primary ? theme.background : theme.text;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={{ width: primary ? 54 : 44, height: primary ? 54 : 44, borderRadius: 28,
      alignItems: 'center', justifyContent: 'center', backgroundColor: primary ? theme.text : 'transparent' }}>
    {disabled ? <ActivityIndicator color={color} /> : <Icon size={primary ? 26 : 21} color={color} />}
  </Pressable>;
}

export function PlayerBar() {
  const player = usePlayback();
  const theme = useAppearance();
  const [expanded, setExpanded] = useState(false);
  if (!player.current) return null;
  const track = player.current;
  const playing = player.status.playing;
  const duration = player.status.duration || track.metadata.duration_seconds || 0;
  const progress = duration ? Math.min(1, player.status.currentTime / duration) : 0;
  const play = <Control primary label={playing ? 'Pause' : 'Play'} icon={playing ? Pause : Play}
    onPress={player.toggle} disabled={player.loading} />;
  const error = player.error ?? player.status.error;
  return <>
    <View style={{ backgroundColor: theme.surface, borderRadius: 14, margin: 6, overflow: 'hidden' }}>
      <View style={{ height: 2, width: `${Math.max(0, progress) * 100}%`, backgroundColor: theme.accent }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 5, gap: 4 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Open now playing" onPress={() => setExpanded(true)}
          style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 5 }}>
          <Cover uri={track.media.artwork?.url} size={42} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: theme.text, fontWeight: '700' }}>{track.metadata.title}</Text>
            <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 12 }}>{error || artistName(track)}</Text>
          </View>
        </Pressable>
        {play}
        <Control label="Next" icon={SkipForward} onPress={() => void player.next()} />
      </View>
    </View>
    {expanded && <Sheet title="Now playing" close={() => setExpanded(false)}>
      <View style={{ alignItems: 'center', gap: 12 }}>
        <Cover uri={track.media.artwork?.url} size={220} />
        <Heading>{track.metadata.title}</Heading>
        <Copy>{artistName(track)}</Copy>
        {error && <Copy>{error}</Copy>}
      </View>
      <Slider accessibilityLabel="Playback position" minimumValue={0} maximumValue={duration || 1}
        value={Math.min(duration || 1, player.status.currentTime)} minimumTrackTintColor={theme.accent}
        disabled={!duration} onSlidingComplete={player.seek} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Time value={player.status.currentTime} /><Time value={duration} />
      </View>
      <View style={{ ...row, justifyContent: 'center' }}>
        <Control label="Previous" icon={SkipBack} onPress={player.previous} />
        {play}
        <Control label="Next" icon={SkipForward} onPress={() => void player.next()} />
      </View>
      <View style={{ ...row, justifyContent: 'center' }}>
        <ListMusic color={theme.muted} size={20} />
        <Action label="Queue" href="/queue" onPress={() => setExpanded(false)} />
        <Action label="Track details" href={`/track/${track.id}`} onPress={() => setExpanded(false)} />
      </View>
    </Sheet>}
  </>;
}
