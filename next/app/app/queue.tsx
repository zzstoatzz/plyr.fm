import Slider from '@react-native-community/slider';
import { View } from 'react-native';
import { Action, Copy, Page, row } from '../src/controls';
import { usePlayback } from '../src/playback';
import { useAppPreferences } from '../src/preference-context';

export default function Queue() {
  const player = usePlayback();
  const { preferences, setPreferences } = useAppPreferences();
  return <Page title="Queue">
    <View style={row}>
      <Action label={`Repeat: ${player.repeat}`} onPress={() => player.setRepeat(player.repeat === 'off' ? 'all' : player.repeat === 'all' ? 'one' : 'off')} />
      <Action label="Shuffle upcoming" onPress={player.shuffle} disabled={player.queue.length <= player.index + 2} />
      <Action label="Clear upcoming" onPress={player.clear} disabled={player.queue.length <= player.index + 1} />
    </View>
    <Copy>Volume</Copy>
    <Slider accessibilityLabel="Volume" minimumValue={0} maximumValue={1} value={preferences.volume}
      onSlidingComplete={(volume) => setPreferences({ volume })} />
    {!player.queue.length && <Copy>Pick a track to start listening.</Copy>}
    {player.queue.map((track, index) => <View key={`${track.id}:${index}`} style={row}>
      <Action label={track.metadata.title} selected={index === player.index} onPress={() => player.jump(index)} />
      {index > player.index && <Action label="Remove" onPress={() => player.remove(index)} />}
    </View>)}
  </Page>;
}
