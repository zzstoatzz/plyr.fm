import { Link } from 'expo-router';
import Check from 'lucide-react-native/icons/check';
import Info from 'lucide-react-native/icons/info';
import TriangleAlert from 'lucide-react-native/icons/triangle-alert';
import X from 'lucide-react-native/icons/x';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View, useWindowDimensions, type ViewInstance } from 'react-native';
import { useAppearance } from './appearance';
import { glassSurface } from './materials';
import { useSheetPresent } from './player-sheet';
import { BodyPortal } from './BodyPortal';
import { Text } from './Text';
import { toast, useToasts, type Toast } from './toast';

const icons = { success: Check, error: X, info: Info, warning: TriangleAlert };

/** Marks where the stack sits: place it directly above the player dock. */
export function Toasts() {
  const items = useToasts();
  const sheet = useSheetPresent();
  const { width, height } = useWindowDimensions();
  const anchor = useRef<ViewInstance>(null);
  const [top, setTop] = useState<number>();
  useEffect(() => {
    if (!items.length) return;
    anchor.current?.measureInWindow((_x, y) => setTop(y));
  }, [items.length, width, height]);
  const bottom = sheet || top === undefined ? 16 : Math.max(16, height - top + 8);
  const stack = items.length > 0 && <View testID="toasts" role="region" aria-live="polite" aria-label="notifications" pointerEvents="box-none"
    style={[styles.stack, Platform.OS === 'web' && styles.fixed, { bottom, maxWidth: Math.min(450, width - 24) }]}>
    {items.map(item => <ToastCard key={item.id} item={item} />)}
  </View>;
  return <View ref={anchor} pointerEvents="box-none" style={styles.anchor}>
    {Platform.OS === 'web' ? stack && <BodyPortal>{stack}</BodyPortal> : stack}
  </View>;
}

function ToastCard({ item }: { item: Toast }) {
  const theme = useAppearance();
  const shown = useRef(new Animated.Value(theme.reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (theme.reduceMotion) { shown.setValue(item.leaving ? 0 : 1); return; }
    Animated.timing(shown, { toValue: item.leaving ? 0 : 1, duration: item.leaving ? toast.leave : 220,
      easing: item.leaving ? Easing.in(Easing.quad) : Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [item.leaving, shown, theme.reduceMotion]);
  const Icon = icons[item.type];
  const tint = item.type === 'error' || item.type === 'warning' ? theme.danger : item.type === 'success' ? theme.accent : theme.muted;
  return <Animated.View testID="toast" role={item.type === 'error' ? 'alert' : 'status'} pointerEvents="box-none"
    style={[glassSurface(theme), styles.card, { boxShadow: theme.dark ? '0px 8px 24px #0000004d' : '0px 8px 24px #00000024',
      opacity: shown, transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>
    <Icon size={16} color={tint} strokeWidth={2.5} />
    {item.message ? <Text style={{ flexShrink: 1, color: theme.text, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale, fontWeight: '500' }}>{item.message}</Text> : null}
    {item.action && <Link href={item.action.href} asChild>
      <Pressable accessibilityRole="link" onPress={() => toast.dismiss(item.id)} hitSlop={12}>
        <Text style={{ color: theme.accent, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale, fontWeight: '600', textDecorationLine: 'underline' }}>{item.action.label}</Text>
      </Pressable>
    </Link>}
  </Animated.View>;
}

const styles = StyleSheet.create({
  anchor: { height: 0, overflow: 'visible', zIndex: 10 },
  stack: { position: 'absolute', left: 12, gap: 8, alignItems: 'flex-start', zIndex: 10000 },
  fixed: { position: 'fixed' as 'absolute' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, maxWidth: '100%' },
});
