import { RAINBOW, TOP_BAR } from "plyr-shared/topBar";
import { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, View, type ColorValue } from "react-native";
import Svg, { Defs, LinearGradient, Mask, Path, Rect, Stop } from "react-native-svg";
import { color, edgeLine } from "@/theme";

const LINE = TOP_BAR.height;
const [NEAR, FAR] = TOP_BAR.glow;
const jamStops = [...RAINBOW, RAINBOW[0]];

/** The container's top edge as a stroke: along the top, round both corners, fading out down the sides. */
function Arc({ width, radius, stroke }: { width: number; radius: number; stroke: ColorValue | null }) {
  const height = radius + LINE;
  const inner = radius - LINE / 2;
  const corner = radius / width;
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="sides" x1="0" y1="0" x2="1" y2="0">
          <Stop offset={0} stopColor="#fff" stopOpacity={0} />
          <Stop offset={corner} stopColor="#fff" stopOpacity={1} />
          <Stop offset={1 - corner} stopColor="#fff" stopOpacity={1} />
          <Stop offset={1} stopColor="#fff" stopOpacity={0} />
        </LinearGradient>
        <LinearGradient id="jam" x1="0" y1="0" x2="1" y2="0">
          {jamStops.map((stop, i) => (
            <Stop key={i} offset={i / (jamStops.length - 1)} stopColor={stop} />
          ))}
        </LinearGradient>
        <Mask id="fade">
          <Rect width={width} height={height} fill="url(#sides)" />
        </Mask>
      </Defs>
      <Path
        d={`M ${LINE / 2} ${radius} A ${inner} ${inner} 0 0 1 ${radius} ${LINE / 2} H ${width - radius} A ${inner} ${inner} 0 0 1 ${width - LINE / 2} ${radius}`}
        fill="none"
        stroke={stroke ?? "url(#jam)"}
        strokeWidth={LINE}
        mask="url(#fade)"
      />
    </Svg>
  );
}

/**
 * The web player's top bar, drawn on the edge of whatever it fills: an accent hairline, dim at rest, bright and
 * glowing while a track plays. `radius` is the container's corner radius; without one it is a capsule.
 * The change is a fade, so Reduce Motion has nothing to still.
 */
export function TopEdge({ lit, radius, jam = false }: { lit: boolean; radius?: number; jam?: boolean }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [glow] = useState(() => new Animated.Value(lit ? 1 : 0));

  useEffect(() => {
    const fade = Animated.timing(glow, { toValue: lit ? 1 : 0, duration: TOP_BAR.fadeMs, easing: Easing.out(Easing.ease), useNativeDriver: true });
    fade.start();
    return () => fade.stop();
  }, [lit, glow]);

  const corner = Math.min(radius ?? size.height / 2, size.width / 2);
  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={({ nativeEvent }) => setSize({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {corner > 0 ? (
        <>
          <Animated.View style={[styles.layer, { opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [TOP_BAR.resting.opacity, 0] }) }]}>
            <Arc width={size.width} radius={corner} stroke={jam ? null : edgeLine.resting} />
          </Animated.View>
          <Animated.View style={[styles.layer, styles.far, { opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0, TOP_BAR.playing.opacity] }) }]}>
            <View style={styles.near}>
              <Arc width={size.width} radius={corner} stroke={jam ? null : edgeLine.playing} />
            </View>
          </Animated.View>
        </>
      ) : null}
    </View>
  );
}

const shadow = { shadowColor: color.accent, shadowOffset: { width: 0, height: 0 } };

const styles = StyleSheet.create({
  layer: { position: "absolute", top: 0, left: 0 },
  // a CSS blur of n px is a gaussian of n/2, which is what shadowRadius takes
  near: { ...shadow, shadowRadius: NEAR.blur / 2, shadowOpacity: NEAR.alpha },
  far: { ...shadow, shadowRadius: FAR.blur / 2, shadowOpacity: FAR.alpha },
});
