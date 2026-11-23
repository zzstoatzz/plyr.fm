import { memo, useEffect, useMemo, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useAppearance } from './appearance';
import { usePlayingLevels, waveHeights } from './playing-levels';

const times = [0, 0.2, 0.45, 0.7, 0.85, 1];
const heights = [
  [0.45, 0.76, 0.35, 0.62, 0.29, 0.45],
  [0.92, 0.47, 0.82, 0.31, 0.73, 0.92],
  [0.64, 0.97, 0.42, 0.78, 0.94, 0.64],
  [0.34, 0.58, 0.72, 0.38, 0.53, 0.34]
];

/** `live={false}` for someone else's listening: the bars only follow audio this app plays. */
export const PlayingWave = memo(function PlayingWave({ color, size = 18, live = true }: { color: string; size?: number; live?: boolean }) {
  const { reduceMotion } = useAppearance();
  const following = usePlayingLevels(live && !reduceMotion);
  const [progress] = useState(() => new Animated.Value(0));
  const bars = useMemo(() => heights.map(outputRange => progress.interpolate({ inputRange: times, outputRange })), [progress]);
  useEffect(() => {
    progress.setValue(0);
    if (reduceMotion) return;
    const animation = Animated.loop(Animated.timing(progress, {
      toValue: 1, duration: 940, easing: Easing.linear, useNativeDriver: true, isInteraction: false
    }));
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion]);
  const width = size / 6;
  return <View aria-hidden pointerEvents="none" testID="playing-wave" style={{ width: size, height: size, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
    {bars.map((scaleY, index) => <Animated.View key={index} style={{
      width, height: size, borderRadius: width / 2, backgroundColor: color,
      transform: [{ scaleY: reduceMotion ? heights[index][0] : following ? waveHeights[index] : scaleY }]
    }} />)}
  </View>;
});

export function PlayingArtworkOverlay() {
  return <View pointerEvents="none" style={styles.artwork}><PlayingWave color="#fff" /></View>;
}

const styles = StyleSheet.create({
  artwork: { ...StyleSheet.absoluteFill, borderRadius: 6, backgroundColor: '#0009', alignItems: 'center', justifyContent: 'center' }
});
