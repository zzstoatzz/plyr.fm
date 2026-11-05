import type Play from 'lucide-react-native/icons/play';
import { ActivityIndicator, Pressable } from 'react-native';
import { useAppearance } from './appearance';

const primaryColors = {
  light: { foreground: '#244d83', background: '#e1eafa', pressed: '#ccddf4', border: '#b4cae7' },
  dark: { foreground: '#c5daf7', background: '#233751', pressed: '#304e72', border: '#45638c' }
};

export function PlayerControl({ icon: Icon, label, onPress, primary, large, busy }: {
  icon: typeof Play; label: string; onPress: () => void; primary?: boolean; large?: boolean; busy?: boolean;
}) {
  const theme = useAppearance();
  const colors = primaryColors[theme.dark ? 'dark' : 'light'];
  const color = primary ? colors.foreground : theme.text;
  const size = large ? 64 : primary ? 48 : 44;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy, disabled: busy }}
    disabled={busy} onPress={onPress}
    style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2,
      transform: [{ scale: pressed ? 0.94 : 1 }],
      alignItems: 'center', justifyContent: 'center',
      borderWidth: primary ? 1 : 0, borderColor: colors.border,
      backgroundColor: primary ? pressed ? colors.pressed : colors.background
        : pressed ? theme.surface : 'transparent' })}>
    {busy ? <ActivityIndicator color={color} /> : <Icon size={large ? 30 : primary ? 25 : 22} color={color} />}
  </Pressable>;
}
