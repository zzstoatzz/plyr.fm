import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';
import { useAppearance } from './appearance';

const resting = [0.4, 0.72, 1, 0.72, 0.4];

export function WaveLoading({ label }: { label: string }) {
  const theme = useAppearance();
  const bars = useRef(resting.map((height) => new Animated.Value(height))).current;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const reveal = setTimeout(() => setVisible(true), 180);
    let disposed = false;
    let animation: Animated.CompositeAnimation | undefined;

    function update(reduced: boolean) {
      if (disposed) return;
      animation?.stop();
      bars.forEach((bar, i) => bar.setValue(reduced ? resting[i] : 0.3));
      if (reduced) return;
      animation = Animated.stagger(90, bars.map((bar) => Animated.loop(Animated.sequence([
        Animated.timing(bar, { toValue: 1, duration: 575, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
        Animated.timing(bar, { toValue: 0.3, duration: 575, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
      ]))));
      animation.start();
    }

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', update);
    void AccessibilityInfo.isReduceMotionEnabled().then(update, () => update(true));
    return () => {
      disposed = true;
      clearTimeout(reveal);
      subscription.remove();
      animation?.stop();
      bars.forEach((bar) => bar.stopAnimation());
    };
  }, [bars]);

  return <View accessibilityRole="progressbar" accessibilityLabel={label}
    style={{ minHeight: 88, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, opacity: visible ? 1 : 0 }}>
    {bars.map((height, index) => <Animated.View key={index} style={{
      width: 5, height: 28, borderRadius: 3, backgroundColor: theme.accent, transform: [{ scaleY: height }],
    }} />)}
  </View>;
}
