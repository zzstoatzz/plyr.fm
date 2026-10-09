import { SymbolView } from "expo-symbols";
import { useEffect } from "react";
import { StyleSheet, View, type ColorValue } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, withTiming, type SharedValue } from "react-native-reanimated";
import { levels, watch } from "@/player/levels";
import { usePlayer } from "@/player/PlayerProvider";
import { useAccent } from "@/settings";

const HEIGHT = 18;

function Bar({ level, tint }: { level: SharedValue<number>; tint: ColorValue }) {
  const height = useAnimatedStyle(() => ({ height: withTiming(level.value * HEIGHT, { duration: 60 }) }));
  return <Animated.View style={[styles.bar, { backgroundColor: tint }, height]} />;
}

/** The mark on the track that is current: bars that follow the audio while it plays and hold still when it stops. Reduce Motion gets the still glyph. */
export function Levels() {
  const { accent } = useAccent();
  const { status } = usePlayer();
  const still = useReducedMotion();
  const moving = !still && status === "playing";
  useEffect(() => (moving ? watch() : undefined), [moving]);
  if (still) return <SymbolView name="waveform" size={HEIGHT} tintColor={accent} />;
  return (
    <View style={styles.bars} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {levels.map((level, bar) => (
        <Bar key={bar} level={level} tint={accent} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bars: { flexDirection: "row", alignItems: "center", gap: 2, height: HEIGHT, width: 18, justifyContent: "center" },
  bar: { width: 3, borderRadius: 1.5 },
});
