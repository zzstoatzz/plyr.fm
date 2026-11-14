import { useRef } from 'react';
import { SpeakerHigh as Volume2, SpeakerX as VolumeX } from './icons';
import { View } from 'react-native';
import { useAppPreferences } from './preference-context';
import { PlayerControl } from './PlayerControl';
import Slider from './Slider';

export function PlayerVolume() {
  const { preferences, setPreferences } = useAppPreferences();
  const previous = useRef(0.6);
  const volume = preferences.volume;
  return <View style={{ flexDirection: 'row', alignItems: 'center', width: 144 }}>
    <PlayerControl label={volume ? 'Mute' : 'Unmute'} icon={volume ? Volume2 : VolumeX} onPress={() => {
      if (volume) previous.current = volume;
      setPreferences({ volume: volume ? 0 : previous.current });
    }} />
    <View style={{ flex: 1 }}><Slider accessibilityLabel="Volume" minimumValue={0} maximumValue={1} value={volume}
      onValueChange={value => setPreferences({ volume: value })} /></View>
  </View>;
}
