import RotateCcw from 'lucide-react-native/icons/rotate-ccw';
import RotateCw from 'lucide-react-native/icons/rotate-cw';
import { View } from 'react-native';
import { useAppearance } from './appearance';
import { usePlayback } from './playback';
import { PlayerControl } from './PlayerControl';
import { Text } from './Text';

export function PlayerSeek({ forward = false }: { forward?: boolean }) {
  const player = usePlayback();
  const theme = useAppearance();
  return <View style={{ width: 44, height: 44 }}>
    <PlayerControl label={forward ? 'Forward 15 seconds' : 'Rewind 15 seconds'} icon={forward ? RotateCw : RotateCcw}
      onPress={() => player.skip(forward ? 15 : -15)} />
    <View pointerEvents="none" aria-hidden style={{ position: 'absolute', top: 18, left: 0, right: 0, alignItems: 'center' }}>
      <Text style={{ color: theme.text, fontSize: 8, fontWeight: '700' }}>15</Text>
    </View>
  </View>;
}
