import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, View } from 'react-native';
import { useAppearance } from './appearance';

const resting = [0.55, 1, 0.7];

export function PlayerLoader({ color, size = 18 }: { color: string; size?: number }) {
  const { reduceMotion } = useAppearance();
  const bars = useRef(resting.map(height => new Animated.Value(height))).current;
  useEffect(() => {
    if (reduceMotion) { bars.forEach((bar, at) => bar.setValue(resting[at])); return; }
    const native = Platform.OS !== 'web';
    const animation = Animated.stagger(120, bars.map(bar => Animated.loop(Animated.sequence([
      Animated.timing(bar, { toValue: 1, duration: 380, easing: Easing.inOut(Easing.sin), useNativeDriver: native, isInteraction: false }),
      Animated.timing(bar, { toValue: 0.3, duration: 380, easing: Easing.inOut(Easing.sin), useNativeDriver: native, isInteraction: false }),
    ]))));
    bars.forEach(bar => bar.setValue(0.3));
    animation.start();
    return () => { animation.stop(); bars.forEach(bar => bar.stopAnimation()); };
  }, [bars, reduceMotion]);
  const width = Math.max(2, Math.round(size / 6));
  return <View accessibilityRole="progressbar" accessibilityLabel="Loading playback" style={{ width: size, height: size, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: width }}>
    {bars.map((bar, at) => <Animated.View key={at} style={{ width, height: size, borderRadius: width / 2, backgroundColor: color, transform: [{ scaleY: bar }] }} />)}
  </View>;
}
