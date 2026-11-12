import Heart from 'lucide-react-native/icons/heart';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { useAppearance } from './appearance';

/** The like glyph. It dips, overshoots and throws a ring when a like lands, and stays still otherwise. */
export function LikeHeart({ liked, size = 21 }: { liked: boolean | undefined; size?: number }) {
  const theme = useAppearance();
  const pulse = useRef(new Animated.Value(0)).current;
  const previous = useRef(liked);
  useEffect(() => {
    const landed = previous.current === false && liked === true;
    previous.current = liked;
    if (!landed || theme.reduceMotion) return;
    pulse.setValue(0);
    Animated.timing(pulse, { toValue: 1, duration: 600, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [liked, pulse, theme.reduceMotion]);
  return <View style={{ width: size, height: size }}>
    <Animated.View testID="like-ring" pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: size / 2, borderWidth: 2, borderColor: theme.accent,
      opacity: pulse.interpolate({ inputRange: [0, 0.2, 0.7, 1], outputRange: [0, 0.6, 0.35, 0] }),
      transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.9] }) }] }]} />
    <Animated.View testID="like-heart" style={{ transform: [{ scale: pulse.interpolate({ inputRange: [0, 0.33, 0.66, 1], outputRange: [1, 0.7, 1.2, 1] }) }] }}>
      <Heart size={size} color={liked ? theme.accent : theme.muted} fill={liked ? theme.accent : 'none'} />
    </Animated.View>
  </View>;
}
