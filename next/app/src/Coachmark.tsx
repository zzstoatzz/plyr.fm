import ArrowDown from 'lucide-react-native/icons/arrow-down';
import ArrowUp from 'lucide-react-native/icons/arrow-up';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { useAppearance } from './appearance';
import { Action } from './controls';
import { hints, useHint, type HintId } from './hints';
import { Text } from './Text';

/**
 * A one-time hint drawn beside the thing it teaches. Place it in the target's own layout (usually absolutely
 * positioned in the same parent) with its arrow pointing at the target; it renders nothing unless it is the
 * app's current hint, appears once the screen has settled, and is gone for good after "got it".
 */
export function Coachmark({ hint, ready = true, arrow = 'down', style, touch }: {
  hint: HintId; ready?: boolean; arrow?: 'up' | 'down'; style?: StyleProp<ViewStyle>; touch?: ViewProps;
}) {
  const theme = useAppearance();
  const { shown, dismiss } = useHint(hint, ready);
  const [visible, setVisible] = useState(false);
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!shown) { setVisible(false); appear.setValue(0); return; }
    const timer = setTimeout(() => {
      setVisible(true);
      Animated.timing(appear, { toValue: 1, duration: theme.reduceMotion ? 0 : 220, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
    }, 700);
    return () => clearTimeout(timer);
  }, [shown, appear, theme.reduceMotion]);
  if (!visible) return null;
  const Icon = arrow === 'down' ? ArrowDown : ArrowUp;
  const text = hints.find(spec => spec.id === hint)?.text ?? '';
  const lift = appear.interpolate({ inputRange: [0, 1], outputRange: [arrow === 'down' ? -8 : 8, 0] });
  return <Animated.View pointerEvents="box-none" style={[style, { opacity: appear, transform: [{ translateY: lift }] }]}>
    <View {...touch} testID="coachmark" accessibilityLiveRegion="polite" role="status" style={[styles.bubble, { backgroundColor: theme.accent }]}>
      <Icon size={20} color={theme.onAccent} aria-hidden />
      <Text style={[styles.text, { color: theme.onAccent, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale, lineHeight: 19 * theme.scale }]}>{text}</Text>
      <Action label="got it" onAccentFill onPress={dismiss} />
      <View pointerEvents="none" style={[styles.tip, arrow === 'down' ? styles.tipDown : styles.tipUp, { backgroundColor: theme.accent }]} />
    </View>
  </Animated.View>;
}

const styles = StyleSheet.create({
  bubble: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, paddingVertical: 8, paddingLeft: 16, paddingRight: 8 },
  text: { flex: 1, minWidth: 0, fontWeight: '600' },
  tip: { position: 'absolute', left: '50%', width: 12, height: 12, marginLeft: -6, transform: [{ rotate: '45deg' }] },
  tipDown: { bottom: -6 },
  tipUp: { top: -6 },
});
