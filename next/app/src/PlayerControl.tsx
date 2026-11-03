import type Play from 'lucide-react-native/icons/play';
import { ActivityIndicator, Pressable } from 'react-native';
import { useAppearance } from './appearance';

export function PlayerControl({ icon: Icon, label, onPress, primary, large, busy }: {
  icon: typeof Play; label: string; onPress: () => void; primary?: boolean; large?: boolean; busy?: boolean;
}) {
  const theme = useAppearance();
  const color = primary ? theme.background : theme.text;
  const size = large ? 64 : primary ? 48 : 44;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy, disabled: busy }}
    disabled={busy} onPress={onPress}
    style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, opacity: pressed ? 0.7 : 1,
      alignItems: 'center', justifyContent: 'center', backgroundColor: primary ? theme.text : 'transparent' })}>
    {busy ? <ActivityIndicator color={color} /> : <Icon size={large ? 30 : primary ? 25 : 22} color={color} />}
  </Pressable>;
}
