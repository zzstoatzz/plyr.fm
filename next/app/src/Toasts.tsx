import { Link } from 'expo-router';
import { Check, Info, Warning as TriangleAlert, X } from './icons';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useAppearance } from './appearance';
import { glassSurface } from './materials';
import { Text } from './Text';
import { toast, useToasts, type Toast } from './toast';

const icons = { success: Check, error: X, info: Info, warning: TriangleAlert };

export function Toasts() {
  const items = useToasts();
  return <View pointerEvents="box-none" style={styles.anchor}>
    {items.length > 0 && <View testID="toasts" role="region" aria-live="polite" aria-label="notifications" pointerEvents="box-none" style={styles.stack}>
      {items.map(item => <ToastCard key={item.id} item={item} />)}
    </View>}
  </View>;
}

function ToastCard({ item }: { item: Toast }) {
  const theme = useAppearance();
  const shown = useRef(new Animated.Value(theme.reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (theme.reduceMotion) { shown.setValue(item.leaving ? 0 : 1); return; }
    Animated.timing(shown, { toValue: item.leaving ? 0 : 1, duration: item.leaving ? toast.leave : 220,
      easing: item.leaving ? Easing.in(Easing.quad) : Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [item.leaving, shown, theme.reduceMotion]);
  const Icon = icons[item.type];
  const tint = item.type === 'error' || item.type === 'warning' ? theme.danger : item.type === 'success' ? theme.accent : theme.muted;
  const label = { color: theme.text, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale, fontWeight: '500' as const };
  const body = <>
    <Icon size={16} color={tint} strokeWidth={2.5} />
    {item.message ? <Text style={[label, { flexShrink: 1 }]}>{item.message}</Text> : null}
    {item.action && <Text style={[label, { color: theme.accent, fontWeight: '600' }]}>{item.action.label} ›</Text>}
  </>;
  return <Animated.View testID="toast" role={item.type === 'error' ? 'alert' : 'status'} pointerEvents={item.action ? 'box-none' : 'none'}
    style={[glassSurface(theme), styles.card, { boxShadow: theme.dark ? '0px 8px 24px #0000004d' : '0px 8px 24px #00000024',
      opacity: shown, transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }] }]}>
    {item.action ? <Link href={item.action.href} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={`${item.message}. ${item.action.label}`} onPress={() => toast.dismiss(item.id)}
        style={styles.content}>{body}</Pressable>
    </Link> : <View style={styles.content}>{body}</View>}
  </Animated.View>;
}

const styles = StyleSheet.create({
  anchor: { height: 0, overflow: 'visible', zIndex: 10 },
  stack: { position: 'absolute', top: 8, left: 12, right: 12, gap: 8, alignItems: 'center', zIndex: 10000 },
  card: { borderRadius: 10, maxWidth: '100%' },
  content: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, minHeight: 44 },
});
