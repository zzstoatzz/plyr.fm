import { View } from 'react-native';
import Slider from '@react-native-community/slider';
import { Action, Copy, row } from './controls';
import { useAppearance } from './appearance';
import { usePlayback } from './playback';

export function PlayerBar() {
  const player = usePlayback();
  const theme = useAppearance();
  if (!player.current) return null;
  return <View style={{ borderTopWidth: 1, borderColor: theme.surface, padding: 8, gap: 4 }}>
    <View style={row}>
      <View style={{ flex: 1, minWidth: 130 }}>
        <Copy>{player.current.metadata.title}</Copy>
        {player.error ? <Copy>{player.error}</Copy> : null}
      </View>
      <Action label="Previous" onPress={player.previous} />
      <Action label={player.loading ? 'Loading…' : player.status.playing ? 'Pause' : 'Play'} onPress={player.toggle} disabled={player.loading} />
      <Action label="Next" onPress={() => void player.next()} />
      <Action label="Queue" href="/queue" />
    </View>
    {player.status.duration > 0 && <Slider accessibilityLabel="Playback position"
      minimumValue={0} maximumValue={player.status.duration} value={player.status.currentTime}
      minimumTrackTintColor={theme.accent} onSlidingComplete={player.seek} />}
  </View>;
}
