import { useMemo, type ReactNode } from 'react';
import { Animated } from 'react-native';
import { playerSheet } from './player-sheet';
import { flightRanges, type Flight } from './player-flight-path';

type Window = readonly [number, number];
const whole: Window = [0, 1];

export function PlayerFlight({ testID, from, to, rest, origin, children, left, originFade = whole, fade = whole }: Flight & {
  testID: string; rest: number; origin: ReactNode; children: ReactNode;
  left?: readonly number[]; originFade?: Window; fade?: Window;
}) {
  // Built once per flight: a node recreated by a re-render would reattach mid-spring and draw one frame from a stale value.
  const motion = useMemo(() => {
    const translation = playerSheet.translation;
    const ranges = flightRanges({ from, to }, rest, left);
    const during = ([start, end]: Window, open: number, docked: number) => translation.interpolate({
      inputRange: [rest * (1 - end), rest * (1 - start)], outputRange: [open, docked], extrapolate: 'clamp' });
    const scale = from.height / to.height;
    return {
      transform: [{ translateX: translation.interpolate({ ...ranges.translateX, extrapolate: 'clamp' }) },
        { translateY: translation.interpolate({ ...ranges.translateY, extrapolate: 'clamp' }) },
        { scale: translation.interpolate({ ...ranges.scale, extrapolate: 'clamp' }) }],
      children: during(fade, 1, 0),
      origin: during(originFade, 0, 1),
      unscale: 1 / scale,
    };
  }, [from, to, rest, left, fade, originFade]);
  return <Animated.View testID={testID} style={{ position: 'absolute', left: to.x, top: to.y, width: to.width, height: to.height, transformOrigin: 'top left',
    transform: motion.transform }}>
    <Animated.View style={{ opacity: motion.children }}>{children}</Animated.View>
    <Animated.View style={{ position: 'absolute', left: 0, top: 0, width: from.width, height: from.height, transformOrigin: 'top left',
      transform: [{ scale: motion.unscale }], opacity: motion.origin }}>{origin}</Animated.View>
  </Animated.View>;
}
