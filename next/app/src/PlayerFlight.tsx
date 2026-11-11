import type { ReactNode } from 'react';
import { Animated } from 'react-native';
import { playerSheet, type Rect } from './player-sheet';

type Window = readonly [number, number];

export function PlayerFlight({ testID, from, to, rest, origin, children, originFade = [0, 1], fade = [0, 1] }: {
  testID: string; from: Rect; to: Rect; rest: number; origin: ReactNode; children: ReactNode; originFade?: Window; fade?: Window;
}) {
  const range = { inputRange: [0, rest], extrapolate: 'clamp' as const };
  const at = (open: number, docked: number) => playerSheet.translation.interpolate({ ...range, outputRange: [open, docked] });
  const during = ([start, end]: Window, open: number, docked: number) => playerSheet.translation.interpolate({
    inputRange: [rest * (1 - end), rest * (1 - start)], outputRange: [open, docked], extrapolate: 'clamp' });
  const scale = from.height / to.height;
  return <Animated.View testID={testID} style={{ position: 'absolute', left: to.x, top: to.y, width: to.width, height: to.height, transformOrigin: 'top left',
    transform: [{ translateX: at(0, from.x - to.x) }, { translateY: at(0, from.y - to.y) }, { scale: at(1, scale) }] }}>
    <Animated.View style={{ opacity: during(fade, 1, 0) }}>{children}</Animated.View>
    <Animated.View style={{ position: 'absolute', left: 0, top: 0, width: from.width, height: from.height, transformOrigin: 'top left',
      transform: [{ scale: 1 / scale }], opacity: during(originFade, 0, 1) }}>{origin}</Animated.View>
  </Animated.View>;
}
