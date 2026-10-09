import { RAINBOW } from "plyr-shared/rainbow";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Mask, Rect, Stop } from "react-native-svg";

const LINE = 2;
const GLOW = 20;
const GLOW_COMPACT = 7;
const LAP_MS = 9000;
const BREATH_MS = 2400;
const PAUSED_OPACITY = 0.32;

const stops = [...RAINBOW, RAINBOW[0]];

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduce);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => subscription.remove();
  }, []);
  return reduce;
}

/** One lap of the rainbow: the line itself, or, given a depth, its glow falling away beneath it. */
function Lap({ width, glow }: { width: number; glow: number }) {
  return (
    <Svg width={width} height={glow || LINE}>
      <Defs>
        <LinearGradient id="colors" x1="0" y1="0" x2="1" y2="0">
          {stops.map((stop, i) => (
            <Stop key={i} offset={i / (stops.length - 1)} stopColor={stop} />
          ))}
        </LinearGradient>
        <LinearGradient id="falloff" x1="0" y1="0" x2="0" y2="1">
          <Stop offset={0} stopColor="#fff" stopOpacity={0.85} />
          <Stop offset={0.4} stopColor="#fff" stopOpacity={0.3} />
          <Stop offset={1} stopColor="#fff" stopOpacity={0} />
        </LinearGradient>
        <Mask id="fade">
          <Rect width={width} height={glow || LINE} fill="url(#falloff)" />
        </Mask>
      </Defs>
      <Rect width={width} height={glow || LINE} fill="url(#colors)" mask={glow ? "url(#fade)" : undefined} />
    </Svg>
  );
}

/** The web player's rainbow top bar: it drifts and glows while a track plays, and rests dim when paused. Reduce Motion keeps the glow and drops the movement. */
export function RainbowStrip({ lit, compact = false, style }: { lit: boolean; compact?: boolean; style?: StyleProp<ViewStyle> }) {
  const depth = compact ? GLOW_COMPACT : GLOW;
  const [width, setWidth] = useState(0);
  const [drift] = useState(() => new Animated.Value(0));
  const [breath] = useState(() => new Animated.Value(0));
  const reduce = useReduceMotion();
  const moving = lit && !reduce && width > 0;

  useEffect(() => {
    if (!moving) return;
    const lap = Animated.loop(Animated.timing(drift, { toValue: 1, duration: LAP_MS, easing: Easing.linear, useNativeDriver: true }));
    const half = { duration: BREATH_MS / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true };
    const pulse = Animated.loop(Animated.sequence([Animated.timing(breath, { toValue: 1, ...half }), Animated.timing(breath, { toValue: 0, ...half })]));
    lap.start();
    pulse.start();
    return () => {
      lap.stop();
      pulse.stop();
    };
  }, [moving, drift, breath]);

  const slide = { transform: [{ translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [0, -width] }) }] };
  return (
    <View
      style={[styles.strip, { height: depth }, style]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {width > 0 ? (
        <>
          <Animated.View style={[styles.laps, slide, { width: width * 2, opacity: lit ? breath.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) : 0 }]}>
            <Lap width={width} glow={depth} />
            <Lap width={width} glow={depth} />
          </Animated.View>
          <Animated.View style={[styles.laps, slide, { width: width * 2, opacity: lit ? 1 : PAUSED_OPACITY }]}>
            <Lap width={width} glow={0} />
            <Lap width={width} glow={0} />
          </Animated.View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { overflow: "hidden", borderTopLeftRadius: LINE, borderTopRightRadius: LINE },
  laps: { position: "absolute", top: 0, left: 0, flexDirection: "row" },
});
